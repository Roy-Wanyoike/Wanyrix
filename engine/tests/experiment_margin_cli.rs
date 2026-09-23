//! Binary-level pin for issue #143 item 4: `experiment verify` grants
//! `verified` ONLY when the measured candidate is faster by MORE than the
//! minimum margin (`--min-margin-pct`, default 10% of the measured baseline).
//! A delta at or below the margin is the explicit `within-noise` outcome —
//! exit-level success (it is a real measurement report), but the evidence
//! tier stays `measured`, the ledger is NOT rewritten, and NO event fires.
//! Honesty contract: verify never claims more certainty than was measured.
//!
//! The records are seeded through the PUBLIC pure seam
//! ([`wanyrix_engine::product::apply_measurement`]) and persisted in the
//! exact on-disk ledger layout (one JSON object per line), so these tests
//! exercise the REAL CLI verify flow without running cargo.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde_json::Value;
use wanyrix_engine::product::{apply_measurement, experiment_record, ExperimentRecord};

fn temp_ws(name: &str) -> PathBuf {
    // Under the engine crate dir's target/ (gitignored, never scanned).
    let rel = format!(
        "target/wanyrix-verify-margin-{name}-{}-{}",
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

/// Persist `rec` exactly the way the engine does: one compact JSON object
/// per line in `<ws>/.wanyrix/experiments.jsonl`.
fn persist(ws: &Path, rec: &ExperimentRecord) {
    let dir = ws.join(".wanyrix");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("experiments.jsonl"),
        format!("{}\n", serde_json::to_string(rec).unwrap()),
    )
    .unwrap();
}

/// A fully measured experiment (two REAL recorded successful builds — the
/// records are seeded via the public pure seam; verify itself is the real
/// CLI flow).
fn measured_pair(ws: &Path, name: &str, baseline_ms: u64, candidate_ms: u64) {
    let rec = experiment_record(ws, name, "a hypothesis worth measuring", None).unwrap();
    let rec = apply_measurement(rec, "baseline", baseline_ms, true, "cargo build", "t1").unwrap();
    let rec = apply_measurement(rec, "candidate", candidate_ms, true, "cargo build", "t2").unwrap();
    persist(ws, &rec);
}

fn run(ws: &Path, args: &[&str]) -> (String, String, i32) {
    let out = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args(args)
        .current_dir(ws)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .unwrap();
    (
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8(out.stderr).unwrap(),
        out.status.code().unwrap_or(-1),
    )
}

fn ledger_text(ws: &Path) -> String {
    std::fs::read_to_string(ws.join(".wanyrix/experiments.jsonl")).unwrap()
}

fn event_count(ws: &Path) -> usize {
    std::fs::read_to_string(ws.join(".wanyrix/events.jsonl"))
        .unwrap()
        .lines()
        .filter(|l| !l.trim().is_empty())
        .count()
}

/// The QA wave-1 repro at the binary level: two ~120 ms builds a few ms
/// apart used to reach `verified` on pure timing noise.
#[test]
fn within_noise_verify_is_exit_0_but_never_upgrades_the_tier() {
    let ws = temp_ws("noise");
    // delta 2 ms on a 120 ms baseline; default margin 10% → ceil(12) = 12 ms.
    measured_pair(&ws, "noise-exp", 120, 118);

    let (stdout, stderr, code) = run(
        &ws,
        &[
            "experiment",
            "verify",
            "--name",
            "noise-exp",
            "--path",
            ws.to_str().unwrap(),
            "--json",
        ],
    );
    assert_eq!(
        code, 0,
        "within-noise is a successful measurement report, not an error: {stderr}"
    );
    let v: Value = serde_json::from_str(stdout.trim()).expect("verify --json emits the envelope");
    assert_eq!(
        v["verifyOutcome"], "within-noise",
        "the outcome is named: {v}"
    );
    assert_eq!(v["status"], "measured", "the evidence tier stays measured");
    assert!(v["verifiedAt"].is_null(), "no verification was granted");
    assert_eq!(v["measuredDeltaMs"], 2, "the measured delta is reported");
    assert_eq!(
        v["minMarginMs"], 12,
        "the margin the delta failed to exceed"
    );
    let note = v["note"].as_str().unwrap();
    assert!(note.contains("noise"), "the note says why: {note}");
    assert!(
        note.contains("nothing was verified"),
        "the note never overclaims: {note}"
    );

    // The ledger is untouched: still exactly the measured record.
    let ledger = ledger_text(&ws);
    assert_eq!(ledger.lines().count(), 1);
    assert!(
        ledger.contains("\"status\":\"measured\""),
        "the on-disk tier stays measured: {ledger}"
    );
    // And NO event fired: only transitions mint events.
    assert_eq!(
        event_count(&ws),
        1,
        "the recorded event only — a within-noise verdict mints nothing"
    );

    // The human flavor states the same facts honestly.
    let (stdout, stderr, code) = run(
        &ws,
        &[
            "experiment",
            "verify",
            "--name",
            "noise-exp",
            "--path",
            ws.to_str().unwrap(),
        ],
    );
    assert_eq!(code, 0, "{stderr}");
    assert!(
        stdout.contains("within-noise") && stdout.contains("NOT verified"),
        "human output names the outcome: {stdout}"
    );
    assert!(
        stdout.contains("minimum margin"),
        "human output names the margin rule: {stdout}"
    );
    std::fs::remove_dir_all(&ws).ok();
}

/// A delta genuinely beyond the margin still verifies — the rule must not
/// make honest verification impossible.
#[test]
fn a_delta_beyond_the_margin_verifies_and_persists() {
    let ws = temp_ws("beyond");
    // delta 500 ms on a 1000 ms baseline; margin ceil(100) = 100 ms.
    measured_pair(&ws, "real-win", 1000, 500);
    let (stdout, stderr, code) = run(
        &ws,
        &[
            "experiment",
            "verify",
            "--name",
            "real-win",
            "--path",
            ws.to_str().unwrap(),
            "--json",
        ],
    );
    assert_eq!(code, 0, "{stderr}");
    let v: Value = serde_json::from_str(stdout.trim()).unwrap();
    assert_eq!(v["verifyOutcome"], "verified");
    assert_eq!(v["status"], "verified");
    assert!(
        v["verifiedAt"].is_string(),
        "the verification day is stamped"
    );

    // The ledger IS rewritten at `verified` and the transition event mints.
    assert!(
        ledger_text(&ws).contains("\"status\":\"verified\""),
        "the on-disk tier upgraded"
    );
    assert_eq!(event_count(&ws), 2, "recorded + the verified transition");
    std::fs::remove_dir_all(&ws).ok();
}

/// `--min-margin-pct 0` is the documented operator override: any strictly
/// faster delta verifies (the operator accepts the noise risk explicitly).
#[test]
fn explicit_zero_margin_accepts_any_strictly_faster_delta() {
    let ws = temp_ws("zero");
    measured_pair(&ws, "tiny", 500, 499); // 1 ms delta — noise by default
    let (stdout, stderr, code) = run(
        &ws,
        &[
            "experiment",
            "verify",
            "--name",
            "tiny",
            "--path",
            ws.to_str().unwrap(),
            "--min-margin-pct",
            "0",
            "--json",
        ],
    );
    assert_eq!(code, 0, "{stderr}");
    let v: Value = serde_json::from_str(stdout.trim()).unwrap();
    assert_eq!(v["verifyOutcome"], "verified");
    assert_eq!(v["status"], "verified");
    std::fs::remove_dir_all(&ws).ok();
}

/// A nonsensical margin is a named CLI refusal (exit 2) — never a silent
/// clamp — and the record stays exactly as measured.
#[test]
fn a_nonsensical_margin_is_a_named_cli_refusal() {
    let ws = temp_ws("bad-margin");
    measured_pair(&ws, "guarded", 100, 50);
    let (_, stderr, code) = run(
        &ws,
        &[
            "experiment",
            "verify",
            "--name",
            "guarded",
            "--path",
            ws.to_str().unwrap(),
            "--min-margin-pct=100.5",
            "--json",
        ],
    );
    assert_eq!(code, 2, "values above 100 are refused: {stderr}");
    assert!(
        stderr.contains("--min-margin-pct"),
        "the refusal names the flag: {stderr}"
    );
    assert!(
        ledger_text(&ws).contains("\"status\":\"measured\""),
        "a refused verify never touches the tier"
    );
    assert_eq!(event_count(&ws), 1, "a refusal mints no event");
    std::fs::remove_dir_all(&ws).ok();
}
