//! Binary-execution contract for `wanyrix chain` (issue #100): the
//! engineering-memory chain query — scan → finding(s) → experiment(s) →
//! measurement → verification verdict — executed as the REAL binary, the
//! way `binary_matrix.rs` pins its surfaces. Pins: the `wanyrix.chain/v1`
//! envelope, byte-identical reruns (JSON and human), the verbatim evidence
//! labels, the named exit-2 refusals (unknown finding id, missing store,
//! blank `--finding`) and the named-not-fatal data paths (orphan links).

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde_json::Value;
use wanyrix_engine::synth;

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wanyrix-chain-cli-{name}-{}-{}",
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

fn run_with_stdin(args: &[&str], payload: &str) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(payload.as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    Output {
        stdout: String::from_utf8(out.stdout).unwrap(),
        stderr: String::from_utf8(out.stderr).unwrap(),
        code: out.status.code().unwrap_or(-1),
    }
}

fn json(out: &Output) -> Value {
    assert_eq!(out.code, 0, "exit 0 expected, stderr: {}", out.stderr);
    serde_json::from_str(out.stdout.trim())
        .unwrap_or_else(|e| panic!("stdout must be valid JSON ({e}): {}", out.stdout))
}

/// A seeded chain: workspace + store + one doctor scan saved + one linked
/// experiment. Returns (ws, db, finding id, stored severity).
fn seeded(name: &str) -> (PathBuf, PathBuf, String, String) {
    let ws = temp_dir(name);
    synth::synth(&ws, 2, 17).unwrap();
    let db = temp_dir(&format!("{name}-db")).join("scans.db");

    let init = run(&["store", "init", "--db", db.to_str().unwrap()]);
    assert_eq!(init.code, 0, "stderr: {}", init.stderr);

    let doctor = run(&["doctor", "--path", ws.to_str().unwrap(), "--json"]);
    assert_eq!(doctor.code, 0, "stderr: {}", doctor.stderr);
    let payload: Value = serde_json::from_str(doctor.stdout.trim()).unwrap();
    let save = run_with_stdin(
        &["store", "save", "--db", db.to_str().unwrap(), "--scan", "-"],
        doctor.stdout.trim(),
    );
    assert_eq!(save.code, 0, "stderr: {}", save.stderr);

    let fid = payload["findings"][0]["id"].as_str().unwrap().to_owned();
    let severity = payload["findings"][0]["severity"]
        .as_str()
        .unwrap()
        .to_owned();
    let rec = run(&[
        "experiment",
        "record",
        "--name",
        "halve-build",
        "--claim",
        "cut the wall clock in half",
        "--finding",
        &fid,
        "--path",
        ws.to_str().unwrap(),
        "--json",
    ]);
    assert_eq!(rec.code, 0, "stderr: {}", rec.stderr);
    let v: Value = serde_json::from_str(rec.stdout.trim()).unwrap();
    assert_eq!(
        v["findingId"], fid,
        "the recorded record carries the link verbatim"
    );
    (ws, db, fid, severity)
}

