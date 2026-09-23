//! Binary-level contract tests for the time-machine surface (issue #115):
//! `wanyrix compare` (`wanyrix.compare/v1`) — the deterministic diff of
//! two STORED scans.
//!
//! Pinned here: the golden delta set on a real persisted fixture pair
//! (findings added/resolved + crate add/version-changed + severity deltas),
//! the clock-free envelope (`generatedAt` is the literal `not-measured`,
//! every repeated invocation byte-identical), the required-key conformance
//! set, and the named refusal ladder (unknown id, cross-workspace pair,
//! missing/corrupt store) — exit 2, empty stdout, stable message.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;
use wanyrix_engine::synth;

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wanyrix-compare-cli-{name}-{}-{}",
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

fn json(out: &Output) -> Value {
    assert_eq!(out.code, 0, "exit 0 expected, stderr: {}", out.stderr);
    serde_json::from_str(out.stdout.trim())
        .unwrap_or_else(|e| panic!("stdout must be valid JSON ({e}): {}", out.stdout))
}

fn synth_ws(name: &str) -> PathBuf {
    let ws = temp_dir(name);
    synth::synth(&ws, 2, 17).unwrap();
    ws
}

/// Measure the workspace through the REAL pipeline (doctor → store save)
/// so both compare sides are genuinely persisted scans. Returns the
/// persisted scan id (parsed from the save summary — the contract output).
fn save_scan(ws: &Path, db: &Path, tag: &str) -> i64 {
    let doctor = run(&["doctor", "--path", ws.to_str().unwrap(), "--json"]);
    assert_eq!(doctor.code, 0, "stderr: {}", doctor.stderr);
    let payload_file = db.parent().unwrap().join(format!("{tag}.json"));
    std::fs::write(&payload_file, doctor.stdout.trim()).unwrap();
    let save = run(&[
        "store",
        "save",
        "--db",
        db.to_str().unwrap(),
        "--scan",
        payload_file.to_str().unwrap(),
    ]);
    assert_eq!(save.code, 0, "stderr: {}", save.stderr);
    let line = save
        .stdout
        .lines()
        .find(|l| l.contains("persisted scan"))
        .expect("save summary line");
    line.split("persisted scan ")
        .nth(1)
        .and_then(|rest| rest.split(' ').next())
        .and_then(|id| id.parse::<i64>().ok())
        .expect("persisted scan id is an integer in the save summary")
}

/* ------------------------- golden delta fixture ------------------------- */

/// The required-key conformance set for `wanyrix.compare/v1` (the envelope
/// the web mirror will consume when it graduates from the backlog).
fn assert_compare_conformance(v: &Value) {
    assert_eq!(v["schema"], "wanyrix.compare/v1");
    for side in ["from", "to"] {
        for key in [
            "scanId",
            "workspace",
            "finishedAt",
            "findingCount",
            "critical",
            "warning",
            "info",
        ] {
            assert!(
                v[side].get(key).is_some(),
                "compare.{side}.{key} is a required envelope key: {v}"
            );
        }
    }
    for key in ["added", "removed", "versionChanged", "unchanged"] {
        assert!(
            v["crates"].get(key).is_some(),
            "compare.crates.{key} is a required envelope key"
        );
    }
    for key in ["added", "resolved", "changed"] {
        assert!(
            v["findings"].get(key).is_some(),
            "compare.findings.{key} is a required envelope key"
        );
    }
    for key in [
        "findingsRecorded",
        "cratesRecorded",
        "toolchainRecorded",
        "edgesRecorded",
    ] {
        assert!(
            v["coverage"].get(key).is_some(),
            "compare.coverage.{key} is a required envelope key"
        );
    }
    for key in [
        "schema",
        "db",
        "from",
        "to",
        "crates",
        "findings",
        "severityDelta",
        "coverage",
        "measurement",
        "generatedAt",
    ] {
        assert!(
            v.get(key).is_some(),
            "compare.{key} is a required envelope key"
        );
    }
    assert_eq!(
        v["generatedAt"], "not-measured",
        "a diff of two stored records carries NO wall-clock"
    );
}

