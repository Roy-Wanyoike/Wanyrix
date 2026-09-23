//! Local analysis daemon (engine phase-2, GitHub issue #58 tranche 2).
//!
//! A long-lived process that keeps ONE measured [`WorkspaceScan`] in memory
//! and serves doctor/graph/health over a Unix domain socket — no TCP, no
//! network, no telemetry leaves the machine. Every data response carries the
//! same versioned envelope the CLI emits (`wanyrix.doctor/v1`, …) wrapped in
//! the additive `wanyrix.daemon/v1` frame below, so the web contract's
//! determinism rules carry over unchanged.
//!
//! # Protocol — `wanyrix.daemon/v1`
//!
//! Newline-delimited JSON, one request per line, one response per line:
//!
//! ```text
//! → {"id":"t1","method":"doctor","params":{"path":"/abs/workspace"}}
//! ← {"schema":"wanyrix.daemon/v1","id":"t1","method":"doctor","ok":true,
//!    "cached":false,"data":{…wanyrix.doctor/v1…},"error":null,
//!    "generatedAt":"…"}
//! ```
//!
//! Methods: `status` · `doctor` · `graph` · `health` · `shutdown`.
//! `generatedAt` is the LAST key of the frame (envelope rule). `cached`
//! appears on the three analysis methods: `true` = served from the
//! in-process cache after a manifest fingerprint match; **zero manifests
//! were re-parsed** for that response. This is the issue-#58 incremental
//! surface: the engine reads only manifests + toolchain files, so a
//! fingerprint over exactly those files ([`crate::scan::manifest_fingerprint`])
//! is a COMPLETE invalidation key — a hit can never serve stale analysis,
//! and a miss always re-scans from the filesystem.
//!
//! # Security posture
//!
//! The socket is bound with mode `0600` (owner-only). The daemon accepts
//! only Unix-stream connections; there is no TCP listener anywhere. A live
//! socket path is never stolen (bind fails honestly); a STALE one (no
//! listener behind it) is removed before rebinding. `status` reports only
//! the daemon's own counters — it never echoes environment variables or
//! anything the connected client did not itself supply.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::analysis::Finding;
use crate::graph::{build_graph, Graph};
use crate::model::{EngineError, WorkspaceScan};
use crate::report;
use crate::scan::{manifest_fingerprint, scan_workspace};
use crate::timestamp::iso8601_now;

pub const DAEMON_SCHEMA: &str = "wanyrix.daemon/v1";

pub const METHODS: [&str; 5] = ["status", "doctor", "graph", "health", "shutdown"];

const ANALYSIS_METHODS: [&str; 3] = ["doctor", "graph", "health"];

/// Why the accept loop stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopReason {
    /// A client sent `method: "shutdown"`.
    ShutdownRequest,
    /// `--max-requests N` was reached (deterministic shutdown for tests).
    MaxRequests,
}

impl StopReason {
    pub fn as_str(self) -> &'static str {
        match self {
            StopReason::ShutdownRequest => "shutdown-request",
            StopReason::MaxRequests => "max-requests",
        }
    }
}

/// Measured server summary, returned when the accept loop ends.
#[derive(Debug, Clone)]
pub struct ServerReport {
    pub requests_served: u64,
    pub cache_hits: u64,
    pub cache_misses: u64,
    /// Measured wall-clock lifetime of the accept loop (seconds).
    pub uptime_seconds: f64,
    pub stopped_by: StopReason,
}

/// Server options. `max_requests = 0` means "no limit".
///
/// `workspace_root` (`daemon start --path <dir>`, issue #143) anchors the
/// daemon to a workspace: RELATIVE request paths are then resolved against
/// this root instead of the server process CWD — the same `--path` flag
/// `daemon call` accepts, honored server-side. Absolute request paths pass
/// through unchanged; `None` (no flag) keeps the historical behavior
/// exactly (relative paths resolve against the process CWD).
#[derive(Debug, Clone, Default)]
pub struct ServerOptions {
    pub max_requests: u64,
    pub workspace_root: Option<std::path::PathBuf>,
}

/// One cached measured workspace. The cache holds at most one — the daemon
/// is a single-workspace accelerator, not a multi-tenant service. On a
/// fingerprint hit, the finished report VALUES are reused verbatim (zero
/// manifests parsed, zero findings recomputed); a different method on the
/// same fingerprint is built once from the cached scan and then reused.
struct CacheEntry {
    root: PathBuf,
    fingerprint: u64,
    scan: WorkspaceScan,
    /// The instant the cached scan was measured (a miss request's `now`).
    /// Reports built later from this scan carry THIS timestamp — honest
    /// provenance: the data was measured then, not now.
    scan_at: String,
    reports: std::collections::BTreeMap<String, Value>,
}

/// Mutable daemon state (shared behind a mutex by the accept loop and the
/// per-connection threads).
pub struct DaemonState {
    started: Instant,
    requests_served: u64,
    cache_hits: u64,
    cache_misses: u64,
    cache: Option<CacheEntry>,
    stop_requested: bool,
    /// `daemon start --path` anchor (issue #143): relative request paths
    /// resolve against this root. `None` = resolve against the process CWD
    /// (the pre-anchor behavior, unchanged default).
    workspace_root: Option<PathBuf>,
}

