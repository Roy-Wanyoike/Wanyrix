//! End-to-end verification of `wanyrix sync push|pull` (issue #92, L3):
//! two clones of a deterministic `synth` fixture rendezvous over a tempdir
//! git repository's REGISTRY BRANCH — a git branch IS the shared store, so
//! the roundtrip is exercised exactly the way a team would run it (real
//! binary, real git, relative `--path`s).
//!
//! Pinned contracts:
//! - the registry bundle IS the `wanyrix.export/v1` bundle (byte-identical
//!   to a plain `wanyrix export` of the same workspace), committed as
//!   EXACTLY ONE deterministic commit — and a byte-identical re-push (from
//!   either clone) is a measured no-op: zero new commits;
//! - pull merges by (workspace id, finding id) + content hash: peer-only
//!   findings are adopted, divergent content becomes a NAMED
//!   `SYNC-CONFLICT-n` finding with the LOCAL bytes kept (never a silent
//!   overwrite), and the peer's version stays in the registry;
//! - evidence tiers never upgrade: a peer `verified` claim imports as
//!   `peer-reported-verified`, the downgrade is sticky across re-pulls;
//! - registry content violating its own `index.json` sha256 binding is a
//!   named refusal (tampered evidence is never merged);
//! - every refusal (missing remote, non-git path, pull before any push,
//!   absolute `--path`) is a NAMED error with the contract exit code 2.
//!
//! Every test SKIPS HONESTLY (printed, never silently green) when the
//! `git` binary is unavailable — the registry transport shells out to git
//! by design (zero-new-dependencies policy), so there is no fixture
//! substitute for it.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;
use wanyrix_engine::synth;

fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Fresh temp dir under the system temp root (unique per test + run).
fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wanyrix-sync-cli-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

struct Out {
    stdout: String,
    stderr: String,
    code: i32,
}

/// Run the REAL binary from `cwd` (the operator's shell) — relative
/// `--path`/`--remote` arguments resolve exactly as they would for a human.
fn run_in(cwd: &Path, args: &[&str]) -> Out {
    let out = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args(args)
        .current_dir(cwd)
        .output()
        .unwrap();
    Out {
        stdout: String::from_utf8(out.stdout).unwrap(),
        stderr: String::from_utf8(out.stderr).unwrap(),
        code: out.status.code().unwrap_or(-1),
    }
}

/// Run git inside `dir` with a fixed test identity (sync itself uses its
/// own machine identity for ITS commits; the test-authored commits must
/// not depend on the runner's git config).
fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_AUTHOR_NAME", "sync-cli-test")
        .env("GIT_AUTHOR_EMAIL", "sync-cli-test@example.invalid")
        .env("GIT_COMMITTER_NAME", "sync-cli-test")
        .env("GIT_COMMITTER_EMAIL", "sync-cli-test@example.invalid")
        .output()
        .expect("git must be available (git_available() checked)");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn git_stdout(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .expect("git must be available (git_available() checked)");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}

/// The shared store: a plain (non-bare) git repository with a `main`
/// default branch — the registry branch does not exist until a push.
fn setup_remote(name: &str) -> PathBuf {
    let remote = temp_dir(name);
    git(&remote, &["init", "--quiet", "-b", "main"]);
    std::fs::write(remote.join("README.md"), "# sync fixture remote\n").unwrap();
    git(&remote, &["add", "README.md"]);
    git(&remote, &["commit", "--quiet", "-m", "init"]);
    remote
}

/// A deterministic fixture workspace (same seed ⇒ byte-identical tree) —
/// the stand-in for "the same workspace measured on two machines".
fn make_fixture(clone: &Path, seed: u64) {
    synth::synth(&clone.join("fixture-ws"), 2, seed).unwrap();
}

/// A fresh clone of `remote` — the stand-in for a teammate's checkout.
fn clone_of(remote: &Path, name: &str) -> PathBuf {
    let dir = temp_dir(name);
    git(
        &dir,
        &["clone", "--quiet", remote.to_str().unwrap(), "clone"],
    );
    dir.join("clone")
}

fn parse(out: &Out) -> Value {
    serde_json::from_str(&out.stdout)
        .unwrap_or_else(|e| panic!("stdout must be the JSON envelope ({e}): {}", out.stdout))
}

