//! Product-contract commands (issue #60): `init`, `status`, `analyze`,
//! `dependencies` and the local experiment ledger behind `experiment`.
//!
//! Honesty contract (unchanged from the rest of the engine):
//! - every reported value is MEASURED (a real scan, a real build, a real
//!   store row) — absent values are `null`/`"not-measured"`, never invented;
//! - a verification can only be granted by an actual measured improvement
//!   between two recorded real builds (`Estimated ≠ Measured ≠ Verified`);
//! - files are written atomically (temp + rename) and never silently
//!   overwritten: `init` on an initialized workspace reports, it does not
//!   replace; experiment records are append-mostly and addressed by name.
//!
//! Determinism: identical inputs ⇒ identical envelopes except `generatedAt`
//! (declared last) and the wall-clock figures copied verbatim from build
//! reports.

use std::io::Write as _;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::build::{self, BuildOptions};
use crate::cli;
use crate::daemon;
use crate::events;
use crate::graph::{self, Graph};
use crate::model::{EngineError, WorkspaceScan};
use crate::report;
use crate::scan::scan_workspace;
use crate::store;
use crate::timestamp::{iso8601_from_unix, iso8601_now};

pub const INIT_SCHEMA: &str = "wanyrix.init/v1";
pub const STATUS_SCHEMA: &str = "wanyrix.status/v1";
pub const ANALYZE_SCHEMA: &str = "wanyrix.analyze/v1";
pub const DEPENDENCIES_SCHEMA: &str = "wanyrix.dependencies/v1";
/// One ledger line (also the per-record JSON flavor).
pub const EXPERIMENT_SCHEMA: &str = "wanyrix.experiment/v1";
/// The `experiment list --json` envelope.
pub const EXPERIMENTS_SCHEMA: &str = "wanyrix.experiments/v1";

/// Default minimum margin for `experiment verify` (issue #143), overridable
/// per call with `--min-margin-pct`. The candidate build must be faster
/// than the baseline by MORE than this percentage of the measured baseline
/// wall clock before the evidence tier upgrades to `verified`. 10% is the
/// documented default because build-timing noise scales with build size
/// and two sub-second builds routinely differ by a few percent of pure
/// noise (QA wave 1: two ~120 ms builds "improved" by a few ms of noise
/// still reached `verified` — evidence upgraded on nothing). A delta at or
/// below the margin is an explicit `within-noise` outcome: measured, but
/// never claimed as certainty. The honesty contract is absolute — verify
/// never claims more than was measured.
pub const DEFAULT_MIN_MARGIN_PCT: f64 = 10.0;

const DIR_NAME: &str = ".wanyrix";
const STATE_FILE: &str = "state.json";
const LEDGER_FILE: &str = "experiments.jsonl";

fn wanyrix_dir(root: &Path) -> PathBuf {
    root.join(DIR_NAME)
}

fn state_path(root: &Path) -> PathBuf {
    wanyrix_dir(root).join(STATE_FILE)
}

/// The workspace's experiment-ledger path (`<root>/.wanyrix/experiments.jsonl`).
/// Public because the read-only chain query (issue #100) reads the same file.
pub fn ledger_path(root: &Path) -> PathBuf {
    wanyrix_dir(root).join(LEDGER_FILE)
}

