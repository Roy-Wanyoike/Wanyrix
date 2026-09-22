//! Core data model: manifests, crates, edges, scan results, errors.
//!
//! Single source of truth rule (ENG-TCA-3, honored by the engine): ONE
//! [`WorkspaceScan`] (crate list + edge list) feeds doctor findings, the
//! dependency graph and the health KPIs. Graph aggregates are derived from
//! the served edge list — never hand-typed, no ghost nodes.

use std::path::PathBuf;

use crate::manifest::ManifestRecord;

/// A path dependency declared by a scanned crate, with its measured
/// resolution outcome. Covers BOTH successful intra-workspace edges and
/// failures; the graph edge list is derived from the resolved subset only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PathDepRecord {
    /// Crate declaring the dependency.
    pub from: String,
    /// Dependency table key as written in the manifest.
    pub dep: String,
    /// Dependency section (normal / dev / build).
    pub kind: EdgeKind,
    /// The literal `path = "…"` value as written.
    pub rel_path: String,
    /// Resolved target crate's package name when the target is a scanned
    /// crate; `None` otherwise (broken or escaped — see `escaped`).
    pub resolved_to: Option<String>,
    /// Measured: does the effective dependency entry carry a `version`
    /// (required for a future crates.io publish)?
    pub has_version: bool,
    /// true = target manifest exists but is outside the analyzed crate set
    /// (escaped the scanned root or failed to parse); false = broken path.
    pub escaped: bool,
}

/// A dependency edge between two workspace crates.
///
/// Direction convention matches the web contract (`src/lib/wanyrix/types.ts`,
/// `GraphEdge`): `from` = dependent (the crate declaring the dependency),
/// `to` = dependency (the declared target).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Edge {
    pub from: String,
    pub to: String,
    pub kind: EdgeKind,
}

/// How a workspace-to-workspace edge was declared.
///
/// Cycles made purely of `Dev` edges are legal in Cargo (test-only) and are
/// reported as `info`; any cycle containing a `Normal` or `Build` edge is a
/// hard build error and is reported as `critical`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum EdgeKind {
    Normal,
    Dev,
    Build,
}

impl EdgeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            EdgeKind::Normal => "normal",
            EdgeKind::Dev => "dev",
            EdgeKind::Build => "build",
        }
    }
}

/// Node band per the web contract `GraphBand`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Band {
    Bin,
    Lib,
}

impl Band {
    pub fn as_str(self) -> &'static str {
        match self {
            Band::Bin => "bin",
            Band::Lib => "lib",
        }
    }
}

/// Node kind per the web contract `GraphNode.kind` (workspace | proc-macro).
/// Engine v1 only emits nodes measured from the scanned manifests, so the
/// `external` kind can never occur here (external crates are not nodes).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeKind {
    Workspace,
    ProcMacro,
}

impl NodeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            NodeKind::Workspace => "workspace",
            NodeKind::ProcMacro => "proc-macro",
        }
    }
}

/// One crate discovered by the filesystem scan.
#[derive(Debug, Clone)]
pub struct CrateInfo {
    /// `[package] name` — the graph node id.
    pub name: String,
    /// `[package] version`, or `"inherited"` when resolved from
    /// `[workspace.package]`, or `"unknown"` when absent/unresolvable.
    pub version: String,
    /// Manifest path relative to the scan root, forward slashes.
    pub manifest_path: String,
    /// Crate root directory relative to the scan root, forward slashes.
    pub crate_root: String,
    pub band: Band,
    pub kind: NodeKind,
    /// Measured manifest metadata (present = key exists after inheritance
    /// resolution; absent = key missing — the basis for FER-ENG-001/002).
    pub license: Option<String>,
    pub description: Option<String>,
}

