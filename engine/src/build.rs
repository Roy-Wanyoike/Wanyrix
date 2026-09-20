//! Instrumented build telemetry — `wanyrix build` (`wanyrix.build/v1`).
//!
//! Engine v0.3.0 could only CONSUME rustc JSON streams (`telemetry ingest`);
//! it never instrumented a build itself, so every build time in the product
//! was honestly labeled `not-measured`. This module closes that roadmap item:
//! it spawns a REAL `cargo build --message-format=json` on this machine and
//! measures the stream.
//!
//! What is measured (and how, honestly):
//! - `wallClockMs` — wall clock around the whole cargo process (exact).
//! - `fresh` flags — read from every `compiler-artifact` message. An artifact
//!   cargo reports as fresh did NOT need rebuilding; `cacheHitRate` is the
//!   measured fresh share. This is the engine's first MEASURED cache-hit rate.
//! - `arrivalDeltaMs` — the measured delta between consecutive JSON messages.
//!   Cargo runs with parallel jobs, so deltas OVERLAP: they are real
//!   measurements of stream activity, NOT per-crate build times (a note in
//!   every envelope says so — Gate 21: no overlap-hidden estimate in disguise).
//! - diagnostics — counted by level/code exactly like `telemetry` counts
//!   them; the message TEXT (`rendered`, spans, suggestions) is never emitted,
//!   so the same source-redaction guarantee holds by construction. Retained
//!   identifier strings (package names, target kinds, codes) still pass
//!   through the secret scrubber as defense in depth.
//!
//! Failure is data: a cargo build that fails still yields a complete envelope
//! (`buildSuccess: false` + the scrubbed stderr tail) — diagnostics do not
//! abort the report. What IS an engine error (exit 2): a missing scan path
//! or a missing cargo executable (nothing was executed, so nothing can be
//! reported; the error says exactly that).
//!
//! Determinism scope: unlike the static-analysis flavors, this envelope is a
//! LIVE measurement — identical input legitimately produces different
//! durations, because the durations are the measured data. All LISTS are
//! still sorted, and `generatedAt` remains the LAST key.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Serialize;
use serde_json::Value;

use crate::model::EngineError;
use crate::telemetry::{scrub_secrets, CodeCount, REDACTION_POLICY};

pub const BUILD_SCHEMA: &str = "wanyrix.build/v1";
pub const BUILD_PROFILE: &str = "instrumented-cargo-build/v1";

pub const MEASUREMENT_NOTE: &str = "measured — every figure is computed from an actual `cargo build --message-format=json` process executed on this machine; nothing is simulated, nothing is cached from a previous run (Gate 21).";

pub const BUILD_NOTES: [&str; 4] = [
    "Per-artifact arrivalDeltaMs is the measured delta between consecutive cargo JSON messages — cargo builds run with parallel jobs, so deltas overlap and are NOT per-crate build times.",
    "cacheHitRate is measured from the stream's `fresh` flags: an artifact cargo reports as fresh was NOT rebuilt (up-to-date).",
    "Compiler message text (`rendered`, span text, suggestions) is never emitted — diagnostics are counted, not copied; retained identifiers still pass the secret scrubber (policy wanyrix.telemetry-redaction/v1).",
    "This envelope is a LIVE measurement: identical input legitimately yields different durations (the durations are the data). Lists are still sorted; generatedAt is still the last key.",
];

/// Options for an instrumented build. `cargo` is injectable so tests can
/// prove the honest "cargo missing" error without relying on PATH, and
/// `target_dir` lets tests build fixtures without touching their tree.
#[derive(Debug, Clone)]
pub struct BuildOptions {
    /// Cargo executable name or path (default `"cargo"`).
    pub cargo: String,
    /// Optional `--target-dir` override.
    pub target_dir: Option<PathBuf>,
}

impl Default for BuildOptions {
    fn default() -> Self {
        Self {
            cargo: "cargo".to_owned(),
            target_dir: None,
        }
    }
}