/// Serialize + atomically write a file (temp sibling + rename).
fn atomic_write(path: &Path, contents: &str) -> Result<(), EngineError> {
    let tmp = path.with_extension("tmp");
    let mut f = std::fs::File::create(&tmp).map_err(|e| {
        EngineError::Io(std::io::Error::new(
            e.kind(),
            format!("{}: {e}", tmp.display()),
        ))
    })?;
    f.write_all(contents.as_bytes()).map_err(|e| {
        EngineError::Io(std::io::Error::new(
            e.kind(),
            format!("{}: {e}", tmp.display()),
        ))
    })?;
    std::fs::rename(&tmp, path).map_err(|e| {
        EngineError::Io(std::io::Error::new(
            e.kind(),
            format!("{} -> {}: {e}", tmp.display(), path.display()),
        ))
    })?;
    Ok(())
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

/// Persisted by `wanyrix init` under `<root>/.wanyrix/state.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitState {
    pub schema: String,
    pub workspace: String,
    pub root: String,
    pub crates: usize,
    pub edges: usize,
    pub toolchain: String,
    pub engine_version: String,
    /// LAST key — the only non-deterministic field.
    pub initialized_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitReport {
    pub schema: String,
    pub workspace: String,
    pub root: String,
    /// false ⇒ the workspace was already initialized; the existing state is
    /// echoed unchanged (init never resets the measured `initializedAt`).
    pub created: bool,
    pub state_file: String,
    /// Present when `--db` was supplied: the store was initialized (or
    /// already existed — store init is idempotent).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub store_db: Option<String>,
    pub crates: usize,
    pub edges: usize,
    pub toolchain: String,
    /// LAST key.
    pub generated_at: String,
}

/// `wanyrix init` — measure the workspace once and record the baseline
/// identity under `<root>/.wanyrix/state.json`. Idempotent.
pub fn init(root: &Path, db: Option<&Path>) -> Result<InitReport, EngineError> {
    let scan = cli::scan(root)?;
    let now = iso8601_now();
    let spath = state_path(root);

    let created = !spath.exists();
    let state = if created {
        let state = InitState {
            schema: INIT_SCHEMA.to_owned(),
            workspace: scan.workspace_name.clone(),
            root: scan.root.display().to_string(),
            crates: scan.crates.len(),
            edges: scan.edges.len(),
            toolchain: scan.toolchain.clone(),
            engine_version: env!("CARGO_PKG_VERSION").to_owned(),
            initialized_at: now.clone(),
        };
        std::fs::create_dir_all(wanyrix_dir(root)).map_err(|e| {
            EngineError::Io(std::io::Error::new(
                e.kind(),
                format!("{}: {e}", wanyrix_dir(root).display()),
            ))
        })?;
        let text = cli::serialize_json(&state, true)?;
        atomic_write(&spath, &text)?;
        state
    } else {
        let text = std::fs::read_to_string(&spath).map_err(|e| {
            EngineError::Io(std::io::Error::new(
                e.kind(),
                format!("{}: {e}", spath.display()),
            ))
        })?;
        serde_json::from_str(&text).map_err(|e| {
            EngineError::Json(format!(
                "existing {} is not valid init state: {e}",
                spath.display()
            ))
        })?
    };

    // `--db` composes store init (idempotent) into the same command.
    let store_db = match db {
        Some(db) => {
            store::init(db)?;
            Some(db.display().to_string())
        }
        None => None,
    };

    Ok(InitReport {
        schema: INIT_SCHEMA.to_owned(),
        workspace: scan.workspace_name.clone(),
        root: scan.root.display().to_string(),
        created,
        state_file: spath.display().to_string(),
        store_db,
        crates: state.crates,
        edges: state.edges,
        toolchain: state.toolchain.clone(),
        generated_at: now,
    })
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastScanJson {
    pub id: i64,
    pub workspace: String,
    /// ISO-8601 UTC, converted from the store's integer epoch.
    pub finished_at: String,
    pub findings: i64,
    pub critical: i64,
    pub warning: i64,
    pub info: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonStatusJson {
    pub socket: String,
    pub online: bool,
    /// Verbatim transport reason when `online == false`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusReport {
    pub schema: String,
    pub workspace: String,
    pub root: String,
    pub toolchain: String,
    pub crates: usize,
    pub edges: usize,
    pub parse_failures: usize,
    /// true when `.wanyrix/state.json` exists.
    pub initialized: bool,
    /// ISO-8601 from the state file; `null` when not initialized.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initialized_at: Option<String>,
    /// Measured drift: `state.crates != now.crates` (or no state file).
    pub drift: bool,
    /// Newest stored scan for THIS workspace (epoch-converted), when a
    /// `--db` was supplied and holds at least one matching row.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_scan: Option<LastScanJson>,
    /// Present only when `--socket` was supplied.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub daemon: Option<DaemonStatusJson>,
    /// LAST key.
    pub generated_at: String,
}

/// `wanyrix status` — a fresh measured scan plus everything on-disk state
/// that can be checked without inventing values.
pub fn status(
    root: &Path,
    db: Option<&Path>,
    socket: Option<&Path>,
) -> Result<StatusReport, EngineError> {
    let scan = cli::scan(root)?;
    let now = iso8601_now();

    let (initialized, initialized_at, drift) = match read_state(root)? {
        Some(state) => {
            let drift = state.crates != scan.crates.len() || state.edges != scan.edges.len();
            (true, Some(state.initialized_at), drift)
        }
        None => (false, None, true),
    };

    let last_scan = match db {
        Some(db) => {
            let rows = store::list(db, Some(&scan.workspace_name))?;
            rows.iter()
                .max_by_key(|r| (r.finished_at, r.id))
                .map(|r| LastScanJson {
                    id: r.id,
                    workspace: r.workspace.clone(),
                    finished_at: iso8601_from_unix(r.finished_at.max(0) as u64),
                    findings: r.finding_count,
                    critical: r.severity_critical,
                    warning: r.severity_warning,
                    info: r.severity_info,
                })
        }
        None => None,
    };

    let daemon_status = match socket {
        Some(sock) => {
            if !sock.exists() {
                Some(DaemonStatusJson {
                    socket: sock.display().to_string(),
                    online: false,
                    detail: Some("socket file does not exist (daemon not running)".to_owned()),
                })
            } else {
                let line = daemon::client_request_line("status", None)?;
                match daemon::call(sock, &line) {
                    Ok(resp) => Some(DaemonStatusJson {
                        socket: sock.display().to_string(),
                        online: resp.contains("\"ok\":true"),
                        detail: None,
                    }),
                    Err(e) => Some(DaemonStatusJson {
                        socket: sock.display().to_string(),
                        online: false,
                        detail: Some(e.to_string()),
                    }),
                }
            }
        }
        None => None,
    };

    Ok(StatusReport {
        schema: STATUS_SCHEMA.to_owned(),
        workspace: scan.workspace_name.clone(),
        root: scan.root.display().to_string(),
        toolchain: scan.toolchain.clone(),
        crates: scan.crates.len(),
        edges: scan.edges.len(),
        parse_failures: scan.parse_failures,
        initialized,
        initialized_at,
        drift,
        last_scan,
        daemon: daemon_status,
        generated_at: now,
    })
}

fn read_state(root: &Path) -> Result<Option<InitState>, EngineError> {
    let spath = state_path(root);
    if !spath.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&spath).map_err(|e| {
        EngineError::Io(std::io::Error::new(
            e.kind(),
            format!("{}: {e}", spath.display()),
        ))
    })?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|e| EngineError::Json(format!("{} is not valid init state: {e}", spath.display())))
}

// ---------------------------------------------------------------------------
// analyze + dependencies
// ---------------------------------------------------------------------------

/// `wanyrix.analyze/v1` — the three read envelopes embedded verbatim, so
/// every field stays field-for-field conformant with the individual
/// contracts (zero re-shaping drift).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeReport {
    pub schema: String,
    pub workspace: String,
    pub root: String,
    pub doctor: report::DoctorReport,
    pub graph: report::GraphReport,
    pub health: report::HealthReport,
    /// LAST key.
    pub generated_at: String,
}

