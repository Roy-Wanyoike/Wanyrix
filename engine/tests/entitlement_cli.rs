//! End-to-end verification of the issue #94 entitlement surfaces through
//! the REAL binary: `wanyrix license keygen|issue`, `wanyrix activate`
//! (offline ed25519 verification) and `wanyrix entitlement` — exercised as
//! the operator would run them.
//!
//! Key-chain discipline: the CLI verifies against the EMBEDDED release key
//! (dev key until release signing). CLI-level tests drive the flow with
//! ephemeral keypairs via the documented `WANYRIX_ACTIVATION_PUBKEY`
//! override (the same override Enterprise on-prem entitlement servers use
//! — roadmap #66). No private key is ever committed: every keypair here is
//! minted by `wanyrix license keygen` into a temp dir or derived in-process
//! from fixed seeds.
//!
//! The free-tier honesty pin (COMMERCIAL.md rule #1) runs the real doctor
//! surface with NO entitlement file in the workspace: it must succeed.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;
use wanyrix_engine::entitlement::{issue_signed, IssueRequest};
use wanyrix_engine::Plan;

fn temp_dir(name: &str) -> PathBuf {
    // Under the engine crate dir's target/ (gitignored, never scanned:
    // `.wanyrix` and `target` are skipped). The path is made ABSOLUTE and
    // created eagerly: the CLI binary runs with `current_dir(root)` below,
    // and a relative path (or a missing dir) would not survive that chdir.
    let rel = format!(
        "target/wanyrix-entitlement-cli-{name}-{}-{}",
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

/// Run the binary inside `cwd` (which becomes the `.wanyrix` state root).
fn run_in(cwd: &Path, envs: &[(&str, &str)], args: &[&str]) -> (String, String, bool) {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_wanyrix"));
    cmd.args(args).current_dir(cwd);
    for (k, v) in envs {
        cmd.env(k, v);
    }
    let out = cmd.output().unwrap();
    (
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8(out.stderr).unwrap(),
        out.status.success(),
    )
}

/// `keygen` a keypair and return (private-key hex, public-key hex).
fn mint_keypair(root: &Path, name: &str) -> (String, String) {
    let dir = root.join(format!("keys-{name}"));
    let (_, stderr, ok) = run_in(
        root,
        &[],
        &["license", "keygen", "--out", dir.to_str().unwrap()],
    );
    assert!(ok, "keygen failed: {stderr}");
    let priv_hex = std::fs::read_to_string(dir.join("wanyrix-license-priv.hex")).unwrap();
    let pub_hex = std::fs::read_to_string(dir.join("wanyrix-license-pub.hex")).unwrap();
    (priv_hex.trim().to_owned(), pub_hex.trim().to_owned())
}

#[test]
fn license_keygen_writes_a_keypair_once_and_refuses_to_clobber() {
    let root = temp_dir("keygen");
    let dir = root.join("keys");
    let (stdout, stderr, ok) = run_in(
        &root,
        &[],
        &["license", "keygen", "--out", dir.to_str().unwrap()],
    );
    assert!(ok, "stderr: {stderr}");
    assert!(
        stdout.contains("NEVER commit"),
        "honesty note on private keys"
    );
    assert!(stdout.contains("mode 0600"));

    let priv_text = std::fs::read_to_string(dir.join("wanyrix-license-priv.hex")).unwrap();
    assert_eq!(priv_text.trim().len(), 64, "32-byte seed as hex");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(dir.join("wanyrix-license-priv.hex"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600, "private key file is operator-only");
    }

    let (_, stderr, ok2) = run_in(
        &root,
        &[],
        &["license", "keygen", "--out", dir.to_str().unwrap()],
    );
    assert!(!ok2, "a second keygen over the same dir must refuse");
    assert!(
        stderr.contains("refusing to overwrite"),
        "named refusal: {stderr}"
    );
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn license_issue_json_prints_exactly_the_signed_token() {
    let root = temp_dir("issue");
    let (priv_hex, pub_hex) = mint_keypair(&root, "issue");
    let (stdout, stderr, ok) = run_in(
        &root,
        &[],
        &[
            "license", "issue", "--plan", "team", "--team", "acme", "--days", "14", "--seats", "5",
            "--key", &priv_hex, "--json",
        ],
    );
    assert!(ok, "stderr: {stderr}");
    let token: Value =
        serde_json::from_str(stdout.trim()).expect("--json stdout is exactly the token");
    assert_eq!(token["schema"], "wanyrix.entitlement.token/v1");
    assert_eq!(token["version"], 1);
    assert_eq!(token["plan"], "team");
    assert_eq!(token["team"], "acme");
    assert_eq!(token["seats"], 5);
    assert_eq!(token["nonce"].as_str().unwrap().len(), 32);
    assert_eq!(token["signature"].as_str().unwrap().len(), 128);
    let issued = token["issuedAtDay"].as_u64().unwrap();
    assert_eq!(
        token["expiryDay"].as_u64().unwrap() - issued,
        14,
        "day-count expiry semantics"
    );
    // The round trip holds against the minted public half: re-parse the
    // printed token and verify the signature OFFLINE with the pub file.
    let parsed: wanyrix_engine::entitlement::SignedToken =
        serde_json::from_value(token.clone()).expect("token JSON round-trips");
    let vk = wanyrix_engine::entitlement::verifying_key_from_hex(&pub_hex).unwrap();
    parsed
        .verify(&vk)
        .expect("issued token verifies against the minted public half");
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn issue_then_activate_then_entitlement_full_loop() {
    let root = temp_dir("loop");
    let (priv_hex, pub_hex) = mint_keypair(&root, "loop");

    // 1. issue --json → token artifact.
    let (stdout, stderr, ok) = run_in(
        &root,
        &[],
        &[
            "license", "issue", "--plan", "team", "--team", "acme", "--days", "30", "--key",
            &priv_hex, "--json",
        ],
    );
    assert!(ok, "stderr: {stderr}");
    let token_file = root.join("token.json");
    std::fs::write(&token_file, stdout.trim()).unwrap();

    // 2. activate --key <file> with the documented pubkey override.
    let (stdout, stderr, ok) = run_in(
        &root,
        &[("WANYRIX_ACTIVATION_PUBKEY", &pub_hex)],
        &["activate", "--key", token_file.to_str().unwrap()],
    );
    assert!(ok, "activate failed: {stderr}");
    assert!(
        stdout.contains("plan: team"),
        "human output names the plan: {stdout}"
    );
    assert!(stdout.contains("team: acme"));
    assert!(stdout.contains("seats: 5"));
    assert!(stdout.contains("status: active"));
    assert!(stdout.contains("zero network I/O"), "offline note");

    // 3. entitlement --json reads the cache back (re-verifying the signature).
    let (stdout, stderr, ok) = run_in(
        &root,
        &[("WANYRIX_ACTIVATION_PUBKEY", &pub_hex)],
        &["entitlement", "--json"],
    );
    assert!(ok, "stderr: {stderr}");
    let report: Value = serde_json::from_str(stdout.trim()).unwrap();
    assert_eq!(report["schema"], "wanyrix.entitlement/v1");
    assert_eq!(report["status"], "active");
    assert_eq!(report["plan"], "team");
    assert_eq!(report["team"], "acme");
    assert_eq!(report["seatsTotal"], 5);
    assert_eq!(report["seatsInUse"], 1, "measured: this machine");
    assert!(report["daysUntilRevalidation"].as_u64().unwrap() >= 1);
    let gates = report["tierGatedSurfaces"].as_array().unwrap();
    assert!(gates
        .iter()
        .any(|g| g["surface"] == "sync.push" && g["requiredPlan"] == "team"));
    assert!(gates.iter().any(|g| g["surface"] == "sync.pull"));
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn activate_refuses_a_tampered_token_by_name() {
    let root = temp_dir("tamper");
    let (priv_hex, pub_hex) = mint_keypair(&root, "tamper");
    let (stdout, stderr, ok) = run_in(
        &root,
        &[],
        &[
            "license", "issue", "--plan", "team", "--team", "acme", "--days", "30", "--key",
            &priv_hex, "--json",
        ],
    );
    assert!(ok, "stderr: {stderr}");
    let mut token: Value = serde_json::from_str(stdout.trim()).unwrap();
    token["seats"] = 9999.into(); // forge seats, keep the signature
    let tampered = root.join("tampered.json");
    std::fs::write(&tampered, serde_json::to_string(&token).unwrap()).unwrap();

    let (_, stderr, ok) = run_in(
        &root,
        &[("WANYRIX_ACTIVATION_PUBKEY", &pub_hex)],
        &["activate", "--key", tampered.to_str().unwrap()],
    );
    assert!(!ok, "tampered tokens must be refused");
    assert!(
        stderr.contains("signature verification failed"),
        "named refusal: {stderr}"
    );
    assert!(
        !root.join(".wanyrix/entitlement.json").exists(),
        "nothing is cached"
    );
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn activate_refuses_a_wrong_key_chain_by_name() {
    let root = temp_dir("wrongkey");
    let (priv_hex, _) = mint_keypair(&root, "wrongkey");
    let (_, other_pub) = mint_keypair(&root, "otherkey");
    let (stdout, stderr, ok) = run_in(
        &root,
        &[],
        &[
            "license", "issue", "--plan", "team", "--team", "acme", "--days", "30", "--key",
            &priv_hex, "--json",
        ],
    );
    assert!(ok, "stderr: {stderr}");
    let token_file = root.join("token.json");
    std::fs::write(&token_file, stdout.trim()).unwrap();

    // Verified against a DIFFERENT keypair's public half: named refusal.
    let (_, stderr, ok) = run_in(
        &root,
        &[("WANYRIX_ACTIVATION_PUBKEY", &other_pub)],
        &["activate", "--key", token_file.to_str().unwrap()],
    );
    assert!(!ok);
    assert!(stderr.contains("signature verification failed"), "{stderr}");
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn activate_refuses_an_expired_token_and_entitlement_reports_grace_inside_the_window() {
    let root = temp_dir("expiry");
    let (priv_hex, pub_hex) = mint_keypair(&root, "expiry");
    let now_day = wanyrix_engine::entitlement::today_day();
    let seed: [u8; 32] = hex_to_32(&priv_hex);

    // Beyond grace: issued 100 days ago for 14 days → refuse by name.
    let expired = issue_signed(
        &IssueRequest {
            plan: Plan::Team,
            team: "acme".into(),
            days: 14,
            seats: 5,
        },
        &priv_hex,
        now_day - 100,
    )
    .unwrap();
    let expired_file = root.join("expired.json");
    std::fs::write(&expired_file, serde_json::to_string(&expired).unwrap()).unwrap();
    let (_, stderr, ok) = run_in(
        &root,
        &[("WANYRIX_ACTIVATION_PUBKEY", &pub_hex)],
        &["activate", "--key", expired_file.to_str().unwrap()],
    );
    assert!(!ok);
    assert!(stderr.contains("expired"), "{stderr}");
    assert!(stderr.contains("grace"), "{stderr}");

    // Inside grace: expired 5 days ago → activates with a VISIBLE grace label.
    let grace = issue_signed(
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
    let grace_file = root.join("grace.json");
    std::fs::write(&grace_file, serde_json::to_string(&grace).unwrap()).unwrap();
    let (stdout, stderr, ok) = run_in(
        &root,
        &[("WANYRIX_ACTIVATION_PUBKEY", &pub_hex)],
        &["activate", "--key", grace_file.to_str().unwrap(), "--json"],
    );
    assert!(ok, "grace activation must succeed: {stderr}");
    let report: Value = serde_json::from_str(stdout.trim()).unwrap();
    assert_eq!(
        report["status"], "grace",
        "the envelope labels grace honestly"
    );
    assert_eq!(
        report["graceDaysRemaining"].as_u64().unwrap(),
        wanyrix_engine::entitlement::REVALIDATION_GRACE_DAYS - 5
    );
    let _ = seed;
    std::fs::remove_dir_all(&root).ok();
}

fn hex_to_32(s: &str) -> [u8; 32] {
    let b = s.trim().as_bytes();
    let nib = |c: u8| -> u8 {
        match c {
            b'0'..=b'9' => c - b'0',
            b'a'..=b'f' => c - b'a' + 10,
            _ => panic!("hex key file"),
        }
    };
    let mut out = [0u8; 32];
    for (i, pair) in b.chunks(2).enumerate() {
        out[i] = nib(pair[0]) << 4 | nib(pair[1]);
    }
    out
}

#[test]
fn entitlement_without_a_license_is_an_honest_not_activated_envelope() {
    let root = temp_dir("none");
    let (stdout, stderr, ok) = run_in(&root, &[], &["entitlement", "--json"]);
    assert!(ok, "stderr: {stderr}");
    let report: Value = serde_json::from_str(stdout.trim()).unwrap();
    assert_eq!(report["schema"], "wanyrix.entitlement/v1");
    assert_eq!(report["status"], "not-activated");
    assert_eq!(report["plan"], "free");
    assert!(report["expiry"].is_null());
    assert!(report["note"].as_str().unwrap().contains("NEVER gated"));

    // Human flavor stays honest too.
    let (stdout, _, ok) = run_in(&root, &[], &["entitlement"]);
    assert!(ok);
    assert!(stdout.contains("not-activated"));
    assert!(stdout.contains("free"));
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn free_tier_pin_core_surfaces_run_with_no_entitlement_file() {
    // COMMERCIAL.md rule #1 at the binary level: with NO .wanyrix/
    // entitlement.json anywhere, every core measured surface keeps working.
    let root = temp_dir("free-tier");
    let ws = root.join("ws");
    wanyrix_engine::synth::synth(&ws, 2, 17).unwrap();
    for cmd in [
        vec!["doctor", "--path", ws.to_str().unwrap(), "--json"],
        vec!["graph", "--path", ws.to_str().unwrap(), "--json"],
        vec!["health", "--path", ws.to_str().unwrap(), "--json"],
        vec!["entitlement", "--json"],
    ] {
        let (stdout, stderr, ok) = run_in(&root, &[], &cmd);
        assert!(
            ok,
            "core surface {:?} must never be gated: {stderr}",
            cmd[0]
        );
        let parsed: Value = serde_json::from_str(stdout.trim()).unwrap();
        assert!(
            parsed["schema"].as_str().unwrap().starts_with("wanyrix."),
            "core surface envelope keeps the wanyrix.* schema family"
        );
    }
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn activate_refuses_garbage_and_missing_key_material_by_name() {
    let root = temp_dir("garbage");
    let (_, pub_hex) = mint_keypair(&root, "garbage");
    for bad in ["not json at all", "{}", "{\"schema\":1}"] {
        let (_, stderr, ok) = run_in(
            &root,
            &[("WANYRIX_ACTIVATION_PUBKEY", &pub_hex)],
            &["activate", "--key", bad],
        );
        assert!(!ok, "garbage key {bad:?} must be refused");
        assert!(
            stderr.contains("entitlement error"),
            "named refusal: {stderr}"
        );
    }
    std::fs::remove_dir_all(&root).ok();
}
