//! Binary-level pins for the docs/CLI.md stdin shorthand (QA-4-B-3).
//!
//! The contract's trailing note promises the pipeline forms
//! `wanyrix store save --db <db> -` (reads a `wanyrix doctor --json`
//! payload from stdin) and `wanyrix telemetry ingest -` (reads a
//! `cargo build --message-format=json` stream from stdin). Before the fix
//! BOTH documented forms were clap usage errors (exit 2) and only the
//! undocumented `--scan -` / `--input -` flags worked.
//!
//! Pinned contract (docs + binary agree):
//! - the documented positional forms run and behave EXACTLY like the long
//!   forms (`--scan -` / `--input -`);
//! - a positional path works like a flag path (pure sugar, one code path);
//! - giving BOTH the positional and the flag is a named refusal (exit 2) —
//!   ambiguity must never silently pick which bytes get consumed;
//! - giving NEITHER is a named refusal, never an empty guess;
//! - garbage scan payloads still fail NAMED through the positional entry
//!   point (exit 2, `store error`).

use std::io::Write as _;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde_json::Value;

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wanyrix-stdin-shorthand-{name}-{}-{}",
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

/// A real measured doctor payload: produced BY the binary, so the store
/// receives exactly what the documented pipeline would feed it.
fn doctor_payload(out: &PathBuf) -> String {
    let ws = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/tiny-ws");
    let run = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args(["doctor", "--path", ws.to_str().unwrap(), "--json"])
        .output()
        .expect("run wanyrix doctor");
    assert_eq!(
        run.status.code(),
        Some(0),
        "doctor failed: {}",
        String::from_utf8_lossy(&run.stderr)
    );
    let payload = String::from_utf8(run.stdout).unwrap();
    std::fs::write(out, &payload).unwrap();
    payload
}

/// Run the binary with `payload` piped to stdin.
fn run_with_stdin(args: &[&str], payload: &str) -> (String, String, Option<i32>) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn wanyrix");
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(payload.as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    (
        String::from_utf8_lossy(&out.stdout).to_string(),
        String::from_utf8_lossy(&out.stderr).to_string(),
        out.status.code(),
    )
}

fn run(args: &[&str]) -> (String, String, Option<i32>) {
    let out = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args(args)
        .output()
        .expect("run wanyrix");
    (
        String::from_utf8_lossy(&out.stdout).to_string(),
        String::from_utf8_lossy(&out.stderr).to_string(),
        out.status.code(),
    )
}

/* ----------------------------- store save ----------------------------- */

#[test]
fn store_save_accepts_the_documented_positional_stdin_form() {
    let dir = temp_dir("store-positional");
    let db = dir.join("scans.db");
    let payload_file = dir.join("doctor.json");
    let payload = doctor_payload(&payload_file);

    let (_, stderr, code) = run(&["store", "init", "--db", db.to_str().unwrap()]);
    assert_eq!(code, Some(0), "store init failed: {stderr}");

    // THE documented contract form: positional `-`.
    let (stdout, stderr, code) = run_with_stdin(
        &["store", "save", "--db", db.to_str().unwrap(), "-"],
        &payload,
    );
    assert_eq!(
        code,
        Some(0),
        "documented `store save --db <db> -` must run: {stderr}"
    );
    assert!(
        stdout.contains("wanyrix store save — persisted scan"),
        "human confirmation: {stdout}"
    );

    // The scan actually persisted (measured, not assumed).
    let (stdout, stderr, code) = run(&["store", "list", "--db", db.to_str().unwrap()]);
    assert_eq!(code, Some(0), "store list failed: {stderr}");
    assert!(stdout.contains("tiny-ws"), "persisted row listed: {stdout}");
}

#[test]
fn store_save_positional_and_long_form_are_equivalent() {
    let dir = temp_dir("store-equiv");
    let payload_file = dir.join("doctor.json");
    let payload = doctor_payload(&payload_file);

    // Long form (pre-existing behavior) and positional form persist the
    // same scan into two stores — both must report identical rows.
    for (name, extra) in [("long", vec!["--scan", "-"]), ("positional", vec!["-"])] {
        let db = dir.join(format!("{name}.db"));
        run(&["store", "init", "--db", db.to_str().unwrap()]);
        let mut args = vec!["store", "save", "--db", db.to_str().unwrap()];
        args.extend(extra);
        let (_, stderr, code) = run_with_stdin(&args, &payload);
        assert_eq!(code, Some(0), "{name} form failed: {stderr}");
    }
    let (a, _, ca) = run(&[
        "store",
        "list",
        "--db",
        dir.join("long.db").to_str().unwrap(),
    ]);
    let (b, _, cb) = run(&[
        "store",
        "list",
        "--db",
        dir.join("positional.db").to_str().unwrap(),
    ]);
    assert_eq!((ca, cb), (Some(0), Some(0)));
    assert_eq!(a, b, "positional form is pure sugar for --scan -");
}