/// Byte-compare one registry/mirror file against the plain-export artifact.
fn assert_bytes_equal(a: &Path, b: &Path, file: &str) {
    let ba = std::fs::read(a.join(file)).unwrap();
    let bb = std::fs::read(b.join(file)).unwrap();
    assert_eq!(ba, bb, "{file}: bytes must be identical");
}

const FOUR_FILES: [&str; 4] = ["doctor.json", "graph.json", "health.json", "index.json"];

#[test]
fn two_clone_roundtrip_push_then_pull_is_byte_identical() {
    if !git_available() {
        println!("SKIP: git binary unavailable — sync's registry transport needs it");
        return;
    }
    let remote = setup_remote("rt-remote");
    let remote = remote.as_path();

    // Clone A measures and exports, then pushes the SAME measured pipeline.
    let a = clone_of(remote, "rt-a");
    make_fixture(&a, 17);
    let exp = run_in(&a, &["export", "--path", "fixture-ws", "--json"]);
    assert_eq!(exp.code, 0, "export failed: {}", exp.stderr);
    let manifest = parse(&exp);
    assert_eq!(manifest["schema"], "wanyrix.export/v1");
    let exports = a.join("fixture-ws/.wanyrix/exports");

    let push = run_in(
        &a,
        &[
            "sync",
            "push",
            "--remote",
            remote.to_str().unwrap(),
            "--path",
            "fixture-ws",
            "--json",
        ],
    );
    assert_eq!(push.code, 0, "push failed: {}", push.stderr);
    let env = parse(&push);
    assert_eq!(env["schema"], "wanyrix.sync/v1");
    assert_eq!(env["action"], "push");
    assert_eq!(env["workspace"], "fixture-ws");
    assert_eq!(env["workspaceId"], "fixture-ws");
    assert_eq!(env["committed"], true, "first push must commit");
    assert_eq!(env["artifacts"].as_array().unwrap().len(), 3);

    // Deterministic commit message: workspace id + the envelope's digest
    // range, and nothing else (no wall-clock anywhere in it).
    let (dmin, dmax) = (
        env["digestMin"].as_str().unwrap().to_owned(),
        env["digestMax"].as_str().unwrap().to_owned(),
    );
    assert_eq!(
        env["commitMessage"].as_str().unwrap(),
        format!("wanyrix-sync push fixture-ws {dmin}..{dmax}")
    );
    assert!(
        !dmin.is_empty() && dmin <= dmax,
        "digest range must be sane"
    );
    assert_eq!(env["commit"].as_str().unwrap().len(), 40, "full sha");
    assert_eq!(
        env["generatedAt"].as_str().unwrap().len(),
        20,
        "ISO-8601 Z stamp, last field"
    );

    // EXACTLY ONE commit on the registry branch, and the envelope named it.
    let registry_head = git_stdout(remote, &["rev-parse", "wanyrix-registry"]);
    assert_eq!(
        env["commit"].as_str().unwrap(),
        registry_head.trim(),
        "the envelope's commit is the registry branch head"
    );
    assert_eq!(
        git_stdout(remote, &["rev-list", "--count", "wanyrix-registry"])
            .trim()
            .parse::<usize>()
            .unwrap(),
        1,
        "first push = exactly one registry commit"
    );

    // Clone B (same-seed fixture) pulls and adopts the bundle verbatim.
    let b = clone_of(remote, "rt-b");
    make_fixture(&b, 17);
    let pull = run_in(
        &b,
        &[
            "sync",
            "pull",
            "--remote",
            remote.to_str().unwrap(),
            "--json",
        ],
    );
    assert_eq!(pull.code, 0, "pull failed: {}", pull.stderr);
    let menv = parse(&pull);
    assert_eq!(menv["schema"], "wanyrix.sync/v1");
    assert_eq!(menv["action"], "pull");
    assert_eq!(menv["workspaceCount"], 1);
    assert_eq!(menv["conflictCount"], 0);
    assert_eq!(menv["relabelCount"], 0);
    assert_eq!(menv["foreignEntries"].as_array().unwrap().len(), 0);
    let ws = &menv["workspaces"][0];
    assert_eq!(ws["outcome"], "adopted");
    let findings = ws["adoptedFindings"].as_u64().unwrap();

    // THE roundtrip contract: every mirror file is byte-identical to the
    // plain export artifact clone A measured (registry == export bundle).
    let mirror = b.join(".wanyrix/sync/registry/fixture-ws");
    for f in FOUR_FILES {
        assert_bytes_equal(&exports, &mirror, f);
    }

    // The adopted finding count matches the peer's doctor envelope.
    let doctor: Value =
        serde_json::from_str(&std::fs::read_to_string(mirror.join("doctor.json")).unwrap())
            .unwrap();
    assert_eq!(
        findings,
        doctor["findings"].as_array().unwrap().len() as u64,
        "adoptedFindings == the peer's finding count"
    );

    // A re-pull over an up-to-date mirror is measured `unchanged`.
    let pull2 = run_in(&b, &["sync", "pull", "--remote", remote.to_str().unwrap()]);
    assert_eq!(pull2.code, 0, "{}", pull2.stderr);
    assert!(
        pull2
            .stdout
            .contains("workspaces: 1 (adopted: 0, merged: 0, unchanged: 1)"),
        "human summary counts the unchanged re-pull: {}",
        pull2.stdout
    );
    let pull2j = run_in(
        &b,
        &[
            "sync",
            "pull",
            "--remote",
            remote.to_str().unwrap(),
            "--json",
        ],
    );
    assert_eq!(parse(&pull2j)["workspaces"][0]["outcome"], "unchanged");

    std::fs::remove_dir_all(&a).ok();
    std::fs::remove_dir_all(&b).ok();
    std::fs::remove_dir_all(remote).ok();
}

