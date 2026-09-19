//! End-to-end daemon IPC verification (issue #58 tranche 2): spawns the
//! real release of the CLI binary, drives the wire protocol through the
//! library client, and measures the daemon's resident memory against the
//! issue's < 100 MB budget.

use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;

use wanyrix_engine::daemon;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

fn wait_for_socket(sock: &std::path::Path) -> bool {
    use std::os::unix::net::UnixStream;
    for _ in 0..250 {
        if UnixStream::connect(sock).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    false
}

/// Read VmRSS in kB from /proc (Linux only — the CI runner is Linux).
#[cfg(target_os = "linux")]
fn rss_kb(pid: u32) -> Option<u64> {
    let text = std::fs::read_to_string(format!("/proc/{pid}/status")).ok()?;
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("VmRSS:") {
            let kb: String = rest.chars().filter(|c| c.is_ascii_digit()).collect();
            return kb.parse().ok();
        }
    }
    None
}

/// Kill the child no matter how the test exits — assertions included.
struct ChildGuard(Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn full_ipc_lifecycle_with_measured_rss_budget() {
    let sock = std::env::temp_dir().join(format!("wanyrix-daemon-ipc-{}.sock", std::process::id()));
    let _ = std::fs::remove_file(&sock);
    let mut child = ChildGuard(
        Command::new(env!("CARGO_BIN_EXE_wanyrix"))
            .args([
                "daemon",
                "start",
                "--socket",
                sock.to_str().unwrap(),
                "--max-requests",
                "4",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn wanyrix daemon start"),
    );

    let tiny = fixture("tiny-ws");
    let doctor_line = format!(
        r#"{{"id":"t1","method":"doctor","params":{{"path":"{}"}}}}"#,
        tiny.display()
    );

    assert!(wait_for_socket(&sock), "daemon never started listening");

    // 1 — status while idle.
    let status = daemon::call(&sock, r#"{"id":"t0","method":"status"}"#).unwrap();
    let status_v: Value = serde_json::from_str(&status).unwrap();
    assert_eq!(status_v["ok"], true);
    assert_eq!(status_v["schema"], "wanyrix.daemon/v1");
    let pid = status_v["data"]["pid"].as_u64().unwrap() as u32;

    // Idle memory budget (issue #58): < 100 MB.
    #[cfg(target_os = "linux")]
    if let Some(kb) = rss_kb(pid) {
        assert!(
            kb < 100_000,
            "idle daemon RSS {kb} kB exceeds the 100 MB budget"
        );
    }

    // 2 — doctor: cold measured scan.
    let cold = daemon::call(&sock, &doctor_line).unwrap();
    let cold_v: Value = serde_json::from_str(&cold).unwrap();
    assert_eq!(cold_v["ok"], true);
    assert_eq!(cold_v["cached"], false);
    assert_eq!(cold_v["data"]["schema"], "wanyrix.doctor/v1");
    assert_eq!(
        cold_v["data"]["summary"]["total"], 4,
        "tiny-ws has exactly 4 findings"
    );
    assert!(cold.rfind("\"generatedAt\"").is_some());

    // 3 — doctor again: cache hit, zero manifests re-parsed.
    let warm = daemon::call(&sock, &doctor_line).unwrap();
    let warm_v: Value = serde_json::from_str(&warm).unwrap();
    assert_eq!(warm_v["cached"], true);
    assert_eq!(warm_v["data"]["findings"], cold_v["data"]["findings"]);

    // Post-scan memory budget.
    #[cfg(target_os = "linux")]
    if let Some(kb) = rss_kb(pid) {
        assert!(
            kb < 100_000,
            "post-scan daemon RSS {kb} kB exceeds the 100 MB budget"
        );
    }

    // 4 — graceful shutdown; the process must exit on its own.
    let bye = daemon::call(&sock, r#"{"id":"t9","method":"shutdown"}"#).unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&bye).unwrap()["data"]["shuttingDown"],
        true
    );

    let deadline = Instant::now() + Duration::from_secs(5);
    let mut exited = false;
    while Instant::now() < deadline {
        match child.0.try_wait().expect("try_wait") {
            Some(_) => {
                exited = true;
                break;
            }
            None => std::thread::sleep(Duration::from_millis(25)),
        }
    }
    if !exited {
        panic!("daemon did not exit after a shutdown request");
    }
    let mut out = String::new();
    child
        .0
        .stdout
        .take()
        .unwrap()
        .read_to_string(&mut out)
        .unwrap();
    assert!(
        out.contains("stopped (shutdown-request)"),
        "measured summary printed: {out}"
    );
    assert!(
        out.contains("requests served: 4"),
        "four requests were served: {out}"
    );
    assert!(out.contains("cache hits: 1"), "one warm hit: {out}");
    assert!(!sock.exists(), "socket file removed on exit");
}

#[test]
fn daemon_refuses_a_second_bind_on_a_live_socket() {
    let sock =
        std::env::temp_dir().join(format!("wanyrix-daemon-steal-{}.sock", std::process::id()));
    let _ = std::fs::remove_file(&sock);
    let mut child = ChildGuard(
        Command::new(env!("CARGO_BIN_EXE_wanyrix"))
            .args([
                "daemon",
                "start",
                "--socket",
                sock.to_str().unwrap(),
                "--max-requests",
                "1",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn first daemon"),
    );

    assert!(wait_for_socket(&sock), "first daemon never listened");

    // Second bind on the LIVE socket: honest failure, exit code 2.
    let output = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args(["daemon", "start", "--socket", sock.to_str().unwrap()])
        .output()
        .expect("spawn second daemon");
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("already served"),
        "honest refusal: {stderr}"
    );

    let _ = daemon::call(&sock, r#"{"id":"bye","method":"shutdown"}"#).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if child.0.try_wait().unwrap().is_some() {
            break;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

#[test]
fn daemon_call_surfaces_scan_failures_with_exit_code_2() {
    let sock = std::env::temp_dir().join(format!(
        "wanyrix-daemon-scanfail-{}.sock",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&sock);
    let _child = ChildGuard(
        Command::new(env!("CARGO_BIN_EXE_wanyrix"))
            .args([
                "daemon",
                "start",
                "--socket",
                sock.to_str().unwrap(),
                "--max-requests",
                "1",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn daemon"),
    );
    assert!(wait_for_socket(&sock));

    // A `daemon call` against a missing workspace exits 2 with the
    // daemon's error frame summarized on stderr.
    let output = Command::new(env!("CARGO_BIN_EXE_wanyrix"))
        .args([
            "daemon",
            "call",
            "--socket",
            sock.to_str().unwrap(),
            "--method",
            "doctor",
            "--path",
            "/wanyrix/definitely/missing",
        ])
        .output()
        .expect("run daemon call");
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("scan-failed"),
        "error code surfaced: {stderr}"
    );

    let _ = std::fs::remove_file(&sock);
}
