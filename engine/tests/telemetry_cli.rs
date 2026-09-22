//! End-to-end telemetry CLI verification (issue #58 tranche 2): drives the
//! real binary against a hand-built rustc JSON diagnostics stream and pins
//! the redaction contract (source out, secrets out, counts measured).

use std::process::Command;

use serde_json::Value;

fn tmp(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("wanyrix-telemetry-{name}-{}", std::process::id()))
}

/// A realistic slice of `cargo build --message-format=json` output: one
/// wrapped error carrying every leak vector, one raw rustc warning, one
/// cargo artifact notification, one malformed line.
fn stream() -> String {
    [
        serde_json::json!({
            "reason": "compiler-message",
            "message": {
                "level": "error",
                "message": "unresolved import api_key = \"ghp_0123456789abcdefABCDEF0123456789abcd\"",
                "code": {"code": "E0432"},
                "rendered": "error[E0432]: let secretvalue = build_token_here;",
                "spans": [{
                    "file_name": "/home/z/workspaces/hidden-project/src/main.rs",
                    "line_start": 7, "line_end": 7, "column_start": 5, "column_end": 20,
                    "is_primary": true,
                    "text": [{"text": "use crate::secretvalue;", "highlight_start": 5, "highlight_end": 9}],
                    "suggested_replacement": "use crate::publicvalue;"
                }],
                "children": [
                    {"level": "help", "message": "a similar name exists: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c", "rendered": null}
                ]
            }
        })
        .to_string(),
        serde_json::json!({
            "$message_type": "diagnostic",
            "level": "warning",
            "message": "unused variable: AKIAIOSFODNN7EXAMPLE",
            "code": null,
            "spans": [{
                "file_name": "/home/z/workspaces/hidden-project/src/lib.rs",
                "line_start": 12, "line_end": 12, "column_start": 9, "column_end": 10,
                "is_primary": false, "text": [], "suggested_replacement": null
            }],
            "children": []
        })
        .to_string(),
        r#"{"reason":"compiler-artifact","target":{"name":"x"},"fresh":false}"#.to_owned(),
        "this line is not json".to_owned(),
    ]
    .join("\n")
}

