//! `wanyrix ai` binary-level pins (issue #89, A1-F7 — AI endpoint scheme
//! honesty): the CLI accepts an `https://` endpoint, but the built-in client
//! speaks plain HTTP only. The honest contract (implemented in
//! `resolve_endpoint`) is a NAMED refusal up front — exit 2, the scheme and
//! the TLS truth named on stderr, no bytes dialed — instead of silently
//! downgrading an https request to plain TCP.
//!
//! The positive transport path (a REAL local model server answering over
//! plain HTTP) is exercised in-process in `src/ai.rs`'s test module with a
//! mock TCP server; this file pins the operator-facing refusal + help
//! contract through the REAL binary.

use std::path::PathBuf;
use std::process::Command;

use wanyrix_engine::synth;

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wanyrix-ai-cli-{name}-{}-{}",
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

fn run(args: &[&str], env_endpoint: Option<&str>) -> (String, String, i32) {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_wanyrix"));
    cmd.args(args);
    if let Some(ep) = env_endpoint {
        cmd.env("WANYRIX_AI_ENDPOINT", ep);
    }
    let out = cmd.output().unwrap();
    (
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8(out.stderr).unwrap(),
        out.status.code().unwrap_or(-1),
    )
}

#[test]
fn an_https_endpoint_is_refused_with_a_named_honesty_error() {
    let ws = temp_dir("https-flag");
    synth::synth(&ws, 2, 17).unwrap();
    let (stdout, stderr, code) = run(
        &[
            "ai",
            "--path",
            ws.to_str().unwrap(),
            "--endpoint",
            "https://example.com:8443",
            "--timeout-secs",
            "1",
        ],
        None,
    );
    assert_eq!(code, 2, "https must be refused, not dialed");
    assert!(stdout.is_empty(), "no partial success output: {stdout}");
    assert!(
        stderr.contains("wanyrix: error:")
            && stderr.contains("https://")
            && stderr.contains("plain HTTP")
            && stderr.contains("TLS"),
        "named refusal on stderr, got: {stderr}"
    );
    std::fs::remove_dir_all(&ws).ok();
}

#[test]
fn the_https_refusal_also_covers_the_env_fallback_endpoint() {
    let ws = temp_dir("https-env");
    synth::synth(&ws, 2, 17).unwrap();
    let (stdout, stderr, code) = run(
        &["ai", "--path", ws.to_str().unwrap(), "--timeout-secs", "1"],
        Some("https://model.corp.internal:443"),
    );
    assert_eq!(code, 2, "$WANYRIX_AI_ENDPOINT=https:// must be refused too");
    assert!(stdout.is_empty(), "no partial success output: {stdout}");
    assert!(
        stderr.contains("https://") && stderr.contains("TLS"),
        "named refusal on stderr, got: {stderr}"
    );
    std::fs::remove_dir_all(&ws).ok();
}

#[test]
fn the_help_states_the_scheme_contract() {
    let (stdout, stderr, code) = run(&["ai", "--help"], None);
    assert_eq!(code, 0, "stderr: {stderr}");
    assert!(
        stdout.contains("https:// is refused"),
        "--help must state the https refusal, got: {stdout}"
    );
    assert!(
        stdout.contains("WANYRIX_AI_ENDPOINT"),
        "--help must state the endpoint env fallback, got: {stdout}"
    );
}