#[test]
fn byte_identical_repush_is_a_measured_no_op() {
    if !git_available() {
        println!("SKIP: git binary unavailable — sync's registry transport needs it");
        return;
    }
    let remote = setup_remote("noop-remote");
    let remote = remote.as_path();

    let a = clone_of(remote, "noop-a");
    make_fixture(&a, 7);
    let push = run_in(
        &a,
        &[
            "sync",
            "push",
            "--remote",
            remote.to_str().unwrap(),
            "--path",
            "fixture-ws",
            "--json",
        ],
    );
    assert_eq!(push.code, 0, "{}", push.stderr);
    assert_eq!(parse(&push)["committed"], true);
    let head_before = git_stdout(remote, &["rev-parse", "wanyrix-registry"]);

    // Same clone, unchanged workspace: staged content matches HEAD ⇒ no
    // commit, no push, and the envelope names the no-op reason.
    let again = run_in(
        &a,
        &[
            "sync",
            "push",
            "--remote",
            remote.to_str().unwrap(),
            "--path",
            "fixture-ws",
        ],
    );
    assert_eq!(again.code, 0, "{}", again.stderr);
    assert!(
        again.stdout.contains("registry commit: none —"),
        "{}",
        again.stdout
    );
    assert!(
        again.stdout.contains("zero new commits"),
        "the no-op reason states the measured outcome: {}",
        again.stdout
    );

    // A DIFFERENT clone with the same-seed (byte-identical) fixture is a
    // no-op too — determinism across machines, not just local state.
    let b = clone_of(remote, "noop-b");
    make_fixture(&b, 7);
    let from_b = run_in(
        &b,
        &[
            "sync",
            "push",
            "--remote",
            remote.to_str().unwrap(),
            "--path",
            "fixture-ws",
            "--json",
        ],
    );
    assert_eq!(from_b.code, 0, "{}", from_b.stderr);
    let env = parse(&from_b);
    assert_eq!(
        env["committed"], false,
        "identical content from another clone is a no-op"
    );
    assert!(env["noopReason"]
        .as_str()
        .unwrap()
        .contains("byte-identical content"));

    // The ref did not move and the registry still holds exactly one commit.
    let head_after = git_stdout(remote, &["rev-parse", "wanyrix-registry"]);
    assert_eq!(
        head_before, head_after,
        "the registry ref must not move on a no-op"
    );
    assert_eq!(
        git_stdout(remote, &["rev-list", "--count", "wanyrix-registry"])
            .trim()
            .parse::<usize>()
            .unwrap(),
        1
    );

    std::fs::remove_dir_all(&a).ok();
    std::fs::remove_dir_all(&b).ok();
    std::fs::remove_dir_all(remote).ok();
}