#[test]
fn cli_ingest_redacts_and_counts_end_to_end() {
    let input = tmp("input");
    let output = tmp("output");
    std::fs::write(&input, stream()).unwrap();

    for _ in 0..2 {
        let status = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
            .args([
                "telemetry",
                "ingest",
                "--input",
                input.to_str().unwrap(),
                "--out",
                output.to_str().unwrap(),
            ])
            .output()
            .expect("run telemetry ingest");
        assert_eq!(
            status.status.code(),
            Some(0),
            "stderr: {}",
            String::from_utf8_lossy(&status.stderr)
        );
    }

    let report: Value = serde_json::from_str(&std::fs::read_to_string(&output).unwrap()).unwrap();
    assert_eq!(report["schema"], "wanyrix.telemetry/v1");
    assert_eq!(report["meta"]["source"], input.to_str().unwrap());
    assert_eq!(report["meta"]["linesRead"], 4);

    let summary = &report["summary"];
    assert_eq!(summary["diagnosticLines"], 2);
    assert_eq!(summary["otherLines"], 1);
    assert_eq!(summary["malformedLines"], 1);
    assert_eq!(summary["errors"], 1);
    assert_eq!(summary["warnings"], 1);
    assert_eq!(
        summary["distinctCodes"], 1,
        "the raw warning carries code: null — not a distinct code"
    );
    assert_eq!(summary["noCode"], 1);

    // Redaction contract: nothing sensitive survives anywhere in the file.
    let raw = std::fs::read_to_string(&output).unwrap();
    for secret in [
        "ghp_0123456789abcdefABCDEF0123456789abcd",
        "AKIAIOSFODNN7EXAMPLE",
        "eyJhbGciOiJIUzI1NiJ9",
        "hidden-project",
        "secretvalue",
        "use crate::",
        "RENDERED-SNIPPET",
    ] {
        assert!(!raw.contains(secret), "LEAK in report: {secret}");
    }
    assert_eq!(
        report["byFile"][0]["file"], "lib.rs",
        "sorted file counts (BTreeMap order)"
    );
    assert_eq!(report["byFile"][1]["file"], "main.rs");
    assert_eq!(report["byFile"].as_array().unwrap().len(), 2);

    let diag0 = &report["diagnostics"][0];
    assert_eq!(diag0["code"], "E0432");
    assert!(diag0.get("rendered").is_none());
    assert!(diag0["spans"][0].get("text").is_none());
    assert!(diag0["spans"][0].get("suggested_replacement").is_none());
    assert!(
        diag0["spans"][0]["file"]
            .as_str()
            .unwrap()
            .ends_with("main.rs"),
        "basename by default"
    );
    assert!(
        !diag0["spans"][0]["file"].as_str().unwrap().contains('/'),
        "basename carries no directory"
    );
    assert!(diag0["children"][0]["message"]
        .as_str()
        .unwrap()
        .contains("Bearer [redacted"));
    assert!(report["redaction"]["secretsScrubbed"].as_u64().unwrap() >= 3);
    assert_eq!(
        report["redaction"]["policy"],
        "wanyrix.telemetry-redaction/v1"
    );

    // Determinism: identical input ⇒ identical file except generatedAt.
    let raw_a = std::fs::read_to_string(&output).unwrap();
    let status = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args([
            "telemetry",
            "ingest",
            "--input",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert_eq!(status.status.code(), Some(0));
    let raw_b = std::fs::read_to_string(&output).unwrap();
    let strip = |s: &str| s.split(r#","generatedAt":"#).next().unwrap().to_owned();
    assert_eq!(strip(&raw_a), strip(&raw_b));

    std::fs::remove_file(&input).ok();
    std::fs::remove_file(&output).ok();
}

#[test]
fn cli_flags_summary_only_and_keep_paths_and_stdin() {
    let input = tmp("flags");
    std::fs::write(&input, stream()).unwrap();

    // --summary-only: aggregates without the diagnostics array.
    let out = tmp("summary");
    let status = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args([
            "telemetry",
            "ingest",
            "--input",
            input.to_str().unwrap(),
            "--out",
            out.to_str().unwrap(),
            "--summary-only",
        ])
        .output()
        .unwrap();
    assert_eq!(status.status.code(), Some(0));
    let report: Value = serde_json::from_str(&std::fs::read_to_string(&out).unwrap()).unwrap();
    assert!(
        report.get("diagnostics").is_none(),
        "summary-only omits the array"
    );
    assert_eq!(
        report["summary"]["diagnosticLines"], 2,
        "counts still measured"
    );

    // --keep-paths: full paths survive, snippets still do not.
    let out = tmp("paths");
    let status = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args([
            "telemetry",
            "ingest",
            "--input",
            input.to_str().unwrap(),
            "--out",
            out.to_str().unwrap(),
            "--keep-paths",
        ])
        .output()
        .unwrap();
    assert_eq!(status.status.code(), Some(0));
    let report: Value = serde_json::from_str(&std::fs::read_to_string(&out).unwrap()).unwrap();
    assert_eq!(report["redaction"]["pathsReduced"], false);
    let raw = std::fs::read_to_string(&out).unwrap();
    assert!(raw.contains("/home/z/workspaces/hidden-project/src/main.rs"));
    assert!(
        !raw.contains("secretvalue"),
        "--keep-paths never restores snippets"
    );

    // stdin (`-`): report goes to stdout.
    use std::io::Write as _;
    let mut child = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args(["telemetry", "ingest", "--input", "-"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(stream().as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert_eq!(output.status.code(), Some(0));
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["meta"]["source"], "<stdin>");
    assert_eq!(report["diagnostics"].as_array().unwrap().len(), 2);

    // A missing input file is an honest error (exit 2), never empty output.
    let status = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args([
            "telemetry",
            "ingest",
            "--input",
            "/wanyrix/no/such/stream.jsonl",
        ])
        .output()
        .unwrap();
    assert_eq!(status.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&status.stderr).contains("telemetry"));

    std::fs::remove_file(&input).ok();
    for f in [out, tmp("summary")] {
        std::fs::remove_file(&f).ok();
    }
}

/// QA-4-B-1 regression: the redaction surface once inserted `[redacted]` and
/// then RE-EMITTED the secret value for `keyword = value` shapes — the value
/// rode along in the "redacted" envelope while being counted as scrubbed.
/// Drives the real binary over a secret-bearing stream and proves the VALUES
/// are absent from the emitted report file (value absence, not just shape).
#[test]
fn cli_ingest_never_reemits_keyword_assignment_values() {
    let input = tmp("secret-values");
    let output = tmp("secret-values-out");
    std::fs::write(
        &input,
        serde_json::json!({
            "reason": "compiler-message",
            "message": {
                "level": "error",
                "message": "password=hunter2hunter2 and api_key = \"supersecretvalue123\" and secret: 'topsecretvalue42'",
                "code": {"code": "E0382"},
                "spans": [],
                "children": []
            }
        })
        .to_string(),
    )
    .unwrap();

    let status = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args([
            "telemetry",
            "ingest",
            "--input",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .output()
        .expect("run telemetry ingest");
    assert_eq!(
        status.status.code(),
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&status.stderr)
    );

    let raw = std::fs::read_to_string(&output).unwrap();
    for secret in ["hunter2hunter2", "supersecretvalue123", "topsecretvalue42"] {
        assert!(
            !raw.contains(secret),
            "SECRET VALUE LEAKED into the redacted envelope: {secret}"
        );
    }

    // The labels are present and the count matches the three assignments.
    let report: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        report["diagnostics"][0]["message"].as_str().unwrap(),
        "password=[redacted] and api_key = \"[redacted]\" and secret: '[redacted]'"
    );
    assert_eq!(report["redaction"]["secretsScrubbed"].as_u64().unwrap(), 3);
    assert_eq!(
        report["redaction"]["policy"],
        "wanyrix.telemetry-redaction/v1"
    );

    std::fs::remove_file(&input).ok();
    std::fs::remove_file(&output).ok();
}

/// AUD-9: the ingest error-path discipline, pinned end-to-end — a missing
/// input file is a NAMED exit-2 with stdout EMPTY (errors go to stderr,
/// JSON to stdout, never both), and a malformed stream is DATA: counted in
/// `malformedLines` with the exit code pinned at 0, never an error.
#[test]
fn cli_ingest_error_paths_pin_exit_codes_and_stream_discipline() {
    // Missing input file: exit 2, stdout empty, named telemetry error.
    let missing = "/wanyrix/no/such/stream.jsonl";
    let status = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args(["telemetry", "ingest", "--input", missing])
        .output()
        .unwrap();
    assert_eq!(status.status.code(), Some(2), "missing input is exit 2");
    assert!(
        status.stdout.is_empty(),
        "no partial payload on a refusal: {}",
        String::from_utf8_lossy(&status.stdout)
    );
    let stderr = String::from_utf8_lossy(&status.stderr).to_string();
    assert!(
        stderr.starts_with("wanyrix: error: telemetry error: "),
        "named telemetry error on stderr, got: {stderr}"
    );

    // Malformed-only stream: the run SUCCEEDS (exit 0 — pinned; malformed
    // lines are never an error) and every line is counted honestly.
    let input = tmp("malformed-only");
    let output = tmp("malformed-only-out");
    std::fs::write(&input, "not json\n{\"truncated\":\n[ still not json ]\n").unwrap();
    let status = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args([
            "telemetry",
            "ingest",
            "--input",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert_eq!(
        status.status.code(),
        Some(0),
        "malformed lines are data, not errors: {}",
        String::from_utf8_lossy(&status.stderr)
    );
    let report: Value = serde_json::from_str(&std::fs::read_to_string(&output).unwrap()).unwrap();
    assert_eq!(report["schema"], "wanyrix.telemetry/v1");
    assert_eq!(report["meta"]["linesRead"], 3);
    assert_eq!(report["summary"]["malformedLines"], 3);
    assert_eq!(report["summary"]["diagnosticLines"], 0);
    assert_eq!(report["diagnostics"].as_array().unwrap().len(), 0);

    std::fs::remove_file(&input).ok();
    std::fs::remove_file(&output).ok();
}