#[test]
fn chain_reconstructs_the_seeded_chain_through_the_real_binary() {
    let (ws, db, fid, severity) = seeded("happy");
    let out = run(&[
        "chain",
        "--path",
        ws.to_str().unwrap(),
        "--db",
        db.to_str().unwrap(),
        "--json",
    ]);
    let v = json(&out);
    assert_eq!(v["schema"], "wanyrix.chain/v1");
    assert_eq!(v["workspace"], ws.file_name().unwrap().to_str().unwrap());
    assert_eq!(v["scope"]["mode"], "workspace");
    assert_eq!(
        v["generatedAt"], "not-measured",
        "a deterministic query carries no wall-clock"
    );
    assert_eq!(v["scans"].as_array().unwrap().len(), 1);
    let finding = v["scans"][0]["findings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["findingId"] == fid.as_str())
        .unwrap_or_else(|| panic!("finding {fid} in the chain: {v}"));
    assert_eq!(
        finding["severity"], severity,
        "severity echoed verbatim from the stored row"
    );
    assert_eq!(finding["experiments"].as_array().unwrap().len(), 1);
    assert_eq!(finding["experiments"][0]["name"], "halve-build");
    assert_eq!(
        finding["experiments"][0]["status"], "estimated",
        "labels echoed VERBATIM — the chain never upgrades evidence"
    );
    assert_eq!(finding["experiments"][0]["findingId"], fid.as_str());
    assert_eq!(v["events"].as_array().unwrap().len(), 1);
    assert_eq!(v["events"][0]["kind"], "experiment.recorded");
    assert!(
        v["notes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n.as_str().unwrap().contains("echoed verbatim")),
        "the honesty note rides the envelope: {v}"
    );
    std::fs::remove_dir_all(&ws).unwrap();
    std::fs::remove_dir_all(db.parent().unwrap()).unwrap();
}

#[test]
fn chain_is_byte_identical_on_rerun_in_both_flavors() {
    let (ws, db, _, _) = seeded("determinism");
    let base = &[
        "chain",
        "--path",
        ws.to_str().unwrap(),
        "--db",
        db.to_str().unwrap(),
    ];
    let a = run(&[base.as_slice(), &["--json"]].concat());
    let b = run(&[base.as_slice(), &["--json"]].concat());
    assert_eq!(a.code, 0);
    assert_eq!(
        a.stdout, b.stdout,
        "JSON reruns are byte-identical (no wall-clock in the envelope)"
    );
    let ha = run(base);
    let hb = run(base);
    assert_eq!(ha.stdout, hb.stdout, "human reruns are byte-identical");
    assert!(ha.stdout.starts_with("wanyrix chain — workspace"));
    std::fs::remove_dir_all(&ws).unwrap();
    std::fs::remove_dir_all(db.parent().unwrap()).unwrap();
}

#[test]
fn chain_human_tree_is_pinned() {
    let (ws, db, fid, severity) = seeded("human");
    let out = run(&[
        "chain",
        "--path",
        ws.to_str().unwrap(),
        "--db",
        db.to_str().unwrap(),
    ]);
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    let h = &out.stdout;
    assert!(h.contains("scope: workspace"), "got: {h}");
    assert!(
        h.contains(&format!("{fid} [{severity}]")),
        "the stored severity is echoed: {h}"
    );
    assert!(
        h.contains("experiment \"halve-build\" [estimated]"),
        "the label is echoed verbatim: {h}"
    );
    assert!(h.contains("baseline: not measured"), "got: {h}");
    assert!(h.contains("unlinked experiments (0)"));
    assert!(h.contains("orphaned experiment→finding links (0)"));
    assert!(h.contains("corrupt ledger lines (0)"));
    assert!(h.contains("notes:"));
    assert!(h.contains("echoed verbatim"));
    std::fs::remove_dir_all(&ws).unwrap();
    std::fs::remove_dir_all(db.parent().unwrap()).unwrap();
}

#[test]
fn chain_finding_scope_limits_the_chain() {
    let (ws, db, fid, _) = seeded("finding-scope");
    let out = run(&[
        "chain",
        "--path",
        ws.to_str().unwrap(),
        "--db",
        db.to_str().unwrap(),
        "--finding",
        &fid,
        "--json",
    ]);
    let v = json(&out);
    assert_eq!(v["scope"]["mode"], "finding");
    assert_eq!(v["scope"]["findingId"], fid.as_str());
    let scans = v["scans"].as_array().unwrap();
    assert_eq!(scans.len(), 1);
    assert_eq!(scans[0]["findings"].as_array().unwrap().len(), 1);
    assert_eq!(scans[0]["findings"][0]["findingId"], fid.as_str());
    std::fs::remove_dir_all(&ws).unwrap();
    std::fs::remove_dir_all(db.parent().unwrap()).unwrap();
}

#[test]
fn chain_unknown_finding_id_is_an_exit2_named_refusal() {
    let (ws, db, _, _) = seeded("unknown");
    let out = run(&[
        "chain",
        "--path",
        ws.to_str().unwrap(),
        "--db",
        db.to_str().unwrap(),
        "--finding",
        "FER-NOPE-999",
    ]);
    assert_eq!(out.code, 2, "unknown scope ids are contract exit 2");
    assert!(out.stdout.is_empty(), "no partial success output");
    assert!(
        out.stderr.contains("wanyrix: error:") && out.stderr.contains("unknown finding id"),
        "named + actionable on stderr, got: {}",
        out.stderr
    );
    std::fs::remove_dir_all(&ws).unwrap();
    std::fs::remove_dir_all(db.parent().unwrap()).unwrap();
}

#[test]
fn chain_refuses_a_missing_store_and_names_the_remediation() {
    let ws = temp_dir("no-store");
    synth::synth(&ws, 2, 17).unwrap();
    let db = temp_dir("no-store-db").join("never-initialized.db");
    let out = run(&[
        "chain",
        "--path",
        ws.to_str().unwrap(),
        "--db",
        db.to_str().unwrap(),
    ]);
    assert_eq!(out.code, 2);
    assert!(out.stdout.is_empty());
    assert!(
        out.stderr.contains("wanyrix: error:") && out.stderr.contains("store not found"),
        "got: {}",
        out.stderr
    );
    std::fs::remove_dir_all(&ws).unwrap();
}

#[test]
fn chain_empty_store_is_a_valid_envelope_with_the_seeding_note() {
    let ws = temp_dir("empty");
    synth::synth(&ws, 2, 17).unwrap();
    let db = temp_dir("empty-db").join("scans.db");
    let init = run(&["store", "init", "--db", db.to_str().unwrap()]);
    assert_eq!(init.code, 0, "stderr: {}", init.stderr);
    let out = run(&[
        "chain",
        "--path",
        ws.to_str().unwrap(),
        "--db",
        db.to_str().unwrap(),
        "--json",
    ]);
    let v = json(&out);
    assert_eq!(v["scans"].as_array().unwrap().len(), 0);
    assert!(
        v["notes"].as_array().unwrap().iter().any(|n| n
            .as_str()
            .unwrap()
            .contains("no stored scans for workspace")),
        "the remediation note is present: {v}"
    );
    std::fs::remove_dir_all(&ws).unwrap();
    std::fs::remove_dir_all(db.parent().unwrap()).unwrap();
}

#[test]
fn chain_names_orphaned_links_instead_of_dropping_them() {
    let (ws, db, _, _) = seeded("orphan");
    let rec = run(&[
        "experiment",
        "record",
        "--name",
        "ghost-link",
        "--claim",
        "points at a finding that was never stored",
        "--finding",
        "FER-GHOST-000",
        "--path",
        ws.to_str().unwrap(),
        "--json",
    ]);
    assert_eq!(rec.code, 0, "stderr: {}", rec.stderr);

    let out = run(&[
        "chain",
        "--path",
        ws.to_str().unwrap(),
        "--db",
        db.to_str().unwrap(),
        "--json",
    ]);
    let v = json(&out);
    assert_eq!(v["orphanLinks"].as_array().unwrap().len(), 1);
    let orphan = &v["orphanLinks"][0];
    assert_eq!(orphan["findingId"], "FER-GHOST-000");
    assert_eq!(orphan["experiment"]["name"], "ghost-link");
    assert!(
        orphan["note"].as_str().unwrap().contains("dangling"),
        "the note names the problem: {orphan}"
    );
    // exit 0: a dangling link is data, not an operator error.
    std::fs::remove_dir_all(&ws).unwrap();
    std::fs::remove_dir_all(db.parent().unwrap()).unwrap();
}

#[test]
fn experiment_record_refuses_a_blank_finding_link() {
    let ws = temp_dir("blank-finding");
    synth::synth(&ws, 2, 17).unwrap();
    let out = run(&[
        "experiment",
        "record",
        "--name",
        "blank",
        "--claim",
        "claim",
        "--finding",
        "   ",
        "--path",
        ws.to_str().unwrap(),
    ]);
    assert_eq!(out.code, 2, "a blank link is not a finding id");
    assert!(out.stdout.is_empty());
    assert!(
        out.stderr.contains("wanyrix: error:") && out.stderr.contains("--finding"),
        "got: {}",
        out.stderr
    );
    std::fs::remove_dir_all(&ws).unwrap();
}