#[test]
fn conflicting_content_becomes_a_named_finding_and_local_bytes_are_kept() {
    if !git_available() {
        println!("SKIP: git binary unavailable — sync's registry transport needs it");
        return;
    }
    let remote = setup_remote("conflict-remote");
    let remote = remote.as_path();

    let a = clone_of(remote, "conflict-a");
    make_fixture(&a, 42);
    let push = run_in(
        &a,
        &[
            "sync",
            "push",
            "--remote",
            remote.to_str().unwrap(),
            "--path",
            "fixture-ws",
            "--json",
        ],
    );
    assert_eq!(push.code, 0, "{}", push.stderr);

    // Clone B adopts, then DIVERGES locally (the stand-in for a different
    // machine having measured/edited different content for the same ids).
    let b = clone_of(remote, "conflict-b");
    make_fixture(&b, 42);
    let pull = run_in(
        &b,
        &[
            "sync",
            "pull",
            "--remote",
            remote.to_str().unwrap(),
            "--json",
        ],
    );
    assert_eq!(pull.code, 0, "{}", pull.stderr);
    let mirror = b.join(".wanyrix/sync/registry/fixture-ws");

    let doctor_path = mirror.join("doctor.json");
    let mut doctor: Value =
        serde_json::from_str(&std::fs::read_to_string(&doctor_path).unwrap()).unwrap();
    let fid = doctor["findings"][0]["id"].as_str().unwrap().to_owned();
    doctor["findings"][0]["title"] = Value::String("DIVERGED LOCALLY".into());
    std::fs::write(
        &doctor_path,
        format!("{}\n", serde_json::to_string(&doctor).unwrap()),
    )
    .unwrap();
    let diverged_doctor = std::fs::read(&doctor_path).unwrap();
    let graph_path = mirror.join("graph.json");
    let diverged_graph = b"{}\nNOT the peer graph bytes\n".to_vec();
    std::fs::write(&graph_path, &diverged_graph).unwrap();

    // The re-pull must NAME both conflicts and keep the local bytes.
    let pull2 = run_in(
        &b,
        &[
            "sync",
            "pull",
            "--remote",
            remote.to_str().unwrap(),
            "--json",
        ],
    );
    assert_eq!(
        pull2.code, 0,
        "a content conflict is a finding, not an error: {}",
        pull2.stderr
    );
    let env = parse(&pull2);
    assert_eq!(env["conflictCount"], 2);
    let ws = &env["workspaces"][0];
    assert_eq!(ws["outcome"], "merged");
    let conflicts = ws["conflicts"].as_array().unwrap();
    assert_eq!(conflicts.len(), 2);

    let by_id = |name: &str| {
        conflicts
            .iter()
            .find(|c| c["findingId"] == Value::String(name.to_owned()))
            .unwrap_or_else(|| panic!("no conflict named {name}"))
            .clone()
    };
    let finding_conflict = by_id(&fid);
    assert_eq!(
        finding_conflict["id"], "SYNC-CONFLICT-1",
        "finding-content conflicts number first"
    );
    assert_eq!(finding_conflict["kind"], "finding-content");
    assert_eq!(finding_conflict["resolution"], "local-kept");
    let graph_conflict = by_id("graph.json");
    assert_eq!(
        graph_conflict["id"], "SYNC-CONFLICT-2",
        "derived-file conflicts number after"
    );
    assert_eq!(graph_conflict["kind"], "derived-file");
    assert_eq!(graph_conflict["resolution"], "local-kept");
    assert_ne!(
        finding_conflict["localSha256"], finding_conflict["peerSha256"],
        "the conflict reports the two divergent content hashes"
    );

    // Nothing was silently overwritten: the diverged local bytes survive.
    assert_eq!(std::fs::read(&doctor_path).unwrap(), diverged_doctor);
    assert_eq!(std::fs::read(&graph_path).unwrap(), diverged_graph);
    let kept: Value = serde_json::from_slice(&diverged_doctor).unwrap();
    assert_eq!(kept["findings"][0]["title"], "DIVERGED LOCALLY");

    // The peer's version stays in the registry for human reconciliation.
    let peer_graph = git_stdout(remote, &["show", "wanyrix-registry:fixture-ws/graph.json"]);
    assert_ne!(
        peer_graph.as_bytes(),
        diverged_graph.as_slice(),
        "the registry still holds the peer's version"
    );

    // The human flavor names the conflicts for the operator, too.
    let human = run_in(&b, &["sync", "pull", "--remote", remote.to_str().unwrap()]);
    assert!(human.stdout.contains("[SYNC-CONFLICT-"), "{}", human.stdout);
    assert!(human.stdout.contains("local-kept"), "{}", human.stdout);

    std::fs::remove_dir_all(&a).ok();
    std::fs::remove_dir_all(&b).ok();
    std::fs::remove_dir_all(remote).ok();
}