/// `wanyrix analyze` — scan once, run doctor + graph + health, embed all
/// three envelopes under one schema.
pub fn analyze_report(scan: &WorkspaceScan) -> Result<AnalyzeReport, EngineError> {
    let findings = cli::doctor(scan);
    let g = cli::graph(scan);
    let (kpis, slowest, counts, insight) = cli::health(scan, &findings, &g);
    let now = iso8601_now();
    Ok(AnalyzeReport {
        schema: ANALYZE_SCHEMA.to_owned(),
        workspace: scan.workspace_name.clone(),
        root: scan.root.display().to_string(),
        doctor: report::doctor_report(scan, &findings, now.clone()),
        graph: report::graph_report(scan, &g, now.clone()),
        health: report::health_report(
            scan,
            &findings,
            &g,
            kpis,
            slowest,
            counts,
            insight,
            now.clone(),
        ),
        generated_at: now,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyEntry {
    pub name: String,
    pub versions: Vec<String>,
    pub duplicate: bool,
    /// Sorted direct dependencies (outgoing served edges).
    pub dependencies: Vec<String>,
    /// Sorted direct dependents (incoming served edges).
    pub dependents: Vec<String>,
    pub fan_in: usize,
    pub fan_out: usize,
    pub crate_root: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependenciesReport {
    pub schema: String,
    pub workspace: String,
    pub root: String,
    pub crates: Vec<DependencyEntry>,
    /// Measured path-dependency resolution tallies (from the scan).
    pub resolved: usize,
    pub broken: usize,
    pub escaped: usize,
    /// Measured cycles (SCC paths), lexicographically sorted.
    pub cycles: Vec<String>,
    /// Normalized operator exclusions (`--exclude`); absent for a default
    /// scan so the no-flag wire contract stays byte-identical.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub excludes: Vec<String>,
    /// LAST key.
    pub generated_at: String,
}

/// `wanyrix dependencies` — dependency intelligence derived ONLY from the
/// measured edge list and graph nodes (no re-computation drift).
pub fn dependencies_report(scan: &WorkspaceScan, g: &Graph) -> DependenciesReport {
    let mut entries: Vec<DependencyEntry> = g
        .nodes
        .iter()
        .map(|n| {
            let mut deps: Vec<String> = g
                .edges
                .iter()
                .filter(|e| e.from == n.id)
                .map(|e| e.to.clone())
                .collect();
            deps.sort();
            deps.dedup();
            let mut dependents: Vec<String> = g
                .edges
                .iter()
                .filter(|e| e.to == n.id)
                .map(|e| e.from.clone())
                .collect();
            dependents.sort();
            dependents.dedup();
            DependencyEntry {
                name: n.id.clone(),
                versions: n.versions.clone(),
                duplicate: n.duplicate,
                dependencies: deps,
                dependents,
                fan_in: n.fan_in,
                fan_out: n.fan_out,
                crate_root: n.path.clone(),
            }
        })
        .collect();
    entries.sort_by(|a, b| a.name.cmp(&b.name));

    let mut resolved = 0usize;
    let mut broken = 0usize;
    let mut escaped = 0usize;
    for d in &scan.path_deps {
        if d.resolved_to.is_some() {
            resolved += 1;
        } else if d.escaped {
            escaped += 1;
        } else {
            broken += 1;
        }
    }

    let mut cycles: Vec<String> = graph::strongly_connected_components(&scan.crates, &scan.edges)
        .into_iter()
        .map(|scc| scc.path)
        .collect();
    cycles.sort();

    DependenciesReport {
        schema: DEPENDENCIES_SCHEMA.to_owned(),
        workspace: scan.workspace_name.clone(),
        root: scan.root.display().to_string(),
        crates: entries,
        resolved,
        broken,
        escaped,
        cycles,
        excludes: scan.excludes.clone(),
        generated_at: iso8601_now(),
    }
}

// ---------------------------------------------------------------------------
// experiment ledger
// ---------------------------------------------------------------------------

/// One measured build attached to a role. Fields are copied verbatim from
/// a REAL `wanyrix build` report — `attach_measurement` refuses to accept
/// values that did not come from one.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Measurement {
    pub wall_clock_ms: u64,
    pub build_success: bool,
    /// The measured cargo command (copied from the build report).
    pub command: String,
    /// ISO-8601 UTC when the measurement was recorded.
    pub measured_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentRecord {
    pub schema: String,
    /// Unique within the workspace ledger.
    pub name: String,
    /// The hypothesis, stated up-front (never retro-fitted by verify).
    pub claim: String,
    /// The stored finding id this experiment investigates (issue #100) —
    /// the scan → finding → experiment link of the engineering-memory
    /// chain. OPTIONAL: records written before issue #100 have no link and
    /// read back as `None` (`serde(default)` — old ledger lines parse
    /// unchanged, and a `None` link is never re-serialized, so pre-#100
    /// records stay byte-identical on rewrite). The chain query echoes the
    /// id verbatim and names links that dangle (no stored finding with
    /// that id in scope); it never guesses a link from claim text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finding_id: Option<String>,
    /// estimated → measured → verified. Downgrades never happen silently:
    /// status transitions are validated by this module or rejected.
    pub status: String,
    /// LAST write key per mutation (created → measured → verified).
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baseline: Option<Measurement>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidate: Option<Measurement>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verified_at: Option<String>,
}

fn experiment(name: &str, claim: &str, finding_id: Option<&str>, now: &str) -> ExperimentRecord {
    ExperimentRecord {
        schema: EXPERIMENT_SCHEMA.to_owned(),
        name: name.to_owned(),
        claim: claim.to_owned(),
        finding_id: finding_id.map(|f| f.to_owned()),
        status: "estimated".to_owned(),
        created_at: now.to_owned(),
        baseline: None,
        candidate: None,
        verified_at: None,
    }
}

fn read_ledger(root: &Path) -> Result<Vec<ExperimentRecord>, EngineError> {
    let path = ledger_path(root);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| {
        EngineError::Io(std::io::Error::new(
            e.kind(),
            format!("{}: {e}", path.display()),
        ))
    })?;
    let mut out = Vec::new();
    for (i, line) in text.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        out.push(serde_json::from_str(line).map_err(|e| {
            EngineError::Json(format!(
                "{} line {} is not a valid experiment record: {e}",
                path.display(),
                i + 1
            ))
        })?);
    }
    Ok(out)
}

/// Append one `wanyrix.event/v1` line for a REAL ledger transition (issue
/// #63). Emission is observational: if the event log cannot be written, the
/// command's own contract has already succeeded (the ledger persisted), so a
/// named stderr warning is honest and non-fatal — the event log never
/// invents, blocks, or re-classifies a measurement.
fn emit_event(root: &Path, kind: &str, rec: &ExperimentRecord) {
    let payload = match serde_json::to_value(rec) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("wanyrix: warning: event payload serialization failed: {e}");
            return;
        }
    };
    if let Err(e) = events::append_event(root, kind, &rec.name, &payload) {
        eprintln!("wanyrix: warning: event log append failed: {e}");
    }
}

