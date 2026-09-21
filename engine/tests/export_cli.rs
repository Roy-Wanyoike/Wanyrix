//! End-to-end verification of `wanyrix export` (issue #91) through the
//! REAL binary: artifacts-as-code with a sha256-bound manifest, byte-identical
//! repeat runs, relative-paths-only and named refusals — all exercised as the
//! operator would run them. No cargo build needed — the export surface is
//! filesystem-only, so there is nothing to skip honestly here.
//!
//! Paths passed to the binary are RELATIVE on purpose: refusing absolute
//! `--path`/`--out` is part of the export contract (no artifact may embed an
//! absolute path), and one test pins that refusal verbatim.

use std::path::PathBuf;
use std::process::Command;

use serde_json::Value;
use wanyrix_engine::synth;

fn temp_dir(name: &str) -> PathBuf {
    // RELATIVE to the test cwd (the engine crate dir) — target/ is
    // gitignored and never scanned (`.wanyrix` and `target` are skipped).
    PathBuf::new().join(format!(
        "target/wanyrix-export-cli-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ))
}

fn run_export(args: &[&str]) -> (String, String, bool) {
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

#[test]
fn export_writes_artifacts_and_a_digest_bound_manifest() {
    let ws = temp_dir("fresh");
    synth::synth(&ws, 2, 17).unwrap();
    let (stdout, stderr, ok) = run_export(&["export", "--path", ws.to_str().unwrap(), "--json"]);
    assert!(ok, "stderr: {stderr}");

    let manifest: Value = serde_json::from_str(&stdout).expect("stdout must be the manifest");
    assert_eq!(manifest["schema"], "wanyrix.export/v1");
    assert_eq!(manifest["engine"], env!("CARGO_PKG_VERSION"));
    let artifacts = manifest["artifacts"].as_array().unwrap();
    assert_eq!(artifacts.len(), 3, "doctor + graph + health");
    for a in artifacts {
        let file = a["file"].as_str().unwrap();
        let bytes = std::fs::read(ws.join(".wanyrix/exports").join(file)).unwrap();
        assert_eq!(bytes.len(), a["bytes"].as_u64().unwrap() as usize);
        let on_disk = String::from_utf8(bytes).unwrap();
        assert!(
            on_disk.ends_with('\n'),
            "{file}: POSIX-friendly trailing newline"
        );
        assert!(a["schema"].as_str().unwrap().starts_with("wanyrix."));
        // The envelope artifact is the real contract, verbatim.
        let parsed: Value = serde_json::from_str(on_disk.trim_end()).unwrap();
        assert_eq!(parsed["schema"], a["schema"]);
        assert_eq!(parsed["generatedAt"], "not-measured");
    }
    assert!(
        std::env::current_dir()
            .unwrap()
            .join(&ws)
            .join(".wanyrix/exports/index.json")
            .exists(),
        "index.json written to the default <path>/.wanyrix/exports"
    );
    std::fs::remove_dir_all(&ws).ok();
}

#[test]
fn export_repeat_runs_are_byte_identical() {
    let ws = temp_dir("identical");
    synth::synth(&ws, 3, 7).unwrap();
    let args = ["export", "--path", ws.to_str().unwrap(), "--json"];
    let (first_stdout, stderr, ok) = run_export(&args);
    assert!(ok, "stderr: {stderr}");
    let (second_stdout, _, ok2) = run_export(&args);
    assert!(ok2);
    assert_eq!(
        first_stdout, second_stdout,
        "the manifest (with all digests) must be byte-identical across runs"
    );

    let exports = ws.join(".wanyrix/exports");
    for file in ["doctor.json", "graph.json", "health.json", "index.json"] {
        let a = std::fs::read(exports.join(file)).unwrap();
        // Re-run once more and compare the file bytes directly.
        run_export(&args);
        let b = std::fs::read(exports.join(file)).unwrap();
        assert_eq!(a, b, "{file}: repeat export must be byte-identical");
    }
    std::fs::remove_dir_all(&ws).ok();
}

#[test]
fn export_digests_match_the_artifact_files_on_disk() {
    let ws = temp_dir("digests");
    synth::synth(&ws, 2, 42).unwrap();
    let (stdout, stderr, ok) = run_export(&["export", "--path", ws.to_str().unwrap(), "--json"]);
    assert!(ok, "stderr: {stderr}");
    let manifest: Value = serde_json::from_str(&stdout).unwrap();
    for a in manifest["artifacts"].as_array().unwrap() {
        let bytes = std::fs::read(
            ws.join(".wanyrix/exports")
                .join(a["file"].as_str().unwrap()),
        )
        .unwrap();
        // sha256sum is the cross-check a teammate would run.
        let digest = String::from_utf8(
            Command::new("sha256sum")
                .arg(
                    ws.join(".wanyrix/exports")
                        .join(a["file"].as_str().unwrap()),
                )
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap();
        let expected = digest.split_whitespace().next().unwrap();
        assert_eq!(
            expected,
            a["sha256"].as_str().unwrap(),
            "{}: manifest digest binds the exact file bytes",
            a["file"]
        );
        assert_eq!(bytes.len(), a["bytes"].as_u64().unwrap() as usize);
    }
    std::fs::remove_dir_all(&ws).ok();
}

#[test]
fn export_refuses_absolute_paths_with_a_named_error() {
    let ws = temp_dir("abs");
    synth::synth(&ws, 2, 17).unwrap();
    let absolute = std::env::current_dir().unwrap().join(&ws);
    let (stdout, stderr, ok) = run_export(&["export", "--path", absolute.to_str().unwrap()]);
    assert!(!ok, "absolute --path must be refused");
    assert!(stdout.is_empty(), "no partial success output");
    assert!(
        stderr.contains("wanyrix: error: export error:") && stderr.contains("absolute"),
        "named refusal on stderr, got: {stderr}"
    );
    assert!(
        !ws.join(".wanyrix/exports").exists(),
        "nothing written for a refused export"
    );
    std::fs::remove_dir_all(&ws).ok();
}

#[test]
fn export_refuses_an_out_path_that_exists_as_a_file() {
    let ws = temp_dir("outfile");
    synth::synth(&ws, 2, 17).unwrap();
    let out_file = ws.join("occupied.json");
    std::fs::write(&out_file, "not a directory").unwrap();
    let (_, stderr, ok) = run_export(&[
        "export",
        "--path",
        ws.to_str().unwrap(),
        "--out",
        out_file.to_str().unwrap(),
    ]);
    assert!(!ok, "an <out> that is a FILE must be refused");
    assert!(
        stderr.contains("exists as a FILE"),
        "named refusal on stderr, got: {stderr}"
    );
    std::fs::remove_dir_all(&ws).ok();
}

#[test]
fn export_human_summary_and_excludes_echo() {
    let ws = temp_dir("human");
    synth::synth(&ws, 2, 17).unwrap();
    let vendor = ws.join("vendor/junk");
    std::fs::create_dir_all(&vendor).unwrap();
    std::fs::write(vendor.join("Cargo.toml"), "not toml {{{").unwrap();

    let (stdout, stderr, ok) = run_export(&[
        "export",
        "--path",
        ws.to_str().unwrap(),
        "--exclude",
        "vendor",
    ]);
    assert!(ok, "stderr: {stderr}");
    // Human flavor: count + bytes + digests in one line, excludes echoed.
    assert!(stdout.contains("wanyrix export — "), "{stdout}");
    assert!(stdout.contains("artifacts (3): "), "{stdout}");
    assert!(stdout.contains("total: "), "{stdout}");
    assert!(stdout.contains("excluded: vendor"), "{stdout}");

    let manifest: Value = serde_json::from_str(
        &String::from_utf8(
            Command::new(env!("CARGO_BIN_EXE_wanyrix"))
                .args([
                    "export",
                    "--path",
                    ws.to_str().unwrap(),
                    "--exclude",
                    "vendor",
                    "--json",
                ])
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(
        manifest["excludes"],
        serde_json::json!(["vendor"]),
        "the #76 echo pattern in the manifest"
    );
    std::fs::remove_dir_all(&ws).ok();
}

#[test]
fn export_pretty_flavor_is_line_diffable_and_still_deterministic() {
    let ws = temp_dir("pretty");
    synth::synth(&ws, 2, 17).unwrap();
    let args = [
        "export",
        "--path",
        ws.to_str().unwrap(),
        "--json",
        "--pretty",
    ];
    let (first, stderr, ok) = run_export(&args);
    assert!(ok, "stderr: {stderr}");
    let (second, _, ok2) = run_export(&args);
    assert!(ok2);
    assert_eq!(first, second, "--pretty output is deterministic too");
    assert!(
        first.contains("\n  \"schema\""),
        "pretty flavor is line-oriented: {first}"
    );
    let manifest: Value = serde_json::from_str(&first).unwrap();
    assert_eq!(manifest["schema"], "wanyrix.export/v1");
    std::fs::remove_dir_all(&ws).ok();
}