#[test]
fn peer_verified_tier_imports_as_peer_reported_verified_and_stays_downgraded() {
    if !git_available() {
        println!("SKIP: git binary unavailable — sync's registry transport needs it");
        return;
    }
    let remote = setup_remote("tier-remote");
    let remote = remote.as_path();

    let a = clone_of(remote, "tier-a");
    make_fixture(&a, 17);
    let push = run_in(
        &a,
        &[
            "sync",
            "push",
            "--remote",
            remote.to_str().unwrap(),
            "--path",
            "fixture-ws",
            "--json",
        ],
    );
    assert_eq!(push.code, 0, "{}", push.stderr);

    // A peer with a richer evidence pipeline publishes a `verified` claim:
    // edit the registry's doctor.json AND re-bind its index.json digest
    // (the exact bytes a verifying peer would ship — self-consistent
    // evidence, so the merge must proceed, not refuse).
    let work = clone_of(remote, "tier-reg");
    git(&work, &["checkout", "--quiet", "wanyrix-registry"]);
    let ws_dir = work.join("fixture-ws");
    let doctor_path = ws_dir.join("doctor.json");
    let mut doctor: Value =
        serde_json::from_str(&std::fs::read_to_string(&doctor_path).unwrap()).unwrap();
    let fid = doctor["findings"][0]["id"].as_str().unwrap().to_owned();
    let severity = doctor["findings"][0]["severity"]
        .as_str()
        .unwrap()
        .to_owned();
    doctor["findings"][0]["measurementStatus"] = Value::String("verified".into());
    let doctor_bytes = format!("{}\n", serde_json::to_string(&doctor).unwrap()).into_bytes();
    std::fs::write(&doctor_path, &doctor_bytes).unwrap();
    let index_path = ws_dir.join("index.json");
    let mut index: Value =
        serde_json::from_str(&std::fs::read_to_string(&index_path).unwrap()).unwrap();
    for a in index["artifacts"].as_array_mut().unwrap() {
        if a["file"] == "doctor.json" {
            a["bytes"] = Value::from(doctor_bytes.len());
            a["sha256"] = Value::from(wanyrix_engine::sha256_hex(&doctor_bytes));
        }
    }
    std::fs::write(
        &index_path,
        format!("{}\n", serde_json::to_string(&index).unwrap()),
    )
    .unwrap();
    // A stray non-workspace entry at the registry root: named, never ignored.
    std::fs::write(work.join("NOT-A-WORKSPACE.txt"), "stray\n").unwrap();
    git(&work, &["add", "-A"]);
    git(&work, &["commit", "--quiet", "-m", "peer claims verified"]);
    git(&work, &["push", "--quiet", "origin", "wanyrix-registry"]);

    // The importing clone DOWNGRADES the tier — never upgrades it.
    let b = clone_of(remote, "tier-b");
    make_fixture(&b, 17);
    let pull = run_in(
        &b,
        &[
            "sync",
            "pull",
            "--remote",
            remote.to_str().unwrap(),
            "--json",
        ],
    );
    assert_eq!(pull.code, 0, "{}", pull.stderr);
    let env = parse(&pull);
    assert_eq!(env["relabelCount"], 1);
    let relabel = &env["workspaces"][0]["relabels"][0];
    assert_eq!(relabel["findingId"], Value::String(fid.clone()));
    assert_eq!(relabel["peerClaimed"], "verified");
    assert_eq!(relabel["importedAs"], "peer-reported-verified");
    assert_eq!(
        env["foreignEntries"],
        serde_json::json!(["NOT-A-WORKSPACE.txt"]),
        "the stray registry entry is named"
    );

    let mirror = b.join(".wanyrix/sync/registry/fixture-ws");
    let stored: Value =
        serde_json::from_str(&std::fs::read_to_string(mirror.join("doctor.json")).unwrap())
            .unwrap();
    assert_eq!(
        stored["findings"][0]["measurementStatus"], "peer-reported-verified",
        "the stored tier is the downgraded label"
    );
    assert_eq!(
        stored["findings"][0]["severity"],
        Value::String(severity.clone()),
        "a tier relabel never changes the measured severity"
    );
    // The rebuilt index.json binds the REWRITTEN doctor bytes.
    let index: Value =
        serde_json::from_str(&std::fs::read_to_string(mirror.join("index.json")).unwrap()).unwrap();
    let stored_bytes = std::fs::read(mirror.join("doctor.json")).unwrap();
    let row = index["artifacts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["file"] == "doctor.json")
        .unwrap();
    assert_eq!(
        row["sha256"],
        Value::from(wanyrix_engine::sha256_hex(&stored_bytes))
    );

    // The downgrade is STICKY: a re-pull does not silently upgrade the
    // tier back — the peer's re-claim diverges from the local label and
    // becomes a named conflict with the local (downgraded) bytes kept.
    let pull2 = run_in(
        &b,
        &[
            "sync",
            "pull",
            "--remote",
            remote.to_str().unwrap(),
            "--json",
        ],
    );
    assert_eq!(pull2.code, 0, "{}", pull2.stderr);
    let env2 = parse(&pull2);
    assert_eq!(
        env2["conflictCount"], 1,
        "the tier divergence is named, not overwritten"
    );
    let c = &env2["workspaces"][0]["conflicts"][0];
    assert_eq!(c["findingId"], Value::String(fid));
    assert_eq!(c["kind"], "finding-content");
    assert_eq!(c["resolution"], "local-kept");
    let still: Value =
        serde_json::from_str(&std::fs::read_to_string(mirror.join("doctor.json")).unwrap())
            .unwrap();
    assert_eq!(
        still["findings"][0]["measurementStatus"],
        "peer-reported-verified"
    );

    std::fs::remove_dir_all(&a).ok();
    std::fs::remove_dir_all(&b).ok();
    std::fs::remove_dir_all(&work).ok();
    std::fs::remove_dir_all(remote).ok();
}

#[test]
fn tampered_registry_content_is_a_named_refusal_never_a_merge() {
    if !git_available() {
        println!("SKIP: git binary unavailable — sync's registry transport needs it");
        return;
    }
    let remote = setup_remote("tamper-remote");
    let remote = remote.as_path();

    let a = clone_of(remote, "tamper-a");
    make_fixture(&a, 17);
    let push = run_in(
        &a,
        &[
            "sync",
            "push",
            "--remote",
            remote.to_str().unwrap(),
            "--path",
            "fixture-ws",
            "--json",
        ],
    );
    assert_eq!(push.code, 0, "{}", push.stderr);

    // Tamper WITHOUT re-binding: the manifest no longer describes the
    // bytes — pulling that must refuse by name, never merge doctored
    // evidence.
    let work = clone_of(remote, "tamper-reg");
    git(&work, &["checkout", "--quiet", "wanyrix-registry"]);
    let doctor_path = work.join("fixture-ws/doctor.json");
    let mut doctor: Value =
        serde_json::from_str(&std::fs::read_to_string(&doctor_path).unwrap()).unwrap();
    doctor["findings"][0]["title"] = Value::String("TAMPERED".into());
    std::fs::write(
        &doctor_path,
        format!("{}\n", serde_json::to_string(&doctor).unwrap()),
    )
    .unwrap();
    git(&work, &["add", "-A"]);
    git(&work, &["commit", "--quiet", "-m", "tampered evidence"]);
    git(&work, &["push", "--quiet", "origin", "wanyrix-registry"]);

    let b = clone_of(remote, "tamper-b");
    make_fixture(&b, 17);
    let pull = run_in(
        &b,
        &[
            "sync",
            "pull",
            "--remote",
            remote.to_str().unwrap(),
            "--json",
        ],
    );
    assert_eq!(
        pull.code, 2,
        "tampered evidence is a contract exit-2 refusal"
    );
    assert!(
        pull.stderr.contains("sync conflict:"),
        "named SyncConflict error, got: {}",
        pull.stderr
    );
    assert!(
        pull.stderr
            .contains("violates its own index.json digest binding"),
        "the refusal names the broken digest binding, got: {}",
        pull.stderr
    );
    assert!(
        !b.join(".wanyrix/sync/registry").exists(),
        "nothing is merged from tampered evidence"
    );

    std::fs::remove_dir_all(&a).ok();
    std::fs::remove_dir_all(&b).ok();
    std::fs::remove_dir_all(&work).ok();
    std::fs::remove_dir_all(remote).ok();
}

#[test]
fn pull_before_any_push_names_the_missing_branch_with_remediation() {
    if !git_available() {
        println!("SKIP: git binary unavailable — sync's registry transport needs it");
        return;
    }
    let remote = setup_remote("nobranch-remote");
    let a = clone_of(remote.as_path(), "nobranch-a");
    make_fixture(&a, 17);

    let pull = run_in(&a, &["sync", "pull", "--remote", remote.to_str().unwrap()]);
    assert_eq!(
        pull.code, 2,
        "pull before any push is a contract exit-2 refusal"
    );
    assert!(
        pull.stderr.contains("sync registry branch unavailable:"),
        "named SyncBranch error, got: {}",
        pull.stderr
    );
    assert!(
        pull.stderr.contains("run `wanyrix sync push` first"),
        "the remediation is stated, got: {}",
        pull.stderr
    );

    std::fs::remove_dir_all(&a).ok();
    std::fs::remove_dir_all(remote).ok();
}

#[test]
fn missing_remote_and_non_git_paths_are_named_refusals() {
    if !git_available() {
        println!("SKIP: git binary unavailable — sync's registry transport needs it");
        return;
    }
    let scratch = temp_dir("refusals");
    let a = scratch.join("clone");
    std::fs::create_dir_all(&a).unwrap();
    make_fixture(&a, 17);

    // A remote path that does not exist.
    let missing = run_in(
        &a,
        &[
            "sync",
            "push",
            "--remote",
            scratch.join("absent").to_str().unwrap(),
            "--path",
            "fixture-ws",
        ],
    );
    assert_eq!(missing.code, 2);
    assert!(
        missing.stderr.contains("sync remote unavailable:")
            && missing.stderr.contains("remote path does not exist"),
        "named refusal with remediation, got: {}",
        missing.stderr
    );

    // A remote path that exists but is NOT a git repository.
    let notgit = scratch.join("not-a-repo");
    std::fs::create_dir_all(&notgit).unwrap();
    std::fs::write(notgit.join("some.txt"), "not git\n").unwrap();
    for cmd in [
        vec![
            "sync",
            "push",
            "--remote",
            notgit.to_str().unwrap(),
            "--path",
            "fixture-ws",
        ],
        vec!["sync", "pull", "--remote", notgit.to_str().unwrap()],
    ] {
        let out = run_in(&a, &cmd);
        assert_eq!(out.code, 2, "{cmd:?} must be refused");
        assert!(
            out.stderr.contains("sync remote unavailable:")
                && out.stderr.contains("is not a git repository"),
            "{cmd:?}: named refusal, got: {}",
            out.stderr
        );
    }

    std::fs::remove_dir_all(&scratch).ok();
}

#[test]
fn absolute_sync_path_is_refused_by_the_relative_paths_only_contract() {
    let scratch = temp_dir("abs-path");
    // No git needed: the refusal happens before any transport.
    let abs = scratch.join("fixture-ws");
    std::fs::create_dir_all(&abs).unwrap();
    let push = run_in(
        &scratch,
        &[
            "sync",
            "push",
            "--remote",
            "irrelevant",
            "--path",
            abs.to_str().unwrap(),
        ],
    );
    assert_eq!(push.code, 2, "absolute --path must be refused");
    assert!(
        push.stderr.contains("sync error:") && push.stderr.contains("absolute"),
        "named Sync refusal, got: {}",
        push.stderr
    );
    let pull = run_in(
        &scratch,
        &[
            "sync",
            "pull",
            "--remote",
            "irrelevant",
            "--path",
            abs.to_str().unwrap(),
        ],
    );
    assert_eq!(pull.code, 2);
    assert!(
        pull.stderr.contains("sync error:") && pull.stderr.contains("absolute"),
        "pull refuses absolute --path too, got: {}",
        pull.stderr
    );
    std::fs::remove_dir_all(&scratch).ok();
}
