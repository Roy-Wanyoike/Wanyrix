//! Binary-level contract tests for the change surfaces — AUD-9:
//! `wanyrix impact` (`wanyrix.impact/v1`), `wanyrix what-changed`
//! (`wanyrix.what-changed/v1`), and the honesty ledger's central transition
//! `experiment measure` (estimated → measured → verified, via REAL builds).
//!
//! impact/what-changed are filesystem-only and run unconditionally; the
//! experiment-measure test executes real `cargo build`s and therefore SKIPS
//! HONESTLY (printed, never silently green) when cargo is unavailable —
//! the same convention as `build_cli.rs`.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;
use wanyrix_engine::synth;

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wanyrix-change-cli-{name}-{}-{}",
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

/* ------------------------------- impact -------------------------------- */

#[test]
fn impact_happy_path_pins_the_blast_radius_envelope_on_synth50() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/synth-50");
    let out = run(&[
        "impact",
        "--crate",
        "c0000",
        "--path",
        fixture.to_str().unwrap(),
        "--json",
    ]);
    let v = json(&out);
    assert_eq!(v["schema"], "wanyrix.impact/v1");
    assert_eq!(v["crateName"], "c0000");
    assert_eq!(v["workspaceCrateCount"], 50);
    // Measured self-consistency: the count mirrors the list and the
    // per-mille is the documented integer math over it.
    let transitive = v["transitiveDependents"].as_array().unwrap();
    assert_eq!(
        v["transitiveCount"],
        transitive.len(),
        "the count is the list's length, never a separate guess"
    );
    let expected_per_mille = (1 + transitive.len() as u64) * 1000 / 50;
    assert_eq!(v["blastRadiusPerMille"], expected_per_mille);
    // Measured fixture fact: the only crate below c0001 is c0000, so c0001
    // is a direct dependent (97-edge backward-only DAG, synth50_fixture.rs).
    let direct = v["directDependents"].as_array().unwrap();
    assert!(
        direct.iter().any(|d| d == "c0001"),
        "c0001 must be a direct dependent of c0000, got {direct:?}"
    );
    for d in direct {
        assert!(
            transitive.iter().any(|t| t == d),
            "direct dependents are inside the transitive closure"
        );
    }
    assert!(
        v["note"].as_str().unwrap().contains("dev"),
        "the envelope carries the dev-edges-don't-propagate rule: {v}"
    );
}

#[test]
fn impact_of_a_leaf_crate_is_a_measured_zero_on_a_tmp_workspace() {
    // synth(2,17) wires exactly one edge c0001 → c0000: c0001 has no
    // dependents (blast radius floor) and c0000's closure is c0001 alone.
    let ws = synth_ws("impact-leaf");
    let out = run(&[
        "impact",
        "--crate",
        "c0001",
        "--path",
        ws.to_str().unwrap(),
        "--json",
    ]);
    let v = json(&out);
    assert_eq!(v["schema"], "wanyrix.impact/v1");
    assert_eq!(v["directDependents"], Value::Array(Vec::new()));
    assert_eq!(v["transitiveCount"], 0);
    assert_eq!(v["blastRadiusPerMille"], 500, "(1+0)*1000/2 — integer math");

    let out = run(&[
        "impact",
        "--crate",
        "c0000",
        "--path",
        ws.to_str().unwrap(),
        "--json",
    ]);
    let v = json(&out);
    assert_eq!(
        v["directDependents"],
        serde_json::json!(["c0001"]),
        "the one measured edge lands in the normal bucket"
    );
    assert_eq!(v["blastRadiusPerMille"], 1000, "whole workspace affected");
    std::fs::remove_dir_all(&ws).ok();
}

#[test]
fn impact_refuses_unknown_crates_stably_with_exit_2() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/synth-50");
    let args = [
        "impact",
        "--crate",
        "ghost-crate",
        "--path",
        fixture.to_str().unwrap(),
        "--json",
    ];
    let first = run(&args);
    let second = run(&args);
    for out in [&first, &second] {
        assert_eq!(out.code, 2, "unknown crate must be exit 2");
        assert!(
            out.stdout.is_empty(),
            "impact is never guessed — no partial payload"
        );
        assert!(
            out.stderr.starts_with(
                "wanyrix: error: impact error: crate 'ghost-crate' is not a workspace crate under "
            ),
            "named refusal, got: {}",
            out.stderr
        );
    }
    assert_eq!(
        first.stderr, second.stderr,
        "the refusal is byte-stable across runs"
    );
}

/* ----------------------------- what-changed ----------------------------- */