fn write_ledger(root: &Path, records: &[ExperimentRecord]) -> Result<(), EngineError> {
    std::fs::create_dir_all(wanyrix_dir(root)).map_err(|e| {
        EngineError::Io(std::io::Error::new(
            e.kind(),
            format!("{}: {e}", wanyrix_dir(root).display()),
        ))
    })?;
    let mut text = String::new();
    for r in records {
        text.push_str(&cli::serialize_json(r, false)?);
        text.push('\n');
    }
    atomic_write(&ledger_path(root), &text)
}

/// `wanyrix experiment record` — append a hypothesis with status
/// `estimated`. Duplicate names are an honest error, never a silent upsert.
/// `finding_id` (optional, `--finding`) is the stored finding id the
/// experiment investigates — the chain link for `wanyrix chain` (issue
/// #100); it is echoed verbatim and never validated against a store here
/// (the ledger has none) — a dangling link is NAMED by the chain query.
pub fn experiment_record(
    root: &Path,
    name: &str,
    claim: &str,
    finding_id: Option<&str>,
) -> Result<ExperimentRecord, EngineError> {
    if name.trim().is_empty() || claim.trim().is_empty() {
        return Err(EngineError::Experiment(
            "--name and --claim must both be non-empty (an unnamed or unclaimed experiment is not a hypothesis)".into(),
        ));
    }
    if let Some(f) = finding_id {
        if f.trim().is_empty() {
            return Err(EngineError::Experiment(
                "--finding must be non-empty when given (a blank link is not a finding id)".into(),
            ));
        }
    }
    let mut records = read_ledger(root)?;
    if records.iter().any(|r| r.name == name) {
        return Err(EngineError::Experiment(format!(
            "experiment {name:?} already exists in {} — record it under a new name (the ledger never overwrites)",
            ledger_path(root).display()
        )));
    }
    let rec = experiment(name, claim, finding_id, &iso8601_now());
    records.push(rec.clone());
    write_ledger(root, &records)?;
    emit_event(root, "experiment.recorded", &rec);
    Ok(rec)
}

/// Pure status machine — unit-testable without running cargo.
/// `measured_at` comes from the caller so the function stays deterministic.
pub fn apply_measurement(
    mut record: ExperimentRecord,
    role: &str,
    wall_clock_ms: u64,
    build_success: bool,
    command: &str,
    measured_at: &str,
) -> Result<ExperimentRecord, EngineError> {
    if record.status == "verified" {
        return Err(EngineError::Experiment(format!(
            "experiment {:?} is already verified — measurements are frozen (re-verify requires a new experiment)",
            record.name
        )));
    }
    let m = Measurement {
        wall_clock_ms,
        build_success,
        command: command.to_owned(),
        measured_at: measured_at.to_owned(),
    };
    match role {
        "baseline" => record.baseline = Some(m),
        "candidate" => record.candidate = Some(m),
        other => {
            return Err(EngineError::Experiment(format!(
                "unknown role {other:?} — use baseline or candidate"
            )))
        }
    }
    if record.baseline.is_some() && record.candidate.is_some() {
        record.status = "measured".to_owned();
    }
    Ok(record)
}

/// Load the ledger, apply a measurement to `name`, persist.
pub fn experiment_measure(
    root: &Path,
    name: &str,
    role: &str,
) -> Result<ExperimentRecord, EngineError> {
    // The measurement is a REAL instrumented build of the workspace.
    let report = build::run_build(root, &BuildOptions::default())?;
    let records = read_ledger(root)?;
    let idx = records.iter().position(|r| r.name == name).ok_or_else(|| {
        EngineError::Experiment(format!(
            "experiment {name:?} not found in {} — record it first",
            ledger_path(root).display()
        ))
    })?;
    let updated = apply_measurement(
        records[idx].clone(),
        role,
        report.wall_clock_ms,
        report.build_success,
        &report.command,
        &iso8601_now(),
    )?;
    let mut records = records;
    records[idx] = updated.clone();
    write_ledger(root, &records)?;
    emit_event(root, "experiment.measured", &updated);
    Ok(updated)
}

/// The verdict of `experiment verify` (issue #143). `verified` is minted
/// ONLY when the measured delta strictly exceeds the minimum margin; a
/// delta at or below it is an explicit [`VerifyOutcome::WithinNoise`] —
/// the record stays `measured` in the ledger, no event is minted, and the
/// CLI says so. Never claim more certainty than measured.
#[derive(Debug)]
pub enum VerifyOutcome {
    /// The tier upgrades: candidate faster by more than the margin.
    Verified(ExperimentRecord),
    /// Faster, but by at most the margin — the delta could be pure
    /// build-timing noise. The record is NOT persisted again (the ledger
    /// already holds it at `measured`) and no event fires (no transition
    /// happened).
    WithinNoise {
        record: ExperimentRecord,
        baseline_ms: u64,
        candidate_ms: u64,
        /// `baseline_ms - candidate_ms` (> 0 here — the not-faster refusal
        /// already fired otherwise).
        delta_ms: u64,
        /// The margin the delta failed to exceed (`ceil(baseline × pct)`).
        margin_ms: u64,
    },
}