/// One measured artifact from a `compiler-artifact` message.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactRow {
    /// Package name parsed from `package_id` (both the legacy `#name@ver`
    /// and the current `#/name/ver` id forms; unknown forms fall back to the
    /// scrubbed raw id rather than guessing).
    pub package: String,
    /// `target.kind` array as reported (`lib`, `bin`, `proc-macro`, …).
    pub target_kinds: Vec<String>,
    /// Measured: cargo reported this artifact as fresh (not rebuilt).
    pub fresh: bool,
    /// Measured ms since the previous stream message (overlaps under
    /// parallelism — see BUILD_NOTES).
    pub arrival_delta_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildSummary {
    pub artifacts_total: usize,
    pub artifacts_fresh: usize,
    /// Artifacts that were (re)built — total minus fresh.
    pub artifacts_rebuilt: usize,
    /// Measured fresh share, percent (floored). 0 when nothing was built.
    pub cache_hit_rate: u8,
    /// `"measured (fresh flags from the cargo JSON stream)"` — or, when the
    /// build produced no artifacts, the honest not-measured label.
    pub cache_hit_rate_status: &'static str,
    pub warnings: usize,
    pub errors: usize,
    /// Internal-compiler-error diagnostics; also counted in `errors`.
    pub ice: usize,
    pub notes: usize,
    /// Diagnostics with any other level — counted, never reclassified.
    pub other_levels: usize,
    pub no_code: usize,
    pub distinct_codes: usize,
    /// `build-script-executed` messages observed.
    pub build_script_runs: usize,
    /// Lines that failed to parse as JSON at all.
    pub malformed_lines: usize,
    /// Valid JSON lines with an unrecognized `reason` (forward-compatible).
    pub unknown_reasons: usize,
    /// Cargo lifecycle messages (`build-finished` on modern cargo) —
    /// counted, never dropped silently. Terminal state itself is already
    /// carried by `buildSuccess`/`exitCode`.
    pub lifecycle_events: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildRedaction {
    pub applied: bool,
    pub policy: &'static str,
    /// Compiler messages whose `rendered` source text was counted-and-dropped.
    pub rendered_dropped: usize,
    /// Secret-shaped substrings actually replaced in retained identifiers.
    pub secrets_scrubbed: usize,
}

/// `wanyrix.build/v1` — field order is the emitted order; `generatedAt` LAST.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildReport {
    pub schema: &'static str,
    pub profile: &'static str,
    /// Display name of the built directory (its file name).
    pub workspace: String,
    /// The exact command that was executed.
    pub command: String,
    /// The cargo binary that actually ran (PATH hit or disclosed rustup
    /// fallback — never a silent substitution).
    pub cargo_executable: String,
    /// Measured cargo exit status.
    pub build_success: bool,
    /// Measured exit code (`None` when the process was killed by a signal).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    /// Scrubbed tail of cargo's stderr — present ONLY when the build failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cargo_stderr_tail: Option<String>,
    pub wall_clock_ms: u64,
    pub duration_status: &'static str,
    pub summary: BuildSummary,
    /// Sorted by (package, kinds); each row is one measured artifact.
    pub artifacts: Vec<ArtifactRow>,
    /// Diagnostics by rustc code, sorted by code.
    pub by_code: Vec<CodeCount>,
    pub redaction: BuildRedaction,
    pub measurement: &'static str,
    pub notes: &'static [&'static str],
    pub started_at: String,
    pub finished_at: String,
    /// LAST key — matches every engine envelope.
    pub generated_at: String,
}

/// Accumulator for the classified cargo JSON stream. Exposed (pub) so tests
/// can feed synthetic streams without spawning cargo.
#[derive(Debug)]
pub struct StreamState {
    summary: BuildSummary,
    artifacts: Vec<ArtifactRow>,
    by_code: BTreeMap<String, usize>,
    rendered_dropped: usize,
    secrets_scrubbed: usize,
}

impl Default for StreamState {
    fn default() -> Self {
        Self::new()
    }
}

impl StreamState {
    pub fn new() -> Self {
        Self {
            summary: BuildSummary {
                artifacts_total: 0,
                artifacts_fresh: 0,
                artifacts_rebuilt: 0,
                cache_hit_rate: 0,
                cache_hit_rate_status: "",
                warnings: 0,
                errors: 0,
                ice: 0,
                notes: 0,
                other_levels: 0,
                no_code: 0,
                distinct_codes: 0,
                build_script_runs: 0,
                malformed_lines: 0,
                unknown_reasons: 0,
                lifecycle_events: 0,
            },
            artifacts: Vec::new(),
            by_code: BTreeMap::new(),
            rendered_dropped: 0,
            secrets_scrubbed: 0,
        }
    }

