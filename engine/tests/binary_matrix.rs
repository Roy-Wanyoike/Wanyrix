//! Binary-execution matrix (issue #89, A1-F2 remainder): the seven CLI
//! surfaces that previously ran only through the lib API in tests — `init`,
//! `status`, `analyze`, `dependencies`, `experiment`, `events`, `store` —
//! executed as the REAL binary, pinning the exit-0 / JSON-envelope contract
//! the operator actually gets, the way `export_cli.rs` and `exclude_cli.rs`
//! pin theirs. Refusal paths are pinned as exit 2 with a named error —
//! never a silent success.
//!
//! No cargo build needed — these surfaces are filesystem-only, so there is
//! nothing to skip honestly here (the cargo-backed `build`/`experiment
//! measure` surfaces keep their own cargo-gated suites).

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde_json::Value;
use wanyrix_engine::synth;

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wanyrix-binary-matrix-{name}-{}-{}",
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

/// Like [`run`], but the child's stdin carries `payload` (for `store save -`).
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

fn fresh_ws(name: &str) -> PathBuf {
    let ws = temp_dir(name);
    synth::synth(&ws, 2, 17).unwrap();
    ws
}

#[test]
fn init_records_measured_identity_and_echoes_idempotently() {
    let ws = fresh_ws("init");
    let out = run(&["init", "--path", ws.to_str().unwrap(), "--json"]);
    let v = json(&out);
    assert_eq!(v["schema"], "wanyrix.init/v1");
    assert_eq!(v["workspace"], ws.file_name().unwrap().to_str().unwrap());
    assert_eq!(v["created"], true, "first run creates the state file");
    assert_eq!(v["crates"], 2);
    assert_eq!(
        v["edges"], 1,
        "synth(2,17) wires one backward path-dep edge"
    );
    assert!(
        v["stateFile"]
            .as_str()
            .unwrap()
            .ends_with(".wanyrix/state.json"),
        "state lands in the engine's own .wanyrix dir: {v}"
    );
    assert!(ws.join(".wanyrix/state.json").is_file(), "state on disk");

    let again = run(&["init", "--path", ws.to_str().unwrap(), "--json"]);
    let v2 = json(&again);
    assert_eq!(v2["schema"], "wanyrix.init/v1");
    assert_eq!(
        v2["created"], false,
        "second run echoes the existing state — never resets it"
    );
    std::fs::remove_dir_all(&ws).ok();
}

#[test]
fn status_reports_the_fresh_measured_snapshot() {
    let ws = fresh_ws("status");
    let out = run(&["status", "--path", ws.to_str().unwrap(), "--json"]);
    let v = json(&out);
    assert_eq!(v["schema"], "wanyrix.status/v1");
    assert_eq!(v["crates"], 2);
    assert_eq!(v["parseFailures"], 0);
    assert_eq!(
        v["initialized"], false,
        "no init ran yet — the baseline flag is honest about it"
    );
    // With an init baseline, the flag flips without a re-init.
    run(&["init", "--path", ws.to_str().unwrap(), "--json"]);
    let out = run(&["status", "--path", ws.to_str().unwrap(), "--json"]);
    let v = json(&out);
    assert_eq!(v["initialized"], true, "init baseline now visible");
    std::fs::remove_dir_all(&ws).ok();
}

#[test]
fn analyze_embeds_doctor_graph_health_verbatim() {
    let ws = fresh_ws("analyze");
    let out = run(&["analyze", "--path", ws.to_str().unwrap(), "--json"]);
    let v = json(&out);
    assert_eq!(v["schema"], "wanyrix.analyze/v1");
    // Zero contract re-shaping: the three envelopes ride under one schema
    // with their own schema ids intact.
    assert_eq!(v["doctor"]["schema"], "wanyrix.doctor/v1");
    assert_eq!(v["graph"]["schema"], "wanyrix.graph/v1");
    assert_eq!(v["health"]["schema"], "wanyrix.health/v1");
    assert_eq!(
        v["doctor"]["summary"]["total"].as_u64().unwrap() > 0,
        true,
        "synth fixture gives doctor something to say"
    );
    std::fs::remove_dir_all(&ws).ok();
}