#[test]
fn store_save_positional_path_and_ambiguity_and_missing_refusals() {
    let dir = temp_dir("store-refs");
    let db = dir.join("scans.db");
    let payload_file = dir.join("doctor.json");
    let payload = doctor_payload(&payload_file);
    run(&["store", "init", "--db", db.to_str().unwrap()]);

    // A positional PATH (not only `-`) is the same code path — the sugar
    // is uniform.
    let (_, stderr, code) = run(&[
        "store",
        "save",
        "--db",
        db.to_str().unwrap(),
        payload_file.to_str().unwrap(),
    ]);
    assert_eq!(code, Some(0), "positional path form failed: {stderr}");

    // BOTH forms: named ambiguity refusal, exit 2.
    let (_, stderr, code) = run(&[
        "store",
        "save",
        "--db",
        db.to_str().unwrap(),
        "--scan",
        payload_file.to_str().unwrap(),
        "-",
    ]);
    assert_eq!(code, Some(2), "both forms must be refused");
    assert!(
        stderr.contains("store error") && stderr.contains("not both"),
        "named refusal: {stderr}"
    );

    // NEITHER form: named refusal, exit 2 — never an empty guess.
    let (_, stderr, code) = run(&["store", "save", "--db", db.to_str().unwrap()]);
    assert_eq!(code, Some(2), "missing source must be refused");
    assert!(
        stderr.contains("store error") && stderr.contains("no scan source given"),
        "named refusal: {stderr}"
    );
    let _ = payload;
}

#[test]
fn store_save_garbage_on_stdin_still_fails_named_through_the_documented_form() {
    let dir = temp_dir("store-garbage");
    let db = dir.join("scans.db");
    run(&["store", "init", "--db", db.to_str().unwrap()]);
    let (_, stderr, code) = run_with_stdin(
        &["store", "save", "--db", db.to_str().unwrap(), "-"],
        "not json at all",
    );
    assert_eq!(code, Some(2), "garbage payload must fail");
    assert!(
        stderr.contains("store error"),
        "named refusal through the documented entry point: {stderr}"
    );
}

/* --------------------------- telemetry ingest -------------------------- */

/// A small rustc/cargo JSON diagnostics stream (same shape as the
/// documented `cargo build --message-format=json` source).
fn telemetry_stream() -> String {
    [
        r#"{"reason":"compiler-message","message":{"level":"error","message":"unresolved import","code":{"code":"E0432"},"rendered":"error[E0432]: unresolved import","spans":[{"file_name":"src/main.rs","line_start":1,"line_end":1,"column_start":1,"column_end":2,"is_primary":true,"text":[{"text":"use nope;","highlight_start":1,"highlight_end":2}],"suggested_replacement":null}],"children":[]}}"#,
        r#"{"reason":"compiler-artifact","target":{"name":"x"},"fresh":false}"#,
    ]
    .join("\n")
}

#[test]
fn telemetry_ingest_accepts_the_documented_positional_stdin_form() {
    let stream = telemetry_stream();

    let (stdout, stderr, code) = run_with_stdin(&["telemetry", "ingest", "-"], &stream);
    assert_eq!(
        code,
        Some(0),
        "documented `telemetry ingest -` must run: {stderr}"
    );
    let report: Value = serde_json::from_str(stdout.trim())
        .expect("documented form emits the wanyrix.telemetry/v1 envelope on stdout");
    assert_eq!(report["schema"], "wanyrix.telemetry/v1");
    assert_eq!(report["meta"]["source"], "<stdin>");
    assert_eq!(report["meta"]["linesRead"], 2);
    assert_eq!(report["summary"]["diagnosticLines"], 1);
    assert_eq!(report["summary"]["otherLines"], 1);
}

#[test]
fn telemetry_ingest_positional_and_long_form_are_equivalent() {
    let dir = temp_dir("telemetry-equiv");
    let stream = telemetry_stream();
    let input = dir.join("stream.jsonl");
    std::fs::write(&input, &stream).unwrap();

    // Positional `-` (stdin) vs long form `--input -` (stdin): identical
    // reports modulo the honest generatedAt stamp. BOTH runs get the SAME
    // piped stdin — the comparison must feed both forms equal bytes.
    let (a, stderr_a, ca) = run_with_stdin(&["telemetry", "ingest", "-"], &stream);
    let (b, stderr_b, cb) = run_with_stdin(&["telemetry", "ingest", "--input", "-"], &stream);
    assert_eq!((ca, cb), (Some(0), Some(0)), "{stderr_a} | {stderr_b}");
    let strip = |s: &str| s.split(r#","generatedAt":"#).next().unwrap().to_owned();
    assert_eq!(
        strip(&a),
        strip(&b),
        "positional form is pure sugar for --input -"
    );

    // Positional PATH: same report for the same bytes on disk.
    let (c, stderr_c, cc) = run(&["telemetry", "ingest", input.to_str().unwrap()]);
    assert_eq!(cc, Some(0), "{stderr_c}");
    let report_c: Value = serde_json::from_str(c.trim()).unwrap();
    assert_eq!(
        report_c["meta"]["source"],
        input.to_str().unwrap(),
        "positional path is echoed as the source, like --input"
    );

    // BOTH forms: named ambiguity refusal, exit 2.
    let (_, stderr, code) = run(&["telemetry", "ingest", "--input", "-", "-"]);
    assert_eq!(code, Some(2), "both forms must be refused");
    assert!(
        stderr.contains("telemetry error") && stderr.contains("not both"),
        "named refusal: {stderr}"
    );

    // NEITHER form: named refusal, exit 2.
    let (_, stderr, code) = run(&["telemetry", "ingest"]);
    assert_eq!(code, Some(2), "missing source must be refused");
    assert!(
        stderr.contains("telemetry error") && stderr.contains("no input source given"),
        "named refusal: {stderr}"
    );
}
