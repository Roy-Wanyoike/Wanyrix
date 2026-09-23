//! CLI definition + the report builders used by `main.rs` (kept in the
//! library so tests can drive the exact CLI code path).

use std::path::{Path, PathBuf};
use std::time::Duration;

use clap::{Parser, Subcommand};

use crate::analysis::{analyze, Finding};
use crate::build::{self, BuildOptions};
use crate::entitlement::LicenseCmd;
use crate::graph::{build_graph, Graph};
use crate::health::build_health;
use crate::model::{EngineError, WorkspaceScan};
use crate::product;
use crate::scan::{scan_workspace, scan_workspace_excluding};
use crate::timestamp::iso8601_now;
use crate::{daemon, store, synth, telemetry};

pub use crate::entitlement::{activate_run, entitlement_run, gate_cli, license_run};

#[derive(Parser)]
#[command(
    name = "wanyrix",
    version,
    about = "Wanyrix engineering-intelligence engine (honesty-first: every value is measured or explicitly labeled not-measured)",
    long_about = "Wanyrix engine — filesystem-manifest analysis for Rust workspaces, local scan persistence, an incremental analysis daemon, rustc telemetry ingestion and synthetic fixture generation.\n\nFlavors: doctor (findings), graph (dependency graph + recompute impact), health (KPI summary derived from doctor+graph), store (SQLite scan history, WAL-backed), daemon (persistent in-process scan cache over a local Unix socket), telemetry (redacted rustc JSON diagnostics ingest), synth (deterministic synthetic fixture workspaces).\n\nHonesty contract: all analysis output is MEASURED from the filesystem; the store persists exactly what doctor measured; the daemon serves cached measured scans invalidated by a manifest fingerprint; telemetry ingestion redacts source and secrets by default; nothing is simulated; absent telemetry is labeled, never fabricated."
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
        /// Repeatable directory exclusion relative to --path; the subtree is
        /// pruned from the walk, counted in skipped entries and echoed in
        /// the envelope (never a silent drop).
        #[arg(long = "exclude")]
        excludes: Vec<String>,
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
        /// Repeatable directory exclusion relative to --path (echoed, never silent).
        #[arg(long = "exclude")]
        excludes: Vec<String>,
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON (has no effect without --json).
        #[arg(long)]
        pretty: bool,
    },
    /// KPI summary derived from doctor + graph results (wanyrix.health/v1).
    Health {
        #[arg(long, default_value = ".")]
        path: PathBuf,
        /// Repeatable directory exclusion relative to --path (echoed, never silent).
        #[arg(long = "exclude")]
        excludes: Vec<String>,
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON (has no effect without --json).
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
    /// Local analysis daemon (wanyrix.daemon/v1): one measured scan kept
    /// in memory, served over a Unix domain socket. No TCP, no network.
    Daemon {
        #[command(subcommand)]
        cmd: DaemonCmd,
    },
    /// Ingest rustc JSON diagnostics (cargo build --message-format=json)
    /// into a redacted, aggregated wanyrix.telemetry/v1 report. Redaction
    /// is default-on: source snippets are dropped unconditionally.
    Telemetry {
        #[command(subcommand)]
        cmd: TelemetryCmd,
    },
    /// Execute a REAL instrumented build (`cargo build
    /// --message-format=json`) and measure it: wall clock, fresh/cache-hit
    /// rate and redacted diagnostics (wanyrix.build/v1). A failed build is
    /// data (buildSuccess: false); only a missing path or missing cargo
    /// binary is an error.
    Build {
        /// Directory to build (must contain a Cargo.toml workspace/package).
        #[arg(long, default_value = ".")]
        path: PathBuf,
        /// Emit the JSON flavor instead of a human-readable summary.
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON (has no effect without --json).
        #[arg(long)]
        pretty: bool,
    },
    /// Record the workspace's measured identity under `.wanyrix/state.json`
    /// (idempotent — an existing state is echoed, never reset).
    Init {
        #[arg(long, default_value = ".")]
        path: PathBuf,
        /// Also initialize (idempotently) a scan store at this path.
        #[arg(long)]
        db: Option<PathBuf>,
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON (has no effect without --json).
        #[arg(long)]
        pretty: bool,
    },
    /// Fresh measured scan + on-disk state summary: init baseline + drift,
    /// newest stored scan (with --db), daemon liveness (with --socket).
    Status {
        #[arg(long, default_value = ".")]
        path: PathBuf,
        #[arg(long)]
        db: Option<PathBuf>,
        /// Unix socket of a running daemon — liveness is probed, honestly.
        #[arg(long)]
        socket: Option<PathBuf>,
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON (has no effect without --json).
        #[arg(long)]
        pretty: bool,
    },
    /// One measured pass: doctor + graph + health embedded verbatim under
    /// wanyrix.analyze/v1 (zero contract re-shaping).
    Analyze {
        #[arg(long, default_value = ".")]
        path: PathBuf,
        /// Repeatable directory exclusion relative to --path (echoed, never silent).
        #[arg(long = "exclude")]
        excludes: Vec<String>,
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON (has no effect without --json).
        #[arg(long)]
        pretty: bool,
    },
    /// Dependency intelligence derived only from the measured edge list:
    /// direct deps/dependents, fan-in/out, duplicates, path-dep resolution
    /// tallies and measured cycles.
    Dependencies {
        #[arg(long, default_value = ".")]
        path: PathBuf,
        /// Repeatable directory exclusion relative to --path (echoed, never silent).
        #[arg(long = "exclude")]
        excludes: Vec<String>,
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON (has no effect without --json).
        #[arg(long)]
        pretty: bool,
    },
    /// Local experiment ledger (.wanyrix/experiments.jsonl): a hypothesis is
    /// `estimated`; two REAL measured builds make it `measured`; a real
    /// measured improvement makes it `verified`. Nothing else does.
    Experiment {
        #[command(subcommand)]
        cmd: ExperimentCmd,
    },
    /// Read the durable event log (.wanyrix/events.jsonl, wanyrix.event/v1):
    /// one append-only mirror of every real ledger transition. Corrupt lines
    /// are skipped and named — never a silent drop, never a crash.
    Events {
        #[arg(long, default_value = ".")]
        path: PathBuf,
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON (has no effect without --json).
        #[arg(long)]
        pretty: bool,
    },
    /// Ask a LOCAL model (Ollama-class) a question about this workspace,
    /// grounded on the measured evidence digest (wanyrix.ai/v1). Only the
    /// digest is transmitted — never source code. AI output is labeled
    /// inference; it is never a measurement and never verification.
    Ai {
        #[arg(long, default_value = ".")]
        path: PathBuf,
        /// Question to ask about the workspace.
        #[arg(
            long,
            short = 'q',
            default_value = "Summarize the health of this workspace and which findings matter most."
        )]
        question: String,
        /// Local model server address (host:port or http://host:port).
        /// Falls back to $WANYRIX_AI_ENDPOINT, then the Ollama default.
        /// https:// is refused with a named error — the client speaks plain
        /// HTTP only (no TLS; local model servers do not need it).
        #[arg(long)]
        endpoint: Option<String>,
        /// Model name (falls back to $WANYRIX_AI_MODEL, then the default).
        #[arg(long)]
        model: Option<String>,
        /// Network timeout in seconds.
        #[arg(long, default_value_t = 120)]
        timeout_secs: u64,
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON (has no effect without --json).
        #[arg(long)]
        pretty: bool,
    },
    /// Measured Git facts for this workspace (wanyrix.git/v1): branch,
    /// HEAD, dirty state, changed files mapped onto crates, recent
    /// commits. Redacted by design: paths and subjects only — never
    /// diffs, never file contents, never author identities.
    Git {
        #[arg(long, default_value = ".")]
        path: PathBuf,
        /// Repeatable directory exclusion relative to --path (echoed, never silent).
        #[arg(long = "exclude")]
        excludes: Vec<String>,
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON (has no effect without --json).
        #[arg(long)]
        pretty: bool,
    },
    /// Reverse-dependency blast radius derived ONLY from the measured edge
    /// list (wanyrix.impact/v1). Dev-dependency edges never propagate.
    /// Unknown crates are a named refusal — impact is never guessed.
    Impact {
        /// The crate whose dependents to measure.
        #[arg(long = "crate")]
        crate_name: String,
        #[arg(long, default_value = ".")]
        path: PathBuf,
        /// Repeatable directory exclusion relative to --path (echoed, never silent).
        #[arg(long = "exclude")]
        excludes: Vec<String>,
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON (has no effect without --json).
        #[arg(long)]
        pretty: bool,
    },
    /// Diff the fresh measured scan against the newest stored scan for this
    /// workspace (wanyrix.what-changed/v1). No baseline yet is a valid
    /// envelope with a named remediation note — never a fake baseline.
    WhatChanged {
        #[arg(long, default_value = ".")]
        path: PathBuf,
        /// Repeatable directory exclusion relative to --path (echoed, never silent).
        #[arg(long = "exclude")]
        excludes: Vec<String>,
        /// SQLite scan store to read the baseline from (wanyrix store init).
        #[arg(long)]
        db: PathBuf,
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON (has no effect without --json).
        #[arg(long)]
        pretty: bool,
    },
    /// Time machine: diff two STORED scans (wanyrix.compare/v1, issue #115)
    /// — findings added/resolved/changed, crate add/remove/version deltas
    /// and severity deltas, read back verbatim from the store. Clock-free
    /// and byte-stable: repeated invocations are identical (generatedAt is
    /// the literal `not-measured`). Unknown ids, cross-workspace pairs and
    /// corrupt store entries are NAMED refusals; identical scans are a
    /// valid zero-delta envelope.
    Compare {
        /// SQLite scan store both scans live in (wanyrix store init/save).
        #[arg(long)]
        db: PathBuf,
        /// The baseline scan id (`wanyrix store list` prints the ids).
        #[arg(long)]
        from: i64,
        /// The scan id to compare against the baseline.
        #[arg(long)]
        to: i64,
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON (has no effect without --json).
        #[arg(long)]
        pretty: bool,
    },
    /// Reconstruct the engineering-memory chain for the stored evidence
    /// (issue #100, wanyrix.chain/v1): scan → finding(s) → experiment(s) →
    /// measurement → verification verdict, joined READ-ONLY from the scan
    /// store (--db), the experiment ledger and the event log under --path.
    /// Evidence labels (estimated / measured / verified) are echoed VERBATIM
    /// — never upgraded, never downgraded. --finding/--scan scope the chain
    /// (mutually exclusive; unknown ids are named exit-2 refusals);
    /// orphaned links, corrupt ledger/event lines and inconsistent store
    /// rows are NAMED in the envelope, never silently dropped. No
    /// wall-clock: repeat queries over unchanged inputs are byte-identical.
    Chain {
        /// Workspace root: its measured name scopes the store join, and its
        /// .wanyrix ledger + event log are the ledger side of the chain.
        #[arg(long, default_value = ".")]
        path: PathBuf,
        /// SQLite scan store to join (wanyrix store init/save).
        #[arg(long)]
        db: PathBuf,
        /// Restrict the chain to this stored finding id.
        #[arg(long)]
        finding: Option<String>,
        /// Restrict the chain to this stored scan id (store list prints ids).
        #[arg(long)]
        scan: Option<i64>,
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON (has no effect without --json).
        #[arg(long)]
        pretty: bool,
    },
    /// Export the freshly measured doctor/graph/health envelopes as
    /// deterministic JSON artifacts (artifacts-as-code, wanyrix.export/v1):
    /// one file per envelope plus an index.json manifest binding each
    /// artifact to its exact bytes with a sha256 digest. No wall-clock
    /// timestamps and no absolute paths in any artifact — repeat exports of
    /// unchanged input are byte-identical, so teams can diff evidence in
    /// PRs. Unwritable targets and absolute paths are NAMED refusals.
    Export {
        /// Directory to scan (walked recursively for Cargo.toml manifests);
        /// must be RELATIVE so artifacts never embed absolute paths.
        #[arg(long, default_value = ".")]
        path: PathBuf,
        /// Output directory for the artifacts (created; RELATIVE to the
        /// launch directory). Defaults to <path>/.wanyrix/exports — the
        /// engine's own .wanyrix state-dir convention.
        #[arg(long)]
        out: Option<PathBuf>,
        /// Repeatable directory exclusion relative to --path (echoed in the
        /// manifest and the envelopes, never silent).
        #[arg(long = "exclude")]
        excludes: Vec<String>,
        /// Emit the manifest envelope instead of a human-readable summary.
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON (has no effect without --json; also applies
        /// to the artifact files so a fixed command re-runs byte-identical).
        #[arg(long)]
        pretty: bool,
    },
    /// Verify an ed25519-signed entitlement token OFFLINE and cache it under
    /// `.wanyrix/entitlement.json` (issue #94). Zero network I/O — the key
    /// argument is a token file path or the literal token JSON.
    Activate {
        /// Path to the signed token file, or the literal token JSON.
        #[arg(long)]
        key: String,
        /// Emit the entitlement envelope instead of a human-readable summary.
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON (has no effect without --json).
        #[arg(long)]
        pretty: bool,
    },
    /// Report the cached entitlement (wanyrix.entitlement/v1): plan, seats
    /// (measured on this machine), expiry, days-until-revalidation and the
    /// tier-gated surface registry. No license is an honest
    /// `not-activated` envelope — the free tier is never gated.
    Entitlement {
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON (has no effect without --json).
        #[arg(long)]
        pretty: bool,
    },
    /// Maintainer tooling: generate signing keypairs and mint signed
    /// entitlement tokens (offline; private keys are NEVER committed).
    License {
        #[command(subcommand)]
        cmd: LicenseCmd,
    },
    /// Serverless team sync over a git REGISTRY BRANCH (wanyrix.sync/v1,
    /// issue #92): a git branch IS the shared store. `push` commits the
    /// measured export bundle as EXACTLY ONE commit (byte-identical
    /// re-pushes are no-ops); `pull` merges the registry into the local
    /// mirror by (workspace id, finding id) + content hash — conflicts
    /// become NAMED findings, never silent overwrites, and evidence tiers
    /// never upgrade (peer `verified` claims import as
    /// `peer-reported-verified` until locally re-verified).
    Sync {
        #[command(subcommand)]
        cmd: SyncCmd,
    },
}