impl Default for DaemonState {
    fn default() -> Self {
        Self::new()
    }
}

impl DaemonState {
    pub fn new() -> Self {
        Self::with_anchor(None)
    }

    /// State anchored to a workspace root (`daemon start --path <dir>`).
    pub fn with_anchor(workspace_root: Option<PathBuf>) -> Self {
        DaemonState {
            started: Instant::now(),
            requests_served: 0,
            cache_hits: 0,
            cache_misses: 0,
            cache: None,
            stop_requested: false,
            workspace_root,
        }
    }

    /// Resolve a request path against the anchor: RELATIVE paths join the
    /// anchored workspace root (issue #143 parity with `daemon call
    /// --path`); absolute paths are never touched.
    fn resolve_request_path(&self, p: PathBuf) -> PathBuf {
        match (&self.workspace_root, p.is_absolute()) {
            (Some(root), false) => root.join(p),
            _ => p,
        }
    }

    /// Fingerprint-first scan: a manifest-fingerprint hit reuses the cached
    /// measured scan (zero manifests re-parsed); anything else performs a
    /// full measured re-scan. Returns the scan and whether it was cached.
    fn scan_cached(
        &mut self,
        path: &Path,
        now: &str,
    ) -> Result<(WorkspaceScan, bool), EngineError> {
        let canon = path.canonicalize().map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => EngineError::PathNotFound(path.to_path_buf()),
            _ => EngineError::Io(e),
        })?;
        if !canon.is_dir() {
            return Err(EngineError::PathNotFound(canon));
        }
        let fingerprint = manifest_fingerprint(&canon)?;
        if let Some(entry) = &self.cache {
            if entry.root == canon && entry.fingerprint == fingerprint {
                self.cache_hits += 1;
                return Ok((entry.scan.clone(), true));
            }
        }
        let scan = scan_workspace(path)?;
        self.cache = Some(CacheEntry {
            root: canon,
            fingerprint,
            scan: scan.clone(),
            scan_at: now.to_owned(),
            reports: std::collections::BTreeMap::new(),
        });
        self.cache_misses += 1;
        Ok((scan, false))
    }

    /// Handle one protocol line and return the response line. EVERY
    /// non-empty line counts as one request served (including malformed
    /// ones — they get an honest `bad-request` error, not silence).
    pub fn handle_request(&mut self, line: &str, now: &str) -> String {
        self.requests_served += 1;
        let parsed: Result<DaemonRequest, _> = serde_json::from_str(line);
        let req = match parsed {
            Ok(req) => req,
            Err(e) => {
                return self.error_line(
                    None,
                    "unparsed",
                    "bad-request",
                    &format!("request is not valid JSON: {e}"),
                    now,
                );
            }
        };
        let method = req.method.clone();
        if !METHODS.contains(&method.as_str()) {
            return self.error_line(
                req.id.clone(),
                &method,
                "unknown-method",
                &format!(
                    "unknown method {method:?}; known methods: {}",
                    METHODS.join(", ")
                ),
                now,
            );
        }
        if method == "shutdown" {
            self.stop_requested = true;
            return self.ok_line(
                req.id.clone(),
                "shutdown",
                None,
                Some(serde_json::json!({"shuttingDown": true})),
                now,
            );
        }
        if method == "status" {
            let data = self.status_data();
            return self.ok_line(req.id.clone(), "status", None, Some(data), now);
        }
        // analysis methods: params.path is required
        let Some(params) = req.params.as_ref() else {
            return self.error_line(
                req.id.clone(),
                &method,
                "bad-request",
                "params.path is required: missing params object for analysis methods",
                now,
            );
        };
        let Some(path_str) = params.get("path").and_then(Value::as_str) else {
            return self.error_line(
                req.id.clone(),
                &method,
                "bad-request",
                "params.path (string) is required for analysis methods",
                now,
            );
        };
        let path = self.resolve_request_path(PathBuf::from(path_str));
        let scan = match self.scan_cached(&path, now) {
            Ok((scan, cached)) => (scan, cached),
            Err(e) => {
                return self.error_line(
                    req.id.clone(),
                    &method,
                    "scan-failed",
                    &e.to_string(),
                    now,
                );
            }
        };
        let (scan, cached) = scan;
        // Report VALUES are cached per (fingerprint, method): a warm hit is
        // the finished envelope, byte-identical to what a fresh run would
        // emit for the same inputs — with the `generatedAt` of the scan it
        // was MEASURED at (stored provenance), never a fabricated "now".
        let data = {
            let entry = self
                .cache
                .as_mut()
                .expect("scan_cached just populated or hit the cache");
            if let Some(v) = entry.reports.get(&method) {
                v.clone()
            } else {
                let measured_at = entry.scan_at.clone();
                let result = match method.as_str() {
                    "doctor" => {
                        let findings: Vec<Finding> = crate::analysis::analyze(&scan);
                        serde_json::to_value(report::doctor_report(&scan, &findings, measured_at))
                    }
                    "graph" => {
                        let g: Graph = build_graph(&scan);
                        serde_json::to_value(report::graph_report(&scan, &g, measured_at))
                    }
                    _ => {
                        let findings = crate::analysis::analyze(&scan);
                        let g = build_graph(&scan);
                        let (kpis, slowest, counts, insight) =
                            crate::health::build_health(&scan, &findings, &g);
                        serde_json::to_value(report::health_report(
                            &scan,
                            &findings,
                            &g,
                            kpis,
                            slowest,
                            counts,
                            insight,
                            measured_at,
                        ))
                    }
                };
                match result {
                    Ok(v) => {
                        entry.reports.insert(method.clone(), v.clone());
                        v
                    }
                    Err(e) => {
                        return self.error_line(
                            req.id.clone(),
                            &method,
                            "internal",
                            &format!("report serialization failed: {e}"),
                            now,
                        );
                    }
                }
            }
        };
        self.ok_line(req.id.clone(), &method, Some(cached), Some(data), now)
    }

    fn status_data(&self) -> Value {
        serde_json::json!({
            "pid": std::process::id(),
            "uptimeSeconds": self.started.elapsed().as_secs(),
            "requestsServed": self.requests_served,
            "cacheHits": self.cache_hits,
            "cacheMisses": self.cache_misses,
            "workspaceRoot": self.workspace_root.as_ref().map(|p| p.display().to_string()),
            "cachedWorkspace": self.cache.as_ref().map(|e| e.scan.workspace_name.clone()),
            "cachedManifests": self.cache.as_ref().map(|e| e.scan.manifests_found),
        })
    }

    fn ok_line(
        &self,
        id: Option<Value>,
        method: &str,
        cached: Option<bool>,
        data: Option<Value>,
        now: &str,
    ) -> String {
        let envelope = DaemonEnvelope {
            schema: DAEMON_SCHEMA,
            id: id.unwrap_or(Value::Null),
            method: method.to_owned(),
            ok: true,
            cached,
            data,
            error: None,
            generated_at: now.to_owned(),
        };
        serde_json::to_string(&envelope).unwrap_or_else(|e| {
            // The frame itself is total for these types; an honest error
            // frame beats a silent empty line if that ever changes.
            let fallback = DaemonEnvelope {
                schema: DAEMON_SCHEMA,
                id: Value::Null,
                method: method.to_owned(),
                ok: false,
                cached: None,
                data: None,
                error: Some(DaemonErrorBody { code: "internal".into(), message: format!("envelope serialization failed: {e}") }),
                generated_at: now.to_owned(),
            };
            serde_json::to_string(&fallback).unwrap_or_else(|_| format!(
                "{{\"schema\":\"{DAEMON_SCHEMA}\",\"id\":null,\"method\":\"{method}\",\"ok\":false,\"error\":{{\"code\":\"internal\",\"message\":\"unserializable envelope\"}},\"generatedAt\":null}}"
            ))
        })
    }

    fn error_line(
        &self,
        id: Option<Value>,
        method: &str,
        code: &str,
        message: &str,
        now: &str,
    ) -> String {
        let envelope = DaemonEnvelope {
            schema: DAEMON_SCHEMA,
            id: id.unwrap_or(Value::Null),
            method: method.to_owned(),
            ok: false,
            cached: None,
            data: None,
            error: Some(DaemonErrorBody {
                code: code.to_owned(),
                message: message.to_owned(),
            }),
            generated_at: now.to_owned(),
        };
        serde_json::to_string(&envelope).unwrap_or_else(|_| format!(
            "{{\"schema\":\"{DAEMON_SCHEMA}\",\"id\":null,\"method\":\"{method}\",\"ok\":false,\"error\":{{\"code\":\"{code}\",\"message\":\"unserializable error\"}},\"generatedAt\":null}}"
        ))
    }
}

