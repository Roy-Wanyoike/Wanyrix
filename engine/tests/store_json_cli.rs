//! Binary-level pin for issue #143 item 1: `store list --json` and
//! `store fsck --json` emit the versioned envelopes design rule 1 promises
//! ("every read command has a `--json` switch"). Before this, `store`
//! read surfaces were the only human-output-only reads in the CLI.

use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde_json::Value;

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wanyrix-store-json-{name}-{}-{}",
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

fn run(args: &[&str], stdin_payload: Option<&str>) -> (String, String, i32) {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_wanyrix"));
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
    if stdin_payload.is_some() {
        cmd.stdin(Stdio::piped());
    }
    let mut child = cmd.spawn().unwrap();
    if let Some(payload) = stdin_payload {
        use std::io::Write;
        child
            .stdin
            .take()
            .unwrap()
            .write_all(payload.as_bytes())
            .unwrap();
    }
    let out = child.wait_with_output().unwrap();
    (
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8(out.stderr).unwrap(),
        out.status.code().unwrap_or(-1),
    )
}

/// `generatedAt` is the LAST key of the envelope (the envelope rule).
fn generated_at_is_last(v: &str) -> bool {
    let Some(idx) = v.rfind("\"generatedAt\"") else {
        return false;
    };
    v[idx..].find("\",\"").is_none()
}

#[test]
fn store_list_and_fsck_speak_the_documented_json_envelopes() {
    let ws = temp_dir("ws");
    let db = ws.join("scans.db");
    // A REAL measured workspace (the tiny-ws fixture) — doctor refuses an
    // empty directory by design, and this test pins the store envelopes.
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/tiny-ws");

    // Build a real store: init + one measured doctor scan saved via stdin.
    let (_, stderr, code) = run(&["store", "init", "--db", db.to_str().unwrap()], None);
    assert_eq!(code, 0, "store init: {stderr}");
    let (doctor_out, stderr, code) = run(
        &["doctor", "--path", fixture.to_str().unwrap(), "--json"],
        None,
    );
    assert_eq!(code, 0, "doctor: {stderr}");
    let doctor_v: Value = serde_json::from_str(doctor_out.trim()).unwrap();
    let (_, stderr, code) = run(
        &["store", "save", "--db", db.to_str().unwrap(), "--scan", "-"],
        Some(doctor_out.trim()),
    );
    assert_eq!(code, 0, "store save: {stderr}");

    // store list --json — the wanyrix.store-scans/v1 collection envelope.
    let (stdout, stderr, code) = run(
        &["store", "list", "--db", db.to_str().unwrap(), "--json"],
        None,
    );
    assert_eq!(code, 0, "store list --json: {stderr}");
    let v: Value = serde_json::from_str(stdout.trim()).unwrap();
    assert_eq!(v["schema"], "wanyrix.store-scans/v1");
    assert_eq!(v["count"], 1);
    assert!(
        v["workspace"].is_null(),
        "no filter → null, never a silent default"
    );
    assert_eq!(v["scans"].as_array().unwrap().len(), 1);
    let row = &v["scans"][0];
    assert_eq!(
        row["workspace"], doctor_v["workspace"],
        "the stored workspace name"
    );
    assert_eq!(row["findingCount"], doctor_v["summary"]["total"]);
    assert_eq!(
        row["severityCritical"], doctor_v["summary"]["critical"],
        "the row echoes exactly what doctor measured"
    );
    assert!(row["finishedAt"].is_u64(), "integer epoch timestamp");
    assert!(row["schemaVersion"].is_i64());
    assert!(
        generated_at_is_last(stdout.trim()),
        "generatedAt is the last envelope key: {stdout}"
    );

    // The --workspace filter is echoed in the envelope too.
    let wsname = doctor_v["workspace"].as_str().unwrap();
    let (stdout, _, code) = run(
        &[
            "store",
            "list",
            "--db",
            db.to_str().unwrap(),
            "--workspace",
            wsname,
            "--json",
        ],
        None,
    );
    assert_eq!(code, 0);
    let v: Value = serde_json::from_str(stdout.trim()).unwrap();
    assert_eq!(v["workspace"], wsname);
    assert_eq!(v["count"], 1);

    // store fsck --json — the wanyrix.store-fsck/v1 envelope; problem
    // triples are named objects, never positional arrays.
    let (stdout, stderr, code) = run(
        &["store", "fsck", "--db", db.to_str().unwrap(), "--json"],
        None,
    );
    assert_eq!(code, 0, "store fsck --json: {stderr}");
    let v: Value = serde_json::from_str(stdout.trim()).unwrap();
    assert_eq!(v["schema"], "wanyrix.store-fsck/v1");
    assert_eq!(v["healthy"], true);
    assert_eq!(v["repair"], false);
    assert_eq!(v["scansChecked"], 1);
    assert_eq!(v["incompleteScans"].as_array().unwrap().len(), 0);
    assert_eq!(v["countMismatches"].as_array().unwrap().len(), 0);
    assert_eq!(v["orphanFindings"].as_array().unwrap().len(), 0);
    assert!(
        generated_at_is_last(stdout.trim()),
        "envelope rule holds: {stdout}"
    );

    // --pretty stays available for humans reading machines' output.
    let (stdout, _, code) = run(
        &[
            "store",
            "list",
            "--db",
            db.to_str().unwrap(),
            "--json",
            "--pretty",
        ],
        None,
    );
    assert_eq!(code, 0);
    assert!(stdout.contains("\n  "), "pretty-printed JSON is multiline");

    std::fs::remove_dir_all(&ws).ok();
}

/// The human output is unchanged (the default flavor stays the table).
#[test]
fn store_human_output_is_unchanged_by_the_json_flag() {
    let ws = temp_dir("human");
    let db = ws.join("scans.db");
    let (_, stderr, code) = run(&["store", "init", "--db", db.to_str().unwrap()], None);
    assert_eq!(code, 0, "{stderr}");
    let (stdout, _, code) = run(&["store", "list", "--db", db.to_str().unwrap()], None);
    assert_eq!(code, 0);
    assert!(
        stdout.contains("0 scan(s)") && stdout.contains("workspace"),
        "human table intact: {stdout}"
    );
    let (stdout, _, code) = run(&["store", "fsck", "--db", db.to_str().unwrap()], None);
    assert_eq!(code, 0);
    assert!(
        stdout.contains("store consistent"),
        "human fsck intact: {stdout}"
    );
    std::fs::remove_dir_all(&ws).ok();
}
