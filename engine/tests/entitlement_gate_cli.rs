//! End-to-end verification of the AUD-1 entitlement-gate wiring: the CLI
//! dispatch must actually ENFORCE the plan matrix (docs/COMMERCIAL.md
//! §"Tiers → gated surfaces") before a premium surface runs — the gate
//! logic was unit-tested since issue #94, but `sync push` succeeded with
//! zero license state until now (the gate had no production caller).
//!
//! Chosen gating matrix (recorded in the commit + docs/COMMERCIAL.md):
//! - FREE (never gated): every core measured surface INCLUDING local
//!   `export` — artifacts-as-code writes to the LOCAL disk (doctor, graph,
//!   health, analyze, dependencies, build, store, synth, daemon, telemetry,
//!   experiment, events, ai, git, impact, what-changed, export, activate,
//!   entitlement, license). The TEAM feature is export SHARING, not local
//!   artifact writing.
//! - TEAM (minimum): `sync.push` + `sync.pull` — the registry-branch
//!   sharing + CI-referee transport. Both directions: a shared registry a
//!   licenseless machine could read would leak exactly the data the gate
//!   exists to protect.
//! - ENTERPRISE: everything Team has (future enterprise-only surfaces as
//!   they register).
//!
//! Refusal contract: named `subscription required` error, exit 2, stdout
//! stays EMPTY (the machine envelope is only for real results), the stderr
//! message names the surface, the required plan and the remediation
//! (`wanyrix activate`, docs/COMMERCIAL.md). NO wall-clock value appears in
//! a refusal payload. Grace is honored fully OFFLINE with a visible label.
//! The documented `WANYRIX_ALLOW_UNLICENSED=1` escape hatch exists for
//! CI/dev honest dry-runs; the default is strict.
//!
//! License chains here are minted by the real maintainer tooling
//! (`license keygen --json` — the QA-4-B-2 envelope — plus `license issue`)
//! in temp dirs and verified through the documented
//! `WANYRIX_ACTIVATION_PUBKEY` override. No private key is committed.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;
use wanyrix_engine::entitlement::{issue_signed, IssueRequest};
use wanyrix_engine::Plan;