/// `wanyrix.daemon/v1` frame — field order is the emitted order;
/// `generatedAt` is LAST.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DaemonEnvelope {
    schema: &'static str,
    id: Value,
    method: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    cached: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<DaemonErrorBody>,
    generated_at: String,
}

#[derive(Serialize)]
struct DaemonErrorBody {
    code: String,
    message: String,
}

#[derive(Deserialize)]
struct DaemonRequest {
    #[serde(default)]
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Option<Value>,
}

/// Bind, serve until stop, and return the measured server report.
///
/// - validates the `--path` anchor BEFORE binding (a nonexistent workspace
///   root is a named refusal, never a daemon that serves only errors);
/// - binds `socket` with mode `0600`;
/// - refuses to steal a LIVE socket (one that answers a probe connect);
/// - removes a STALE socket file before binding;
/// - removes the socket file on exit.
pub fn run_server(socket: &Path, opts: &ServerOptions) -> Result<ServerReport, EngineError> {
    if let Some(root) = &opts.workspace_root {
        if !root.is_dir() {
            return Err(EngineError::Daemon(format!(
                "daemon workspace root {} does not exist or is not a directory — pass --path <workspace dir> or start without it (request paths then resolve against the process CWD)",
                root.display()
            )));
        }
    }
    unix_run_server(socket, opts)
}