/// Subcommands for `wanyrix sync` (registry-branch team sync, no server).
#[derive(Subcommand)]
pub enum SyncCmd {
    /// Measure once and commit the wanyrix.export/v1 bundle to the remote's
    /// registry branch as EXACTLY ONE commit (deterministic message:
    /// workspace id + sha256 digest range; NO wall-clock anywhere). A
    /// byte-identical re-push creates ZERO commits (measured no-op).
    Push {
        /// Local path or git URL of the shared repository hosting the
        /// registry branch (local paths are the supported test surface).
        #[arg(long)]
        remote: String,
        /// The branch that IS the shared store.
        #[arg(long, default_value = "wanyrix-registry")]
        branch: String,
        /// Workspace to measure (RELATIVE; same contract as export).
        #[arg(long, default_value = ".")]
        path: PathBuf,
        /// Emit the wanyrix.sync/v1 envelope instead of a human summary.
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON (has no effect without --json).
        #[arg(long)]
        pretty: bool,
    },
    /// Fetch the registry branch and merge every workspace subtree into the
    /// local mirror (<path>/.wanyrix/sync/registry): peer-only findings are
    /// adopted (evidence tiers never upgrade), identical content is kept,
    /// differing content becomes a NAMED conflict finding — the local
    /// bytes are never silently overwritten.
    Pull {
        /// Local path or git URL of the shared repository hosting the
        /// registry branch (local paths are the supported test surface).
        #[arg(long)]
        remote: String,
        /// The branch that IS the shared store.
        #[arg(long, default_value = "wanyrix-registry")]
        branch: String,
        /// Workspace the local mirror lives under (RELATIVE; the mirror is
        /// <path>/.wanyrix/sync/registry — the engine's own state dir,
        /// invisible to measurement).
        #[arg(long, default_value = ".")]
        path: PathBuf,
        /// Emit the wanyrix.sync/v1 envelope instead of a human summary.
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON (has no effect without --json).
        #[arg(long)]
        pretty: bool,
    },
}