fn temp_dir(name: &str) -> PathBuf {
    // Under the engine crate's target/ (gitignored, never scanned). Made
    // ABSOLUTE + created eagerly: the binary runs with current_dir(root).
    let rel = format!(
        "target/wanyrix-gate-cli-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    let abs = std::env::current_dir().unwrap().join(rel);
    std::fs::create_dir_all(&abs).unwrap();
    abs
}

/// Run the real binary inside `cwd` (which becomes BOTH the operator shell
/// and the `.wanyrix` entitlement state root — the gate reads the exact
/// cache `activate` writes).
fn run_in(cwd: &Path, envs: &[(&str, &str)], args: &[&str]) -> (String, String, i32) {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_wanyrix"));
    cmd.args(args).current_dir(cwd);
    for (k, v) in envs {
        cmd.env(k, v);
    }
    let out = cmd.output().unwrap();
    (
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8(out.stderr).unwrap(),
        out.status.code().unwrap_or(-1),
    )
}

/* --------------------- git fixtures (sync transport) ------------------- */

fn git_available() -> bool {
    Command::new("git")
        .args(["--version"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Run git inside `dir` with a fixed test identity (the sync commits use
/// their own machine identity; test-authored commits must not depend on
/// the runner's git config).
fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_AUTHOR_NAME", "gate-cli-test")
        .env("GIT_AUTHOR_EMAIL", "gate-cli-test@example.invalid")
        .env("GIT_COMMITTER_NAME", "gate-cli-test")
        .env("GIT_COMMITTER_EMAIL", "gate-cli-test@example.invalid")
        .output()
        .expect("git must be available (git_available() checked)");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// The shared store: a plain git repo whose registry branch appears on the
/// first push.
fn setup_remote(name: &str) -> PathBuf {
    let remote = temp_dir(name);
    git(&remote, &["init", "--quiet", "-b", "main"]);
    std::fs::write(remote.join("README.md"), "# gate-cli fixture remote\n").unwrap();
    git(&remote, &["add", "README.md"]);
    git(&remote, &["commit", "--quiet", "-m", "init"]);
    remote
}

/// A fresh clone of `remote` — the operator's checkout to sync FROM.
fn clone_of(remote: &Path, name: &str) -> PathBuf {
    let dir = temp_dir(name);
    git(
        &dir,
        &["clone", "--quiet", remote.to_str().unwrap(), "clone"],
    );
    dir.join("clone")
}

fn make_fixture(clone: &Path, seed: u64) {
    wanyrix_engine::synth::synth(&clone.join("fixture-ws"), 2, seed).unwrap();
}

fn parse(stdout: &str) -> Value {
    serde_json::from_str(stdout.trim())
        .unwrap_or_else(|e| panic!("stdout must be the JSON envelope ({e}): {stdout}"))
}

/// True when `s` embeds an ISO-8601 `YYYY-MM-DDTHH:MM:SSZ` timestamp. The
/// refusal contract bans wall-clock nondeterminism in ERROR payloads, so
/// the subscription refusal must never match this.
fn contains_iso8601(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() < 20 {
        return false;
    }
    let digits = |r: std::ops::Range<usize>, w: &[u8]| r.clone().all(|i| w[i].is_ascii_digit());
    for i in 0..=b.len() - 20 {
        let w = &b[i..i + 20];
        if w[4] == b'-'
            && w[7] == b'-'
            && w[10] == b'T'
            && w[13] == b':'
            && w[16] == b':'
            && w[19] == b'Z'
            && digits(0..4, w)
            && digits(5..7, w)
            && digits(8..10, w)
            && digits(11..13, w)
            && digits(14..16, w)
            && digits(17..19, w)
        {
            return true;
        }
    }
    false
}

/* -------------------- license chain via the real tooling --------------- */

/// Mint a keypair with `license keygen --json` (the QA-4-B-2 envelope —
/// dogfooded here as the only machine-readable source of the public half)
/// and return (private-key hex from the 0600 file, public-key hex).
fn mint_keypair(root: &Path, name: &str) -> (String, String) {
    let dir = root.join(format!("keys-{name}"));
    let (stdout, stderr, code) = run_in(
        root,
        &[],
        &[
            "license",
            "keygen",
            "--out",
            dir.to_str().unwrap(),
            "--json",
        ],
    );
    assert_eq!(code, 0, "keygen --json failed: {stderr}");
    let report = parse(&stdout);
    assert_eq!(report["schema"], "wanyrix.license-keygen/v1");
    let priv_path = root.join(report["privateKeyPath"].as_str().unwrap());
    let priv_hex = std::fs::read_to_string(priv_path)
        .unwrap()
        .trim()
        .to_owned();
    let pub_hex = report["publicKeyHex"].as_str().unwrap().to_owned();
    (priv_hex, pub_hex)
}

/// `license issue --json` a trial-shaped TEAM token (14 days) with the
/// minted key and return the token file path.
fn issue_trial_token(root: &Path, priv_hex: &str) -> PathBuf {
    let (stdout, stderr, code) = run_in(
        root,
        &[],
        &[
            "license", "issue", "--plan", "team", "--team", "acme", "--days", "14", "--seats", "5",
            "--key", priv_hex, "--json",
        ],
    );
    assert_eq!(code, 0, "license issue failed: {stderr}");
    let token: Value = parse(&stdout);
    assert_eq!(token["schema"], "wanyrix.entitlement.token/v1");
    assert_eq!(token["plan"], "team");
    let file = root.join("token.json");
    std::fs::write(&file, stdout.trim()).unwrap();
    file
}

/// Push args from an operator cwd (relative --path per the sync contract).
fn push_args(remote: &Path) -> Vec<String> {
    vec![
        "sync".into(),
        "push".into(),
        "--remote".into(),
        remote.display().to_string(),
        "--path".into(),
        "fixture-ws".into(),
        "--json".into(),
    ]
}

fn strs(v: &[String]) -> Vec<&str> {
    v.iter().map(String::as_str).collect()
}

/* -------------------------------- tests -------------------------------- */

#[test]
fn sync_push_without_a_license_is_a_named_subscription_refusal() {
    if !git_available() {
        println!("SKIP: git binary unavailable — sync's registry transport needs it");
        return;
    }
    let _root = temp_dir("no-license");
    let remote = setup_remote("no-license-remote");
    let clone = clone_of(&remote, "no-license-clone");
    make_fixture(&clone, 17);

    let (stdout, stderr, code) = run_in(&clone, &[], &strs(&push_args(&remote)));
    assert_eq!(code, 2, "unlicensed sync push must exit 2: {stderr}");
    assert!(
        stdout.trim().is_empty(),
        "error discipline: stdout stays empty on refusal, got: {stdout}"
    );
    // Named: the error kind, the surface, the required plan.
    assert!(stderr.contains("subscription required"), "named: {stderr}");
    assert!(stderr.contains("sync.push"), "names the surface: {stderr}");
    assert!(stderr.contains("team"), "names the required plan: {stderr}");
    // Actionable: the activation command and the commercial doc pointer.
    assert!(stderr.contains("wanyrix activate"), "actionable: {stderr}");
    assert!(
        stderr.contains("docs/COMMERCIAL.md"),
        "doc pointer: {stderr}"
    );
    // NO wall-clock nondeterminism in the refusal payload: no ISO-8601
    // timestamp anywhere in the error text (the only dates a refusal may
    // name are the TOKEN's expiry day as data — and the missing-license
    // refusal names none).
    assert!(
        !contains_iso8601(&stderr),
        "refusal must not embed wall-clock timestamps: {stderr}"
    );
}

#[test]
fn sync_push_after_trial_team_license_activation_is_allowed() {
    if !git_available() {
        println!("SKIP: git binary unavailable — sync's registry transport needs it");
        return;
    }
    let root = temp_dir("activated");
    let (priv_hex, pub_hex) = mint_keypair(&root, "activated");
    let token_file = issue_trial_token(&root, &priv_hex);
    let pubkey_env = &[("WANYRIX_ACTIVATION_PUBKEY", pub_hex.as_str())];

    // Activate (offline ed25519 verification against the minted public half).
    let (stdout, stderr, code) = run_in(
        &root,
        pubkey_env,
        &["activate", "--key", token_file.to_str().unwrap()],
    );
    assert_eq!(code, 0, "activate failed: {stderr}");
    assert!(stdout.contains("plan: team"), "{stdout}");
    assert!(
        root.join(".wanyrix/entitlement.json").exists(),
        "cache written"
    );

    // The gated surface now runs END-TO-END (same cwd = same state root).
    let remote = setup_remote("activated-remote");
    let clone = clone_of(&remote, "activated-clone");
    make_fixture(&clone, 17);
    // The activation cache must live in the DIRECTORY THE OPERATOR SYNCS
    // FROM — activate there (the per-directory state convention).
    let (_, stderr, code) = run_in(
        &clone,
        pubkey_env,
        &["activate", "--key", token_file.to_str().unwrap()],
    );
    assert_eq!(code, 0, "activate in the sync cwd failed: {stderr}");

    let (stdout, stderr, code) = run_in(&clone, pubkey_env, &strs(&push_args(&remote)));
    assert_eq!(code, 0, "entitled sync push must succeed: {stderr}");
    let envelope = parse(&stdout);
    assert_eq!(envelope["schema"], "wanyrix.sync/v1");
    assert_eq!(envelope["action"], "push");
    assert_eq!(
        envelope["committed"], true,
        "the first push really commits the registry bundle"
    );
}

#[test]
fn sync_pull_is_gated_too_per_the_single_mapping() {
    if !git_available() {
        println!("SKIP: git binary unavailable — sync's registry transport needs it");
        return;
    }
    let _root = temp_dir("pull-gated");
    let remote = setup_remote("pull-gated-remote");
    let clone = clone_of(&remote, "pull-gated-clone");
    make_fixture(&clone, 18);

    let (stdout, stderr, code) = run_in(
        &clone,
        &[],
        &[
            "sync",
            "pull",
            "--remote",
            remote.to_str().unwrap(),
            "--path",
            "fixture-ws",
            "--json",
        ],
    );
    assert_eq!(code, 2, "unlicensed sync pull must exit 2: {stderr}");
    assert!(stdout.trim().is_empty(), "stdout stays empty: {stdout}");
    assert!(stderr.contains("subscription required"), "named: {stderr}");
    assert!(stderr.contains("sync.pull"), "names the surface: {stderr}");
    assert!(stderr.contains("team"), "names the plan: {stderr}");
}

#[test]
fn tampered_license_refuses_the_premium_surface_by_name() {
    if !git_available() {
        println!("SKIP: git binary unavailable — sync's registry transport needs it");
        return;
    }
    let root = temp_dir("tampered");
    let (priv_hex, pub_hex) = mint_keypair(&root, "tampered");
    let token_file = issue_trial_token(&root, &priv_hex);
    let pubkey_env = &[("WANYRIX_ACTIVATION_PUBKEY", pub_hex.as_str())];

    let remote = setup_remote("tampered-remote");
    let clone = clone_of(&remote, "tampered-clone");
    make_fixture(&clone, 19);
    let (_, stderr, code) = run_in(
        &clone,
        pubkey_env,
        &["activate", "--key", token_file.to_str().unwrap()],
    );
    assert_eq!(code, 0, "activate failed: {stderr}");

    // Tamper the CACHE after activation (forge enterprise, keep signature).
    let cache = clone.join(".wanyrix/entitlement.json");
    let text = std::fs::read_to_string(&cache).unwrap();
    let forged = text.replace("\"plan\":\"team\"", "\"plan\":\"enterprise\"");
    assert_ne!(text, forged, "fixture tamper must change the bytes");
    std::fs::write(&cache, forged).unwrap();

    let (stdout, stderr, code) = run_in(&clone, pubkey_env, &strs(&push_args(&remote)));
    assert_eq!(code, 2, "tampered license must be refused: {stderr}");
    assert!(stdout.trim().is_empty(), "stdout stays empty: {stdout}");
    assert!(
        stderr.contains("signature verification failed"),
        "named tamper refusal: {stderr}"
    );
    assert!(
        stderr.contains("sync.push"),
        "the refused surface is named: {stderr}"
    );
}

#[test]
fn grace_window_lets_premium_surfaces_run_offline_with_a_visible_label() {
    if !git_available() {
        println!("SKIP: git binary unavailable — sync's registry transport needs it");
        return;
    }
    let root = temp_dir("grace");
    let (priv_hex, pub_hex) = mint_keypair(&root, "grace");
    let pubkey_env = &[("WANYRIX_ACTIVATION_PUBKEY", pub_hex.as_str())];

    // Expired 5 days ago (issued 15 days ago for 10 days) — INSIDE the
    // 30-day revalidation grace. Minted offline; NOTHING here (or in the
    // gate) touches the network.
    let now_day = wanyrix_engine::entitlement::today_day();
    let token = issue_signed(
        &IssueRequest {
            plan: Plan::Team,
            team: "acme".into(),
            days: 10,
            seats: 5,
        },
        &priv_hex,
        now_day - 15,
    )
    .unwrap();
    let token_file = root.join("grace-token.json");
    std::fs::write(&token_file, serde_json::to_string(&token).unwrap()).unwrap();

    let remote = setup_remote("grace-remote");
    let clone = clone_of(&remote, "grace-clone");
    make_fixture(&clone, 20);
    let (stdout, stderr, code) = run_in(
        &clone,
        pubkey_env,
        &["activate", "--key", token_file.to_str().unwrap(), "--json"],
    );
    assert_eq!(code, 0, "grace activation must succeed: {stderr}");
    let report = parse(&stdout);
    assert_eq!(report["status"], "grace", "the envelope labels grace");
    assert_eq!(
        report["graceDaysRemaining"].as_u64().unwrap(),
        wanyrix_engine::entitlement::REVALIDATION_GRACE_DAYS - 5
    );

    // Premium surface runs in grace — with the VISIBLE grace label.
    let (stdout, stderr, code) = run_in(&clone, pubkey_env, &strs(&push_args(&remote)));
    assert_eq!(
        code, 0,
        "grace-window sync push must succeed offline: {stderr}"
    );
    assert_eq!(parse(&stdout)["schema"], "wanyrix.sync/v1");
    assert!(
        stderr.contains("grace"),
        "visible grace label on stderr: {stderr}"
    );
    assert!(
        stderr.contains("renew"),
        "the label carries the remediation: {stderr}"
    );
}

#[test]
fn export_and_free_surfaces_stay_free_while_sync_is_gated() {
    if !git_available() {
        println!("SKIP: git binary unavailable — the sync control needs it");
        return;
    }
    let _root = temp_dir("free-tier");
    let remote = setup_remote("free-tier-remote");
    let clone = clone_of(&remote, "free-tier-clone");
    make_fixture(&clone, 21);

    // NO license anywhere. Every core measured surface keeps working…
    for args in [
        vec!["doctor", "--path", "fixture-ws", "--json"],
        vec!["graph", "--path", "fixture-ws", "--json"],
        vec!["health", "--path", "fixture-ws", "--json"],
        vec!["analyze", "--path", "fixture-ws", "--json"],
        vec!["dependencies", "--path", "fixture-ws", "--json"],
        // …including local `export`: the chosen matrix keeps local
        // artifacts free (COMMERCIAL.md Free tier lists exports; the TEAM
        // feature is export SHARING = the sync transport).
        vec!["export", "--path", "fixture-ws", "--json"],
    ] {
        let (stdout, stderr, code) = run_in(&clone, &[], &args);
        assert_eq!(
            code, 0,
            "free surface {:?} must never be gated: {stderr}",
            args[0]
        );
        let envelope = parse(&stdout);
        let schema = envelope["schema"].as_str().unwrap();
        assert!(
            schema.starts_with("wanyrix."),
            "free surface keeps the envelope family: {schema}"
        );
        if args[0] == "export" {
            assert_eq!(schema, "wanyrix.export/v1");
        }
    }

    // …while the sharing transport stays refused (the matrix boundary).
    let (stdout, stderr, code) = run_in(&clone, &[], &strs(&push_args(&remote)));
    assert_eq!(code, 2, "sync push stays gated: {stderr}");
    assert!(stdout.trim().is_empty());
    assert!(stderr.contains("subscription required"), "{stderr}");
}

#[test]
fn escape_hatch_grants_only_the_exact_documented_value() {
    if !git_available() {
        println!("SKIP: git binary unavailable — sync's registry transport needs it");
        return;
    }
    let _root = temp_dir("hatch");
    let remote = setup_remote("hatch-remote");
    let clone = clone_of(&remote, "hatch-clone");
    make_fixture(&clone, 22);

    // A boolean-ish value is NOT the override: default enforcement holds.
    let (stdout, stderr, code) = run_in(
        &clone,
        &[("WANYRIX_ALLOW_UNLICENSED", "true")],
        &strs(&push_args(&remote)),
    );
    assert_eq!(code, 2, "only the exact documented value grants: {stderr}");
    assert!(stdout.trim().is_empty());
    assert!(stderr.contains("subscription required"), "{stderr}");

    // The exact documented value: the push runs (CI/dev honest dry-run).
    let (stdout, stderr, code) = run_in(
        &clone,
        &[("WANYRIX_ALLOW_UNLICENSED", "1")],
        &strs(&push_args(&remote)),
    );
    assert_eq!(code, 0, "documented escape hatch must grant: {stderr}");
    let envelope = parse(&stdout);
    assert_eq!(envelope["schema"], "wanyrix.sync/v1");
    assert_eq!(envelope["committed"], true, "first push really commits");
}

#[test]
fn unlicensed_refusal_fires_before_any_transport_work() {
    // No git fixture needed ON PURPOSE: the gate lives at DISPATCH, so the
    // subscription refusal must fire before sync even resolves the remote
    // (a nonexistent remote would otherwise answer `sync remote
    // unavailable` instead of the licensing refusal).
    let _root = temp_dir("dispatch-order");
    make_fixture(&_root, 23);
    let (stdout, stderr, code) = run_in(
        &_root,
        &[],
        &[
            "sync",
            "push",
            "--remote",
            "/wanyrix/no/such/remote.git",
            "--path",
            "fixture-ws",
            "--json",
        ],
    );
    assert_eq!(code, 2);
    assert!(
        stderr.contains("subscription required"),
        "the licensing refusal wins at dispatch: {stderr}"
    );
    assert!(
        !stderr.contains("sync remote unavailable"),
        "no transport work happened before the gate: {stderr}"
    );
    assert!(stdout.trim().is_empty());
}
