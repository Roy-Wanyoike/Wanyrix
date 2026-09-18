//! CLI definition + the three report builders used by `main.rs` (kept in the
//! library so tests can drive the exact CLI code path).

use std::path::PathBuf;

use clap::{Parser, Subcommand};

use crate::analysis::{analyze, Finding};
use crate::graph::{build_graph, Graph};
use crate::health::build_health;
use crate::model::{EngineError, WorkspaceScan};
use crate::scan::scan_workspace;
use crate::timestamp::iso8601_now;

#[derive(Parser)]
#[command(
    name = "wanyrix",
    version,
    about = "Wanyrix engineering-intelligence engine (honesty-first: every value is measured or explicitly labeled not-measured)",
    long_about = "Wanyrix engine v1 — filesystem-manifest analysis for Rust workspaces.\n\nThree flavors: doctor (findings), graph (dependency graph + recompute impact), health (KPI summary derived from doctor+graph).\n\nHonesty contract: all output is MEASURED from the filesystem; nothing is simulated; absent telemetry is labeled, never fabricated."
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand)]
pub enum Command {
    /// Analyze a Rust workspace: crate list + measured findings (wanyrix.doctor/v1).
    Doctor {
        /// Directory to scan (walked recursively for Cargo.toml manifests).
        #[arg(long, default_value = ".")]
        path: PathBuf,
        /// Emit the JSON flavor instead of a human-readable summary.
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON (has no effect without --json).
        #[arg(long)]
        pretty: bool,
    },
    /// Emit the dependency graph derived from the measured edge list (wanyrix.graph/v1).
    Graph {
        #[arg(long, default_value = ".")]
        path: PathBuf,
        #[arg(long)]
        json: bool,
        #[arg(long)]
        pretty: bool,
    },
    /// KPI summary derived from doctor + graph results (wanyrix.health/v1).
    Health {
        #[arg(long, default_value = ".")]
        path: PathBuf,
        #[arg(long)]
        json: bool,
        #[arg(long)]
        pretty: bool,
    },
}

/// Scan once — the single source of truth for every report.
pub fn scan(path: &std::path::Path) -> Result<WorkspaceScan, EngineError> {
    scan_workspace(path)
}

/// `wanyrix doctor` payload: (scan, findings).
pub fn doctor(scan: &WorkspaceScan) -> Vec<Finding> {
    analyze(scan)
}

/// `wanyrix graph` payload.
pub fn graph(scan: &WorkspaceScan) -> Graph {
    build_graph(scan)
}

/// `wanyrix health` payload: (kpis, slowest, findingCounts, insight).
pub fn health(
    scan: &WorkspaceScan,
    findings: &[Finding],
    graph: &Graph,
) -> (
    crate::health::Kpis,
    Vec<crate::health::SlowCrate>,
    Vec<crate::health::SectionCount>,
    Option<crate::health::Insight>,
) {
    build_health(scan, findings, graph)
}

/// Serialize a report to the output string for the CLI. Serialization is
/// total for the current envelope types; a failure is surfaced as an engine
/// error (exit code 2), never swallowed into a fabricated `{}`.
pub fn serialize_json<T: serde::Serialize>(value: &T, pretty: bool) -> Result<String, EngineError> {
    let out = if pretty {
        serde_json::to_string_pretty(value)
    } else {
        serde_json::to_string(value)
    };
    out.map_err(|e| EngineError::Json(e.to_string()))
}

/// Generate the report timestamp (ISO-8601 UTC).
pub fn now_iso8601() -> String {
    iso8601_now()
}

/// Human-readable summary (used when --json is absent). Deterministic.
pub fn human_summary(command: &str, scan: &WorkspaceScan, findings: &[Finding]) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "wanyrix {command} — {} (manifest-static-v1)\n",
        scan.workspace_name
    ));
    out.push_str(&format!("root: {}\n", scan.root.display()));
    out.push_str(&format!("toolchain: {}\n", scan.toolchain));
    out.push_str(&format!(
        "crates ({}): {}\n",
        scan.crates.len(),
        scan.crates
            .iter()
            .map(|c| format!("{} {} [{}]", c.name, c.version, c.band.as_str()))
            .collect::<Vec<_>>()
            .join(", ")
    ));
    let (crit, warn, info) = (
        findings.iter().filter(|f| f.severity == "critical").count(),
        findings.iter().filter(|f| f.severity == "warning").count(),
        findings.iter().filter(|f| f.severity == "info").count(),
    );
    out.push_str(&format!(
        "findings ({}): {crit} critical, {warn} warning, {info} info\n",
        findings.len()
    ));
    for f in findings {
        out.push_str(&format!("  [{}] {} — {}\n", f.severity, f.id, f.title));
        out.push_str(&format!("    → {}\n", f.recommendation));
    }
    out.push_str(
        "measurement: all figures measured from the filesystem; no telemetry simulated (engine v1 measures no build times)\n",
    );
    out
}