    /// Classify ONE stream line against the measured delta to the previous
    /// message. Empty lines are skipped silently (cargo emits none; shells
    /// and pipes may).
    pub fn ingest_line(&mut self, line: &str, delta_ms: u64) {
        let line = line.trim();
        if line.is_empty() {
            return;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            self.summary.malformed_lines += 1;
            return;
        };
        let Some(reason) = value.get("reason").and_then(Value::as_str) else {
            self.summary.unknown_reasons += 1;
            return;
        };
        match reason {
            "compiler-artifact" => {
                let fresh = value.get("fresh").and_then(Value::as_bool).unwrap_or(false);
                let kinds = value
                    .get("target")
                    .and_then(|t| t.get("kind"))
                    .and_then(Value::as_array)
                    .map(|a| {
                        a.iter()
                            .filter_map(Value::as_str)
                            .map(str::to_owned)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let raw_id = value
                    .get("package_id")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let (package, scrubbed) = scrub_secrets(&package_name_from_id(raw_id));
                self.secrets_scrubbed += scrubbed;
                self.summary.artifacts_total += 1;
                if fresh {
                    self.summary.artifacts_fresh += 1;
                }
                self.artifacts.push(ArtifactRow {
                    package,
                    target_kinds: kinds,
                    fresh,
                    arrival_delta_ms: delta_ms,
                });
            }
            "compiler-message" => {
                if let Some(rendered) = value
                    .get("message")
                    .and_then(|m| m.get("rendered"))
                    .and_then(Value::as_str)
                {
                    if !rendered.is_empty() {
                        self.rendered_dropped += 1;
                    }
                }
                let msg = value.get("message");
                let level = msg
                    .and_then(|m| m.get("level"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_ascii_lowercase();
                if level.contains("internal compiler error") {
                    self.summary.ice += 1;
                    self.summary.errors += 1;
                } else if level.starts_with("error") {
                    self.summary.errors += 1;
                } else if level.starts_with("warning") {
                    self.summary.warnings += 1;
                } else if level.starts_with("note") {
                    self.summary.notes += 1;
                } else if level.starts_with("help") {
                    // help lines are notes-class guidance — counted in notes,
                    // mirroring telemetry's bucket (never reclassified).
                    self.summary.notes += 1;
                } else {
                    self.summary.other_levels += 1;
                }
                match msg
                    .and_then(|m| m.get("code"))
                    .and_then(|c| c.get("code"))
                    .and_then(Value::as_str)
                {
                    Some(code) => {
                        let (code, scrubbed) = scrub_secrets(code);
                        self.secrets_scrubbed += scrubbed;
                        *self.by_code.entry(code).or_insert(0) += 1;
                    }
                    None => self.summary.no_code += 1,
                }
            }
            "build-script-executed" => self.summary.build_script_runs += 1,
            // Modern cargo's terminal marker — counted, never dropped.
            "build-finished" => self.summary.lifecycle_events += 1,
            // Forward-compatible: counted honestly, never dropped silently.
            _ => self.summary.unknown_reasons += 1,
        }
    }

    /// Freeze the measured stream into the report's summary + sorted lists.
    fn finish(self) -> (BuildSummary, Vec<ArtifactRow>, Vec<CodeCount>, usize, usize) {
        let mut s = self.summary;
        s.artifacts_rebuilt = s.artifacts_total - s.artifacts_fresh;
        let (rate, status) = if s.artifacts_total == 0 {
            (0, "not-measured (no artifacts were produced by this build)")
        } else {
            let rate = s
                .artifacts_fresh
                .checked_mul(100)
                .and_then(|p| p.checked_div(s.artifacts_total))
                .unwrap_or(0) as u8;
            (rate, "measured (fresh flags from the cargo JSON stream)")
        };
        s.cache_hit_rate = rate;
        s.cache_hit_rate_status = status;
        s.distinct_codes = self.by_code.len();
        let mut artifacts = self.artifacts;
        artifacts.sort_by(|a, b| {
            a.package
                .cmp(&b.package)
                .then_with(|| a.target_kinds.cmp(&b.target_kinds))
                .then_with(|| a.fresh.cmp(&b.fresh))
                .then_with(|| a.arrival_delta_ms.cmp(&b.arrival_delta_ms))
        });
        (
            s,
            artifacts,
            self.by_code
                .into_iter()
                .map(|(code, count)| CodeCount { code, count })
                .collect(),
            self.rendered_dropped,
            self.secrets_scrubbed,
        )
    }
}

/// Parse a package name out of a cargo `package_id`. Cargo has used two id
/// layouts: legacy `registry+url#name@1.0.0` / `path+file:///dir#name@1.0.0`
/// and the current `path+file:///dir#/name/1.0.0`. Both route through `#`;
/// the current form separates name/version with `/`, the legacy one with
/// `@`. Anything unparseable returns the raw id (scrubbed downstream) rather
/// than a guess.
pub fn package_name_from_id(package_id: &str) -> String {
    let Some(after_hash) = package_id.rsplit_once('#').map(|(_, tail)| tail) else {
        return package_id.to_owned();
    };
    if after_hash.starts_with('/') {
        // Current form: /name/version (version may itself contain '/'? — it
        // may not; semver has no slash. Take the segment after the slash.)
        let mut parts = after_hash.splitn(3, '/');
        match (parts.next(), parts.next()) {
            (Some(_), Some(name)) if !name.is_empty() => return name.to_owned(),
            _ => return package_id.to_owned(),
        }
    }
    // Legacy form: name@version.
    match after_hash.split_once('@') {
        Some((name, _)) if !name.is_empty() => name.to_owned(),
        _ if !after_hash.is_empty() => after_hash.to_owned(),
        _ => package_id.to_owned(),
    }
}

/// Spawn candidates for the cargo executable. An explicit path (containing
/// a separator) is used verbatim — never substituted. A bare name that is
/// not on PATH falls back to the standard rustup install locations, and the
/// envelope reports which binary actually ran (`cargoExecutable`) — a
/// fallback is disclosed, never silent.
fn cargo_candidates(bare_or_path: &str) -> Vec<PathBuf> {
    let mut out = vec![PathBuf::from(bare_or_path)];
    let looks_like_path = bare_or_path.contains('/') || bare_or_path.contains('\\');
    if !looks_like_path {
        if let Ok(home) = std::env::var("HOME") {
            if !home.is_empty() {
                out.push(
                    PathBuf::from(home)
                        .join(".cargo")
                        .join("bin")
                        .join(bare_or_path),
                );
            }
        }
        if let Ok(cargo_home) = std::env::var("CARGO_HOME") {
            if !cargo_home.is_empty() {
                out.push(PathBuf::from(cargo_home).join("bin").join(bare_or_path));
            }
        }
    }
    out
}

/// Execute the instrumented build: spawn cargo, classify the stream, measure,
/// assemble the envelope. A failed BUILD is data (complete envelope with
/// `buildSuccess: false`); a build that could not be STARTED is an error.
pub fn run_build(path: &Path, opts: &BuildOptions) -> Result<BuildReport, EngineError> {
    // Pre-check the scan root FIRST so a missing directory is never
    // misreported as "cargo not found" (both fail spawn with ENOENT).
    if !path.is_dir() {
        return Err(EngineError::PathNotFound(path.to_path_buf()));
    }
    let workspace = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());

    let started_at_sys = std::time::SystemTime::now();
    let started = Instant::now();

    // Try each candidate in order; the first that SPAWNS wins. NotFound →
    // next candidate; any other spawn error → honest error immediately.
    let make_cmd = |program: &Path| {
        let mut c = Command::new(program);
        c.arg("build")
            .arg("--message-format=json")
            .arg("--quiet") // progress chatter goes to stderr; keep it minimal
            .current_dir(path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(td) = &opts.target_dir {
            c.arg("--target-dir").arg(td);
        }
        c
    };

    let mut child = None;
    let mut resolved_cargo = String::new();
    let mut not_found: Vec<String> = Vec::new();
    let mut spawn_error: Option<std::io::Error> = None;
    for candidate in cargo_candidates(&opts.cargo) {
        match make_cmd(&candidate).spawn() {
            Ok(c) => {
                child = Some(c);
                resolved_cargo = candidate.to_string_lossy().into_owned();
                break;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                not_found.push(candidate.to_string_lossy().into_owned());
            }
            Err(e) => {
                spawn_error = Some(e);
                break;
            }
        }
    }
    let mut child = match (child, spawn_error) {
        (Some(c), _) => c,
        (None, Some(e)) => {
            return Err(EngineError::Build(format!("cannot start cargo: {e}")));
        }
        (None, None) => {
            return Err(EngineError::Build(format!(
                "cargo executable not found (tried: {}) — build telemetry executes a real build and nothing can substitute it; nothing was executed, nothing is fabricated (Gate 21)",
                not_found.join(", ")
            )));
        }
    };

    // Drain stderr on a thread — cargo never writes diagnostics there in
    // --message-format=json mode, but progress/rustc panics do, and an
    // unreadable full pipe would deadlock the build.
    let mut stderr_pipe = child.stderr.take().ok_or_else(|| {
        EngineError::Build("cargo spawned without a capturable stderr — refusing to proceed".into())
    })?;
    let stderr_buf = Arc::new(Mutex::new(Vec::<u8>::new()));
    let stderr_handle = {
        let buf = Arc::clone(&stderr_buf);
        std::thread::spawn(move || {
            use std::io::{Read, Write};
            let mut sink = buf.lock().unwrap_or_else(|p| p.into_inner());
            let mut chunk = [0u8; 8192];
            loop {
                match stderr_pipe.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let _ = sink.write_all(&chunk[..n]);
                        // Bound the retained tail; older bytes fall off.
                        let len = sink.len();
                        if len > 64 * 1024 {
                            let drop_from = len - 32 * 1024;
                            let remainder = sink.split_off(drop_from);
                            *sink = remainder;
                        }
                    }
                }
            }
        })
    };

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| EngineError::Build("cargo spawned without a capturable stdout".into()))?;
    let mut state = StreamState::new();
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    let mut prev = Instant::now();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                let now = Instant::now();
                let delta = now.saturating_duration_since(prev);
                state.ingest_line(&line, delta.as_millis() as u64);
                prev = now;
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(EngineError::Build(format!(
                    "failed reading the cargo JSON stream: {e}"
                )));
            }
        }
    }

    let status = child
        .wait()
        .map_err(|e| EngineError::Build(format!("cargo exited without a readable status: {e}")))?;
    let _ = stderr_handle.join();
    let wall_clock_ms = started.elapsed().as_millis() as u64;
    let finished_at_sys = std::time::SystemTime::now();

    let build_success = status.success();
    // stderr tail only for FAILED builds — and scrubbed like every string.
    let cargo_stderr_tail = if build_success {
        None
    } else {
        let raw = stderr_buf.lock().unwrap_or_else(|p| p.into_inner()).clone();
        let start = raw.len().saturating_sub(500);
        // Lossy conversion absorbs any UTF-8 char a byte window may split.
        let tail = String::from_utf8_lossy(&raw[start..]).into_owned();
        if tail.is_empty() {
            None
        } else {
            let (scrubbed, _) = scrub_secrets(&tail);
            Some(scrubbed)
        }
    };

    let (summary, artifacts, by_code, rendered_dropped, secrets_scrubbed) = state.finish();
    Ok(BuildReport {
        schema: BUILD_SCHEMA,
        profile: BUILD_PROFILE,
        workspace,
        command: "cargo build --message-format=json --quiet".to_owned(),
        cargo_executable: resolved_cargo,
        build_success,
        exit_code: status.code(),
        cargo_stderr_tail,
        wall_clock_ms,
        duration_status: "measured — wall clock around the cargo process",
        summary,
        artifacts,
        by_code,
        redaction: BuildRedaction {
            applied: true,
            policy: REDACTION_POLICY,
            rendered_dropped,
            secrets_scrubbed,
        },
        measurement: MEASUREMENT_NOTE,
        notes: &BUILD_NOTES,
        started_at: crate::timestamp::iso8601_from_unix(
            started_at_sys
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        ),
        finished_at: crate::timestamp::iso8601_from_unix(
            finished_at_sys
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        ),
        generated_at: crate::timestamp::iso8601_now(),
    })
}

