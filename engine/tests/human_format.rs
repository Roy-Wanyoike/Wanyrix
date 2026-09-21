//! Human formatter pins (issue #89, A1-F5 remainder): doctor/graph/health/
//! analyze/dependencies human output was structure-unasserted (the doctor
//! exclusion line got covered by `exclude_cli.rs` in #86). This file runs
//! the REAL binary WITHOUT `--json` and pins the human contract:
//!
//! - the `wanyrix <cmd> — <workspace> (manifest-static-v1)` header,
//! - the measured `crates (N):` line,
//! - the `findings (N): X critical, Y warning, Z info` tally — cross-checked
//!   against the `--json` summary so the two flavors cannot drift,
//! - the per-finding `[severity] ID — title` / `→ recommendation` layout,
//! - the exact honesty footer,
//! - the analyze + dependencies flavor-specific summaries.

use std::path::PathBuf;
use std::process::Command;

use serde_json::Value;
use wanyrix_engine::synth;

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wanyrix-human-{name}-{}-{}",
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

fn run(args: &[&str]) -> (String, String, bool) {
    let out = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args(args)
        .output()
        .unwrap();
    (
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8(out.stderr).unwrap(),
        out.status.success(),
    )
}

fn fresh_ws(name: &str) -> PathBuf {
    let ws = temp_dir(name);
    synth::synth(&ws, 2, 17).unwrap();
    ws
}

/// The header + crates + findings-tally + footer shape shared by the
/// human_summary() flavors (doctor/graph/health).
fn assert_human_summary_shape(cmd: &str, text: &str, ws: &std::path::Path, footer_last: bool) {
    let mut lines = text.lines();
    let header = lines.next().unwrap_or("");
    assert_eq!(
        header,
        format!("wanyrix {cmd} — {} (manifest-static-v1)", ws.file_name().unwrap().to_str().unwrap()),
        "{cmd}: header line"
    );
    assert!(text.contains(&format!("root: {}", ws.display())), "{cmd}: root line");
    assert!(text.contains("toolchain: "), "{cmd}: toolchain line");

    let crates_line = text
        .lines()
        .find(|l| l.starts_with("crates ("))
        .unwrap_or_else(|| panic!("{cmd}: crates line missing in {text}"));
    let n: usize = crates_line
        .trim_start_matches("crates (")
        .split(')')
        .next()
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(n, 2, "{cmd}: measured crate count");
    assert!(
        crates_line.contains("c0000 0.1.0 [lib]") && crates_line.contains("c0001 0.1.0 [lib]"),
        "{cmd}: crate entries carry name, version and band: {crates_line}"
    );

    let findings_line = text
        .lines()
        .find(|l| l.starts_with("findings ("))
        .unwrap_or_else(|| panic!("{cmd}: findings line missing in {text}"));
    let (total, tallies) = findings_line
        .trim_start_matches("findings (")
        .split_once("): ")
        .unwrap();
    let total: usize = total.parse().unwrap();
    let sev = |name: &str| -> usize {
        tallies
            .split(", ")
            .find(|t| t.ends_with(name))
            .unwrap_or_else(|| panic!("{cmd}: {name} tally in {findings_line}"))
            .split(' ')
            .next()
            .unwrap()
            .parse()
            .unwrap()
    };
    let (crit, warn, info) = (sev("critical"), sev("warning"), sev("info"));
    assert_eq!(
        crit + warn + info,
        total,
        "{cmd}: the human tally must add up: {findings_line}"
    );

    // Per-finding layout: `  [severity] ID — title` + `    → recommendation`.
    let finding_lines: Vec<&str> = text
        .lines()
        .filter(|l| l.starts_with("  ["))
        .collect();
    assert_eq!(
        finding_lines.len(),
        total,
        "{cmd}: one line per finding: {text}"
    );
    for l in &finding_lines {
        let body = l.trim_start_matches("  [");
        let sev = body.split(']').next().unwrap();
        assert!(
            ["critical", "warning", "info"].contains(&sev),
            "{cmd}: severity token: {l}"
        );
        let rest = body.split("] ").nth(1).unwrap();
        let id = rest.split(" — ").next().unwrap();
        assert!(
            id.starts_with("FER-ENG-") || id.starts_with("FER-ENG-ERR"),
            "{cmd}: finding id: {l}"
        );
    }
    let recs: Vec<&str> = text.lines().filter(|l| l.starts_with("    → ")).collect();
    assert_eq!(recs.len(), total, "{cmd}: one recommendation per finding");

    const FOOTER_END: &str =
        "measurement: all figures measured from the filesystem; no telemetry simulated (engine v1 measures no build times)";
    if footer_last {
        assert!(
            text.trim_end().ends_with(FOOTER_END),
            "{cmd}: the honesty footer closes the output: {text}"
        );
    } else {
        assert!(
            text.contains(FOOTER_END),
            "{cmd}: the honesty footer is present: {text}"
        );
    }
}