/// Result of walking a directory tree and parsing every `Cargo.toml`.
#[derive(Debug, Clone)]
pub struct WorkspaceScan {
    /// Canonical absolute scan root (echoed in every report).
    pub root: PathBuf,
    /// Workspace display name: root `[package] name` if the root manifest is
    /// a package, otherwise the root directory name.
    pub workspace_name: String,
    /// Toolchain channel measured from `rust-toolchain.toml` at the scan
    /// root, or `"unspecified (no rust-toolchain.toml)"`.
    pub toolchain: String,
    /// All crates discovered under the root, sorted by name.
    pub crates: Vec<CrateInfo>,
    /// Intra-workspace path-dependency edges (endpoints are scanned crates),
    /// sorted by (from, to, kind) and deduped. This is THE edge list
    /// everything else derives from — graph, findings and health all read
    /// this one list; nothing else may invent edges.
    pub edges: Vec<Edge>,
    /// Every manifest found under the root, including parse failures and
    /// virtual `[workspace]`-only manifests (needed by the analysis pass).
    pub manifests: Vec<ManifestRecord>,
    /// Every path-dependency declaration with its measured resolution
    /// (resolved intra-workspace, broken, or escaped the analyzed set).
    pub path_deps: Vec<PathDepRecord>,
    /// Manifests found (parsed or not).
    pub manifests_found: usize,
    /// Manifests that failed to parse (each produced a FER-ENG-ERR finding
    /// upstream; they are not crates and not graph nodes).
    pub parse_failures: usize,
    /// Directories/files skipped during the walk (target/, .git, hidden).
    /// The engine's OWN `.wanyrix` state dir is invisible to measurement:
    /// it is never walked and never counted, so the tool's own artifacts
    /// (store, ledger, exports) cannot perturb a re-measurement (issue #91
    /// byte-identical re-export). Everything else the walk refuses is
    /// counted — never a silent drop.
    pub skipped: usize,
    /// Normalized operator-requested directory exclusions (`--exclude`),
    /// relative to the scan root, sorted and deduped. Empty for a default
    /// scan — exclusion is always echoed, never a silent drop.
    pub excludes: Vec<String>,
}

impl WorkspaceScan {
    /// Crate names in sorted order (test convenience).
    #[cfg(test)]
    pub(crate) fn crate_names(&self) -> impl Iterator<Item = &str> {
        self.crates.iter().map(|c| c.name.as_str())
    }
}

