//! End-to-end verification of `--exclude <dir>` (issue #76) through the
//! REAL binary: a vendored fixture with a deliberately broken manifest is
//! measurable noise without the flag and gone (pruned, counted, echoed)
//! with it. No cargo build needed — the doctor surface is filesystem-only,
//! so there is nothing to skip honestly here.

use std::path::PathBuf;
use std::process::Command;

use serde_json::Value;
use wanyrix_engine::synth;

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wanyrix-exclude-cli-{name}-{}-{}",
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

/// synth workspace (2 crates) + a vendored third-party tree whose manifest
/// deliberately fails to parse — the stand-in for vendored/example noise.
fn workspace_with_vendor_fixture(name: &str) -> PathBuf {
    let ws = temp_dir(name);
    synth::synth(&ws, 2, 17).unwrap();
    let vendor = ws.join("vendor/junk");
    std::fs::create_dir_all(&vendor).unwrap();
    std::fs::write(vendor.join("Cargo.toml"), "not toml {{{").unwrap();
    ws
}

fn run_doctor(ws: &std::path::Path, extra: &[&str]) -> (String, String, bool) {
    let out = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args(["doctor", "--path", ws.to_str().unwrap(), "--json"])
        .args(extra)
        .output()
        .unwrap();
    (
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8(out.stderr).unwrap(),
        out.status.success(),
    )
}

#[test]
fn doctor_without_exclude_measures_the_vendor_noise() {
    let ws = workspace_with_vendor_fixture("plain");
    let (stdout, stderr, ok) = run_doctor(&ws, &[]);
    assert!(ok, "stderr: {stderr}");
    let value: Value = serde_json::from_str(&stdout).expect("stdout must be valid JSON");
    assert_eq!(value["schema"], "wanyrix.doctor/v1");
    assert_eq!(
        value["scan"]["manifestsFound"], 4,
        "root + 2 synth crates + vendor/junk"
    );
    assert_eq!(value["scan"]["parseFailures"], 1, "vendor/junk measured");
    assert!(
        value["scan"].get("excludes").is_none(),
        "default wire contract: no flag → no excludes key: {}",
        stdout
    );
    std::fs::remove_dir_all(&ws).ok();
}

#[test]
fn doctor_with_exclude_prunes_counts_and_echoes() {
    let ws = workspace_with_vendor_fixture("excluded");
    let (stdout, stderr, ok) = run_doctor(&ws, &["--exclude", "vendor"]);
    assert!(ok, "stderr: {stderr}");
    let value: Value = serde_json::from_str(&stdout).expect("stdout must be valid JSON");
    assert_eq!(value["scan"]["manifestsFound"], 3, "vendor pruned");
    assert_eq!(value["scan"]["parseFailures"], 0, "pruned = not measured");
    assert_eq!(
        value["scan"]["excludes"],
        serde_json::json!(["vendor"]),
        "the exclusion is named in the envelope, never a silent drop"
    );
    std::fs::remove_dir_all(&ws).ok();
}

#[test]
fn doctor_with_invalid_exclude_fails_with_a_named_error() {
    let ws = workspace_with_vendor_fixture("invalid");
    let out = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args([
            "doctor",
            "--path",
            ws.to_str().unwrap(),
            "--exclude",
            "../escape",
        ])
        .output()
        .unwrap();
    assert!(!out.status.success(), "traversal must be rejected");
    let stderr = String::from_utf8(out.stderr).unwrap();
    assert!(
        stderr.contains("invalid --exclude value"),
        "named error on stderr, got: {stderr}"
    );
    std::fs::remove_dir_all(&ws).ok();
}

#[test]
fn doctor_exclusion_is_repeatable_and_normalized() {
    let ws = workspace_with_vendor_fixture("repeat");
    let (stdout, stderr, ok) = run_doctor(
        &ws,
        &[
            "--exclude",
            "vendor/",
            "--exclude",
            "./vendor",
            "--exclude",
            "nonexistent-dir",
        ],
    );
    assert!(ok, "stderr: {stderr}");
    let value: Value = serde_json::from_str(&stdout).expect("stdout must be valid JSON");
    assert_eq!(
        value["scan"]["excludes"],
        serde_json::json!(["nonexistent-dir", "vendor"]),
        "deduped, sorted, trailing slashes and ./ prefixes normalized"
    );
    assert_eq!(value["scan"]["manifestsFound"], 3);
    std::fs::remove_dir_all(&ws).ok();
}

#[test]
fn doctor_human_summary_names_the_exclusions() {
    let ws = workspace_with_vendor_fixture("human");
    let out = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args([
            "doctor",
            "--path",
            ws.to_str().unwrap(),
            "--exclude",
            "vendor",
        ])
        .output()
        .unwrap();
    assert!(out.status.success());
    let text = String::from_utf8(out.stdout).unwrap();
    assert!(
        text.contains("excluded: vendor"),
        "human flavor names the exclusions: {text}"
    );
    std::fs::remove_dir_all(&ws).ok();
}