#[test]
fn dependencies_reports_the_measured_edge_intelligence() {
    let ws = fresh_ws("deps");
    let out = run(&["dependencies", "--path", ws.to_str().unwrap(), "--json"]);
    let v = json(&out);
    assert_eq!(v["schema"], "wanyrix.dependencies/v1");
    let crates = v["crates"].as_array().unwrap();
    assert_eq!(crates.len(), 2);
    assert_eq!(v["resolved"], 1, "the one synth path-dep edge resolves");
    assert_eq!(v["broken"], 0);
    assert_eq!(v["escaped"], 0);
    assert_eq!(v["cycles"].as_array().unwrap().len(), 0);
    for c in crates {
        for key in ["name", "dependencies", "dependents", "fanIn", "fanOut"] {
            assert!(c.get(key).is_some(), "dependency entry key `{key}` in {c}");
        }
    }
    // Cross-checked against the measured edge list: c0001 → c0000.
    let by_name = |n: &str| {
        crates
            .iter()
            .find(|c| c["name"] == n)
            .unwrap_or_else(|| panic!("crate {n} in {crates:?}"))
            .clone()
    };
    assert_eq!(by_name("c0000")["dependents"], serde_json::json!(["c0001"]));
    assert_eq!(
        by_name("c0001")["dependencies"],
        serde_json::json!(["c0000"])
    );
    assert_eq!(by_name("c0000")["fanIn"], 1);
    assert_eq!(by_name("c0000")["fanOut"], 0);
    std::fs::remove_dir_all(&ws).ok();
}

#[test]
fn experiment_ledger_records_lists_and_refuses_overwrites() {
    let ws = fresh_ws("experiment");
    let out = run(&[
        "experiment",
        "record",
        "--name",
        "halve-build",
        "--claim",
        "cut wall clock in half",
        "--path",
        ws.to_str().unwrap(),
        "--json",
    ]);
    let v = json(&out);
    assert_eq!(v["schema"], "wanyrix.experiment/v1");
    assert_eq!(v["name"], "halve-build");
    assert_eq!(
        v["status"], "estimated",
        "a recorded hypothesis is estimated"
    );
    assert!(
        v.get("baseline").is_none() && v.get("candidate").is_none(),
        "no fabricated measurements on an estimated record: {v}"
    );

    // The ledger never overwrites — a duplicate name is a named exit-2 error.
    let dup = run(&[
        "experiment",
        "record",
        "--name",
        "halve-build",
        "--claim",
        "again",
        "--path",
        ws.to_str().unwrap(),
        "--json",
    ]);
    assert_eq!(dup.code, 2, "duplicate names must be refused");
    assert!(dup.stdout.is_empty(), "no partial success output");
    assert!(
        dup.stderr.contains("already exists") && dup.stderr.contains("never overwrites"),
        "named refusal on stderr, got: {}",
        dup.stderr
    );

    // `list` speaks its own envelope: wanyrix.experiments/v1 (plural).
    let out = run(&[
        "experiment",
        "list",
        "--path",
        ws.to_str().unwrap(),
        "--json",
    ]);
    let v = json(&out);
    assert_eq!(
        v["schema"], "wanyrix.experiments/v1",
        "the list envelope is the PLURAL schema (docs/CLI.md row 12 drift, #89)"
    );
    assert_eq!(v["count"], 1);
    assert_eq!(v["experiments"][0]["name"], "halve-build");

    // verify without two real measured builds is a named refusal (the gate
    // cannot be faked through the binary either).
    let verify = run(&[
        "experiment",
        "verify",
        "--name",
        "halve-build",
        "--path",
        ws.to_str().unwrap(),
        "--json",
    ]);
    assert_eq!(
        verify.code, 2,
        "verify without measurements must be refused"
    );
    assert!(
        verify.stderr.contains("not fully measured"),
        "named refusal on stderr, got: {}",
        verify.stderr
    );

    // The record transition minted exactly one durable event.
    let out = run(&["events", "--path", ws.to_str().unwrap(), "--json"]);
    let v = json(&out);
    assert_eq!(v["schema"], "wanyrix.events/v1");
    assert_eq!(v["count"], 1);
    assert_eq!(v["corruptCount"], 0);
    assert_eq!(
        v["events"][0]["schema"], "wanyrix.event/v1",
        "the trail carries wanyrix.event/v1 lines"
    );
    std::fs::remove_dir_all(&ws).ok();
}