/// Subcommands for `wanyrix experiment` (local ledger, no network).
#[derive(Subcommand)]
pub enum ExperimentCmd {
    /// Append a hypothesis with status `estimated` (names are unique; the
    /// ledger never overwrites).
    Record {
        /// Unique experiment name.
        #[arg(long)]
        name: String,
        /// The claim this experiment is expected to verify.
        #[arg(long)]
        claim: String,
        /// Optional stored finding id this experiment investigates — the
        /// scan → finding → experiment link `wanyrix chain` joins (issue
        /// #100). Echoed verbatim, never validated here; a dangling link is
        /// NAMED by the chain query, never guessed.
        #[arg(long)]
        finding: Option<String>,
        #[arg(long, default_value = ".")]
        path: PathBuf,
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON (has no effect without --json).
        #[arg(long)]
        pretty: bool,
    },
    /// Run ONE real instrumented build and attach it as the role's
    /// measurement (baseline | candidate). Both roles ⇒ `measured`.
    Measure {
        #[arg(long)]
        name: String,
        /// baseline | candidate
        #[arg(long)]
        role: String,
        #[arg(long, default_value = ".")]
        path: PathBuf,
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON (has no effect without --json).
        #[arg(long)]
        pretty: bool,
    },
    /// Grant `verified` — only when baseline and candidate are real,
    /// successful measurements and the candidate is measurably faster.
    Verify {
        #[arg(long)]
        name: String,
        #[arg(long, default_value = ".")]
        path: PathBuf,
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON (has no effect without --json).
        #[arg(long)]
        pretty: bool,
    },
    /// Print the ledger in append order.
    List {
        #[arg(long, default_value = ".")]
        path: PathBuf,
        #[arg(long)]
        json: bool,
        /// Pretty-print the JSON (has no effect without --json).
        #[arg(long)]
        pretty: bool,
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
    /// --json` output). The source is the documented positional `-`
    /// (stdin) form — `wanyrix store save --db <db> -` — or the equivalent
    /// long form `--scan <path|->`.
    Save {
        #[arg(long)]
        db: PathBuf,
        /// Path to the scan JSON, or `-` for stdin (long form).
        #[arg(long)]
        scan: Option<String>,
        /// Positional scan source (the docs contract form: `-` reads
        /// stdin; a path reads that file). Exactly one of this and
        /// `--scan` must be given.
        #[arg(value_name = "SCAN")]
        scan_source: Option<String>,
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

/// Subcommands for `wanyrix daemon`.
#[derive(Subcommand)]
pub enum DaemonCmd {
    /// Bind the socket and serve requests until a `shutdown` request (or
    /// `--max-requests`) stops the loop. Refuses to steal a live socket.
    Start {
        /// Unix domain socket path (created with mode 0600).
        #[arg(long)]
        socket: PathBuf,
        /// Stop after serving N requests (0 = serve until shutdown).
        #[arg(long, default_value_t = 0)]
        max_requests: u64,
    },
    /// Send ONE request to a running daemon and print the response frame.
    /// Exit code 2 when the frame reports ok:false.
    Call {
        /// Unix domain socket the daemon is listening on.
        #[arg(long)]
        socket: PathBuf,
        /// status | doctor | graph | health | shutdown
        #[arg(long)]
        method: String,
        /// Workspace to analyze (doctor/graph/health only).
        #[arg(long, default_value = ".")]
        path: PathBuf,
        /// Pretty-print the response frame.
        #[arg(long)]
        pretty: bool,
    },
}

/// Subcommands for `wanyrix telemetry`.
#[derive(Subcommand)]
pub enum TelemetryCmd {
    /// Ingest a rustc/cargo JSON diagnostics stream (one JSON object per
    /// line) and emit the redacted report. The source is the documented
    /// positional `-` (stdin) form — `wanyrix telemetry ingest -` — or the
    /// equivalent long form `--input <path|->`.
    Ingest {
        /// Input file path, or `-` for stdin (long form).
        #[arg(long)]
        input: Option<String>,
        /// Positional input source (the docs contract form: `-` reads
        /// stdin; a path reads that file). Exactly one of this and
        /// `--input` must be given.
        #[arg(value_name = "INPUT")]
        input_source: Option<String>,
        /// Write the report here instead of stdout (parent dirs created).
        #[arg(long)]
        out: Option<PathBuf>,
        /// Keep full span file paths (basenames are the default; source
        /// snippets are dropped either way — this switch cannot restore them).
        #[arg(long)]
        keep_paths: bool,
        /// Emit aggregates only (omit the per-diagnostic array).
        #[arg(long)]
        summary_only: bool,
    },
}

/// Scan once — the single source of truth for every report.
pub fn scan(path: &std::path::Path) -> Result<WorkspaceScan, EngineError> {
    scan_workspace(path)
}

/// Scan with operator exclusions (`--exclude`, repeatable). Excluded
/// subtrees are pruned from the walk, counted in `skipped` and echoed on
/// the scan — never a silent drop.
pub fn scan_excluding(
    path: &std::path::Path,
    excludes: &[String],
) -> Result<WorkspaceScan, EngineError> {
    scan_workspace_excluding(path, excludes)
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

/// Resolve the stdin-shorthand duality (QA-4-B-3): docs/CLI.md documents
/// the positional forms (`store save -`, `telemetry ingest -`), while the
/// long forms (`--scan`/`--input`) are the pre-contract flags. Both are
/// accepted and mean the same thing; giving BOTH is a named refusal (the
/// ambiguity could silently change which bytes are consumed), and giving
/// NEITHER is a named refusal (never an empty guess).
fn resolve_input_source(
    kind: &str,
    flag: &str,
    flagged: Option<String>,
    positional: Option<String>,
) -> Result<String, String> {
    match (flagged, positional) {
        (Some(v), None) | (None, Some(v)) => Ok(v),
        (Some(_), Some(_)) => Err(format!(
            "pass the {kind} source either as {flag} <path|-> or as the positional <{kind}> argument — not both"
        )),
        (None, None) => Err(format!(
            "no {kind} source given — pass {flag} <path|-> or the positional <{kind}> (`-` reads stdin)"
        )),
    }
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
        StoreCmd::Save {
            db,
            scan,
            scan_source,
        } => {
            let source = resolve_input_source("scan", "--scan", scan, scan_source)
                .map_err(EngineError::Store)?;
            let payload = read_scan_payload(Path::new(&source))?;
            let outcome = store::save(&db, &payload)?;
            Ok(format!(
                "wanyrix store save — persisted scan {} ({})\n  findings rows written: {}\n  inventory rows written: {} (1 toolchain + {} crate snapshot(s), issue #115)\n  db: {} (journal_mode=wal)\n  commit order: scans row committed, then findings rows (two-phase — see src/store.rs; `store fsck` detects a kill between them), then the crate/toolchain inventory (a save killed before that third commit leaves the scan honestly labeled not-recorded by `wanyrix compare`)\n",
                outcome.scan_id,
                outcome.workspace,
                outcome.findings,
                outcome.inventory,
                outcome.inventory.saturating_sub(1),
                db.display()
            ))
        }
        StoreCmd::List { db, workspace } => {
            let rows = store::list(&db, workspace.as_deref())?;
            let mut out = String::new();
            match &workspace {
                Some(w) => out.push_str(&format!(
                    "wanyrix store list — {} scan(s) for workspace {w:?}\n",
                    rows.len()
                )),
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
            let mut out = format!(
                "wanyrix store fsck — {}{}\n",
                db.display(),
                if repair { " (--repair)" } else { "" }
            );
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
        std::fs::read_to_string(scan).map_err(|e| {
            EngineError::Store(format!("cannot read scan payload {}: {e}", scan.display()))
        })
    }
}

/// Run `wanyrix synth` and format its human output.
pub fn synth_run(crates: usize, out: &Path, seed: u64) -> Result<String, EngineError> {
    if crates == 0 {
        return Err(EngineError::Synth(
            "--crates must be at least 1 (a zero-crate workspace scans to nothing)".into(),
        ));
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

/// Run a `wanyrix daemon …` subcommand.
///
/// `start` blocks until the loop stops and prints the measured server
/// summary. `call` sends one request, prints the response frame, and
/// returns an error (exit 2) when the frame reports `ok:false` — scripts
/// get an honest exit code, never a green shell around a red payload.
pub fn daemon_run(cmd: DaemonCmd) -> Result<String, EngineError> {
    match cmd {
        DaemonCmd::Start {
            socket,
            max_requests,
        } => {
            let report = daemon::run_server(&socket, &daemon::ServerOptions { max_requests })?;
            Ok(daemon::human_server_summary(&report))
        }
        DaemonCmd::Call {
            socket,
            method,
            path,
            pretty,
        } => {
            let line = daemon::client_request_line(&method, Some(&path))?;
            let response = daemon::call(&socket, &line)?;
            let value: serde_json::Value = serde_json::from_str(&response).map_err(|e| {
                EngineError::Daemon(format!("daemon response is not valid JSON: {e}"))
            })?;
            let printed = if pretty {
                serde_json::to_string_pretty(&value)
                    .map_err(|e| EngineError::Json(e.to_string()))?
            } else {
                response
            };
            if value.get("ok").and_then(serde_json::Value::as_bool) == Some(true) {
                Ok(printed)
            } else {
                let err = value.get("error");
                let code = err
                    .and_then(|e| e.get("code"))
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("unknown");
                let message = err
                    .and_then(|e| e.get("message"))
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("no message");
                Err(EngineError::Daemon(format!(
                    "daemon responded ok=false [{code}]: {message}"
                )))
            }
        }
    }
}

/// Run a `wanyrix telemetry …` subcommand.
pub fn telemetry_run(cmd: TelemetryCmd) -> Result<String, EngineError> {
    match cmd {
        TelemetryCmd::Ingest {
            input,
            input_source,
            out,
            keep_paths,
            summary_only,
        } => {
            let source = resolve_input_source("input", "--input", input, input_source)
                .map_err(EngineError::Telemetry)?;
            let opts = telemetry::IngestOptions {
                keep_paths,
                summary_only,
            };
            telemetry::ingest_run(&source, out.as_deref(), &opts)
        }
    }
}

/// Run `wanyrix build` — the instrumented build-telemetry surface.
pub fn build_run(path: &Path, json: bool, pretty: bool) -> Result<String, EngineError> {
    let report = build::run_build(path, &BuildOptions::default())?;
    if json {
        serialize_json(&report, pretty)
    } else {
        Ok(build::human_summary(&report))
    }
}

/// Run `wanyrix init`.
pub fn product_init_run(
    path: &Path,
    db: Option<&Path>,
    json: bool,
    pretty: bool,
) -> Result<String, EngineError> {
    let r = product::init(path, db)?;
    if json {
        serialize_json(&r, pretty)
    } else {
        Ok(product::init_human(&r))
    }
}

/// Run `wanyrix status`.
pub fn product_status_run(
    path: &Path,
    db: Option<&Path>,
    socket: Option<&Path>,
    json: bool,
    pretty: bool,
) -> Result<String, EngineError> {
    let r = product::status(path, db, socket)?;
    if json {
        serialize_json(&r, pretty)
    } else {
        Ok(product::status_human(&r))
    }
}

/// Run `wanyrix analyze`.
pub fn product_analyze_run(
    path: &Path,
    excludes: &[String],
    json: bool,
    pretty: bool,
) -> Result<String, EngineError> {
    let scan = scan_excluding(path, excludes)?;
    let r = product::analyze_report(&scan)?;
    if json {
        serialize_json(&r, pretty)
    } else {
        let mut out = human_summary("analyze", &scan, &[]);
        out.push_str(&format!(
            "  doctor: {} findings | graph: {} nodes/{} edges | health: see `--json` (wanyrix.analyze/v1 embeds all three)\n",
            r.doctor.summary.total, r.graph.meta.served_nodes, r.graph.meta.served_edges,
        ));
        Ok(out)
    }
}

/// Run `wanyrix dependencies`.
pub fn product_dependencies_run(
    path: &Path,
    excludes: &[String],
    json: bool,
    pretty: bool,
) -> Result<String, EngineError> {
    let scan = scan_excluding(path, excludes)?;
    let g = build_graph(&scan);
    let r = product::dependencies_report(&scan, &g);
    if json {
        serialize_json(&r, pretty)
    } else {
        Ok(product::dependencies_human(&r))
    }
}

/// Run `wanyrix experiment <sub>`.
pub fn product_experiment_run(cmd: crate::cli::ExperimentCmd) -> Result<String, EngineError> {
    use crate::cli::ExperimentCmd;
    match cmd {
        ExperimentCmd::Record {
            name,
            claim,
            finding,
            path,
            json,
            pretty,
        } => {
            let rec = product::experiment_record(&path, &name, &claim, finding.as_deref())?;
            if json {
                serialize_json(&rec, pretty)
            } else {
                Ok(format!(
                    "recorded (estimated):\n{}",
                    product::experiment_human(&rec)
                ))
            }
        }
        ExperimentCmd::Measure {
            name,
            role,
            path,
            json,
            pretty,
        } => {
            let rec = product::experiment_measure(&path, &name, &role)?;
            if json {
                serialize_json(&rec, pretty)
            } else {
                Ok(format!(
                    "measured ({role}):\n{}",
                    product::experiment_human(&rec)
                ))
            }
        }
        ExperimentCmd::Verify {
            name,
            path,
            json,
            pretty,
        } => {
            let rec = product::experiment_verify(&path, &name)?;
            if json {
                serialize_json(&rec, pretty)
            } else {
                Ok(format!("verified:\n{}", product::experiment_human(&rec)))
            }
        }
        ExperimentCmd::List { path, json, pretty } => {
            let records = product::experiment_list(&path)?;
            if json {
                // The workspace name is only knowable via a scan; the ledger
                // lives under the scanned root, so derive it honestly —
                // `null` when the root is not a scannable workspace.
                let workspace = product::read_workspace_name(&path);
                let value = serde_json::json!({
                    "schema": product::EXPERIMENTS_SCHEMA,
                    "workspace": workspace,
                    "count": records.len(),
                    "experiments": records,
                    "generatedAt": iso8601_now(),
                });
                serialize_json(&value, pretty)
            } else if records.is_empty() {
                Ok(format!(
                    "wanyrix experiment list — 0 record(s) in {} (record one with `wanyrix experiment record --name … --claim …`)\n",
                    path.join(".wanyrix/experiments.jsonl").display()
                ))
            } else {
                let mut out = format!("wanyrix experiment list — {} record(s)\n", records.len());
                for r in &records {
                    out.push_str(&product::experiment_human(r));
                    out.push('\n');
                }
                Ok(out)
            }
        }
    }
}

/// Run `wanyrix events` — the durable event log, read-only.
pub fn events_run(path: &Path, json: bool, pretty: bool) -> Result<String, EngineError> {
    let log = crate::events::read_events(path)?;
    if json {
        let value = serde_json::json!({
            "schema": crate::events::EVENTS_SCHEMA,
            "count": log.events.len(),
            "corruptCount": log.corrupt.len(),
            "events": log.events,
            "corrupt": log.corrupt,
            "generatedAt": iso8601_now(),
        });
        serialize_json(&value, pretty)
    } else if log.events.is_empty() && log.corrupt.is_empty() {
        Ok(format!(
            "wanyrix events — 0 event(s) in {} (events appear as real ledger transitions happen: experiment record → measure → verify)\n",
            path.join(".wanyrix/events.jsonl").display()
        ))
    } else {
        let mut out = format!(
            "wanyrix events — {} event(s){}\n",
            log.events.len(),
            if log.corrupt.is_empty() {
                String::new()
            } else {
                format!(", {} corrupt line(s) named below", log.corrupt.len())
            }
        );
        out.push_str(&crate::events::events_human(&log));
        Ok(out)
    }
}

/// Run `wanyrix ai` — the local-AI explanation surface. The scan is real
/// and local; the ONLY network traffic is one loopback HTTP request carrying
/// the measured evidence digest to the user-chosen model server.
pub fn ai_run(
    path: &Path,
    question: &str,
    endpoint: Option<String>,
    model: Option<String>,
    timeout_secs: u64,
    json: bool,
    pretty: bool,
) -> Result<String, EngineError> {
    let report = crate::ai::ai_explain(
        path,
        question,
        endpoint,
        model,
        Duration::from_secs(timeout_secs),
    )?;
    if json {
        serialize_json(&report, pretty)
    } else {
        Ok(crate::ai::ai_human(&report))
    }
}

/// Run `wanyrix git` — measured repository facts, read-only, redacted by
/// design (paths and subjects only).
pub fn git_run(
    path: &Path,
    excludes: &[String],
    json: bool,
    pretty: bool,
) -> Result<String, EngineError> {
    let scan = scan_excluding(path, excludes)?;
    let report = crate::git::git_facts(&scan)?;
    if json {
        serialize_json(&report, pretty)
    } else {
        Ok(crate::git::git_human(&report))
    }
}

/// Run `wanyrix impact` — reverse-dependency blast radius derived only
/// from the measured edge list. Never an AI output; never a guess.
pub fn impact_run(
    crate_name: &str,
    path: &Path,
    excludes: &[String],
    json: bool,
    pretty: bool,
) -> Result<String, EngineError> {
    let scan = scan_excluding(path, excludes)?;
    let report = crate::change::impact_report(&scan, crate_name)?;
    if json {
        serialize_json(&report, pretty)
    } else {
        Ok(crate::change::impact_human(&report))
    }
}

/// Run `wanyrix what-changed` — fresh measured scan diffed against the
/// newest stored baseline for the same workspace.
pub fn what_changed_run(
    path: &Path,
    db: &Path,
    excludes: &[String],
    json: bool,
    pretty: bool,
) -> Result<String, EngineError> {
    let scan = scan_excluding(path, excludes)?;
    let findings = doctor(&scan);
    let report = crate::change::what_changed(&scan, &findings, db)?;
    if json {
        serialize_json(&report, pretty)
    } else {
        Ok(crate::change::what_changed_human(&report))
    }
}

/// Run `wanyrix compare` — the time-machine diff of two STORED scans
/// (issue #115). Both sides come from the store, so the output is fully
/// deterministic: no fresh scan, no wall-clock, byte-stable across runs.
pub fn compare_run(
    db: &Path,
    from: i64,
    to: i64,
    json: bool,
    pretty: bool,
) -> Result<String, EngineError> {
    let report = crate::compare::compare_scan_refs(db, from, to)?;
    if json {
        serialize_json(&report, pretty)
    } else {
        Ok(crate::compare::compare_human(&report))
    }
}

/// Run `wanyrix chain` — the engineering-memory chain query (issue #100).
/// Read-only: nothing is measured twice and nothing is written; the JSON
/// flavor is the versioned `wanyrix.chain/v1` envelope, the default flavor
/// is the pinned human tree.
pub fn chain_run(
    path: &Path,
    db: &Path,
    finding: Option<&str>,
    scan: Option<i64>,
    json: bool,
    pretty: bool,
) -> Result<String, EngineError> {
    let report = crate::chain::chain_report(path, db, finding, scan)?;
    if json {
        serialize_json(&report, pretty)
    } else {
        Ok(crate::chain::chain_human(&report))
    }
}

/// Run `wanyrix export` — artifacts-as-code: one measured pass (the same
/// pipeline as `analyze`, zero re-shaping drift) written verbatim as
/// clock-free, path-relative JSON artifacts plus a sha256-bound manifest
/// (wanyrix.export/v1). The manifest is the `--json` stdout payload.
pub fn product_export_run(
    path: &Path,
    out: Option<&Path>,
    excludes: &[String],
    json: bool,
    pretty: bool,
) -> Result<String, EngineError> {
    let (manifest, out_dir) = crate::export::export_run(path, out, excludes, pretty)?;
    if json {
        serialize_json(&manifest, pretty)
    } else {
        Ok(crate::export::export_human(&manifest, &out_dir))
    }
}

/// Run `wanyrix sync push|pull` — the registry-branch team sync surface.
pub fn sync_run(cmd: SyncCmd) -> Result<String, EngineError> {
    match cmd {
        SyncCmd::Push {
            remote,
            branch,
            path,
            json,
            pretty,
        } => {
            let r = crate::sync::sync_push(&path, &remote, &branch)?;
            if json {
                serialize_json(&r, pretty)
            } else {
                Ok(crate::sync::push_human(&r))
            }
        }
        SyncCmd::Pull {
            remote,
            branch,
            path,
            json,
            pretty,
        } => {
            let r = crate::sync::sync_pull(&path, &remote, &branch)?;
            if json {
                serialize_json(&r, pretty)
            } else {
                Ok(crate::sync::pull_human(&r))
            }
        }
    }
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
    if !scan.excludes.is_empty() {
        out.push_str(&format!(
            "excluded: {} (counted in skipped entries)\n",
            scan.excludes.join(", ")
        ));
    }
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
