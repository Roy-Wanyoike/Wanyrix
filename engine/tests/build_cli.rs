//! End-to-end verification of `wanyrix build` (`wanyrix.build/v1`).
//!
//! These tests execute REAL `cargo build` processes (the instrumented-build
//! surface has no fixture substitute — the whole point is a measured build),
//! so every cargo-backed test SKIPS HONESTLY (printed, never silently green)
//! when cargo is unavailable on the machine.

use std::path::PathBuf;
use std::process::Command;

use serde_json::Value;
use wanyrix_engine::build::{self, BuildOptions, BUILD_SCHEMA};
use wanyrix_engine::synth;

fn cargo_available() -> bool {
    Command::new("cargo")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Fresh temp dir (cleaned on success paths; tests use unique names).
fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wanyrix-build-cli-{name}-{}-{}",
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

fn opts_for(target: &std::path::Path) -> BuildOptions {
    BuildOptions {
        cargo: "cargo".to_owned(),
        target_dir: Some(target.to_path_buf()),
    }
}

/// The flagship measured path: build a zero-dependency synth workspace twice
/// — cold (rebuilt artifacts) then warm (everything fresh, cache-hit rate
/// 100, measured from the stream's fresh flags).
#[test]
fn real_instrumented_build_cold_then_warm() {
    if !cargo_available() {
        println!(
            "SKIP: cargo is not available on this machine — the instrumented-build \
             test executes a real build and nothing else can substitute it"
        );
        return;
    }
    let ws = temp_dir("ws");
    let target = temp_dir("target");
    synth::synth(&ws, 2, 7).unwrap();

    // Cold build: the workspace compiles; every figure is measured.
    let cold = build::run_build(&ws, &opts_for(&target)).unwrap();
    assert_eq!(cold.schema, BUILD_SCHEMA);
    assert!(
        cold.build_success,
        "a zero-dependency synth workspace must build; stderr tail: {:?}",
        cold.cargo_stderr_tail
    );
    assert_eq!(cold.exit_code, Some(0));
    assert!(cold.wall_clock_ms > 0, "wall clock must be measured");
    assert!(
        cold.summary.artifacts_total >= 2,
        "two crates → ≥2 artifacts"
    );
    assert!(cold.redaction.applied);

    // Warm build: same inputs, everything fresh → measured 100% cache hits.
    let warm = build::run_build(&ws, &opts_for(&target)).unwrap();
    assert!(warm.build_success);
    assert_eq!(
        warm.summary.artifacts_fresh, warm.summary.artifacts_total,
        "a no-op rebuild must report every artifact as fresh"
    );
    assert_eq!(warm.summary.cache_hit_rate, 100);
    assert_eq!(
        warm.summary.cache_hit_rate_status,
        "measured (fresh flags from the cargo JSON stream)"
    );
    let _ = std::fs::remove_dir_all(&target);
}

/// A build that RAN but failed is DATA — a complete envelope with
/// `buildSuccess: false` and the scrubbed stderr tail — never an error.
#[test]
fn failed_build_is_data_not_an_error() {
    if !cargo_available() {
        println!("SKIP: cargo is not available on this machine (see real_instrumented_build_cold_then_warm)");
        return;
    }
    let bare = temp_dir("no-manifest"); // intentionally no Cargo.toml
    let target = temp_dir("target-fail");
    let report = build::run_build(&bare, &opts_for(&target)).unwrap();
    assert!(!report.build_success);
    assert_eq!(report.exit_code, Some(101), "cargo's measured exit code");
    let tail = report
        .cargo_stderr_tail
        .expect("cargo's failure explains itself on stderr");
    assert!(
        tail.contains("Cargo.toml") || tail.contains("could not"),
        "unexpected stderr tail: {tail}"
    );
    assert!(report.summary.malformed_lines == 0);
    let _ = std::fs::remove_dir_all(&bare);
    let _ = std::fs::remove_dir_all(&target);
}

/// The CLI path: `wanyrix build --path <ws> --json` emits the envelope on
/// stdout with `generatedAt` LAST and no `rendered` key anywhere.
#[test]
fn cli_build_json_emits_envelope() {
    if !cargo_available() {
        println!("SKIP: cargo is not available on this machine (see real_instrumented_build_cold_then_warm)");
        return;
    }
    let ws = temp_dir("cli-ws");
    synth::synth(&ws, 2, 11).unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args(["build", "--path", ws.to_str().unwrap(), "--json"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let text = String::from_utf8(out.stdout).unwrap();
    let value: Value = serde_json::from_str(&text).expect("stdout must be valid JSON");
    assert_eq!(value["schema"], BUILD_SCHEMA);
    assert_eq!(value["profile"], "instrumented-cargo-build/v1");
    assert_eq!(
        value["summary"]["cacheHitRateStatus"],
        "measured (fresh flags from the cargo JSON stream)"
    );
    let trimmed = text.trim_end();
    let tail = &trimmed[trimmed.len().saturating_sub(60)..];
    assert!(
        tail.contains("\"generatedAt\":\""),
        "generatedAt must trail the envelope, tail: {tail}"
    );
    assert!(
        !text.contains("\"rendered\""),
        "no rendered key is ever emitted"
    );
    let _ = std::fs::remove_dir_all(&ws);
}

/// Human summary without `--json` stays deterministic in structure and says
/// what was measured (duration values vary — they are the data).
#[test]
fn cli_build_human_summary_names_the_measurements() {
    if !cargo_available() {
        println!("SKIP: cargo is not available on this machine (see real_instrumented_build_cold_then_warm)");
        return;
    }
    let ws = temp_dir("cli-human");
    synth::synth(&ws, 2, 13).unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args(["build", "--path", ws.to_str().unwrap()])
        .output()
        .unwrap();
    assert!(out.status.success());
    let text = String::from_utf8(out.stdout).unwrap();
    assert!(text.contains("wanyrix build"));
    assert!(text.contains("(instrumented-cargo-build/v1)"));
    assert!(text.contains("wall clock"));
    assert!(text.contains("cache hit rate"));
    assert!(text.contains("not per-crate build time"));
    let _ = std::fs::remove_dir_all(&ws);
}