#[test]
fn events_reads_an_empty_ledger_honestly() {
    let ws = fresh_ws("events");
    let out = run(&["events", "--path", ws.to_str().unwrap(), "--json"]);
    let v = json(&out);
    assert_eq!(v["schema"], "wanyrix.events/v1");
    assert_eq!(v["count"], 0);
    assert_eq!(v["corruptCount"], 0);
    assert_eq!(v["events"].as_array().unwrap().len(), 0);
    std::fs::remove_dir_all(&ws).ok();
}

#[test]
fn store_lifecycle_init_save_list_fsck_through_the_binary() {
    let ws = fresh_ws("store");
    let db = temp_dir("store-db").join("scans.db");

    let out = run(&["store", "init", "--db", db.to_str().unwrap()]);
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    assert!(
        out.stdout.contains("schema ready") && out.stdout.contains("journal_mode=wal"),
        "human contract of store init, got: {}",
        out.stdout
    );

    // `store save -` reads the exact `wanyrix doctor --json` payload from stdin.
    let doctor = run(&["doctor", "--path", ws.to_str().unwrap(), "--json"]);
    assert_eq!(doctor.code, 0, "stderr: {}", doctor.stderr);
    let payload: Value = serde_json::from_str(doctor.stdout.trim()).unwrap();
    let out = run_with_stdin(
        &["store", "save", "--db", db.to_str().unwrap(), "--scan", "-"],
        doctor.stdout.trim(),
    );
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    assert!(
        out.stdout.contains("persisted scan"),
        "human contract of store save, got: {}",
        out.stdout
    );
    assert!(
        out.stdout.contains("two-phase"),
        "the commit-order honesty note is part of the output"
    );

    let out = run(&["store", "list", "--db", db.to_str().unwrap()]);
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    assert!(
        out.stdout.contains("1 scan(s)"),
        "one stored scan, got: {}",
        out.stdout
    );
    assert!(
        out.stdout.contains(payload["workspace"].as_str().unwrap()),
        "the stored workspace name shows up in the table: {}",
        out.stdout
    );

    let out = run(&["store", "fsck", "--db", db.to_str().unwrap()]);
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    assert!(
        out.stdout.contains("1 scans checked")
            && out
                .stdout
                .contains("incomplete scans (missing findings rows): 0"),
        "a clean two-phase store fscks clean, got: {}",
        out.stdout
    );
    std::fs::remove_dir_all(&ws).ok();
    std::fs::remove_dir_all(db.parent().unwrap()).ok();
}

#[test]
fn scan_backed_surfaces_refuse_a_missing_path_with_exit_2() {
    let missing = temp_dir("missing");
    let missing_str = missing.to_str().unwrap().to_owned();
    std::fs::remove_dir_all(&missing).unwrap();
    for cmd in [
        vec!["init", "--path", &missing_str, "--json"],
        vec!["status", "--path", &missing_str, "--json"],
        vec!["analyze", "--path", &missing_str, "--json"],
        vec!["dependencies", "--path", &missing_str, "--json"],
    ] {
        let out = run(&cmd);
        assert_eq!(out.code, 2, "`{:?}` must fail with exit 2", cmd);
        assert!(out.stdout.is_empty(), "`{:?}` printed partial success", cmd);
        assert!(
            out.stderr.contains("wanyrix: error:")
                && out.stderr.contains("does not exist or is not a directory"),
            "`{:?}`: named error on stderr, got: {}",
            cmd,
            out.stderr
        );
    }
    // `events` is NOT scan-backed: it reads `.wanyrix/events.jsonl` and an
    // absent trail is an honest empty log (exit 0, zero counts) — pinned so
    // nobody "fixes" it into a fake failure.
    let out = run(&["events", "--path", &missing_str, "--json"]);
    let v = json(&out);
    assert_eq!(v["schema"], "wanyrix.events/v1");
    assert_eq!(v["count"], 0);
    assert_eq!(v["corruptCount"], 0);
}

#[test]
fn store_refuses_a_missing_database_file_with_exit_2() {
    let db = temp_dir("no-store").join("never-initialized.db");
    let out = run(&["store", "list", "--db", db.to_str().unwrap()]);
    assert_eq!(out.code, 2, "list on a missing store must fail");
    assert!(
        out.stderr.contains("wanyrix: error:"),
        "named error on stderr, got: {}",
        out.stderr
    );
}
