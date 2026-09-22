//! Binary-level contract tests for `wanyrix git` (`wanyrix.git/v1`) — AUD-9.
//!
//! The git surface previously had NO binary-level test (coverage matrix ✘).
//! These tests drive the REAL binary against a real (tiny, /tmp) repository
//! and pin the operator-facing contract from docs/CLI.md row 15:
//! - the envelope shape (branch / HEAD / dirty / changed files / commits);
//! - not-a-repository is a NAMED exit-2 refusal (stdout stays empty);
//! - redaction is UNCONDITIONAL — author identity never survives, the human
//!   summary says so, and there is no flag to turn it off (deliberately:
//!   the contract documents no redaction flag, so one must not exist).

use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;
use wanyrix_engine::synth;

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wanyrix-git-cli-{name}-{}-{}",
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

struct Output {
    stdout: String,
    stderr: String,
    code: i32,
}

fn run(args: &[&str]) -> Output {
    let out = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args(args)
        .output()
        .unwrap();
    Output {
        stdout: String::from_utf8(out.stdout).unwrap(),
        stderr: String::from_utf8(out.stderr).unwrap(),
        code: out.status.code().unwrap_or(-1),
    }
}

fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("git {:?} failed to spawn: {e}", args));
    assert!(
        out.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&out.stderr)
    );
}

/// A 2-crate synth workspace turned into a real git repository with exactly
/// one commit on `main` (author identity deliberately distinctive — the
/// redaction test asserts it never reaches the wire).
fn committed_repo(name: &str) -> (PathBuf, PathBuf) {
    let ws = temp_dir(name);
    synth::synth(&ws, 2, 17).unwrap();
    git(&ws, &["init", "-q", "-b", "main"]);
    git(&ws, &["add", "-A"]);
    git(
        &ws,
        &[
            "-c",
            "user.name=Secretive Persona",
            "-c",
            "user.email=persona@example.com",
            "commit",
            "-q",
            "-m",
            "initial commit",
        ],
    );
    let head = String::from_utf8(
        Command::new("git")
            .arg("-C")
            .arg(&ws)
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap();
    (ws, PathBuf::from(head.trim()))
}

#[test]
fn git_envelope_pins_branch_head_and_dirty_state_on_a_real_repo() {
    let (ws, head) = committed_repo("envelope");
    let out = run(&["git", "--path", ws.to_str().unwrap(), "--json"]);
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    let v: Value = serde_json::from_str(out.stdout.trim()).unwrap();

    // Envelope identity + measured repository facts.
    assert_eq!(v["schema"], "wanyrix.git/v1");
    assert_eq!(v["branch"], "main");
    assert_eq!(v["head"], head.to_str().unwrap(), "full 40-hex HEAD sha");
    assert_eq!(
        v["head"].as_str().unwrap().len(),
        40,
        "the wire carries the FULL sha"
    );
    assert_eq!(
        v["dirty"], false,
        "a fresh commit leaves the working tree clean"
    );
    assert_eq!(v["commitCount"], 1);
    assert_eq!(
        v["recentCommits"].as_array().unwrap().len(),
        1,
        "10-newest cap, measured count is 1"
    );
    assert_eq!(v["recentCommits"][0]["subject"], "initial commit");
    assert_eq!(v["changedFiles"], Value::Array(Vec::new()));
    assert_eq!(v["changedFilesCount"], 0);

    // Untracked work is measured, not ignored: dirty flips with exact counts.
    std::fs::write(ws.join("untracked-note.txt"), "drift\n").unwrap();
    let out = run(&["git", "--path", ws.to_str().unwrap(), "--json"]);
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    let v: Value = serde_json::from_str(out.stdout.trim()).unwrap();
    assert_eq!(v["dirty"], true);
    assert_eq!(v["changedFilesCount"], 1, "exact measured count");
    assert_eq!(
        v["untrackedFiles"],
        serde_json::json!(["untracked-note.txt"])
    );
    assert_eq!(
        v["changedFiles"],
        serde_json::json!(["untracked-note.txt"]),
        "untracked paths are changed paths (porcelain ?? entries)"
    );
    assert_eq!(v["changedFilesTruncated"], false);

    // A second commit is measured in the commit count; the tree is clean again.
    git(&ws, &["add", "-A"]);
    git(
        &ws,
        &[
            "-c",
            "user.name=Secretive Persona",
            "-c",
            "user.email=persona@example.com",
            "commit",
            "-q",
            "-m",
            "second commit",
        ],
    );
    let out = run(&["git", "--path", ws.to_str().unwrap(), "--json"]);
    let v: Value = serde_json::from_str(out.stdout.trim()).unwrap();
    assert_eq!(v["commitCount"], 2);
    assert_eq!(v["dirty"], false);
    std::fs::remove_dir_all(&ws).ok();
}

#[test]
fn git_refuses_a_non_repository_with_a_named_exit_2() {
    // A workspace WITH manifests but WITHOUT git: the scan succeeds, the
    // repository measurement refuses honestly.
    let ws = temp_dir("not-a-repo");
    synth::synth(&ws, 2, 17).unwrap();
    let out = run(&["git", "--path", ws.to_str().unwrap(), "--json"]);
    assert_eq!(out.code, 2, "not-a-repo must be exit 2");
    assert!(
        out.stdout.is_empty(),
        "no partial success payload on a refusal: {}",
        out.stdout
    );
    assert!(
        out.stderr
            .starts_with("wanyrix: error: git error: no git repository found at or above "),
        "named error on stderr, got: {}",
        out.stderr
    );
    assert!(
        out.stderr.contains(ws.to_str().unwrap()),
        "the refusal names the measured root: {}",
        out.stderr
    );
    std::fs::remove_dir_all(&ws).ok();
}

#[test]
fn git_redaction_is_unconditional_and_has_no_off_switch() {
    let (ws, _) = committed_repo("redaction");
    let out = run(&["git", "--path", ws.to_str().unwrap(), "--json"]);
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    // Author identity never reaches the wire — no flag was asked for; the
    // contract redacts by design.
    for banned in ["Secretive Persona", "persona@example.com"] {
        assert!(
            !out.stdout.contains(banned),
            "redaction leak on the wire: {banned}"
        );
    }
    // The human summary states the redaction contract explicitly.
    let human = run(&["git", "--path", ws.to_str().unwrap()]);
    assert_eq!(human.code, 0, "stderr: {}", human.stderr);
    assert!(
        human.stdout.contains(
            "redaction: paths and subjects only — never diffs, contents, or author identities"
        ),
        "the human output must carry the redaction note, got: {}",
        human.stdout
    );
    assert!(
        !human.stdout.contains("Secretive Persona"),
        "human output redacts too"
    );
    // The contract documents NO redaction flag — a flag to disable the
    // redaction must not exist (clap usage error, exit 2).
    let off = run(&[
        "git",
        "--path",
        ws.to_str().unwrap(),
        "--no-redact",
        "--json",
    ]);
    assert_eq!(
        off.code, 2,
        "an off-switch for the redaction must not exist"
    );
    assert!(off.stdout.is_empty());
    std::fs::remove_dir_all(&ws).ok();
}
