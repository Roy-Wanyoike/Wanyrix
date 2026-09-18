//! CLI definition + the report builders used by `main.rs` (kept in the
//! library so tests can drive the exact CLI code path).

use std::path::{Path, PathBuf};

use clap::{Parser, Subcommand};

use crate::analysis::{analyze, Finding};
use crate::graph::{build_graph, Graph};
use crate::health::build_health;
use crate::model::{EngineError, WorkspaceScan};
use crate::scan::scan_workspace;
use crate::store;
use crate::synth;
use crate::timestamp::iso8601_now;

#[derive(Parser)]
#[command(
    name = "wanyrix",
    version,
    about = "Wanyrix engineering-intelligence engine (honesty-first: every value is measured or explicitly labeled not-measured)",
    long_about = "Wanyrix engine — filesystem-manifest analysis for Rust workspaces plus local scan persistence.\n\nFlavors: doctor (findings), graph (dependency graph + recompute impact), health (KPI summary derived from doctor+graph), store (SQLite scan history, WAL-backed), synth (deterministic synthetic fixture workspaces).\n\nHonesty contract: all analysis output is MEASURED from the filesystem; the store persists exactly what doctor measured; nothing is simulated; absent telemetry is labeled, never fabricated."
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
    /// Local SQLite scan store (WAL journal; layout v1) — persists exactly
    /// what `doctor --json` measured, nothing more.
    Store {
        #[command(subcommand)]
        cmd: StoreCmd,
    },
    /// Generate a deterministic synthetic Rust workspace (fixture, issue #58).
    Synth {
        /// Number of crates to generate (directories c0000..).
        #[arg(long)]
        crates: usize,
        /// Output directory (created; existing crate files are overwritten).
        #[arg(long)]
        out: PathBuf,
        /// PRNG seed — same (seed, count) regenerates a byte-identical tree.
        #[arg(long, default_value_t = synth::DEFAULT_SEED)]
        seed: u64,
    },
}

#[derive(Subcommand)]
pub enum StoreCmd {
    /// Create the store schema (idempotent; enables WAL journal mode).
    Init {
        #[arg(long)]
        db: PathBuf,
    },
    /// Persist one doctor-scan JSON result (the exact `wanyrix doctor
    /// --json` output; pass `-` to read the payload from stdin).
    Save {
        #[arg(long)]
        db: PathBuf,
        /// Path to the scan JSON, or `-` for stdin.
        #[arg(long)]
        scan: String,
    },
    /// Print stored scan summaries (id, workspace, date, finding counts).
    List {
        #[arg(long)]
        db: PathBuf,
        /// Only scans of this workspace name (exact match).
        #[arg(long)]
        workspace: Option<String>,
    },
    /// Integrity check: every scan must have its complete findings row
    /// set; reports (and with --repair removes) kill-between-commits
    /// orphans and dangling findings rows.
    Fsck {
        #[arg(long)]
        db: PathBuf,
        /// Delete orphaned/inconsistent rows instead of only reporting them.
        #[arg(long)]
        repair: bool,
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

/// Run a `wanyrix store …` subcommand and format its human output.
/// Deterministic; every count is measured from what the store actually
/// did (rows written / rows found / rows removed).
pub fn store_run(cmd: StoreCmd) -> Result<String, EngineError> {
    match cmd {
        StoreCmd::Init { db } => {
            store::init(&db)?;
            Ok(format!(
                "wanyrix store init — schema ready at {} (layout v{}, journal_mode=wal)\n",
                db.display(),
                store::STORE_SCHEMA_VERSION
            ))
        }
        StoreCmd::Save { db, scan } => {
            let payload = read_scan_payload(Path::new(&scan))?;
            let outcome = store::save(&db, &payload)?;
            Ok(format!(
                "wanyrix store save — persisted scan {} ({})\n  findings rows written: {}\n  db: {} (journal_mode=wal)\n  commit order: scans row committed, then findings rows (two-phase — see src/store.rs; `store fsck` detects a kill between them)\n",
                outcome.scan_id, outcome.workspace, outcome.findings, db.display()
            ))
        }
        StoreCmd::List { db, workspace } => {
            let rows = store::list(&db, workspace.as_deref())?;
            let mut out = String::new();
            match &workspace {
                Some(w) => out.push_str(&format!("wanyrix store list — {} scan(s) for workspace {w:?}\n", rows.len())),
                None => out.push_str(&format!("wanyrix store list — {} scan(s)\n", rows.len())),
            }
            out.push_str(&format!(
                "  {:>4}  {:<16} {:<20} {:>8}  {:>4}  {:>4}  {:>4}  {:>6}\n",
                "id", "workspace", "finished (UTC)", "findings", "crit", "warn", "info", "schema"
            ));
            for r in rows {
                out.push_str(&format!("  {}\n", r.line()));
            }
            out.push_str(
                "  timestamps: the payload's measured generatedAt (integer epoch; the doctor scan measures no duration, so started_at mirrors finished_at)\n",
            );
            Ok(out)
        }
        StoreCmd::Fsck { db, repair } => {
            let report = store::fsck(&db, repair)?;
            let mut out = format!("wanyrix store fsck — {}{}\n", db.display(), if repair { " (--repair)" } else { "" });
            out.push_str(&report.summary());
            Ok(out)
        }
    }
}

/// Read the doctor payload from `--scan` (`-` = stdin). Missing files are
/// an honest error, never an empty payload.
fn read_scan_payload(scan: &Path) -> Result<String, EngineError> {
    if scan.as_os_str() == "-" {
        use std::io::Read;
        let mut buf = String::new();
        std::io::stdin()
            .read_to_string(&mut buf)
            .map_err(|e| EngineError::Store(format!("cannot read payload from stdin: {e}")))?;
        Ok(buf)
    } else {
        std::fs::read_to_string(scan).map_err(|e| EngineError::Store(format!("cannot read scan payload {}: {e}", scan.display())))
    }
}

/// Run `wanyrix synth` and format its human output.
pub fn synth_run(crates: usize, out: &Path, seed: u64) -> Result<String, EngineError> {
    if crates == 0 {
        return Err(EngineError::Synth("--crates must be at least 1 (a zero-crate workspace scans to nothing)".into()));
    }
    let outcome = synth::synth(out, crates, seed)?;
    let incomplete = outcome.crates_written - outcome.complete_crates;
    Ok(format!(
        "wanyrix synth — deterministic synthetic workspace\n  out: {}\n  seed: {}\n  crates: {} ({} with license+description, {} intentionally incomplete so doctor finds things)\n  path-dependency edges (backward-only DAG): {}\n  files written: {}\n  note: synthetic fixture, not measured data — same --seed + --crates regenerate a byte-identical tree\n",
        outcome.root.display(),
        outcome.seed,
        outcome.crates_written,
        outcome.complete_crates,
        incomplete,
        outcome.dep_edges,
        outcome.files_written,
    ))
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