/// One-shot client: send one protocol line, read one response line.
pub fn call(socket: &Path, request_line: &str) -> Result<String, EngineError> {
    unix_call(socket, request_line)
}

// ---------------------------------------------------------------------------
// Unix implementation (Unix domain sockets; the CLI surfaces an honest
// error on platforms without them rather than pretending to listen).
// ---------------------------------------------------------------------------

#[cfg(unix)]
fn unix_run_server(socket: &Path, opts: &ServerOptions) -> Result<ServerReport, EngineError> {
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::net::{UnixListener, UnixStream};

    if let Some(parent) = socket.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| {
                EngineError::Daemon(format!(
                    "cannot create socket directory {}: {e}",
                    parent.display()
                ))
            })?;
        }
    }
    if socket.exists() {
        match UnixStream::connect(socket) {
            Ok(_) => {
                return Err(EngineError::Daemon(format!(
                    "socket {} is already served by a live daemon; stop it or choose another path",
                    socket.display()
                )));
            }
            Err(_) => {
                std::fs::remove_file(socket).map_err(|e| {
                    EngineError::Daemon(format!(
                        "cannot remove stale socket {}: {e}",
                        socket.display()
                    ))
                })?;
            }
        }
    }
    let listener = UnixListener::bind(socket).map_err(|e| {
        EngineError::Daemon(format!("cannot bind socket {}: {e}", socket.display()))
    })?;
    std::fs::set_permissions(socket, std::fs::Permissions::from_mode(0o600)).map_err(|e| {
        let _ = std::fs::remove_file(socket);
        EngineError::Daemon(format!(
            "cannot chmod 0600 socket {}: {e}",
            socket.display()
        ))
    })?;
    listener
        .set_nonblocking(true)
        .map_err(|e| EngineError::Daemon(format!("cannot set listener non-blocking: {e}")))?;

    let state = Arc::new(Mutex::new(DaemonState::with_anchor(
        opts.workspace_root.clone(),
    )));
    let started = Instant::now();
    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                let st = Arc::clone(&state);
                std::thread::spawn(move || serve_stream(stream, st));
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => {
                // Transient accept error: keep serving; the next poll
                // retries. Never crash the daemon over one failed accept.
            }
        }
        {
            let s = state.lock().unwrap_or_else(|p| p.into_inner());
            if s.stop_requested || (opts.max_requests > 0 && s.requests_served >= opts.max_requests)
            {
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(15));
    }
    let _ = std::fs::remove_file(socket);
    let s = state.lock().unwrap_or_else(|p| p.into_inner());
    let stopped_by = if s.stop_requested {
        StopReason::ShutdownRequest
    } else {
        StopReason::MaxRequests
    };
    Ok(ServerReport {
        requests_served: s.requests_served,
        cache_hits: s.cache_hits,
        cache_misses: s.cache_misses,
        uptime_seconds: started.elapsed().as_secs_f64(),
        stopped_by,
    })
}

#[cfg(unix)]
fn serve_stream(stream: std::os::unix::net::UnixStream, state: Arc<Mutex<DaemonState>>) {
    use std::io::Write;

    let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
    let mut writer = match stream.try_clone() {
        Ok(w) => w,
        Err(_) => return,
    };
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let response = {
            let mut s = state.lock().unwrap_or_else(|p| p.into_inner());
            s.handle_request(trimmed, &iso8601_now())
        };
        if writeln!(writer, "{response}").is_err() {
            break;
        }
    }
}

#[cfg(unix)]
fn unix_call(socket: &Path, request_line: &str) -> Result<String, EngineError> {
    use std::io::Write;
    use std::os::unix::net::UnixStream;

    let mut stream = UnixStream::connect(socket).map_err(|e| {
        EngineError::Daemon(format!(
            "cannot connect to daemon socket {}: {e}",
            socket.display()
        ))
    })?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
    writeln!(&mut stream, "{request_line}")
        .map_err(|e| EngineError::Daemon(format!("cannot write request: {e}")))?;
    let mut reader = BufReader::new(stream);
    let mut response = String::new();
    reader
        .read_line(&mut response)
        .map_err(|e| EngineError::Daemon(format!("cannot read response: {e}")))?;
    let trimmed = response.trim().to_owned();
    if trimmed.is_empty() {
        return Err(EngineError::Daemon(
            "daemon closed the connection without a response".into(),
        ));
    }
    Ok(trimmed)
}

#[cfg(not(unix))]
fn unix_run_server(_socket: &Path, _opts: &ServerOptions) -> Result<ServerReport, EngineError> {
    Err(EngineError::Daemon(
        "the daemon requires Unix domain sockets, which this platform does not provide".into(),
    ))
}