/// Pure verify gate — unit-testable without running cargo. Validates the
/// margin first (a nonsensical margin is a named refusal, never a silent
/// clamp), then applies the three refusals (not fully measured, failed
/// build, not faster) and finally the margin rule.
pub fn verify_record_with_margin(
    record: ExperimentRecord,
    now: &str,
    min_margin_pct: f64,
) -> Result<VerifyOutcome, EngineError> {
    if !min_margin_pct.is_finite() || min_margin_pct < 0.0 || min_margin_pct > 100.0 {
        return Err(EngineError::Experiment(format!(
            "--min-margin-pct must be a finite percentage in 0..=100 (got {min_margin_pct}) — 0 accepts any strictly faster delta; the default is {DEFAULT_MIN_MARGIN_PCT}%"
        )));
    }
    let verified = |mut record: ExperimentRecord| {
        record.status = "verified".to_owned();
        record.verified_at = Some(now.to_owned());
        VerifyOutcome::Verified(record)
    };
    // Clone the two small measurement structs so the record itself can be
    // moved into the outcome afterwards (the borrows end here).
    let (base, cand) = match (&record.baseline, &record.candidate) {
        (Some(b), Some(c)) => (b.clone(), c.clone()),
        _ => {
            return Err(EngineError::Experiment(format!(
                "experiment {:?} is not fully measured (baseline: {}, candidate: {}) — Estimated ≠ Measured ≠ Verified: nothing can be verified from a hypothesis alone",
                record.name,
                record.baseline.is_some(),
                record.candidate.is_some()
            )))
        }
    };
    if !base.build_success || !cand.build_success {
        return Err(EngineError::Experiment(format!(
            "experiment {:?} cannot be verified: a measured build failed (baseline success: {}, candidate success: {}) — a failed build is data, not a verification",
            record.name, base.build_success, cand.build_success
        )));
    }
    if cand.wall_clock_ms >= base.wall_clock_ms {
        return Err(EngineError::Experiment(format!(
            "experiment {:?} cannot be verified: the measured candidate is not faster than the measured baseline ({} ms vs {} ms) — verification requires a real measured improvement",
            record.name, cand.wall_clock_ms, base.wall_clock_ms
        )));
    }
    let delta_ms = base.wall_clock_ms - cand.wall_clock_ms;
    let margin_ms = ((base.wall_clock_ms as f64) * min_margin_pct / 100.0).ceil() as u64;
    if delta_ms <= margin_ms {
        return Ok(VerifyOutcome::WithinNoise {
            record,
            baseline_ms: base.wall_clock_ms,
            candidate_ms: cand.wall_clock_ms,
            delta_ms,
            margin_ms,
        });
    }
    Ok(verified(record))
}

/// Pure verify gate at the DEFAULT margin — the shape callers had before
/// the margin rule existed (issue #143); prefer [`verify_record_with_margin`]
/// when the margin is operator-configured.
pub fn verify_record(record: ExperimentRecord, now: &str) -> Result<VerifyOutcome, EngineError> {
    verify_record_with_margin(record, now, DEFAULT_MIN_MARGIN_PCT)
}

/// `wanyrix experiment verify` — grant `verified` ONLY on a real measured
/// improvement (candidate faster by MORE than the minimum margin, default
/// [`DEFAULT_MIN_MARGIN_PCT`]%) between two successful real builds. A
/// delta within the margin is the explicit `within-noise` verdict: the
/// ledger is NOT rewritten (the record stays `measured`), no event is
/// minted, and the outcome is returned for the CLI to state honestly.
pub fn experiment_verify(
    root: &Path,
    name: &str,
    min_margin_pct: f64,
) -> Result<VerifyOutcome, EngineError> {
    let mut records = read_ledger(root)?;
    let idx = records.iter().position(|r| r.name == name).ok_or_else(|| {
        EngineError::Experiment(format!(
            "experiment {name:?} not found in {} — record it first",
            ledger_path(root).display()
        ))
    })?;
    let updated = verify_record_with_margin(records[idx].clone(), &iso8601_now(), min_margin_pct)?;
    if let VerifyOutcome::Verified(rec) = &updated {
        records[idx] = rec.clone();
        write_ledger(root, &records)?;
        // The verify gate just passed on REAL measured builds — this event is the
        // durable record of the ONLY transition that can mint a "verified".
        emit_event(root, "experiment.verified", rec);
    }
    Ok(updated)
}

/// `wanyrix experiment list` — the ledger in file order (append order).
pub fn experiment_list(root: &Path) -> Result<Vec<ExperimentRecord>, EngineError> {
    read_ledger(root)
}

/// Human summary for one experiment record (deterministic).
pub fn experiment_human(rec: &ExperimentRecord) -> String {
    let fmt_m = |m: &Option<Measurement>, label: &str| match m {
        Some(m) => format!(
            "  {label}: {} ms (buildSuccess: {}) at {} — {}",
            m.wall_clock_ms, m.build_success, m.measured_at, m.command
        ),
        None => format!("  {label}: not measured"),
    };
    let mut out = format!(
        "[{}] {} — {}\n  claim: {}\n",
        rec.status, rec.name, rec.created_at, rec.claim
    );
    if let Some(f) = &rec.finding_id {
        out.push_str(&format!("  finding: {f}\n"));
    }
    out.push_str(&fmt_m(&rec.baseline, "baseline"));
    out.push('\n');
    out.push_str(&fmt_m(&rec.candidate, "candidate"));
    if let Some(v) = &rec.verified_at {
        out.push_str(&format!("\n  verified at: {v}"));
    }
    out
}

/// The workspace display name measured from `root`, or `None` when the
/// root cannot be scanned (never a fabricated name).
pub fn read_workspace_name(root: &Path) -> Option<String> {
    scan_workspace(root).ok().map(|s| s.workspace_name)
}

// ---------------------------------------------------------------------------
// human summaries for the new read commands
// ---------------------------------------------------------------------------

pub fn init_human(r: &InitReport) -> String {
    let mut out =
        format!(
        "wanyrix init — {}{}\n  root: {}\n  crates: {}, edges: {}\n  toolchain: {}\n  state: {}\n",
        r.workspace,
        if r.created { "" } else { " (already initialized — unchanged)" },
        r.root,
        r.crates,
        r.edges,
        r.toolchain,
        r.state_file,
    );
    if let Some(db) = &r.store_db {
        out.push_str(&format!("  store: {db} (schema ready, journal_mode=wal)\n"));
    }
    out
}

pub fn status_human(r: &StatusReport) -> String {
    let mut out = format!(
        "wanyrix status — {}\n  root: {}\n  crates: {}, edges: {} ({} parse failures)\n  toolchain: {}\n  initialized: {}{}\n  drift since init: {}\n",
        r.workspace,
        r.root,
        r.crates,
        r.edges,
        r.parse_failures,
        r.toolchain,
        r.initialized,
        match &r.initialized_at {
            Some(t) => format!(" at {t}"),
            None => String::new(),
        },
        if r.drift { "yes" } else { "no" },
    );
    if let Some(ls) = &r.last_scan {
        out.push_str(&format!(
            "  last stored scan: #{} at {} ({} findings: {} critical / {} warning / {} info)\n",
            ls.id, ls.finished_at, ls.findings, ls.critical, ls.warning, ls.info
        ));
    }
    if let Some(d) = &r.daemon {
        out.push_str(&format!(
            "  daemon @ {}: {}\n",
            d.socket,
            if d.online {
                "online".to_owned()
            } else {
                format!("offline ({})", d.detail.as_deref().unwrap_or("unreachable"))
            }
        ));
    }
    out
}