/// Baseline the workspace through the REAL store pipeline (doctor → save),
/// so the diff is against a genuinely persisted scan.
fn save_baseline(ws: &Path, db: &Path) {
    let doctor = run(&["doctor", "--path", ws.to_str().unwrap(), "--json"]);
    assert_eq!(doctor.code, 0, "stderr: {}", doctor.stderr);
    let payload_file = ws.parent().unwrap().join("baseline.json");
    std::fs::write(&payload_file, doctor.stdout.trim()).unwrap();
    let init = run(&["store", "init", "--db", db.to_str().unwrap()]);
    assert_eq!(init.code, 0, "stderr: {}", init.stderr);
    let save = run(&[
        "store",
        "save",
        "--db",
        db.to_str().unwrap(),
        "--scan",
        payload_file.to_str().unwrap(),
    ]);
    assert_eq!(save.code, 0, "stderr: {}", save.stderr);
}

#[test]
fn what_changed_without_a_baseline_is_a_valid_named_note_envelope() {
    let ws = synth_ws("wc-no-baseline");
    let db = temp_dir("wc-no-baseline-db").join("scans.db");
    run(&["store", "init", "--db", db.to_str().unwrap()]);

    let out = run(&[
        "what-changed",
        "--path",
        ws.to_str().unwrap(),
        "--db",
        db.to_str().unwrap(),
        "--json",
    ]);
    let v = json(&out);
    assert_eq!(v["schema"], "wanyrix.what-changed/v1");
    assert_eq!(v["workspace"], ws.file_name().unwrap().to_str().unwrap());
    assert!(
        v.get("against").is_none(),
        "no baseline ⇒ no fabricated baseline reference: {v}"
    );
    let note = v["baselineNote"].as_str().unwrap();
    assert!(
        note.contains("no stored scan for workspace") && note.contains("wanyrix store save"),
        "the note is the named remediation, got: {note}"
    );
    // Honest accounting: with no baseline every current finding is added,
    // cross-checked against the doctor run of the same binary.
    let doctor = run(&["doctor", "--path", ws.to_str().unwrap(), "--json"]);
    let d: Value = serde_json::from_str(doctor.stdout.trim()).unwrap();
    assert_eq!(
        v["findings"]["added"].as_array().unwrap().len() as u64,
        d["summary"]["total"].as_u64().unwrap(),
        "added == the full measured finding set"
    );
    assert_eq!(
        v["severityDelta"]["warning"].as_i64().unwrap(),
        d["summary"]["warning"].as_i64().unwrap(),
        "the delta is measured against an empty baseline"
    );
    std::fs::remove_dir_all(&ws).ok();
    std::fs::remove_dir_all(db.parent().unwrap()).ok();
}

#[test]
fn what_changed_diffs_the_saved_baseline_into_a_drift_envelope() {
    let ws = synth_ws("wc-drift");
    let db = temp_dir("wc-drift-db").join("scans.db");
    save_baseline(&ws, &db);

    // Clean tree: the diff against the just-saved baseline is empty and the
    // envelope names WHAT it diffed against (scanId + finishedAt).
    let out = run(&[
        "what-changed",
        "--path",
        ws.to_str().unwrap(),
        "--db",
        db.to_str().unwrap(),
        "--json",
    ]);
    let v = json(&out);
    assert_eq!(v["schema"], "wanyrix.what-changed/v1");
    assert_eq!(v["against"]["scanId"], 1);
    assert!(
        v["against"]["finishedAt"].as_str().unwrap().contains("T"),
        "ISO-8601 baseline stamp"
    );
    for key in ["added", "resolved", "changed"] {
        assert_eq!(
            v["findings"][key].as_array().unwrap().len(),
            0,
            "clean diff must not invent drift in `{key}`"
        );
    }

    // Real drift: license+description added to c0000 (resolves two
    // findings) and a version-less path dep c0000 → c0001 (adds FER-ENG-003
    // and closes the cycle → FER-ENG-005).
    let manifest = ws.join("c0000/Cargo.toml");
    let text = std::fs::read_to_string(&manifest).unwrap();
    let text = text.replace(
        "# license and description intentionally omitted (doctor findings fixture)",
        "license = \"MIT\"\ndescription = \"documented now\"",
    );
    // synth(2,17) wires c0001 → c0000 only; pointing c0000 back at c0001
    // adds a version-less dep (FER-ENG-003) and closes the cycle
    // (FER-ENG-005).
    let text = format!("{text}\n[dependencies]\nc0001 = {{ path = \"../c0001\" }}\n");
    std::fs::write(&manifest, text).unwrap();

    let out = run(&[
        "what-changed",
        "--path",
        ws.to_str().unwrap(),
        "--db",
        db.to_str().unwrap(),
        "--json",
    ]);
    let v = json(&out);
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
    assert_eq!(added, ["FER-ENG-003-c0000", "FER-ENG-005-c0000"]);
    assert_eq!(resolved, ["FER-ENG-001-c0000", "FER-ENG-002-c0000"]);
    assert_eq!(
        v["severityDelta"]["critical"], 1,
        "the cycle finding is critical — the delta ladder is measured"
    );
    std::fs::remove_dir_all(&ws).ok();
    std::fs::remove_dir_all(db.parent().unwrap()).ok();
}

