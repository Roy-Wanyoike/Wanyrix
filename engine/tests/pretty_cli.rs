//! `--pretty` execution matrix (issue #89, A1-F6): the flag was never
//! executed by any automated test outside `export` (#91 added one there).
//! This file runs `--json --pretty` through the REAL binary across every
//! read surface that accepts it and pins the two-part contract:
//!
//! 1. `--pretty` changes FORMATTING only — the pretty payload parses to the
//!    exact same JSON value as the compact one (timestamps normalized).
//! 2. `--pretty` without `--json` is a documented NO-OP — the human flavor
//!    is byte-identical with and without the flag (docs/CLI.md: "pretty has
//!    no effect without `--json`").
//!
//! Both directions are executed against the real binary, not re-derived.

use std::path::PathBuf;
use std::process::Command;

use serde_json::Value;
use wanyrix_engine::synth;

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wanyrix-pretty-cli-{name}-{}-{}",
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

/// Replace every timestamp value (`generatedAt` and the mirrored
/// `meta.lastScan`) so two independent runs compare equal.
fn normalize(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (k, v) in map.iter_mut() {
                if k == "generatedAt" || k == "lastScan" {
                    *v = Value::String("<timestamp>".to_owned());
                } else {
                    normalize(v);
                }
            }
        }
        Value::Array(items) => {
            for v in items.iter_mut() {
                normalize(v);
            }
        }
        _ => {}
    }
}

/// Fresh deterministic workspace per run — `init`/`status` are stateful
/// (first run creates `.wanyrix/state.json`, the second echoes it), so a
/// fair A/B comparison needs two identical fresh trees, not one shared one.
fn fresh(name: &str) -> PathBuf {
    let ws = temp_dir(name);
    synth::synth(&ws, 2, 17).unwrap();
    ws
}

/// The surfaces that take `--json` + `--pretty` and are pure scans (plus
/// init/status/events, which are timestamped the same way).
const SURFACES: [&str; 8] = [
    "doctor",
    "graph",
    "health",
    "analyze",
    "dependencies",
    "init",
    "status",
    "events",
];

#[test]
fn pretty_flavor_parses_to_the_same_payload_as_the_compact_flavor() {
    for surface in SURFACES {
        // One fixed workspace path for both runs — the envelopes embed the
        // scan root — with the engine's own `.wanyrix` state cleared in
        // between so stateful surfaces (init/status) see a fresh tree twice.
        let ws = fresh("cmp");
        let (compact, stderr, ok) = run(&[surface, "--path", ws.to_str().unwrap(), "--json"]);
        assert!(ok, "{surface}: stderr: {stderr}");
        let mut compact: Value = serde_json::from_str(compact.trim())
            .unwrap_or_else(|e| panic!("{surface}: compact stdout must be JSON ({e})"));

        let _ = std::fs::remove_dir_all(ws.join(".wanyrix"));
        let (pretty, stderr, ok) = run(&[
            surface,
            "--path",
            ws.to_str().unwrap(),
            "--json",
            "--pretty",
        ]);
        assert!(ok, "{surface}: stderr: {stderr}");
        assert!(
            pretty.contains("\n  \""),
            "{surface}: pretty flavor is line-indented: {pretty}"
        );
        assert!(
            pretty.trim_end().ends_with('}') && pretty.lines().count() > 1,
            "{surface}: pretty flavor spans multiple lines: {pretty}"
        );
        let mut pretty_value: Value = serde_json::from_str(pretty.trim())
            .unwrap_or_else(|e| panic!("{surface}: pretty stdout must be JSON ({e})"));

        normalize(&mut compact);
        normalize(&mut pretty_value);
        assert_eq!(
            compact, pretty_value,
            "{surface}: --pretty must be formatting-only"
        );
        let _ = std::fs::remove_dir_all(&ws);
    }
}

#[test]
fn pretty_without_json_is_the_documented_no_op() {
    for surface in SURFACES {
        let ws = fresh("noop");
        let (human, stderr, ok) = run(&[surface, "--path", ws.to_str().unwrap()]);
        assert!(ok, "{surface}: stderr: {stderr}");
        let _ = std::fs::remove_dir_all(ws.join(".wanyrix"));
        let (human_pretty, stderr, ok) =
            run(&[surface, "--path", ws.to_str().unwrap(), "--pretty"]);
        assert!(ok, "{surface}: stderr: {stderr}");
        assert_eq!(
            human, human_pretty,
            "{surface}: --pretty without --json must not change the human flavor"
        );
        let _ = std::fs::remove_dir_all(&ws);
    }
}

#[test]
fn the_no_op_contract_is_stated_in_every_pretty_subcommand_help() {
    // The documented contract lives in the CLI itself — pinned verbatim so
    // the doc and the binary cannot drift apart.
    for surface in [
        "doctor",
        "graph",
        "health",
        "analyze",
        "dependencies",
        "init",
        "status",
        "events",
        "build",
        "export",
        "ai",
        "git",
        "impact",
        "what-changed",
    ] {
        let (stdout, stderr, ok) = run(&[surface, "--help"]);
        assert!(ok, "{surface}: stderr: {stderr}");
        assert!(
            stdout.contains("no effect without --json"),
            "{surface} --help must state the --pretty no-op contract: {stdout}"
        );
    }
}