#[test]
fn compare_golden_delta_pair_through_the_real_store_pipeline() {
    let ws = synth_ws("cmp-golden");
    let db = temp_dir("cmp-golden-db").join("scans.db");
    run(&["store", "init", "--db", db.to_str().unwrap()]);
    let from = save_scan(&ws, &db, "baseline");
    assert_eq!(from, 1);

    // Real drift, mirroring the what-changed fixture mutations plus the
    // crate-level deltas only compare can see:
    // - license+description added to c0000 (resolves FER-ENG-001/002),
    // - version bumped 0.1.0 → 0.2.0 (crate version-changed),
    // - a version-less path dep c0000 → c0001 (adds FER-ENG-003 and closes
    //   the cycle → FER-ENG-005 critical),
    // - a new crate c0002 (crate added; adds FER-ENG-001/002 for it).
    let manifest = ws.join("c0000/Cargo.toml");
    let text = std::fs::read_to_string(&manifest).unwrap();
    let text = text.replace(
        "# license and description intentionally omitted (doctor findings fixture)",
        "license = \"MIT\"\ndescription = \"documented now\"",
    );
    let text = text.replacen("version = \"0.1.0\"", "version = \"0.2.0\"", 1);
    let text = format!("{text}\n[dependencies]\nc0001 = {{ path = \"../c0001\" }}\n");
    std::fs::write(&manifest, text).unwrap();
    let c0002 = ws.join("c0002");
    std::fs::create_dir_all(&c0002).unwrap();
    std::fs::write(
        c0002.join("Cargo.toml"),
        "[package]\nname = \"c0002\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
    )
    .unwrap();

    let to = save_scan(&ws, &db, "drifted");
    assert_eq!(to, 2);

    let out = run(&[
        "compare",
        "--db",
        db.to_str().unwrap(),
        "--from",
        "1",
        "--to",
        "2",
        "--json",
    ]);
    let v = json(&out);
    assert_compare_conformance(&v);
    assert_eq!(v["from"]["scanId"], 1);
    assert_eq!(v["to"]["scanId"], 2);
    assert_eq!(v["from"]["workspace"], v["to"]["workspace"]);
    assert!(
        v["from"]["toolchain"].is_string(),
        "a full save records the measured toolchain: {v}"
    );

    // Crate deltas: one added, one version-changed, one unchanged (c0001).
    assert_eq!(
        v["crates"]["added"],
        serde_json::json!([{ "name": "c0002", "version": "0.1.0" }])
    );
    assert_eq!(
        v["crates"]["versionChanged"],
        serde_json::json!([{ "name": "c0000", "fromVersion": "0.1.0", "toVersion": "0.2.0" }])
    );
    assert_eq!(v["crates"]["removed"], Value::Array(Vec::new()));
    assert_eq!(v["crates"]["unchanged"], 1);

    // Finding deltas — the same golden pair the what-changed surface pins,
    // plus the new crate's own findings.
    let added: Vec<&str> = v["findings"]["added"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["id"].as_str().unwrap())
        .collect();
    let resolved: Vec<&str> = v["findings"]["resolved"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["id"].as_str().unwrap())
        .collect();
    assert_eq!(
        added,
        [
            "FER-ENG-001-c0002",
            "FER-ENG-002-c0002",
            "FER-ENG-003-c0000",
            "FER-ENG-005-c0000"
        ]
    );
    assert_eq!(resolved, ["FER-ENG-001-c0000", "FER-ENG-002-c0000"]);
    assert_eq!(v["findings"]["changed"], Value::Array(Vec::new()));

    // The severity ladder is measured from the committed scan rows.
    assert_eq!(
        v["severityDelta"],
        serde_json::json!({ "critical": 1, "warning": 1, "info": 0 })
    );
    assert_eq!(v["coverage"]["cratesRecorded"], true);
    assert_eq!(v["coverage"]["toolchainRecorded"], true);
    assert_eq!(
        v["coverage"]["edgesRecorded"], false,
        "the store persists doctor payloads, which carry no edge list — labeled, never guessed"
    );
    assert!(
        v["notes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n.as_str().unwrap().contains("edges are not recorded")),
        "the edge-coverage limitation is named in the envelope itself"
    );
    std::fs::remove_dir_all(&ws).ok();
    std::fs::remove_dir_all(db.parent().unwrap()).ok();
}

/* ------------------------------ determinism ----------------------------- */

#[test]
fn compare_is_byte_identical_across_repeated_invocations() {
    let ws = synth_ws("cmp-determinism");
    let db = temp_dir("cmp-determinism-db").join("scans.db");
    run(&["store", "init", "--db", db.to_str().unwrap()]);
    save_scan(&ws, &db, "a");
    // A genuinely different second scan (a new crate changes the doctor
    // payload), so the determinism check runs over a NON-trivial delta.
    let c2 = ws.join("c0002");
    std::fs::create_dir_all(&c2).unwrap();
    std::fs::write(
        c2.join("Cargo.toml"),
        "[package]\nname = \"c0002\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
    )
    .unwrap();
    save_scan(&ws, &db, "b");

    for mode in [
        vec!["--json"],
        vec!["--json", "--pretty"],
        vec![], // human output is deterministic too
    ] {
        let mut args = vec![
            "compare".to_string(),
            "--db".to_string(),
            db.to_str().unwrap().to_string(),
            "--from".to_string(),
            "1".to_string(),
            "--to".to_string(),
            "2".to_string(),
        ];
        args.extend(mode.iter().map(|s| s.to_string()));
        let args: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let first = run(&args);
        let second = run(&args);
        assert_eq!(first.code, 0, "stderr: {}", first.stderr);
        assert_eq!(
            first.stdout, second.stdout,
            "mode {mode:?}: repeated invocations must be byte-identical"
        );
    }

    // The pretty envelope is the same document, formatted: no clock there either.
    let pretty = run(&[
        "compare",
        "--db",
        db.to_str().unwrap(),
        "--from",
        "1",
        "--to",
        "2",
        "--json",
        "--pretty",
    ]);
    assert!(pretty.stdout.contains("\"generatedAt\": \"not-measured\""));
    std::fs::remove_dir_all(&ws).ok();
    std::fs::remove_dir_all(db.parent().unwrap()).ok();
}

#[test]
fn compare_identical_scans_is_a_clean_zero_delta_envelope() {
    let ws = synth_ws("cmp-zero");
    let db = temp_dir("cmp-zero-db").join("scans.db");
    run(&["store", "init", "--db", db.to_str().unwrap()]);
    save_scan(&ws, &db, "one");
    save_scan(&ws, &db, "two"); // same tree — a second stored scan

    let out = run(&[
        "compare",
        "--db",
        db.to_str().unwrap(),
        "--from",
        "1",
        "--to",
        "2",
        "--json",
    ]);
    let v = json(&out);
    for key in ["added", "resolved", "changed"] {
        assert_eq!(
            v["findings"][key].as_array().unwrap().len(),
            0,
            "identical trees must not invent drift in `{key}`"
        );
    }
    assert_eq!(v["crates"]["unchanged"], 2);
    assert_eq!(
        v["severityDelta"],
        serde_json::json!({ "critical": 0, "warning": 0, "info": 0 })
    );

    // Comparing a scan with itself is the same clean no-op (exit 0).
    let out = run(&[
        "compare",
        "--db",
        db.to_str().unwrap(),
        "--from",
        "2",
        "--to",
        "2",
        "--json",
    ]);
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    let v = json(&out);
    assert_eq!(v["crates"]["unchanged"], 2);
    std::fs::remove_dir_all(&ws).ok();
    std::fs::remove_dir_all(db.parent().unwrap()).ok();
}

/* ------------------------------- refusals ------------------------------- */

#[test]
fn compare_refusal_ladder_is_named_and_byte_stable() {
    let ws = synth_ws("cmp-refusals");

    // Never-initialized store: the store's own named remediation.
    let missing = temp_dir("cmp-refusals-db").join("never-init.db");
    let out = run(&[
        "compare",
        "--db",
        missing.to_str().unwrap(),
        "--from",
        "1",
        "--to",
        "2",
        "--json",
    ]);
    assert_eq!(out.code, 2, "missing store must be exit 2");
    assert!(out.stdout.is_empty(), "never a partial payload");
    assert!(
        out.stderr
            .starts_with("wanyrix: error: scan store error: store not found at ")
            && out.stderr.contains("wanyrix store init"),
        "named refusal with remediation, got: {}",
        out.stderr
    );

    // Corrupt store FILE: the SQLite layer refuses honestly.
    let corrupt = temp_dir("cmp-corrupt-db").join("corrupt.db");
    std::fs::write(&corrupt, "this is not a sqlite database\n").unwrap();
    let out = run(&[
        "compare",
        "--db",
        corrupt.to_str().unwrap(),
        "--from",
        "1",
        "--to",
        "2",
        "--json",
    ]);
    assert_eq!(out.code, 2, "corrupt store must be exit 2");
    assert!(out.stdout.is_empty());
    assert!(
        out.stderr.starts_with("wanyrix: error: scan store error: "),
        "named refusal, got: {}",
        out.stderr
    );

    // Initialized store, unknown scan ids — exit 2, named, byte-stable.
    let db = temp_dir("cmp-refusals-db2").join("scans.db");
    run(&["store", "init", "--db", db.to_str().unwrap()]);
    save_scan(&ws, &db, "only");
    for (from, to) in [("99", "1"), ("1", "99")] {
        let args = [
            "compare",
            "--db",
            db.to_str().unwrap(),
            "--from",
            from,
            "--to",
            to,
            "--json",
        ];
        let first = run(&args);
        let second = run(&args);
        for out in [&first, &second] {
            assert_eq!(out.code, 2, "unknown scan id must be exit 2");
            assert!(out.stdout.is_empty(), "never a partial diff");
            assert!(
                out.stderr
                    .starts_with("wanyrix: error: compare error: scan #99 not found in ")
                    && out.stderr.contains("wanyrix store list"),
                "named refusal with remediation, got: {}",
                out.stderr
            );
        }
        assert_eq!(
            first.stderr, second.stderr,
            "the refusal is byte-stable across runs"
        );
    }
    std::fs::remove_dir_all(&ws).ok();
    std::fs::remove_dir_all(db.parent().unwrap()).ok();
}

#[test]
fn compare_refuses_cross_workspace_pairs_with_a_named_error() {
    let db = temp_dir("cmp-cross-db").join("scans.db");
    run(&["store", "init", "--db", db.to_str().unwrap()]);

    let ws_a = synth_ws("cmp-cross-a");
    save_scan(&ws_a, &db, "a");
    let ws_b = synth_ws("cmp-cross-b");
    save_scan(&ws_b, &db, "b");

    let out = run(&[
        "compare",
        "--db",
        db.to_str().unwrap(),
        "--from",
        "1",
        "--to",
        "2",
        "--json",
    ]);
    assert_eq!(out.code, 2, "cross-workspace pairs are a named refusal");
    assert!(out.stdout.is_empty(), "never a partial diff");
    assert!(
        out.stderr.contains("different workspaces")
            && out.stderr.contains("cmp-cross-a")
            && out.stderr.contains("cmp-cross-b")
            && out.stderr.contains("--workspace"),
        "the refusal names both workspaces and the remediation, got: {}",
        out.stderr
    );
    std::fs::remove_dir_all(&ws_a).ok();
    std::fs::remove_dir_all(&ws_b).ok();
    std::fs::remove_dir_all(db.parent().unwrap()).ok();
}

/* ---------------------------- human contract ---------------------------- */

#[test]
fn compare_human_output_names_the_diff_with_the_established_markers() {
    let ws = synth_ws("cmp-human");
    let db = temp_dir("cmp-human-db").join("scans.db");
    run(&["store", "init", "--db", db.to_str().unwrap()]);
    save_scan(&ws, &db, "base");
    let manifest = ws.join("c0000/Cargo.toml");
    let text = std::fs::read_to_string(&manifest).unwrap();
    let text = text.replace(
        "# license and description intentionally omitted (doctor findings fixture)",
        "license = \"MIT\"\ndescription = \"documented now\"",
    );
    let text = format!("{text}\n[dependencies]\nc0001 = {{ path = \"../c0001\" }}\n");
    std::fs::write(&manifest, text).unwrap();
    save_scan(&ws, &db, "drift");

    let out = run(&[
        "compare",
        "--db",
        db.to_str().unwrap(),
        "--from",
        "1",
        "--to",
        "2",
    ]);
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    let human = &out.stdout;
    let ws_name = ws.file_name().unwrap().to_str().unwrap();
    assert!(
        human.starts_with(&format!(
            "wanyrix compare — {ws_name} (wanyrix.compare/v1)\n"
        )),
        "header names the surface, workspace and schema: {human}"
    );
    assert!(
        human.contains("from: scan #1 (measured "),
        "side reference: {human}"
    );
    assert!(
        human.contains("to:   scan #2 (measured "),
        "side reference: {human}"
    );
    assert!(
        human.contains("findings: 2 added, 2 resolved, 0 changed"),
        "{human}"
    );
    assert!(
        human.contains("+ [warning] FER-ENG-003-c0000"),
        "added marker: {human}"
    );
    assert!(
        human.contains("+ [critical] FER-ENG-005-c0000"),
        "critical is visible: {human}"
    );
    assert!(
        human.contains("- [warning] FER-ENG-001-c0000"),
        "resolved marker: {human}"
    );
    assert!(human.contains("severity delta: 1 critical"), "{human}");
    assert!(
        human.contains("edges NOT recorded"),
        "coverage is honest in human output: {human}"
    );
    assert!(
        !human.contains("generatedAt"),
        "the human summary carries no clock — the diff is between recorded instants"
    );

    // Second run: byte-identical human output.
    let again = run(&[
        "compare",
        "--db",
        db.to_str().unwrap(),
        "--from",
        "1",
        "--to",
        "2",
    ]);
    assert_eq!(out.stdout, again.stdout);
    std::fs::remove_dir_all(&ws).ok();
    std::fs::remove_dir_all(db.parent().unwrap()).ok();
}