#[test]
fn doctor_human_output_is_fully_structured_and_agrees_with_the_json_summary() {
    let ws = fresh_ws("doctor");
    let (stdout, stderr, ok) = run(&["doctor", "--path", ws.to_str().unwrap()]);
    assert!(ok, "stderr: {stderr}");
    assert_human_summary_shape("doctor", &stdout, &ws, true);

    // The human tally must agree with the JSON envelope (no flavor drift).
    let (json_out, _, ok) = run(&["doctor", "--path", ws.to_str().unwrap(), "--json"]);
    assert!(ok);
    let v: Value = serde_json::from_str(json_out.trim()).unwrap();
    let summary = &v["summary"];
    let findings_line = stdout
        .lines()
        .find(|l| l.starts_with("findings ("))
        .unwrap();
    assert!(
        findings_line.contains(&format!("{} critical", summary["critical"]))
            && findings_line.contains(&format!("{} warning", summary["warning"]))
            && findings_line.contains(&format!("{} info", summary["info"])),
        "human tally vs JSON summary: {findings_line} vs {summary}"
    );
    for f in v["findings"].as_array().unwrap() {
        assert!(
            stdout.contains(f["id"].as_str().unwrap()),
            "human output names every finding id"
        );
    }
    std::fs::remove_dir_all(&ws).ok();
}

#[test]
fn graph_and_health_human_output_share_the_summary_shape() {
    for cmd in ["graph", "health"] {
        let ws = fresh_ws(cmd);
        let (stdout, stderr, ok) = run(&[cmd, "--path", ws.to_str().unwrap()]);
        assert!(ok, "{cmd}: stderr: {stderr}");
        assert_human_summary_shape(cmd, &stdout, &ws, true);
        std::fs::remove_dir_all(&ws).ok();
    }
}

#[test]
fn analyze_human_output_appends_the_embedded_envelope_counts() {
    let ws = fresh_ws("analyze");
    let (stdout, stderr, ok) = run(&["analyze", "--path", ws.to_str().unwrap()]);
    assert!(ok, "stderr: {stderr}");
    // Measured behavior: the embedded-count line is appended AFTER the
    // shared summary body (so the footer is not the last line here).
    assert_human_summary_shape("analyze", &stdout, &ws, false);
    assert!(
        stdout.trim_end().ends_with("health: see `--json` (wanyrix.analyze/v1 embeds all three)"),
        "the analyze-specific line closes the output: {stdout}"
    );
    let tail = stdout
        .lines()
        .find(|l| l.starts_with("  doctor: "))
        .unwrap_or_else(|| panic!("analyze: embedded-count line missing in {stdout}"));
    assert!(
        tail.contains("doctor: 3 findings")
            && tail.contains("graph: 2 nodes/1 edges")
            && tail.contains("health: see `--json` (wanyrix.analyze/v1 embeds all three)"),
        "the analyze-specific summary line: {tail}"
    );
    std::fs::remove_dir_all(&ws).ok();
}

#[test]
fn dependencies_human_output_reports_the_measured_tallies() {
    let ws = fresh_ws("deps");
    let (stdout, stderr, ok) = run(&["dependencies", "--path", ws.to_str().unwrap()]);
    assert!(ok, "stderr: {stderr}");
    let header = stdout.lines().next().unwrap();
    assert_eq!(
        header,
        format!(
            "wanyrix dependencies — {} (2 crates, 1 path-deps resolved, 0 broken/escaped, 0 cycle(s))",
            ws.file_name().unwrap().to_str().unwrap()
        ),
        "dependencies: measured header tallies: {header}"
    );
    let c0000 = stdout
        .lines()
        .find(|l| l.starts_with("  c0000"))
        .unwrap_or_else(|| panic!("c0000 line missing: {stdout}"));
    assert_eq!(
        c0000,
        "  c0000 → deps [], dependents [c0001] (fanIn 1, fanOut 0)",
        "per-crate human layout: {c0000}"
    );
    std::fs::remove_dir_all(&ws).ok();
}