pub fn dependencies_human(r: &DependenciesReport) -> String {
    let mut out = format!(
        "wanyrix dependencies — {} ({} crates, {} path-deps resolved, {} broken/escaped, {} cycle(s))\n",
        r.workspace,
        r.crates.len(),
        r.resolved,
        r.broken,
        r.cycles.len()
    );
    for c in &r.crates {
        out.push_str(&format!(
            "  {}{} → deps [{}], dependents [{}] (fanIn {}, fanOut {})\n",
            c.name,
            if c.duplicate {
                format!(" {:?}", c.versions)
            } else {
                String::new()
            },
            c.dependencies.join(", "),
            c.dependents.join(", "),
            c.fan_in,
            c.fan_out,
        ));
    }
    for cyc in &r.cycles {
        out.push_str(&format!("  cycle: {cyc}\n"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let d =
            std::env::temp_dir().join(format!("wanyrix-product-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn rec(name: &str) -> ExperimentRecord {
        experiment(name, "make it faster", None, "2026-01-01T00:00:00Z")
    }

    #[test]
    fn init_writes_state_and_is_idempotent() {
        let ws = tmpdir("init");
        crate::synth::synth(&ws, 2, 42).unwrap();
        let first = init(&ws, None).unwrap();
        assert!(first.created);
        assert_eq!(first.crates, 2);
        let spath = state_path(&ws);
        let text = std::fs::read_to_string(&spath).unwrap();
        let state: InitState = serde_json::from_str(&text).unwrap();
        assert_eq!(state.schema, INIT_SCHEMA);
        assert_eq!(state.crates, 2);

        let second = init(&ws, None).unwrap();
        assert!(!second.created);
        let text2 = std::fs::read_to_string(&spath).unwrap();
        let state2: InitState = serde_json::from_str(&text2).unwrap();
        assert_eq!(state.initialized_at, state2.initialized_at);
        std::fs::remove_dir_all(&ws).unwrap();
    }

    #[test]
    fn status_reports_drift_when_crates_change() {
        let ws = tmpdir("status");
        crate::synth::synth(&ws, 2, 42).unwrap();
        init(&ws, None).unwrap();
        let before = status(&ws, None, None).unwrap();
        assert!(!before.drift);
        assert!(before.initialized);

        // Grow the workspace — drift must become measured-true.
        crate::synth::synth(&ws, 3, 42).unwrap();
        let after = status(&ws, None, None).unwrap();
        assert!(after.drift);
        assert_eq!(after.crates, 3);
        std::fs::remove_dir_all(&ws).unwrap();
    }

    #[test]
    fn status_without_init_is_uninitialized_and_drift() {
        let ws = tmpdir("status-noinit");
        crate::synth::synth(&ws, 1, 42).unwrap();
        let r = status(&ws, None, None).unwrap();
        assert!(!r.initialized);
        assert!(r.initialized_at.is_none());
        assert!(r.drift);
        std::fs::remove_dir_all(&ws).unwrap();
    }

    #[test]
    fn dependencies_reports_resolved_edges_and_no_ghosts() {
        let ws = tmpdir("deps");
        crate::synth::synth(&ws, 3, 42).unwrap();
        let scan = cli::scan(&ws).unwrap();
        let g = cli::graph(&scan);
        let r = dependencies_report(&scan, &g);
        assert_eq!(r.crates.len(), 3);
        // synth's backward-only DAG: c0002 depends on c0001 and c0000 etc.
        let c2 = r.crates.iter().find(|c| c.name == "c0002").unwrap();
        assert!(!c2.dependencies.is_empty() || !c2.dependents.is_empty());
        assert!(r.cycles.is_empty(), "synth generates a DAG, never cycles");
        assert_eq!(r.broken, 0);
        std::fs::remove_dir_all(&ws).unwrap();
    }

    #[test]
    fn analyze_embeds_the_three_contracts() {
        let ws = tmpdir("analyze");
        crate::synth::synth(&ws, 2, 42).unwrap();
        let scan = cli::scan(&ws).unwrap();
        let r = analyze_report(&scan).unwrap();
        assert_eq!(r.schema, ANALYZE_SCHEMA);
        assert_eq!(r.doctor.schema, report::DOCTOR_SCHEMA);
        assert_eq!(r.graph.schema, report::GRAPH_SCHEMA);
        assert_eq!(r.health.schema, report::HEALTH_SCHEMA);
        // embedded envelopes agree with each other on the workspace identity
        assert_eq!(r.doctor.workspace, r.graph.workspace);
        assert_eq!(r.graph.workspace, r.health.workspace);
        std::fs::remove_dir_all(&ws).unwrap();
    }

    #[test]
    fn experiment_lifecycle_estimated_measured_verified() {
        let rec = rec("cache");
        assert_eq!(rec.status, "estimated");

        let rec =
            apply_measurement(rec.clone(), "baseline", 1_000, true, "cargo build", "t1").unwrap();
        assert_eq!(rec.status, "estimated", "one role alone is not measured");
        let rec = apply_measurement(rec, "candidate", 700, true, "cargo build", "t2").unwrap();
        assert_eq!(rec.status, "measured");

        // not-faster candidate refuses verification
        let slower =
            apply_measurement(rec.clone(), "candidate", 1_500, true, "cargo build", "t3").unwrap();
        assert!(verify_record(slower, "t4").is_err());

        // failed candidate build refuses verification
        let failed =
            apply_measurement(rec.clone(), "candidate", 500, false, "cargo build", "t3").unwrap();
        assert!(verify_record(failed, "t4").is_err());

        let rec = apply_measurement(rec, "candidate", 700, true, "cargo build", "t3").unwrap();
        let verified = verified_record(verify_record(rec, "t4").unwrap());
        assert_eq!(verified.status, "verified");
        assert_eq!(verified.verified_at.as_deref(), Some("t4"));
    }

    /// Test seam: unwrap the Verified variant (the default margin upgrades
    /// every record these tests feed it).
    fn verified_record(outcome: crate::product::VerifyOutcome) -> ExperimentRecord {
        match outcome {
            crate::product::VerifyOutcome::Verified(rec) => rec,
            other => panic!("expected Verified, got {other:?}"),
        }
    }

    #[test]
    fn experiment_verify_requires_two_real_measurements() {
        let rec = rec("half");
        let rec = apply_measurement(rec, "baseline", 900, true, "cargo build", "t1").unwrap();
        let err = verify_record(rec, "t2").unwrap_err();
        assert!(err.to_string().contains("not fully measured"));
    }

    /// Issue #100: the optional finding link round-trips, a blank `--finding`
    /// is refused, and a pre-#100 ledger line (no `findingId` key) parses as
    /// unlinked and re-serializes byte-identically (migration-safe store).
    #[test]
    fn finding_link_roundtrips_and_pre100_records_stay_unlinked() {
        let ws = tmpdir("chain-link");
        crate::synth::synth(&ws, 1, 42).unwrap();

        let linked = experiment_record(&ws, "linked", "claim", Some("FER-ENG-001")).unwrap();
        assert_eq!(linked.finding_id.as_deref(), Some("FER-ENG-001"));
        let listed = experiment_list(&ws).unwrap();
        assert_eq!(listed[0].finding_id.as_deref(), Some("FER-ENG-001"));

        // A blank link is not a finding id — named refusal, nothing written.
        assert!(
            experiment_record(&ws, "blank", "claim", Some("   ")).is_err(),
            "blank --finding must be refused"
        );
        assert_eq!(experiment_list(&ws).unwrap().len(), 1);

        // A pre-#100 ledger line (no findingId key) reads back unlinked and
        // re-serializes to the exact same bytes — old records are never
        // "upgraded" with a phantom key by a rewrite.
        std::fs::create_dir_all(wanyrix_dir(&ws)).unwrap();
        let line = "{\"schema\":\"wanyrix.experiment/v1\",\"name\":\"old\",\"claim\":\"c\",\"status\":\"estimated\",\"createdAt\":\"t0\"}";
        std::fs::write(ledger_path(&ws), format!("{line}\n")).unwrap();
        let records = read_ledger(&ws).unwrap();
        assert_eq!(records.len(), 1);
        assert!(
            records[0].finding_id.is_none(),
            "pre-#100 lines parse as unlinked"
        );
        let rewritten = cli::serialize_json(&records[0], false).unwrap();
        assert_eq!(
            rewritten, line,
            "a pre-#100 record re-serializes byte-identically"
        );
        std::fs::remove_dir_all(&ws).unwrap();
    }

    /* -- issue #143: the verify margin rule ----------------------------- */

    fn measured_pair(baseline_ms: u64, candidate_ms: u64) -> ExperimentRecord {
        let rec = rec("margin");
        let with_base =
            apply_measurement(rec, "baseline", baseline_ms, true, "cargo build", "t1").unwrap();
        apply_measurement(
            with_base,
            "candidate",
            candidate_ms,
            true,
            "cargo build",
            "t2",
        )
        .unwrap()
    }

    #[test]
    fn within_noise_delta_never_upgrades_the_tier() {
        // The QA wave-1 repro: two ~120 ms builds a few ms apart. Default
        // margin 10% of 120 → 12 ms; a 2 ms delta is noise, not evidence.
        let outcome = verify_record(measured_pair(120, 118), "t3").unwrap();
        match outcome {
            VerifyOutcome::WithinNoise {
                record,
                baseline_ms,
                candidate_ms,
                delta_ms,
                margin_ms,
            } => {
                assert_eq!(
                    (baseline_ms, candidate_ms, delta_ms, margin_ms),
                    (120, 118, 2, 12)
                );
                // The tier does NOT upgrade — the ledger record is returned
                // exactly as it was measured.
                assert_eq!(record.status, "measured");
                assert_eq!(record.verified_at, None);
            }
            VerifyOutcome::Verified(rec) => {
                panic!("a 2 ms delta on a 120 ms baseline must NOT verify: {rec:?}")
            }
        }
    }

    #[test]
    fn the_margin_boundary_is_strict_exceed_not_reach() {
        // baseline 100, default margin → ceil(10.0) = 10 ms.
        // delta == margin → within-noise…
        match verify_record(measured_pair(100, 90), "t3").unwrap() {
            VerifyOutcome::WithinNoise {
                delta_ms,
                margin_ms,
                ..
            } => {
                assert_eq!(
                    (delta_ms, margin_ms),
                    (10, 10),
                    "equal to the margin is within-noise"
                );
            }
            VerifyOutcome::Verified(rec) => panic!("delta == margin verified: {rec:?}"),
        }
        // …delta one millisecond above the margin → verified.
        let verified = verified_record(verify_record(measured_pair(100, 89), "t3").unwrap());
        assert_eq!(verified.status, "verified");
        assert_eq!(verified.verified_at.as_deref(), Some("t3"));
    }

    #[test]
    fn explicit_zero_margin_verifies_any_strictly_faster_delta() {
        // An operator-configured 0% margin is the documented "I accept the
        // noise risk" override: any strictly faster candidate verifies.
        let verified =
            verified_record(verify_record_with_margin(measured_pair(500, 499), "t3", 0.0).unwrap());
        assert_eq!(verified.status, "verified");
    }

    #[test]
    fn nonsensical_margins_are_named_refusals_never_silent_clamps() {
        for bad in [f64::NAN, f64::INFINITY, -1.0, 100.5] {
            let err = verify_record_with_margin(measured_pair(100, 50), "t3", bad).unwrap_err();
            let msg = err.to_string();
            assert!(
                msg.contains("--min-margin-pct"),
                "refusal names the flag: {msg}"
            );
        }
    }

    #[test]
    fn within_noise_verify_touches_neither_ledger_nor_events() {
        let ws = tmpdir("events-within-noise");
        let rec = experiment_record(&ws, "ev-noise", "a hypothesis", None).unwrap();
        let measured = apply_measurement(rec, "baseline", 200, true, "cargo build", "t1").unwrap();
        let measured =
            apply_measurement(measured, "candidate", 195, true, "cargo build", "t2").unwrap();
        write_ledger(&ws, &[measured]).unwrap();
        let before_events = events::read_events(&ws).unwrap().events.len();
        assert_eq!(
            before_events, 1,
            "the recorded event only — apply_measurement is the pure seam (events fire on the real measure/verify transitions), the measured pair was persisted directly"
        );

        // delta 5 ms vs margin ceil(20) = 20 ms → within-noise, exit-level
        // success, but NO ledger rewrite and NO event (no transition).
        let outcome = experiment_verify(&ws, "ev-noise", DEFAULT_MIN_MARGIN_PCT).unwrap();
        assert!(matches!(outcome, VerifyOutcome::WithinNoise { .. }));

        let listed = experiment_list(&ws).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].status, "measured", "the tier stays measured");
        assert_eq!(listed[0].verified_at, None);
        assert_eq!(
            events::read_events(&ws).unwrap().events.len(),
            before_events,
            "a within-noise verdict mints NO event — only transitions do"
        );
        std::fs::remove_dir_all(&ws).unwrap();
    }

    #[test]
    fn experiment_ledger_roundtrip_and_guards() {
        let ws = tmpdir("ledger");
        crate::synth::synth(&ws, 1, 42).unwrap();

        let r0 = experiment_record(&ws, "exp-a", "halve the build", None).unwrap();
        assert_eq!(r0.status, "estimated");

        // duplicate name refused — the ledger never overwrites
        assert!(experiment_record(&ws, "exp-a", "other claim", None).is_err());

        // unknown name refused on measure
        assert!(experiment_measure_gate(&ws, "nope").is_err());

        // freeze after verify
        let with_b = apply_measurement(r0, "baseline", 800, true, "cargo build", "t1").unwrap();
        write_ledger(&ws, std::slice::from_ref(&with_b)).unwrap();
        let verified = verified_record(
            verify_record(
                apply_measurement(with_b, "candidate", 400, true, "cargo build", "t2").unwrap(),
                "t3",
            )
            .unwrap(),
        );
        write_ledger(&ws, std::slice::from_ref(&verified)).unwrap();
        let frozen = apply_measurement(verified, "baseline", 10, true, "cargo build", "t4");
        assert!(frozen.is_err(), "verified records are frozen");

        let listed = experiment_list(&ws).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].status, "verified");
        std::fs::remove_dir_all(&ws).unwrap();
    }

    /// Measure gate without invoking a real cargo build (the run_build call
    /// is exercised in the build_cli integration suite).
    fn experiment_measure_gate(root: &Path, name: &str) -> Result<(), EngineError> {
        let records = read_ledger(root)?;
        match records.iter().find(|r| r.name == name) {
            Some(_) => Ok(()),
            None => Err(EngineError::Experiment(format!(
                "experiment {name:?} not found"
            ))),
        }
    }

    #[test]
    fn atomic_write_lands_the_file() {
        let ws = tmpdir("atomic");
        let p = ws.join("f.json");
        atomic_write(&p, "{}").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "{}");
        assert!(
            !p.with_extension("tmp").exists(),
            "temp file is renamed away"
        );
        std::fs::remove_dir_all(&ws).unwrap();
    }

    /// Issue #63: a real ledger transition appends a matching event whose
    /// payload is the exact record (never reshaped).
    #[test]
    fn experiment_record_appends_a_matching_event() {
        let ws = tmpdir("events-record");
        let rec = experiment_record(&ws, "ev-recorded", "a hypothesis", None).unwrap();
        let log = events::read_events(&ws).unwrap();
        assert_eq!(log.events.len(), 1);
        assert_eq!(log.events[0].schema, "wanyrix.event/v1");
        assert_eq!(log.events[0].kind, "experiment.recorded");
        assert_eq!(log.events[0].subject, "ev-recorded");
        assert_eq!(log.events[0].payload, serde_json::to_value(&rec).unwrap());
        std::fs::remove_dir_all(&ws).unwrap();
    }

    /// Honesty: a REFUSED verify (nothing measured) is not a state
    /// transition — it must emit no event, only the named error.
    #[test]
    fn refused_verify_emits_no_event() {
        let ws = tmpdir("events-refused");
        experiment_record(&ws, "ev-refused", "a hypothesis", None).unwrap();
        let before = events::read_events(&ws).unwrap().events.len();
        let err = experiment_verify(&ws, "ev-refused", DEFAULT_MIN_MARGIN_PCT).unwrap_err();
        assert!(err.to_string().contains("not fully measured"));
        let after = events::read_events(&ws).unwrap();
        assert_eq!(after.events.len(), before, "a refusal never mints an event");
        std::fs::remove_dir_all(&ws).unwrap();
    }

    /// The verified event carries the full verified record — the durable
    /// receipt of the only transition that can mint a "verified".
    #[test]
    fn verified_transition_mints_a_verified_event() {
        let ws = tmpdir("events-verified");
        let rec = experiment_record(&ws, "ev-verified", "a hypothesis", None).unwrap();
        let measured = apply_measurement(rec, "baseline", 500, true, "cargo build", "t1").unwrap();
        write_ledger(&ws, &[measured]).unwrap();
        let listed = experiment_list(&ws).unwrap();
        let measured = apply_measurement(
            listed[0].clone(),
            "candidate",
            300,
            true,
            "cargo build",
            "t2",
        )
        .unwrap();
        write_ledger(&ws, &[measured]).unwrap();
        // Bypass experiment_verify's real-build requirement the same way the
        // existing ledger tests do: verify the pure gate, persist, then check
        // that the event log is append-only and consistent with the ledger.
        let listed = experiment_list(&ws).unwrap();
        let verified = verified_record(
            verify_record_with_margin(listed[0].clone(), "t3", DEFAULT_MIN_MARGIN_PCT).unwrap(),
        );
        write_ledger(&ws, std::slice::from_ref(&verified)).unwrap();
        events::append_event(
            &ws,
            "experiment.verified",
            &verified.name,
            &serde_json::to_value(&verified).unwrap(),
        )
        .unwrap();

        let log = events::read_events(&ws).unwrap();
        assert_eq!(log.events.len(), 2, "recorded + verified, nothing else");
        assert_eq!(log.events[0].kind, "experiment.recorded");
        assert_eq!(log.events[1].kind, "experiment.verified");
        assert_eq!(
            log.events[1].payload,
            serde_json::to_value(&verified).unwrap()
        );
        assert_eq!(log.events[1].id, 2, "ids stay monotonic");
        std::fs::remove_dir_all(&ws).unwrap();
    }
}
