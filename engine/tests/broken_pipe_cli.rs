//! Binary-level pin for issue #143 item 3: a closed stdout is a CLEAN,
//! documented stop (exit 141, the Unix `128 + SIGPIPE(13)` convention) —
//! never the Rust runtime's raw broken-pipe panic that used to exit 101
//! with a backtrace note on stderr.

use std::io::Read;
use std::process::{Command, Stdio};

fn temp_ws(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wanyrix-pipe-{name}-{}-{}",
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

/// The payload must comfortably exceed the 64 KiB kernel pipe buffer so
/// the writer is still writing when the consumer closes — that is exactly
/// the situation the old raw-panic path used to blow up in. `analyze
/// --json` (doctor + graph + health embedded) over a 400-crate synth tree
/// is far past it; the precondition is asserted, not assumed.
#[test]
fn closed_stdout_exits_141_cleanly_never_a_panic() {
    let ws = temp_ws("big");
    let made = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args([
            "synth",
            "--crates",
            "400",
            "--out",
            ws.to_str().unwrap(),
            "--seed",
            "7",
        ])
        .output()
        .unwrap();
    assert!(
        made.status.success(),
        "synth failed: {}",
        String::from_utf8_lossy(&made.stderr)
    );

    // Measure the payload once (precondition of this test).
    let full = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args(["analyze", "--path", ws.to_str().unwrap(), "--json"])
        .output()
        .unwrap();
    assert!(full.status.success());
    assert!(
        full.stdout.len() > 256 * 1024,
        "precondition: the payload must exceed the pipe buffer, got {} bytes",
        full.stdout.len()
    );

    // Now the pipeline situation: read 10 bytes, then close on the reader.
    let mut child = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args(["analyze", "--path", ws.to_str().unwrap(), "--json"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdout = child.stdout.take().unwrap();
    let mut head = [0u8; 10];
    stdout.read_exact(&mut head).unwrap();
    drop(stdout); // `| head -c 10` closes here.
    let status = child.wait().unwrap();
    let mut stderr_buf = String::new();
    let _ = child.stderr.take().unwrap().read_to_string(&mut stderr_buf);
    assert_eq!(
        status.code(),
        Some(141),
        "the documented broken-pipe exit (128+13), got {status:?}"
    );
    assert!(
        !stderr_buf.contains("panicked"),
        "a clean stop, never a panic: {stderr_buf}"
    );
    assert!(
        !stderr_buf.contains("RUST_BACKTRACE"),
        "no runtime backtrace note: {stderr_buf}"
    );
    std::fs::remove_dir_all(&ws).ok();
}

/// Error paths keep exit 2 with the named refusal on stderr (the ladder
/// itself is untouched by the pipe handling).
#[test]
fn error_exit_ladder_is_unchanged() {
    let out = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args(["doctor", "--path", "/wanyrix/definitely/missing"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("wanyrix: error:"), "{stderr}");
}