#[cfg(not(unix))]
fn unix_call(_socket: &Path, _request_line: &str) -> Result<String, EngineError> {
    Err(EngineError::Daemon(
        "the daemon requires Unix domain sockets, which this platform does not provide".into(),
    ))
}

/// Build the canonical protocol line for a client request (`daemon call`).
/// Returns an error for a method outside [`METHODS`] — the CLI never sends
/// something the daemon must reject as unknown.
pub fn client_request_line(method: &str, path: Option<&Path>) -> Result<String, EngineError> {
    if !METHODS.contains(&method) {
        return Err(EngineError::Daemon(format!(
            "unknown method {method:?}; known methods: {}",
            METHODS.join(", ")
        )));
    }
    let params = if ANALYSIS_METHODS.contains(&method) {
        let p = path.ok_or_else(|| {
            EngineError::Daemon(format!(
                "method {method:?} requires --path (the workspace to analyze)"
            ))
        })?;
        serde_json::json!({ "path": p.display().to_string() })
    } else {
        Value::Null
    };
    Ok(serde_json::json!({ "id": "cli", "method": method, "params": params }).to_string())
}

/// Human summary after `daemon start` exits. Every figure is measured from
/// what the server actually did.
pub fn human_server_summary(report: &ServerReport) -> String {
    format!(
        "wanyrix daemon — stopped ({})\n  requests served: {} (cache hits: {}, misses: {} — misses are full measured re-scans)\n  uptime: {:.3}s\n",
        report.stopped_by.as_str(),
        report.requests_served,
        report.cache_hits,
        report.cache_misses,
        report.uptime_seconds,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

    fn req_line(id: &str, method: &str, path: Option<&std::path::Path>) -> String {
        let params = match path {
            Some(p) => format!(r#","params":{{"path":"{}"}}"#, p.display()),
            None => String::new(),
        };
        format!(r#"{{"id":"{id}","method":"{method}"{params}}}"#)
    }

    fn doctor_req(path: &std::path::Path) -> String {
        req_line("t1", "doctor", Some(path))
    }

    fn last_key_is_generated_at(response: &str) -> bool {
        let Some(gen_idx) = response.rfind("\"generatedAt\"") else {
            return false;
        };
        // No further key separator may appear after the generatedAt key —
        // it is the LAST member of the frame (envelope rule).
        response[gen_idx..].find("\",\"").is_none()
    }

    #[test]
    fn doctor_cold_then_cached_warm() {
        let tiny = fixture("tiny-ws");
        let mut state = DaemonState::new();
        let line = doctor_req(&tiny);
        let cold = state.handle_request(&line, "2026-01-01T00:00:00Z");
        let warm = state.handle_request(&line, "2026-01-01T00:00:01Z");
        assert!(last_key_is_generated_at(&cold));
        assert!(last_key_is_generated_at(&warm));
        let cold_v: Value = serde_json::from_str(&cold).unwrap();
        let warm_v: Value = serde_json::from_str(&warm).unwrap();
        assert_eq!(cold_v["schema"], DAEMON_SCHEMA);
        assert_eq!(cold_v["ok"], true);
        assert_eq!(
            cold_v["cached"], false,
            "first analysis request is a measured cold scan"
        );
        assert_eq!(
            warm_v["cached"], true,
            "unchanged manifests ⇒ fingerprint hit, zero re-parses"
        );
        assert_eq!(cold_v["data"]["schema"], "wanyrix.doctor/v1");
        assert_eq!(
            cold_v["data"]["summary"]["total"],
            warm_v["data"]["summary"]["total"]
        );
        assert_eq!(cold_v["data"]["findings"], warm_v["data"]["findings"]);
        assert_eq!(state.cache_hits, 1);
        assert_eq!(state.cache_misses, 1);
        assert_eq!(state.requests_served, 2);
    }

    #[test]
    fn cache_invalidates_when_manifest_changes() {
        let dir =
            std::env::temp_dir().join(format!("wanyrix-daemon-invalidate-{}", std::process::id()));
        let crate_dir = dir.join("a");
        std::fs::create_dir_all(&crate_dir).unwrap();
        std::fs::write(dir.join("Cargo.toml"), "[workspace]\nmembers = [\"a\"]\n").unwrap();
        let manifest = crate_dir.join("Cargo.toml");
        std::fs::write(
            &manifest,
            "[package]\nname = \"a\"\nversion = \"0.1.0\"\nlicense = \"MIT\"\ndescription = \"before\"\n",
        )
        .unwrap();
        let mut state = DaemonState::new();
        let line = doctor_req(&dir);
        let first = state.handle_request(&line, "2026-01-01T00:00:00Z");
        let first_v: Value = serde_json::from_str(&first).unwrap();
        assert_eq!(first_v["cached"], false);
        // Same content rewrite bumps mtime ⇒ fingerprint differs ⇒ re-scan.
        std::fs::write(
            &manifest,
            "[package]\nname = \"a\"\nversion = \"0.1.0\"\nlicense = \"MIT\"\ndescription = \"after\"\n",
        )
        .unwrap();
        let second = state.handle_request(&line, "2026-01-01T00:00:01Z");
        let second_v: Value = serde_json::from_str(&second).unwrap();
        assert_eq!(
            second_v["cached"], false,
            "changed manifest must invalidate the cache"
        );
        assert_eq!(
            second_v["data"]["summary"]["total"],
            first_v["data"]["summary"]["total"]
        );
        assert_eq!(state.cache_misses, 2);
        assert_eq!(state.cache_hits, 0);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn cache_hit_serves_identical_payload_after_unrelated_source_change() {
        // The engine measures manifests only: a changed .rs source file
        // cannot alter any report, so it must NOT invalidate the cache.
        let dir = std::env::temp_dir().join(format!(
            "wanyrix-daemon-src-irrelevant-{}",
            std::process::id()
        ));
        let crate_dir = dir.join("a");
        std::fs::create_dir_all(crate_dir.join("src")).unwrap();
        std::fs::write(dir.join("Cargo.toml"), "[workspace]\nmembers = [\"a\"]\n").unwrap();
        std::fs::write(
            crate_dir.join("Cargo.toml"),
            "[package]\nname = \"a\"\nversion = \"0.1.0\"\nlicense = \"MIT\"\ndescription = \"x\"\n",
        )
        .unwrap();
        std::fs::write(crate_dir.join("src/lib.rs"), "pub fn f() -> u32 { 1 }").unwrap();
        let mut state = DaemonState::new();
        let line = doctor_req(&dir);
        let cold = state.handle_request(&line, "2026-01-01T00:00:00Z");
        std::fs::write(
            crate_dir.join("src/lib.rs"),
            "pub fn f() -> u32 { 2 } // changed",
        )
        .unwrap();
        let warm = state.handle_request(&line, "2026-01-01T00:00:01Z");
        let cold_v: Value = serde_json::from_str(&cold).unwrap();
        let warm_v: Value = serde_json::from_str(&warm).unwrap();
        assert_eq!(cold_v["cached"], false);
        assert_eq!(
            warm_v["cached"], true,
            "source-only change is outside the measured surface"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn status_reports_measured_counters_and_pid() {
        let tiny = fixture("tiny-ws");
        let mut state = DaemonState::new();
        let _ = state.handle_request(&doctor_req(&tiny), "2026-01-01T00:00:00Z");
        let response =
            state.handle_request(&req_line("s1", "status", None), "2026-01-01T00:00:05Z");
        let v: Value = serde_json::from_str(&response).unwrap();
        assert_eq!(v["ok"], true);
        assert_eq!(v["method"], "status");
        assert!(v.get("cached").is_none(), "status carries no cached flag");
        assert_eq!(v["data"]["pid"], std::process::id());
        assert_eq!(v["data"]["requestsServed"], 2, "status counts itself");
        assert_eq!(v["data"]["cacheHits"], 0);
        assert_eq!(v["data"]["cacheMisses"], 1);
        assert_eq!(v["data"]["cachedWorkspace"], "tiny-ws");
        assert_eq!(v["data"]["cachedManifests"], 4);
        assert!(last_key_is_generated_at(&response));
    }

    #[test]
    fn shutdown_requests_stop() {
        let mut state = DaemonState::new();
        let response =
            state.handle_request(&req_line("s2", "shutdown", None), "2026-01-01T00:00:00Z");
        let v: Value = serde_json::from_str(&response).unwrap();
        assert_eq!(v["ok"], true);
        assert_eq!(v["data"]["shuttingDown"], true);
        assert!(state.stop_requested);
    }

    #[test]
    fn unknown_method_is_an_honest_error() {
        let mut state = DaemonState::new();
        let response =
            state.handle_request(&req_line("u1", "teleport", None), "2026-01-01T00:00:00Z");
        let v: Value = serde_json::from_str(&response).unwrap();
        assert_eq!(v["ok"], false);
        assert_eq!(v["error"]["code"], "unknown-method");
        assert!(v["error"]["message"].as_str().unwrap().contains("teleport"));
        assert_eq!(v["id"], "u1");
        assert!(last_key_is_generated_at(&response));
    }

    #[test]
    fn malformed_line_is_bad_request_never_a_crash() {
        let mut state = DaemonState::new();
        let response = state.handle_request("this is not json", "2026-01-01T00:00:00Z");
        let v: Value = serde_json::from_str(&response).unwrap();
        assert_eq!(v["ok"], false);
        assert_eq!(v["error"]["code"], "bad-request");
        assert_eq!(
            v["id"],
            Value::Null,
            "no id could be recovered from the line"
        );
    }

    #[test]
    fn analysis_without_path_is_bad_request() {
        let mut state = DaemonState::new();
        let response =
            state.handle_request(&req_line("p1", "doctor", None), "2026-01-01T00:00:00Z");
        let v: Value = serde_json::from_str(&response).unwrap();
        assert_eq!(v["error"]["code"], "bad-request");
        assert!(v["error"]["message"]
            .as_str()
            .unwrap()
            .contains("params.path"));
    }

    #[test]
    fn missing_scan_path_is_scan_failed() {
        let mut state = DaemonState::new();
        let ghost = std::env::temp_dir().join("wanyrix-does-not-exist-anywhere");
        let response = state.handle_request(&doctor_req(&ghost), "2026-01-01T00:00:00Z");
        let v: Value = serde_json::from_str(&response).unwrap();
        assert_eq!(v["error"]["code"], "scan-failed");
        assert!(
            state.cache.is_none(),
            "a failed scan must not poison the cache"
        );
    }

    #[test]
    fn graph_and_health_serve_with_cache_semantics() {
        let tiny = fixture("tiny-ws");
        let mut state = DaemonState::new();
        let g1 = state.handle_request(
            &req_line("g1", "graph", Some(&tiny)),
            "2026-01-01T00:00:00Z",
        );
        let g2 = state.handle_request(
            &req_line("g2", "graph", Some(&tiny)),
            "2026-01-01T00:00:01Z",
        );
        assert_eq!(
            serde_json::from_str::<Value>(&g1).unwrap()["data"]["schema"],
            "wanyrix.graph/v1"
        );
        assert_eq!(serde_json::from_str::<Value>(&g2).unwrap()["cached"], true);
        let h1 = state.handle_request(
            &req_line("h1", "health", Some(&tiny)),
            "2026-01-01T00:00:02Z",
        );
        let h2 = state.handle_request(
            &req_line("h2", "health", Some(&tiny)),
            "2026-01-01T00:00:03Z",
        );
        assert_eq!(
            serde_json::from_str::<Value>(&h1).unwrap()["data"]["schema"],
            "wanyrix.health/v1"
        );
        assert_eq!(serde_json::from_str::<Value>(&h2).unwrap()["cached"], true);
        assert_eq!(
            state.cache_hits, 3,
            "cache is per-workspace: health reuses the graph scan"
        );
        assert_eq!(state.cache_misses, 1);
    }

    #[test]
    fn every_response_echoes_the_request_id() {
        let mut state = DaemonState::new();
        let ok = state.handle_request(&req_line("echo-1", "status", None), "2026-01-01T00:00:00Z");
        assert_eq!(serde_json::from_str::<Value>(&ok).unwrap()["id"], "echo-1");
        let err = state.handle_request(&req_line("echo-2", "nope", None), "2026-01-01T00:00:00Z");
        assert_eq!(serde_json::from_str::<Value>(&err).unwrap()["id"], "echo-2");
    }

    #[test]
    fn client_request_line_validates_methods() {
        assert!(client_request_line("status", None).is_ok());
        assert!(client_request_line("doctor", Some(Path::new("/tmp/ws"))).is_ok());
        assert!(
            client_request_line("doctor", None).is_err(),
            "analysis methods need a path"
        );
        assert!(client_request_line("shutdown", None).is_ok());
        assert!(client_request_line("exec", None).is_err());
    }

    /// Issue #143: `daemon start --path <root>` anchors the server — a
    /// RELATIVE request path resolves against the anchor, an absolute one
    /// is untouched, and the status frame echoes the anchor.
    #[test]
    fn anchored_start_resolves_relative_request_paths() {
        let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
        let tiny = fixture("tiny-ws");
        let mut anchored = DaemonState::with_anchor(Some(fixtures.clone()));

        // status echoes the anchor before any analysis request.
        let status = anchored.handle_request(&req_line("s1", "status", None), "now");
        let sv: Value = serde_json::from_str(&status).unwrap();
        assert_eq!(
            sv["data"]["workspaceRoot"].as_str().unwrap(),
            fixtures.display().to_string(),
            "the anchor is visible in the status frame"
        );

        // Relative request path → resolved against the anchor (this scan
        // measured the SAME workspace the absolute form measures).
        let rel = anchored.handle_request(
            &req_line("r1", "doctor", Some(Path::new("tiny-ws"))),
            "2026-01-01T00:00:00Z",
        );
        let rv: Value = serde_json::from_str(&rel).unwrap();
        assert_eq!(
            rv["ok"], true,
            "relative path anchored to the fixture: {rel}"
        );
        assert_eq!(rv["data"]["workspace"], "tiny-ws");

        let mut plain = DaemonState::new();
        let abs = plain.handle_request(&doctor_req(&tiny), "2026-01-01T00:00:00Z");
        let av: Value = serde_json::from_str(&abs).unwrap();
        assert_eq!(
            rv["data"]["findings"], av["data"]["findings"],
            "anchored relative path and absolute path measure the same bytes"
        );

        // An unanchored state keeps the historical behavior: the status
        // frame reports no root and a relative path resolves against CWD.
        let plain_status = plain.handle_request(&req_line("s2", "status", None), "now");
        let pv: Value = serde_json::from_str(&plain_status).unwrap();
        assert!(pv["data"]["workspaceRoot"].is_null());
    }

    /// Issue #143: a nonexistent `--path` anchor is refused BEFORE the
    /// socket binds — a daemon that could only serve errors must not start.
    #[test]
    fn run_server_refuses_a_missing_workspace_root() {
        let missing = std::env::temp_dir().join("wanyrix-does-not-exist-anchor");
        let opts = ServerOptions {
            max_requests: 0,
            workspace_root: Some(missing),
        };
        let err = super::run_server(Path::new("/tmp/never-bound.sock"), &opts).unwrap_err();
        match err {
            EngineError::Daemon(msg) => {
                assert!(
                    msg.contains("does not exist or is not a directory"),
                    "{msg}"
                );
            }
            other => panic!("expected a Daemon error, got {other:?}"),
        }
    }

    #[test]
    fn refuse_to_steal_a_live_socket_and_recover_a_stale_one() {
        let sock =
            std::env::temp_dir().join(format!("wanyrix-daemon-steal-{}.sock", std::process::id()));
        let opts = ServerOptions {
            max_requests: 1,
            ..Default::default()
        };
        // Start a server that stops after ONE request.
        let server_thread = std::thread::spawn({
            let sock = sock.clone();
            move || super::run_server(&sock, &opts)
        });
        // Wait until it is listening.
        let mut listening = false;
        for _ in 0..250 {
            if std::os::unix::net::UnixStream::connect(&sock).is_ok() {
                listening = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(listening, "server did not start listening");
        // A second bind on the LIVE socket must fail honestly.
        let steal = super::run_server(&sock, &ServerOptions::default());
        match steal {
            Err(EngineError::Daemon(msg)) => assert!(msg.contains("already served")),
            other => panic!("expected a Daemon error, got {other:?}"),
        }
        // A STALE file at the socket path is removed, then bound.
        let stale =
            std::env::temp_dir().join(format!("wanyrix-daemon-stale-{}.sock", std::process::id()));
        std::fs::write(&stale, b"not a socket").unwrap();
        let opts2 = ServerOptions {
            max_requests: 1,
            ..Default::default()
        };
        let stale_for_thread = stale.clone();
        let server2 = std::thread::spawn(move || super::run_server(&stale_for_thread, &opts2));
        let mut rebound = false;
        for _ in 0..250 {
            if std::os::unix::net::UnixStream::connect(&stale).is_ok() {
                rebound = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(
            rebound,
            "stale socket file was not replaced by a live listener"
        );
        // Drain both servers (one request each: shutdown).
        let _ = super::call(&sock, &req_line("bye", "shutdown", None));
        let _ = super::call(&stale, &req_line("bye", "shutdown", None));
        let r1 = server_thread.join().unwrap().unwrap();
        let r2 = server2.join().unwrap().unwrap();
        assert_eq!(r1.stopped_by, StopReason::ShutdownRequest);
        assert_eq!(r2.stopped_by, StopReason::ShutdownRequest);
        assert_eq!(r1.requests_served, 1);
        assert_eq!(r2.requests_served, 1);
        assert!(!sock.exists(), "socket file must be removed on exit");
        assert!(!stale.exists());
    }

    #[test]
    fn socket_permissions_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let sock =
            std::env::temp_dir().join(format!("wanyrix-daemon-perm-{}.sock", std::process::id()));
        let handle = std::thread::spawn({
            let sock = sock.clone();
            move || {
                super::run_server(
                    &sock,
                    &ServerOptions {
                        max_requests: 1,
                        ..Default::default()
                    },
                )
            }
        });
        let mut bound = false;
        for _ in 0..250 {
            if std::os::unix::net::UnixStream::connect(&sock).is_ok() {
                bound = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(bound);
        let mode = std::fs::metadata(&sock).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "socket must be owner-only (0600)");
        let _ = super::call(&sock, &req_line("bye", "shutdown", None));
        handle.join().unwrap().unwrap();
    }

    #[test]
    fn multiple_lines_on_one_connection_are_all_served() {
        // Drives the same per-connection loop shape used by serve_stream:
        // several requests over one state, each answered in order.
        let tiny = fixture("tiny-ws");
        let mut state = DaemonState::new();
        let lines = [
            req_line("m1", "status", None),
            doctor_req(&tiny),
            doctor_req(&tiny),
            req_line("m4", "shutdown", None),
        ];
        let responses: Vec<String> = lines
            .iter()
            .map(|l| state.handle_request(l, "2026-01-01T00:00:00Z"))
            .collect();
        assert_eq!(responses.len(), 4);
        assert_eq!(
            serde_json::from_str::<Value>(&responses[0]).unwrap()["method"],
            "status"
        );
        assert_eq!(
            serde_json::from_str::<Value>(&responses[1]).unwrap()["cached"],
            false
        );
        assert_eq!(
            serde_json::from_str::<Value>(&responses[2]).unwrap()["cached"],
            true
        );
        assert_eq!(
            serde_json::from_str::<Value>(&responses[3]).unwrap()["method"],
            "shutdown"
        );
        assert!(state.stop_requested);
    }
}