/// Engine error surfaced to the CLI (exit code 2). Everything else — bad
/// manifests, broken deps — is reported as FINDINGS, never as a crash.
#[derive(Debug)]
pub enum EngineError {
    /// The `--path` argument does not exist or is not a directory.
    PathNotFound(PathBuf),
    /// The directory was walked but contains no `Cargo.toml` at all.
    NoManifests(PathBuf),
    /// An I/O error while reading the scan root itself.
    Io(std::io::Error),
    /// JSON serialization of a report failed. Unreachable for the current
    /// envelope types (no non-string keys, no floats), but handled honestly
    /// instead of panicking or silently emitting `{}`.
    Json(String),
    /// The local SQLite scan store rejected an operation: a malformed or
    /// self-inconsistent doctor payload, or a storage I/O error. The
    /// rusqlite message is preserved verbatim — never swallowed.
    Store(String),
    /// The synthetic-workspace generator was asked for something outside
    /// its documented operating range (e.g. a crate count above the cap).
    Synth(String),
    /// The local analysis daemon could not bind/connect/serve, or a
    /// `daemon call` got an `ok:false` response. The transport detail is
    /// preserved verbatim — never swallowed.
    Daemon(String),
    /// Telemetry ingestion rejected an operation (unreadable input/output
    /// path). Malformed diagnostic LINES are never an error — they are
    /// counted in the report (`meta.summary.malformedLines`).
    Telemetry(String),
    /// The instrumented build (`wanyrix build`) could not be STARTED: the
    /// scan path is missing (see `PathNotFound`) or the cargo executable was
    /// not found / could not spawn. A build that RAN but failed is never
    /// this — it is data in the envelope (`buildSuccess: false`).
    Build(String),
    /// The local experiment ledger rejected an operation: duplicate or
    /// unknown name, an incomplete/unsuccessful measurement, or a verify
    /// attempt without a real measured improvement (the honesty gate).
    Experiment(String),
    /// The local-AI surface failed: endpoint unreachable/timeout, HTTP error
    /// status, malformed model reply, or endpoint address could not be parsed.
    /// The transport detail is preserved verbatim — never swallowed.
    Ai(String),
    /// Git facts could not be measured: not a repository, unborn HEAD,
    /// missing git binary, or a git command failed. The detail is preserved
    /// verbatim — never swallowed, never replaced by fabricated facts.
    Git(String),
    /// The impact surface refused: the requested crate is not a workspace
    /// crate under the scan root (the verify-ledger refusal pattern).
    Impact(String),
    /// An operator-supplied `--exclude` value was rejected: absolute path,
    /// `..` traversal, `.`, or an empty/whitespace value. Exclusions are
    /// operator input and are validated like every other path input.
    InvalidExclude(String),
    /// The export surface (artifacts-as-code, issue #91) refused: an
    /// absolute `--path`/`--out` (artifacts must never embed absolute
    /// paths), an `<out>` that exists as a FILE, or an unwritable target.
    /// Named refusals only — export never silently rewrites an operator
    /// path, and the transport detail is preserved verbatim.
    Export(String),
    /// The entitlement surface (issue #94) refused: a malformed, tampered,
    /// expired-beyond-grace or unreadable license state. The precise reason
    /// is preserved verbatim — a tampered token is a named signature
    /// refusal, never a silent pass.
    Entitlement(String),
    /// A PREMIUM surface was refused because no qualifying entitlement is
    /// activated (no license, deleted cache, or a plan below the tier the
    /// surface requires — see `engine/src/entitlement.rs`'s registry).
    /// Core measured surfaces are never gated (docs/COMMERCIAL.md rule #1);
    /// this error exists only for registered premium surfaces.
    SubscriptionRequired {
        /// The premium surface that was refused (e.g. `sync.push`).
        surface: String,
        /// The minimum plan the surface requires (e.g. `team`).
        plan_required: String,
    },
    /// The sync surface (registry-branch team sync, issue #92) could not
    /// reach the remote at all: the path does not exist, the target is not
    /// a git repository, the clone/transport failed, or the registry push
    /// was refused by the remote. The git transport detail is preserved
    /// verbatim — never swallowed, never retried silently.
    SyncRemoteUnavailable(String),
    /// The registry branch is missing on the remote (pull before any
    /// push), or a branch-level git operation refused. Remediation is
    /// always stated: run `wanyrix sync push` first.
    SyncBranch(String),
    /// The sync merge REFUSED because the evidence to merge is
    /// self-inconsistent: registry content violates its own `index.json`
    /// sha256 digest binding (tampered/corrupt), or a peer envelope is
    /// malformed (missing `measurementStatus`, findings not an array).
    /// CONTENT conflicts between peers are NOT this — they are named
    /// findings in the `wanyrix.sync/v1` envelope (local content kept,
    /// never silently overwritten).
    SyncConflict(String),
    /// The sync surface refused an operator input: an absolute `--path`
    /// (sync artifacts and workspace ids must be machine-independent, the
    /// export relative-paths-only contract), or an empty remote value.
    Sync(String),
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EngineError::PathNotFound(p) => {
                write!(
                    f,
                    "scan path does not exist or is not a directory: {}",
                    p.display()
                )
            }
            EngineError::NoManifests(p) => {
                write!(f, "no Cargo.toml manifests found under: {}", p.display())
            }
            EngineError::Io(e) => write!(f, "filesystem error: {e}"),
            EngineError::Json(e) => write!(f, "report serialization error: {e}"),
            EngineError::Store(e) => write!(f, "scan store error: {e}"),
            EngineError::Synth(e) => write!(f, "synthetic workspace error: {e}"),
            EngineError::Daemon(e) => write!(f, "daemon error: {e}"),
            EngineError::Telemetry(e) => write!(f, "telemetry error: {e}"),
            EngineError::Build(e) => write!(f, "build telemetry error: {e}"),
            EngineError::Experiment(e) => write!(f, "experiment ledger error: {e}"),
            EngineError::Ai(e) => write!(f, "local AI error: {e}"),
            EngineError::Git(e) => write!(f, "git error: {e}"),
            EngineError::Impact(e) => write!(f, "impact error: {e}"),
            EngineError::InvalidExclude(e) => write!(f, "invalid --exclude value: {e}"),
            EngineError::Export(e) => write!(f, "export error: {e}"),
            EngineError::Entitlement(e) => write!(f, "entitlement error: {e}"),
            EngineError::SubscriptionRequired {
                surface,
                plan_required,
            } => write!(
                f,
                "surface '{surface}' requires the {plan_required} plan — no qualifying entitlement is activated (activate with: wanyrix activate --key <token>; core local surfaces are never gated — docs/COMMERCIAL.md rule #1)"
            ),
            EngineError::SyncRemoteUnavailable(e) => write!(f, "sync remote unavailable: {e}"),
            EngineError::SyncBranch(e) => write!(f, "sync registry branch unavailable: {e}"),
            EngineError::SyncConflict(e) => write!(f, "sync conflict: {e}"),
            EngineError::Sync(e) => write!(f, "sync error: {e}"),
        }
    }
}

impl std::error::Error for EngineError {}