#[test]
fn what_changed_refuses_missing_and_corrupt_stores_with_exit_2() {
    let ws = synth_ws("wc-refusals");

    // Never-initialized store: named remediation, no partial payload.
    let missing = temp_dir("wc-refusals-db").join("never-init.db");
    let out = run(&[
        "what-changed",
        "--path",
        ws.to_str().unwrap(),
        "--db",
        missing.to_str().unwrap(),
        "--json",
    ]);
    assert_eq!(out.code, 2);
    assert!(out.stdout.is_empty());
    assert!(
        out.stderr
            .starts_with("wanyrix: error: scan store error: store not found at ")
            && out.stderr.contains("wanyrix store init"),
        "named refusal with remediation, got: {}",
        out.stderr
    );

    // Corrupt store file: the SQLite layer refuses honestly — never an
    // empty "all clear" diff.
    let corrupt = temp_dir("wc-corrupt-db").join("corrupt.db");
    std::fs::write(&corrupt, "this is not a sqlite database\n").unwrap();
    let out = run(&[
        "what-changed",
        "--path",
        ws.to_str().unwrap(),
        "--db",
        corrupt.to_str().unwrap(),
        "--json",
    ]);
    assert_eq!(out.code, 2, "corrupt store must be exit 2");
    assert!(out.stdout.is_empty());
    assert!(
        out.stderr.starts_with("wanyrix: error: scan store error: "),
        "named refusal, got: {}",
        out.stderr
    );
    std::fs::remove_dir_all(&ws).ok();
}

/* -------------------- experiment measure (cargo-gated) ------------------ */