/// Deterministic human summary for `wanyrix build` without `--json`.
/// Durations vary per run BY DESIGN (they are the measured data).
pub fn human_summary(report: &BuildReport) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "wanyrix build — {} ({})\n",
        report.workspace, BUILD_PROFILE
    ));
    out.push_str(&format!("command: {}\n", report.command));
    out.push_str(&format!(
        "cargo: {} (measured exit below)\n",
        report.cargo_executable
    ));
    out.push_str(&format!(
        "result: {} (exit {}) · wall clock {}ms (measured)\n",
        if report.build_success {
            "success"
        } else {
            "FAILED"
        },
        report
            .exit_code
            .map(|c| c.to_string())
            .unwrap_or_else(|| "signal".to_owned()),
        report.wall_clock_ms
    ));
    let s = &report.summary;
    out.push_str(&format!(
        "artifacts: {} total · {} fresh · {} rebuilt — cache hit rate {}/100 ({}),\n",
        s.artifacts_total,
        s.artifacts_fresh,
        s.artifacts_rebuilt,
        s.cache_hit_rate,
        s.cache_hit_rate_status
    ));
    out.push_str(&format!(
        "diagnostics: {} warnings · {} errors ({} ICE) · {} notes\n",
        s.warnings, s.errors, s.ice, s.notes
    ));
    out.push_str(&format!(
        "redaction: rendered text dropped unconditionally ({} messages; policy {})\n",
        report.redaction.rendered_dropped, REDACTION_POLICY
    ));
    out.push_str(
        "note: per-artifact arrivalDeltaMs overlaps under cargo's parallel jobs — it is stream activity, not per-crate build time\n",
    );
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn artifact_line(package_id: &str, fresh: bool, kinds: &[&str]) -> String {
        let kinds_json = kinds
            .iter()
            .map(|k| format!("\"{k}\""))
            .collect::<Vec<_>>()
            .join(",");
        format!(
            r#"{{"reason":"compiler-artifact","package_id":"{package_id}","target":{{"kind":[{kinds_json}],"name":"x"}},"fresh":{fresh}}}"#
        )
    }

    fn message_line(level: &str, code: Option<&str>, rendered: Option<&str>) -> String {
        let code_json = match code {
            Some(c) => format!(r#"{{"code":"{c}"}}"#),
            None => "null".to_owned(),
        };
        let rendered_json = match rendered {
            Some(r) => format!(r#","rendered":"{r}""#),
            None => String::new(),
        };
        format!(
            r#"{{"reason":"compiler-message","message":{{"level":"{level}","code":{code_json},"message":"m","spans":[]{rendered_json}}}}}"#
        )
    }

    #[test]
    fn synthetic_stream_is_fully_classified() {
        let mut st = StreamState::new();
        st.ingest_line(
            r#"{"reason":"compiler-artifact","package_id":"path+file:///ws#/alpha/0.1.0","target":{"kind":["lib"]},"fresh":true}"#,
            0,
        );
        st.ingest_line(
            &artifact_line("registry+https://crates.io#beta@0.2.0", false, &["lib"]),
            12,
        );
        st.ingest_line(
            &message_line("warning", Some("unused_variables"), Some("warn text")),
            3,
        );
        st.ingest_line(&message_line("error", Some("E0432"), Some("err text")), 4);
        st.ingest_line(
            r#"{"reason":"compiler-message","message":{"level":"error: internal compiler error","code":null,"message":"ice","spans":[]}}"#,
            1,
        );
        st.ingest_line(
            r#"{"reason":"build-script-executed","package_id":"path+file:///ws#/alpha/0.1.0"}"#,
            2,
        );
        st.ingest_line(r#"{"reason":"build-finished","success":true}"#, 1);
        st.ingest_line("not json at all", 1);
        st.ingest_line(r#"{"reason":"future-reason","x":1}"#, 1);
        st.ingest_line("", 1); // skipped, not counted anywhere
        let (summary, artifacts, by_code, rendered_dropped, secrets) = st.finish();

        assert_eq!(summary.artifacts_total, 2);
        assert_eq!(summary.artifacts_fresh, 1);
        assert_eq!(summary.artifacts_rebuilt, 1);
        assert_eq!(summary.cache_hit_rate, 50);
        assert_eq!(
            summary.cache_hit_rate_status,
            "measured (fresh flags from the cargo JSON stream)"
        );
        assert_eq!(summary.warnings, 1);
        assert_eq!(summary.errors, 2);
        assert_eq!(summary.ice, 1);
        assert_eq!(summary.no_code, 1);
        assert_eq!(summary.build_script_runs, 1);
        assert_eq!(summary.lifecycle_events, 1);
        assert_eq!(summary.malformed_lines, 1);
        assert_eq!(summary.unknown_reasons, 1);
        assert_eq!(rendered_dropped, 2);
        assert_eq!(secrets, 0);

        // Package names across BOTH cargo id layouts.
        let names: Vec<&str> = artifacts.iter().map(|a| a.package.as_str()).collect();
        assert_eq!(names, vec!["alpha", "beta"]); // sorted
        assert_eq!(artifacts[0].target_kinds, vec!["lib"]);
        assert!(artifacts[0].fresh);
        assert_eq!(artifacts[1].arrival_delta_ms, 12);

        // by_code is sorted (BTreeMap) and keeps counts.
        assert_eq!(by_code.len(), 2);
        assert_eq!(by_code[0].code, "E0432");
        assert_eq!(by_code[0].count, 1);
        assert_eq!(by_code[1].code, "unused_variables");
    }

    #[test]
    fn zero_artifacts_is_not_measured_not_faked() {
        let mut st = StreamState::new();
        st.ingest_line(&message_line("note", None, None), 0);
        let (summary, _, _, _, _) = st.finish();
        assert_eq!(summary.artifacts_total, 0);
        assert_eq!(summary.cache_hit_rate, 0);
        assert_eq!(
            summary.cache_hit_rate_status,
            "not-measured (no artifacts were produced by this build)"
        );
    }

    #[test]
    fn help_level_is_counted_as_note_never_reclassified() {
        let mut st = StreamState::new();
        st.ingest_line(&message_line("help", None, None), 0);
        let (summary, _, _, _, _) = st.finish();
        assert_eq!(summary.notes, 1);
        assert_eq!(summary.other_levels, 0);
    }

    #[test]
    fn package_id_forms_parse_to_names() {
        assert_eq!(
            package_name_from_id("path+file:///home/dev/workspaces/engine#/wanyrix-engine/0.4.0"),
            "wanyrix-engine"
        );
        assert_eq!(
            package_name_from_id(
                "registry+https://github.com/rust-lang/crates.io-index#serde@1.0.200"
            ),
            "serde"
        );
        assert_eq!(
            package_name_from_id("file:///legacy/path#oldname@0.1.0"),
            "oldname"
        );
        // Unparseable → the raw id (scrubbed downstream), never a guess.
        assert_eq!(package_name_from_id("opaque-id"), "opaque-id");
        assert_eq!(package_name_from_id("path+file:///ws#/weird"), "weird");
    }

    #[test]
    fn secret_shaped_identifiers_are_scrubbed() {
        let mut st = StreamState::new();
        st.ingest_line(
            &message_line(
                "warning",
                Some("ghp_AAAAABBBBCCCCDDDDEEEEFFFF11112222"),
                None,
            ),
            0,
        );
        let (_, _, by_code, _, secrets) = st.finish();
        assert_eq!(secrets, 1);
        assert!(by_code.iter().all(|c| !c.code.contains("ghp_")));
    }

    #[test]
    fn rendered_text_is_never_retained_anywhere() {
        let secret_text = "source code le ghp_AAAAABBBBCCCCDDDDEEEEFFFF11112222";
        let mut st = StreamState::new();
        st.ingest_line(&message_line("error", Some("E0432"), Some(secret_text)), 0);
        let (summary, _, _, rendered_dropped, _) = st.finish();
        assert_eq!(summary.errors, 1);
        assert_eq!(rendered_dropped, 1);
        let report = assemble_test_report(summary, Vec::new(), Vec::new());
        let text = serde_json::to_string(&report).unwrap();
        assert!(!text.contains("le ghp_"), "rendered source must never leak");
        // The only "rendered" key allowed is the redaction COUNTER
        // (`renderedDropped`) — never a `"rendered"` text field.
        assert!(
            !text.contains("\"rendered\""),
            "no rendered text field is emitted at all"
        );
    }

    fn assemble_test_report(
        summary: BuildSummary,
        artifacts: Vec<ArtifactRow>,
        by_code: Vec<CodeCount>,
    ) -> BuildReport {
        BuildReport {
            schema: BUILD_SCHEMA,
            profile: BUILD_PROFILE,
            workspace: "ws".into(),
            command: "cargo build --message-format=json --quiet".into(),
            cargo_executable: "cargo".into(),
            build_success: true,
            exit_code: Some(0),
            cargo_stderr_tail: None,
            wall_clock_ms: 1,
            duration_status: "measured — wall clock around the cargo process",
            summary,
            artifacts,
            by_code,
            redaction: BuildRedaction {
                applied: true,
                policy: REDACTION_POLICY,
                rendered_dropped: 0,
                secrets_scrubbed: 0,
            },
            measurement: MEASUREMENT_NOTE,
            notes: &BUILD_NOTES,
            started_at: "2026-01-01T00:00:00Z".into(),
            finished_at: "2026-01-01T00:00:01Z".into(),
            generated_at: "2026-01-01T00:00:02Z".into(),
        }
    }

    #[test]
    fn envelope_generated_at_is_the_last_key() {
        let mut st = StreamState::new();
        st.ingest_line(
            &artifact_line("path+file:///ws#/a/0.1.0", true, &["lib"]),
            0,
        );
        let (summary, artifacts, by_code, dropped, secrets) = st.finish();
        let report = assemble_test_report(summary, artifacts, by_code);
        assert_eq!(dropped, 0);
        assert_eq!(secrets, 0);
        let text = serde_json::to_string(&report).unwrap();
        assert_eq!(report.schema, BUILD_SCHEMA);
        let tail = &text[text.len().saturating_sub(60)..];
        assert!(
            tail.contains("\"generatedAt\":\""),
            "generatedAt must trail the envelope, tail: {tail}"
        );
        assert!(text.ends_with('}'));
    }

    #[test]
    fn cargo_candidates_never_substitute_an_explicit_path() {
        // Explicit paths are used verbatim — no rustup fallback is appended.
        let explicit = cargo_candidates("/usr/local/bin/cargo");
        assert_eq!(explicit.len(), 1);
        assert_eq!(explicit[0], PathBuf::from("/usr/local/bin/cargo"));
        // Bare names gain rustup-location fallbacks containing the name.
        let bare = cargo_candidates("cargo");
        assert_eq!(bare[0], PathBuf::from("cargo"));
        assert!(bare.len() >= 2, "bare name must try rustup locations");
        for candidate in &bare[1..] {
            assert!(candidate.ends_with("cargo"), "candidate: {candidate:?}");
            let s = candidate.to_string_lossy();
            assert!(
                s.contains(".cargo") || s.contains("CARGO"),
                "candidate: {s}"
            );
        }
    }

    #[test]
    fn missing_cargo_is_an_honest_error_not_a_fabricated_report() {
        let dir =
            std::env::temp_dir().join(format!("wanyrix-build-missing-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let opts = BuildOptions {
            cargo: "/nonexistent/wanyrix-no-such-cargo".to_owned(),
            target_dir: None,
        };
        let err = run_build(&dir, &opts).unwrap_err();
        match err {
            EngineError::Build(msg) => {
                assert!(msg.contains("cargo executable"), "message: {msg}");
                assert!(msg.contains("nothing was executed"), "message: {msg}");
            }
            other => panic!("expected EngineError::Build, got: {other:?}"),
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_path_is_reported_as_path_not_found() {
        let ghost = std::env::temp_dir().join(format!(
            "wanyrix-build-ghost-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let opts = BuildOptions::default();
        let err = run_build(&ghost, &opts).unwrap_err();
        assert!(matches!(err, EngineError::PathNotFound(_)), "got: {err}");
    }
}