fn cargo_available() -> bool {
    Command::new("cargo")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// The honesty ledger's central transition, end-to-end through the binary
/// with REAL builds: record (estimated) → measure baseline → measure
/// candidate (measured) → verify (verified, candidate measurably faster).
/// Cargo-gated like build_cli.rs — the transition is a measured build and
/// nothing else can substitute it.
#[test]
fn experiment_record_measure_verify_transitions_through_the_binary() {
    if !cargo_available() {
        println!(
            "SKIP: cargo is not available on this machine — the estimated→measured \
             transition executes real instrumented builds and nothing else can substitute it"
        );
        return;
    }
    // A 2-crate /tmp workspace synthesized BY the binary (dogfoods the
    // documented synth surface for fixture creation).
    let ws = temp_dir("exp-ws");
    let made = run(&[
        "synth",
        "--crates",
        "2",
        "--out",
        ws.to_str().unwrap(),
        "--seed",
        "11",
    ]);
    assert_eq!(made.code, 0, "stderr: {}", made.stderr);

    // record: estimated, no fabricated measurements.
    let out = run(&[
        "experiment",
        "record",
        "--name",
        "halve-build",
        "--claim",
        "warm rebuild halves the wall clock",
        "--path",
        ws.to_str().unwrap(),
        "--json",
    ]);
    let v = json(&out);
    assert_eq!(v["schema"], "wanyrix.experiment/v1");
    assert_eq!(v["status"], "estimated");
    assert!(v.get("baseline").is_none() && v.get("candidate").is_none());

    // measure baseline: a REAL instrumented build attaches measured figures.
    let out = run(&[
        "experiment",
        "measure",
        "--name",
        "halve-build",
        "--role",
        "baseline",
        "--path",
        ws.to_str().unwrap(),
        "--json",
    ]);
    let v = json(&out);
    assert_eq!(v["schema"], "wanyrix.experiment/v1");
    assert_eq!(v["status"], "estimated", "one role is not yet measured");
    assert_eq!(
        v["baseline"]["buildSuccess"], true,
        "a zero-dep synth workspace must build"
    );
    assert!(
        v["baseline"]["wallClockMs"].as_u64().unwrap() > 0,
        "the wall clock is measured"
    );
    assert!(v.get("candidate").is_none(), "no fabricated candidate");

    // measure candidate: both roles ⇒ status measured.
    let out = run(&[
        "experiment",
        "measure",
        "--name",
        "halve-build",
        "--role",
        "candidate",
        "--path",
        ws.to_str().unwrap(),
        "--json",
    ]);
    let v = json(&out);
    assert_eq!(v["status"], "measured");
    assert_eq!(v["candidate"]["buildSuccess"], true);

    // verify: granted ONLY because the candidate is measurably faster (the
    // warm rebuild of the same target dir against the cold baseline).
    let out = run(&[
        "experiment",
        "verify",
        "--name",
        "halve-build",
        "--path",
        ws.to_str().unwrap(),
        "--json",
    ]);
    let v = json(&out);
    assert_eq!(v["schema"], "wanyrix.experiment/v1");
    assert_eq!(v["status"], "verified");
    assert!(v["verifiedAt"].is_string(), "the grant is stamped");

    // Every transition minted a durable event (recorded + 2× measured +
    // verified), each carrying the event schema.
    let out = run(&["events", "--path", ws.to_str().unwrap(), "--json"]);
    let v = json(&out);
    assert_eq!(v["schema"], "wanyrix.events/v1");
    assert_eq!(v["count"], 4);
    let kinds: Vec<&str> = v["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["kind"].as_str().unwrap())
        .collect();
    assert_eq!(
        kinds,
        [
            "experiment.recorded",
            "experiment.measured",
            "experiment.measured",
            "experiment.verified"
        ]
    );
    assert_eq!(
        v["events"][0]["schema"], "wanyrix.event/v1",
        "the trail mirrors transitions as wanyrix.event/v1 lines"
    );
    std::fs::remove_dir_all(&ws).ok();
}

/// The measure/verify refusal paths keep their names through the binary.
/// `measure` refusals run their (real) build first — the ledger is only
/// consulted after the measurement exists — so the whole test is
/// cargo-gated; `verify` refusals are ledger-only and run unconditionally.
#[test]
fn experiment_refusals_stay_named_verify_gate_never_fakes() {
    let ws = synth_ws("exp-refusals");

    // verify an unknown name: ledger-only refusal — no cargo needed.
    let out = run(&[
        "experiment",
        "verify",
        "--name",
        "ghost",
        "--path",
        ws.to_str().unwrap(),
        "--json",
    ]);
    assert_eq!(out.code, 2);
    assert!(out.stdout.is_empty());
    assert!(
        out.stderr.starts_with(
            "wanyrix: error: experiment ledger error: experiment \"ghost\" not found in "
        ) && out.stderr.contains("record it first"),
        "named refusal, got: {}",
        out.stderr
    );

    // A second record whose verify (without any measurement) must stay a
    // named refusal — the honesty gate cannot be faked through the binary.
    let out = run(&[
        "experiment",
        "record",
        "--name",
        "only-estimated",
        "--claim",
        "never measured",
        "--path",
        ws.to_str().unwrap(),
        "--json",
    ]);
    assert_eq!(out.code, 0, "stderr: {}", out.stderr);
    let out = run(&[
        "experiment",
        "verify",
        "--name",
        "only-estimated",
        "--path",
        ws.to_str().unwrap(),
        "--json",
    ]);
    assert_eq!(out.code, 2);
    assert!(
        out.stderr.contains("not fully measured"),
        "verify-without-measure stays refused, got: {}",
        out.stderr
    );

    // measure refusals consult the ledger AFTER running the real build, so
    // they need cargo on PATH; skip honestly when it is absent.
    if !cargo_available() {
        println!("SKIP: cargo is not available on this machine (measure refusals run a real build first)");
        std::fs::remove_dir_all(&ws).ok();
        return;
    }
    // Unknown role: measured against the real tree, then refused by name.
    let out = run(&[
        "experiment",
        "measure",
        "--name",
        "only-estimated",
        "--role",
        "sideways",
        "--path",
        ws.to_str().unwrap(),
        "--json",
    ]);
    assert_eq!(out.code, 2);
    assert!(out.stdout.is_empty());
    assert!(
        out.stderr.contains("unknown role") && out.stderr.contains("baseline or candidate"),
        "named role refusal, got: {}",
        out.stderr
    );
    // Unknown name: refused by name, exit 2.
    let out = run(&[
        "experiment",
        "measure",
        "--name",
        "ghost",
        "--role",
        "baseline",
        "--path",
        ws.to_str().unwrap(),
        "--json",
    ]);
    assert_eq!(out.code, 2);
    assert!(
        out.stderr.contains("\"ghost\" not found in"),
        "named unknown-experiment refusal, got: {}",
        out.stderr
    );
    std::fs::remove_dir_all(&ws).ok();
}
