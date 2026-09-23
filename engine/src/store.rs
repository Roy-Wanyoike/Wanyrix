//! SQLite persistence for doctor scans (engine phase-2, GitHub issue #58).
//!
//! # Storage honesty contract
//!
//! 1. The store persists exactly what `wanyrix doctor --json` measured. It
//!    never computes, estimates, or enriches findings; a stored scan is a
//!    byte-faithful projection of the payload's own summary (cross-checked
//!    against its findings array before anything is written — a
//!    self-inconsistent payload is rejected, not "fixed").
//! 2. `wanyrix.doctor/v1` carries ONE measured instant (`generatedAt`, the
//!    scan-completion time). The engine measures no scan *duration*, so
//!    `started_at` mirrors `finished_at` (both = the payload's
//!    `generatedAt` parsed to an integer epoch). We do not invent a start
//!    time or a duration — when a future phase measures real scan bounds,
//!    the columns are ready for them.
//! 3. All timestamps are integer Unix epochs (seconds). The store's own
//!    layout version is pinned in [`STORE_SCHEMA_VERSION`] and recorded in
//!    the database header (`PRAGMA user_version`) so a future migration
//!    can detect an older file honestly instead of guessing.
//! 4. WAL journal mode (`PRAGMA journal_mode=wal`, `synchronous=NORMAL`):
//!    committed data survives an abrupt process kill; the WAL is replayed
//!    (or checkpointed) on the next open. Verified by
//!    `tests/store_recovery.rs`.
//!
//! # Two-phase commit (deliberate, testable crash seam)
//!
//! `save` commits the `scans` row and the `findings` rows in TWO separate
//! transactions — scan row first, findings second. A single transaction
//! would make partial states impossible, which is exactly why the seam is
//! kept: an abrupt kill between the two commits leaves a *detectable*
//! orphan (a scan whose findings row set is missing), and
//! [`fsck`] reports it (and can repair it). The commit order is the
//! designed behavior required by issue #58's acceptance test (b); both
//! crash states are reproduced in tests by dropping the connection with
//! the second transaction uncommitted.
//!
//! # Crate/toolchain inventory (issue #115)
//!
//! Besides findings, `save` records a per-scan CRATE INVENTORY (name,
//! version, band, node kind, manifest path) and the measured toolchain
//! string — the identity fields the doctor payload carries, stored so
//! `wanyrix compare` can diff two stored scans beyond findings. The
//! inventory is written in a THIRD commit after the findings rows; a scan
//! saved by an older engine (or whose save was killed before the third
//! commit) simply has NO inventory rows — reads report that honestly as
//! "not recorded" (never fabricated), and `wanyrix store fsck --repair`
//! cleans inventory rows left orphaned by external tools.
//!
//! # Layout
//!
//! - [`init`] — create the schema (idempotent)
//! - [`save`] / [`save_scan_row`] / [`save_findings_rows`] — persistence
//!   (the two `save_*_row` halves are the public crash seam used by tests)
//! - [`save_inventory`] — the third commit: crate + toolchain snapshot
//! - [`list`] — scan summaries, newest last
//! - [`crates_for`] / [`toolchain_for`] — per-scan inventory reads
//! - [`fsck`] — report (and optionally repair) partial/orphaned writes
//!
//! The `findings.scan_id` foreign key is enforced on every connection the
//! store opens (`PRAGMA foreign_keys=ON`), so a dangling findings row
//! cannot be written through this module; the fsck orphan-findings check
//! stays as defense-in-depth for databases touched by other tools. The
//! inventory tables carry the same enforced foreign key.

use std::path::Path;

use rusqlite::{Connection, OptionalExtension};

use crate::model::EngineError;
use crate::timestamp::{iso8601_from_unix, unix_from_iso8601};

/// Version of the STORE's own table layout (not the doctor payload schema).
/// Recorded as `PRAGMA user_version`; bumped only by a migration that
/// keeps every committed scan readable or explicitly re-verifiable.
pub const STORE_SCHEMA_VERSION: i64 = 1;

/// The only payload flavor the store accepts. Anything else is rejected —
/// the store documents what it holds, it does not guess.
pub const ACCEPTED_PAYLOAD_SCHEMA: &str = "wanyrix.doctor/v1";

const DDL: [&str; 5] = [
    "CREATE TABLE IF NOT EXISTS scans (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace        TEXT    NOT NULL,
        started_at       INTEGER NOT NULL,
        finished_at      INTEGER NOT NULL,
        finding_count    INTEGER NOT NULL,
        severity_critical INTEGER NOT NULL,
        severity_warning INTEGER NOT NULL,
        severity_info    INTEGER NOT NULL,
        schema_version   INTEGER NOT NULL
    )",
    "CREATE TABLE IF NOT EXISTS findings (
        scan_id       INTEGER NOT NULL REFERENCES scans(id),
        finding_id    TEXT    NOT NULL,
        severity      TEXT    NOT NULL,
        title         TEXT    NOT NULL,
        evidence_json TEXT    NOT NULL
    )",
    // speed + deterministic ordering for per-scan reads; the FK itself is
    // deliberately un-enforced (see module docs)
    "CREATE INDEX IF NOT EXISTS idx_findings_scan_id ON findings(scan_id)",
    // Crate inventory per scan (issue #115): the identity fields of every
    // measured crate, stored verbatim so two stored scans can be diffed.
    "CREATE TABLE IF NOT EXISTS scan_crates (
        scan_id       INTEGER NOT NULL REFERENCES scans(id),
        name          TEXT    NOT NULL,
        version       TEXT    NOT NULL,
        band          TEXT    NOT NULL,
        node_kind     TEXT    NOT NULL,
        manifest_path TEXT    NOT NULL
    )",
    // The measured toolchain string of the scan (one row per scan).
    "CREATE TABLE IF NOT EXISTS scan_toolchain (
        scan_id   INTEGER NOT NULL REFERENCES scans(id),
        toolchain TEXT    NOT NULL
    )",
];

/// What one `store save` wrote (reported honestly, in commit order).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SaveOutcome {
    /// Row id of the committed `scans` row.
    pub scan_id: i64,
    /// Findings rows committed for that scan (== the payload's summary
    /// total; enforced before writing).
    pub findings: usize,
    /// Inventory rows committed for that scan (1 toolchain row + one row
    /// per measured crate) — the third commit.
    pub inventory: usize,
    /// Workspace name as measured by the doctor scan.
    pub workspace: String,
}

/// One row of `store list` output.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanRow {
    pub id: i64,
    pub workspace: String,
    /// Integer epoch (seconds) — the payload's measured `generatedAt`.
    pub finished_at: i64,
    pub finding_count: i64,
    pub severity_critical: i64,
    pub severity_warning: i64,
    pub severity_info: i64,
    pub schema_version: i64,
}

impl ScanRow {
    /// Human row matching the `store list` header column widths.
    /// Deterministic; the date renders from the stored epoch.
    pub fn line(&self) -> String {
        format!(
            "{:>4}  {:<16} {:<20} {:>8}  {:>4}  {:>4}  {:>4}  {:>6}",
            self.id,
            self.workspace,
            iso8601_from_unix(self.finished_at.max(0) as u64),
            self.finding_count,
            self.severity_critical,
            self.severity_warning,
            self.severity_info,
            format!("v{}", self.schema_version),
        )
    }
}

/// Integrity report from [`fsck`]. Every list holds the offending scan ids
/// (or rowids) — empty lists on a healthy store.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FsckReport {
    pub scans_checked: usize,
    pub findings_rows: usize,
    /// Scans whose findings row set is missing or incomplete
    /// (0 ≤ rows < finding_count): `(id, finding_count, actual_rows)`.
    /// This is exactly the state a kill between the two save commits leaves.
    pub incomplete_scans: Vec<(i64, i64, i64)>,
    /// Scans whose stored finding_count disagrees with the actual row count
    /// in the other direction (rows > finding_count) — untrustworthy.
    pub count_mismatches: Vec<(i64, i64, i64)>,
    /// Findings rows whose scan_id has no scans row (dangling children).
    pub orphan_findings: Vec<i64>,
    /// Scan ids that still have crate/toolchain inventory rows but no
    /// scans row (dangling inventory, issue #115 — same defense-in-depth
    /// class as `orphan_findings`, reported sorted and deduped).
    pub orphan_inventory: Vec<i64>,
    /// When `repair` ran: scans rows deleted (incomplete/mismatched).
    pub removed_scans: usize,
    /// When `repair` ran: findings rows deleted (orphans + partial sets).
    pub removed_findings: usize,
    /// When `repair` ran: inventory rows deleted (doomed scans' snapshots
    /// + orphaned inventory).
    pub removed_inventory: usize,
}

impl FsckReport {
    pub fn healthy(&self) -> bool {
        self.incomplete_scans.is_empty()
            && self.count_mismatches.is_empty()
            && self.orphan_findings.is_empty()
            && self.orphan_inventory.is_empty()
    }

    /// Deterministic human summary (one line per problem class, plus the
    /// honest all-clear line).
    pub fn summary(&self) -> String {
        let mut out = String::new();
        out.push_str(&format!(
            "fsck: {} scans checked, {} findings rows\n",
            self.scans_checked, self.findings_rows
        ));
        out.push_str(&format!(
            "  incomplete scans (missing findings rows): {}\n",
            self.incomplete_scans.len()
        ));
        for (id, stored, actual) in &self.incomplete_scans {
            out.push_str(&format!(
                "    scan {id}: committed without its full findings row set (finding_count={stored}, findings rows={actual})\n"
            ));
        }
        out.push_str(&format!(
            "  count mismatches: {}\n",
            self.count_mismatches.len()
        ));
        for (id, stored, actual) in &self.count_mismatches {
            out.push_str(&format!(
                "    scan {id}: finding_count={stored} but {actual} findings rows exist\n"
            ));
        }
        out.push_str(&format!(
            "  orphan findings rows: {}\n",
            self.orphan_findings.len()
        ));
        for id in &self.orphan_findings {
            out.push_str(&format!(
                "    finding row {id}: references a scan that does not exist\n"
            ));
        }
        out.push_str(&format!(
            "  orphan inventory rows (crate/toolchain snapshots of missing scans): {}\n",
            self.orphan_inventory.len()
        ));
        for id in &self.orphan_inventory {
            out.push_str(&format!(
                "    scan {id}: inventory rows reference a scan that does not exist\n"
            ));
        }
        if self.removed_scans > 0 || self.removed_findings > 0 || self.removed_inventory > 0 {
            out.push_str(&format!(
                "  repaired: removed {} scan rows, {} findings rows and {} inventory rows\n",
                self.removed_scans, self.removed_findings, self.removed_inventory
            ));
        }
        if self.healthy()
            && self.removed_scans == 0
            && self.removed_findings == 0
            && self.removed_inventory == 0
        {
            out.push_str("  store consistent — every scan has its complete findings row set\n");
        }
        out
    }
}

// ---------------------------------------------------------------- errors

fn store_err<E: std::fmt::Display>(e: E) -> EngineError {
    EngineError::Store(e.to_string())
}

// ------------------------------------------------------------- open/init

/// Open (creating the file if absent), switch to WAL, and apply the schema.
/// Idempotent: safe to run against an initialized store.
pub fn init(db_path: &Path) -> Result<(), EngineError> {
    let conn = open_wal(db_path)?;
    for stmt in DDL {
        conn.execute_batch(stmt).map_err(store_err)?;
    }
    // Record the store layout version in the DB header. pragma_update is
    // fine here (user_version set returns no rows).
    conn.pragma_update(None, "user_version", STORE_SCHEMA_VERSION)
        .map_err(store_err)?;
    Ok(())
}

/// Open an existing store read/write. Fails honestly when the file was
/// never initialized (missing `scans` table) — no silent empty results.
pub fn open_existing(db_path: &Path) -> Result<Connection, EngineError> {
    if !db_path.is_file() {
        return Err(EngineError::Store(format!(
            "store not found at {} — run `wanyrix store init --db <path>` first",
            db_path.display()
        )));
    }
    let conn = open_wal(db_path)?;
    let tables: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('scans','findings')",
            [],
            |r| r.get(0),
        )
        .map_err(store_err)?;
    if tables < 2 {
        return Err(EngineError::Store(format!(
            "{} is not a wanyrix scan store (schema missing) — run `wanyrix store init`",
            db_path.display()
        )));
    }
    Ok(conn)
}

/// Open + WAL + pragmas. Shared by init and open_existing.
fn open_wal(db_path: &Path) -> Result<Connection, EngineError> {
    if let Some(parent) = db_path.parent() {
        // A --db path under a not-yet-existing directory is a user typo in
        // most cases, but creating the parent is the least surprising
        // behavior for nested paths like /var/lib/wanyrix/scans.db.
        std::fs::create_dir_all(parent).map_err(store_err)?;
    }
    let conn = Connection::open(db_path).map_err(store_err)?;
    // WAL is persistent (stored in the DB header) — set on every open so a
    // pre-WAL file is migrated, and read back to verify honestly.
    let mode: String = conn
        .query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0))
        .map_err(store_err)?;
    if mode != "wal" {
        return Err(EngineError::Store(format!(
            "could not enable WAL journal mode (got \"{mode}\") — refusing to run without the crash-recovery guarantees"
        )));
    }
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(store_err)?;
    // Referential integrity enforced: a findings row cannot reference a
    // scan that does not exist. fsck's orphan-findings check remains as
    // defense-in-depth for databases written by tools that did not
    // enforce the constraint (older writers, manual edits).
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(store_err)?;
    conn.busy_timeout(std::time::Duration::from_millis(5_000))
        .map_err(store_err)?;
    Ok(conn)
}

// ----------------------------------------------------------------- save

/// Parse a doctor payload (`Value`) into its measured scan-row fields.
/// Every field is cross-checked; nothing defaults silently.
fn payload_fields(payload: &serde_json::Value) -> Result<PayloadScan, EngineError> {
    let schema = payload["schema"].as_str().unwrap_or_default();
    if schema != ACCEPTED_PAYLOAD_SCHEMA {
        return Err(EngineError::Store(format!(
            "payload schema is {:?}, but the store only accepts {ACCEPTED_PAYLOAD_SCHEMA} (the exact `wanyrix doctor --json` output)",
            payload["schema"].to_string()
        )));
    }
    let workspace = payload["workspace"]
        .as_str()
        .ok_or_else(|| EngineError::Store("payload has no string `workspace` field".into()))?;
    let generated_at = payload["generatedAt"]
        .as_str()
        .ok_or_else(|| EngineError::Store("payload has no string `generatedAt` field".into()))?;
    // The single measured instant, parsed to an integer epoch. Both bound
    // columns store it (see module docs — no duration is invented).
    let finished_at = unix_from_iso8601(generated_at).map_err(EngineError::Store)? as i64;
    let summary = &payload["summary"];
    let get_count = |key: &str| -> Result<i64, EngineError> {
        summary[key]
            .as_u64()
            .map(|v| v as i64)
            .ok_or_else(|| EngineError::Store(format!("payload summary has no numeric `{key}`")))
    };
    let (crit, warn, info, total) = (
        get_count("critical")?,
        get_count("warning")?,
        get_count("info")?,
        get_count("total")?,
    );
    let findings = payload["findings"]
        .as_array()
        .ok_or_else(|| EngineError::Store("payload has no `findings` array".into()))?;
    // Honesty cross-check: refuse to persist a self-inconsistent payload.
    if findings.len() as i64 != total {
        return Err(EngineError::Store(format!(
            "payload is self-inconsistent: summary.total={total} but {} findings are present",
            findings.len()
        )));
    }
    let derived_total = crit + warn + info;
    if derived_total != total {
        return Err(EngineError::Store(format!(
            "payload is self-inconsistent: severity counts sum to {derived_total}, summary.total={total}"
        )));
    }
    let mut rows = Vec::with_capacity(findings.len());
    for f in findings {
        let id = f["id"]
            .as_str()
            .ok_or_else(|| EngineError::Store("a finding has no string `id`".into()))?;
        let severity = f["severity"]
            .as_str()
            .ok_or_else(|| EngineError::Store(format!("finding {id} has no string `severity`")))?;
        let title = f["title"]
            .as_str()
            .ok_or_else(|| EngineError::Store(format!("finding {id} has no string `title`")))?;
        // The evidence array is stored exactly as the payload carried it
        // (verbatim JSON, round-trippable — never re-typed).
        let evidence_json = serde_json::to_string(&f["evidence"]).map_err(store_err)?;
        rows.push(FindingRow {
            finding_id: id.to_owned(),
            severity: severity.to_owned(),
            title: title.to_owned(),
            evidence_json,
        });
    }
    // Crate inventory (issue #115): name + version are the diff keys and
    // are REQUIRED (a doctor payload whose crates lack them is not an
    // honest doctor payload); the display fields default to "" when an
    // exotic payload omits them — they are never diff keys, so nothing is
    // silently invented.
    let crates_json = payload["crates"]
        .as_array()
        .ok_or_else(|| EngineError::Store("payload has no `crates` array".into()))?;
    let mut crates = Vec::with_capacity(crates_json.len());
    for c in crates_json {
        let name = c["name"]
            .as_str()
            .ok_or_else(|| EngineError::Store("a crate has no string `name`".into()))?;
        let version = c["version"]
            .as_str()
            .ok_or_else(|| EngineError::Store(format!("crate {name} has no string `version`")))?;
        crates.push(CrateSnapshot {
            name: name.to_owned(),
            version: version.to_owned(),
            band: c["band"].as_str().unwrap_or_default().to_owned(),
            node_kind: c["kind"].as_str().unwrap_or_default().to_owned(),
            manifest_path: c["manifestPath"].as_str().unwrap_or_default().to_owned(),
        });
    }
    let toolchain = payload["toolchain"]
        .as_str()
        .ok_or_else(|| EngineError::Store("payload has no string `toolchain` field".into()))?;
    Ok(PayloadScan {
        workspace: workspace.to_owned(),
        finished_at,
        toolchain: toolchain.to_owned(),
        critical: crit,
        warning: warn,
        info,
        total,
        findings: rows,
        crates,
    })
}

/// Persist one doctor-scan payload: scan row committed FIRST, then the
/// findings rows, then the crate/toolchain inventory (three transactions —
/// see the module docs for why the seams are deliberate).
pub fn save(db_path: &Path, payload_text: &str) -> Result<SaveOutcome, EngineError> {
    let scan = parse_payload(payload_text)?;
    let scan_id = save_scan_row(db_path, &scan)?;
    let n = save_findings_rows(db_path, scan_id, &scan.findings)?;
    let inventory = save_inventory(db_path, scan_id, &scan)?;
    Ok(SaveOutcome {
        scan_id,
        findings: n,
        inventory,
        workspace: scan.workspace,
    })
}

/// Parse + validate a doctor payload into its measured scan-row fields.
/// Public because it is half of the crash-simulation seam: tests call
/// [`parse_payload`] → [`save_scan_row`] → (drop connection) →
/// [`save_findings_rows`] to reproduce the kill-between-commits state
/// that [`fsck`] must detect.
pub fn parse_payload(payload_text: &str) -> Result<PayloadScan, EngineError> {
    let payload: serde_json::Value = serde_json::from_str(payload_text)
        .map_err(|e| EngineError::Store(format!("payload is not valid JSON: {e}")))?;
    payload_fields(&payload)
}

/// The measured fields of one doctor payload, validated and ready to
/// persist (see [`parse_payload`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PayloadScan {
    pub workspace: String,
    /// Integer epoch (seconds) — the payload's `generatedAt`.
    pub finished_at: i64,
    /// The payload's measured `toolchain` string (never empty for a
    /// conformant doctor payload — absence is a named rejection).
    pub toolchain: String,
    pub critical: i64,
    pub warning: i64,
    pub info: i64,
    pub total: i64,
    pub findings: Vec<FindingRow>,
    /// The measured crate inventory (issue #115) — identity fields only,
    /// verbatim from the payload's `crates` array.
    pub crates: Vec<CrateSnapshot>,
}

/// One finding row to persist (evidence kept verbatim as JSON text).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FindingRow {
    pub finding_id: String,
    pub severity: String,
    pub title: String,
    pub evidence_json: String,
}

/// One crate-inventory row to persist / read back (issue #115): the
/// identity fields of a measured crate, verbatim from the payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CrateSnapshot {
    pub name: String,
    pub version: String,
    pub band: String,
    pub node_kind: String,
    pub manifest_path: String,
}

/// Commit ONLY the `scans` row. This is the first half of [`save`] and the
/// public crash-simulation seam for issue #58's acceptance tests: calling
/// it and then dropping the connection reproduces "killed between the two
/// commits" exactly.
pub fn save_scan_row(db_path: &Path, scan: &PayloadScan) -> Result<i64, EngineError> {
    let conn = open_existing(db_path)?;
    conn.execute(
        "INSERT INTO scans (workspace, started_at, finished_at, finding_count, severity_critical, severity_warning, severity_info, schema_version)
         VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            scan.workspace,
            scan.finished_at,
            scan.total,
            scan.critical,
            scan.warning,
            scan.info,
            STORE_SCHEMA_VERSION,
        ],
    )
    .map_err(store_err)?;
    Ok(conn.last_insert_rowid())
}

/// Commit the findings rows for `scan_id`. Second half of [`save`].
/// Returns the number of rows committed.
pub fn save_findings_rows(
    db_path: &Path,
    scan_id: i64,
    findings: &[FindingRow],
) -> Result<usize, EngineError> {
    let mut conn = open_existing(db_path)?;
    let txn = conn.transaction().map_err(store_err)?;
    {
        let mut stmt = txn
            .prepare("INSERT INTO findings (scan_id, finding_id, severity, title, evidence_json) VALUES (?1, ?2, ?3, ?4, ?5)")
            .map_err(store_err)?;
        for f in findings {
            stmt.execute(rusqlite::params![
                scan_id,
                f.finding_id,
                f.severity,
                f.title,
                f.evidence_json
            ])
            .map_err(store_err)?;
        }
    }
    txn.commit().map_err(store_err)?;
    Ok(findings.len())
}

/// Commit the crate/toolchain inventory for `scan_id` (issue #115). Third
/// half of [`save`]; a separate transaction so the public crash seam
/// (`save_scan_row` + `save_findings_rows`) keeps its exact issue-#58
/// semantics — a scan whose save died before this commit has findings but
/// NO inventory, which reads report honestly as "not recorded".
/// Returns the number of rows committed (1 toolchain row + one per crate).
pub fn save_inventory(
    db_path: &Path,
    scan_id: i64,
    scan: &PayloadScan,
) -> Result<usize, EngineError> {
    let mut conn = open_existing(db_path)?;
    // Self-healing idempotent DDL (same philosophy as the per-open WAL
    // pragma): a store file created by a pre-#115 engine has no inventory
    // tables yet — `save` migrates it on first write instead of failing.
    for stmt in [&DDL[3], &DDL[4]] {
        conn.execute_batch(stmt).map_err(store_err)?;
    }
    let txn = conn.transaction().map_err(store_err)?;
    txn.execute(
        "INSERT INTO scan_toolchain (scan_id, toolchain) VALUES (?1, ?2)",
        rusqlite::params![scan_id, scan.toolchain],
    )
    .map_err(store_err)?;
    {
        let mut stmt = txn
            .prepare(
                "INSERT INTO scan_crates (scan_id, name, version, band, node_kind, manifest_path)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .map_err(store_err)?;
        for c in &scan.crates {
            stmt.execute(rusqlite::params![
                scan_id,
                c.name,
                c.version,
                c.band,
                c.node_kind,
                c.manifest_path
            ])
            .map_err(store_err)?;
        }
    }
    txn.commit().map_err(store_err)?;
    Ok(scan.crates.len() + 1)
}

// ------------------------------------------------------- inventory reads

/// True when this database file has the inventory tables (stores created by
/// pre-#115 engines never ran the new DDL). Read-only: missing tables are
/// reported, never silently created by a read path.
fn has_inventory_tables(conn: &Connection) -> Result<bool, EngineError> {
    let tables: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table'
             AND name IN ('scan_crates','scan_toolchain')",
            [],
            |r| r.get(0),
        )
        .map_err(store_err)?;
    Ok(tables == 2)
}

/// The measured toolchain of one stored scan; `Ok(None)` when the scan has
/// no recorded inventory (saved by a pre-#115 engine, or its save was
/// killed before the inventory commit). Callers label that "not recorded" —
/// never a fabricated value.
pub fn toolchain_for(db_path: &Path, scan_id: i64) -> Result<Option<String>, EngineError> {
    let conn = open_existing(db_path)?;
    if !has_inventory_tables(&conn)? {
        return Ok(None);
    }
    let mut stmt = conn
        .prepare("SELECT toolchain FROM scan_toolchain WHERE scan_id = ?1")
        .map_err(store_err)?;
    let mut rows = stmt
        .query_map(rusqlite::params![scan_id], |r| r.get::<_, String>(0))
        .map_err(store_err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(store_err)?;
    // One row per scan by construction; if an external tool inserted more,
    // take the lexicographically smallest so reads stay deterministic.
    rows.sort();
    Ok(rows.into_iter().next())
}

/// The recorded crate inventory of one stored scan, ordered by
/// (name, version, manifest_path) — deterministic. Empty when the scan has
/// no recorded inventory (see [`toolchain_for`]); the caller distinguishes
/// "not recorded" from "recorded empty" via [`toolchain_for`].
pub fn crates_for(db_path: &Path, scan_id: i64) -> Result<Vec<CrateSnapshot>, EngineError> {
    let conn = open_existing(db_path)?;
    if !has_inventory_tables(&conn)? {
        return Ok(Vec::new());
    }
    let mut stmt = conn
        .prepare(
            "SELECT name, version, band, node_kind, manifest_path
             FROM scan_crates
             WHERE scan_id = ?1
             ORDER BY name ASC, version ASC, manifest_path ASC",
        )
        .map_err(store_err)?;
    let rows = stmt
        .query_map(rusqlite::params![scan_id], |r| {
            Ok(CrateSnapshot {
                name: r.get(0)?,
                version: r.get(1)?,
                band: r.get(2)?,
                node_kind: r.get(3)?,
                manifest_path: r.get(4)?,
            })
        })
        .map_err(store_err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(store_err)?;
    Ok(rows)
}

// ----------------------------------------------------------------- list

/// Scan summaries, ordered by id (insertion order = chronological order;
/// ids are monotonic). `workspace` filters exactly (None = all).
pub fn list(db_path: &Path, workspace: Option<&str>) -> Result<Vec<ScanRow>, EngineError> {
    let conn = open_existing(db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, workspace, finished_at, finding_count, severity_critical, severity_warning, severity_info, schema_version
             FROM scans
             WHERE (?1 IS NULL OR workspace = ?1)
             ORDER BY id ASC",
        )
        .map_err(store_err)?;
    let rows = stmt
        .query_map(rusqlite::params![workspace], |r| {
            Ok(ScanRow {
                id: r.get(0)?,
                workspace: r.get(1)?,
                finished_at: r.get(2)?,
                finding_count: r.get(3)?,
                severity_critical: r.get(4)?,
                severity_warning: r.get(5)?,
                severity_info: r.get(6)?,
                schema_version: r.get(7)?,
            })
        })
        .map_err(store_err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(store_err)?;
    Ok(rows)
}

// ---------------------------------------------------------- findings read

/// The persisted findings rows for one scan, ordered by `finding_id`
/// (deterministic). Read-only helper backing `wanyrix what-changed`:
/// the baseline side of the diff is exactly what the store saved — never
/// re-derived, never re-shaped.
pub fn findings_for(db_path: &Path, scan_id: i64) -> Result<Vec<FindingRow>, EngineError> {
    let conn = open_existing(db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT finding_id, severity, title, evidence_json
             FROM findings
             WHERE scan_id = ?1
             ORDER BY finding_id ASC",
        )
        .map_err(store_err)?;
    let rows = stmt
        .query_map(rusqlite::params![scan_id], |r| {
            Ok(FindingRow {
                finding_id: r.get(0)?,
                severity: r.get(1)?,
                title: r.get(2)?,
                evidence_json: r.get(3)?,
            })
        })
        .map_err(store_err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(store_err)?;
    Ok(rows)
}

// ---------------------------------------------------------- chain queries

/// One finding row plus the scan row it was stored under — the join unit of
/// the engineering-memory chain query (issue #100). Read-only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FindingOccurrence {
    pub scan: ScanRow,
    pub finding: FindingRow,
}

/// Every stored occurrence of one finding id, ordered by scan id
/// (deterministic). Spans ALL workspaces in the store — the chain query
/// scopes by workspace and names a cross-workspace hit with its remediation
/// instead of silently dropping it.
pub fn finding_occurrences(
    db_path: &Path,
    finding_id: &str,
) -> Result<Vec<FindingOccurrence>, EngineError> {
    let conn = open_existing(db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.workspace, s.finished_at, s.finding_count,
                    s.severity_critical, s.severity_warning, s.severity_info, s.schema_version,
                    f.finding_id, f.severity, f.title, f.evidence_json
             FROM findings f JOIN scans s ON s.id = f.scan_id
             WHERE f.finding_id = ?1
             ORDER BY s.id ASC",
        )
        .map_err(store_err)?;
    let rows = stmt
        .query_map(rusqlite::params![finding_id], |r| {
            Ok(FindingOccurrence {
                scan: ScanRow {
                    id: r.get(0)?,
                    workspace: r.get(1)?,
                    finished_at: r.get(2)?,
                    finding_count: r.get(3)?,
                    severity_critical: r.get(4)?,
                    severity_warning: r.get(5)?,
                    severity_info: r.get(6)?,
                    schema_version: r.get(7)?,
                },
                finding: FindingRow {
                    finding_id: r.get(8)?,
                    severity: r.get(9)?,
                    title: r.get(10)?,
                    evidence_json: r.get(11)?,
                },
            })
        })
        .map_err(store_err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(store_err)?;
    Ok(rows)
}

/// The (deduped, sorted) workspace names that hold a stored occurrence of
/// one finding id — the actionable remediation when a chain query is scoped
/// to a different workspace than the one holding the finding.
pub fn finding_workspaces(db_path: &Path, finding_id: &str) -> Result<Vec<String>, EngineError> {
    let conn = open_existing(db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT s.workspace
             FROM findings f JOIN scans s ON s.id = f.scan_id
             WHERE f.finding_id = ?1
             ORDER BY s.workspace ASC",
        )
        .map_err(store_err)?;
    let rows = stmt
        .query_map(rusqlite::params![finding_id], |r| r.get(0))
        .map_err(store_err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(store_err)?;
    Ok(rows)
}

/// One scan row by id (`None` when absent) — the `wanyrix chain --scan`
/// scope lookup. Read-only.
pub fn scan_by_id(db_path: &Path, scan_id: i64) -> Result<Option<ScanRow>, EngineError> {
    let conn = open_existing(db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, workspace, finished_at, finding_count, severity_critical,
                    severity_warning, severity_info, schema_version
             FROM scans WHERE id = ?1",
        )
        .map_err(store_err)?;
    let row = stmt
        .query_row(rusqlite::params![scan_id], |r| {
            Ok(ScanRow {
                id: r.get(0)?,
                workspace: r.get(1)?,
                finished_at: r.get(2)?,
                finding_count: r.get(3)?,
                severity_critical: r.get(4)?,
                severity_warning: r.get(5)?,
                severity_info: r.get(6)?,
                schema_version: r.get(7)?,
            })
        })
        .optional()
        .map_err(store_err)?;
    Ok(row)
}

// ----------------------------------------------------------------- fsck

/// Check store integrity (issue #58 acceptance): every scan must have its
/// complete findings row set, no dangling findings rows. With `repair`,
/// inconsistent scans (and their partial findings) and orphan findings
/// rows are deleted — repair removes data it cannot trust, it never
/// fabricates the missing rows.
pub fn fsck(db_path: &Path, repair: bool) -> Result<FsckReport, EngineError> {
    let mut conn = open_existing(db_path)?;
    let mut report = FsckReport {
        scans_checked: conn
            .query_row("SELECT count(*) FROM scans", [], |r| r.get(0))
            .map_err(store_err)?,
        findings_rows: conn
            .query_row("SELECT count(*) FROM findings", [], |r| r.get(0))
            .map_err(store_err)?,
        ..FsckReport::default()
    };

    {
        let mut stmt = conn
            .prepare(
                "SELECT s.id, s.finding_count,
                        (SELECT count(*) FROM findings f WHERE f.scan_id = s.id)
                 FROM scans s ORDER BY s.id",
            )
            .map_err(store_err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .map_err(store_err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(store_err)?;
        for (id, stored, actual) in rows {
            if actual < stored {
                // missing or partial findings row set — the kill-between-
                // commits state this check exists to catch
                report.incomplete_scans.push((id, stored, actual));
            } else if actual > stored {
                report.count_mismatches.push((id, stored, actual));
            }
        }
    }

    {
        let mut stmt = conn
            .prepare(
                "SELECT f.rowid FROM findings f
                 WHERE NOT EXISTS (SELECT 1 FROM scans s WHERE s.id = f.scan_id)
                 ORDER BY f.rowid",
            )
            .map_err(store_err)?;
        report.orphan_findings = stmt
            .query_map([], |r| r.get(0))
            .map_err(store_err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(store_err)?;
    }

    // Inventory orphans (issue #115): same defense-in-depth class as the
    // orphan-findings check — reachable only through tools that bypass the
    // enforced foreign keys (manual edits, older writers).
    {
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT c.scan_id FROM scan_crates c
                 WHERE NOT EXISTS (SELECT 1 FROM scans s WHERE s.id = c.scan_id)
                 UNION
                 SELECT DISTINCT t.scan_id FROM scan_toolchain t
                 WHERE NOT EXISTS (SELECT 1 FROM scans s WHERE s.id = t.scan_id)
                 ORDER BY 1",
            )
            .map_err(store_err)?;
        report.orphan_inventory = stmt
            .query_map([], |r| r.get(0))
            .map_err(store_err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(store_err)?;
    }

    if repair {
        // Measure the exact number of findings rows that belong to the
        // scans we are about to remove, BEFORE removing them — the report
        // states measured counts, never estimates.
        let doomed_scans = report
            .incomplete_scans
            .iter()
            .map(|(id, _, _)| *id)
            .chain(report.count_mismatches.iter().map(|(id, _, _)| *id))
            .collect::<Vec<i64>>();
        let mut rows_of_removed_scans = 0usize;
        {
            let mut stmt = conn
                .prepare("SELECT count(*) FROM findings WHERE scan_id = ?1")
                .map_err(store_err)?;
            for id in &doomed_scans {
                rows_of_removed_scans += stmt
                    .query_row(rusqlite::params![id], |r| r.get::<_, i64>(0))
                    .map_err(store_err)? as usize;
            }
        }
        // Same measured-before-removal accounting for the doomed scans'
        // inventory rows (they must go first — the enforced FK forbids
        // deleting a scans row that children still reference).
        let mut inventory_of_removed_scans = 0usize;
        {
            let mut stmt = conn
                .prepare("SELECT count(*) FROM scan_crates WHERE scan_id = ?1")
                .map_err(store_err)?;
            for id in &doomed_scans {
                inventory_of_removed_scans += stmt
                    .query_row(rusqlite::params![id], |r| r.get::<_, i64>(0))
                    .map_err(store_err)? as usize;
            }
            let mut stmt = conn
                .prepare("SELECT count(*) FROM scan_toolchain WHERE scan_id = ?1")
                .map_err(store_err)?;
            for id in &doomed_scans {
                inventory_of_removed_scans += stmt
                    .query_row(rusqlite::params![id], |r| r.get::<_, i64>(0))
                    .map_err(store_err)? as usize;
            }
        }
        let txn = conn.transaction().map_err(store_err)?;
        for id in &doomed_scans {
            txn.execute(
                "DELETE FROM scan_crates WHERE scan_id = ?1",
                rusqlite::params![id],
            )
            .map_err(store_err)?;
            txn.execute(
                "DELETE FROM scan_toolchain WHERE scan_id = ?1",
                rusqlite::params![id],
            )
            .map_err(store_err)?;
            txn.execute(
                "DELETE FROM findings WHERE scan_id = ?1",
                rusqlite::params![id],
            )
            .map_err(store_err)?;
            txn.execute("DELETE FROM scans WHERE id = ?1", rusqlite::params![id])
                .map_err(store_err)?;
        }
        for id in &report.orphan_findings {
            txn.execute(
                "DELETE FROM findings WHERE rowid = ?1",
                rusqlite::params![id],
            )
            .map_err(store_err)?;
        }
        let mut removed_inventory = inventory_of_removed_scans;
        for id in &report.orphan_inventory {
            removed_inventory += txn
                .execute(
                    "DELETE FROM scan_crates WHERE scan_id = ?1",
                    rusqlite::params![id],
                )
                .map_err(store_err)?;
            removed_inventory += txn
                .execute(
                    "DELETE FROM scan_toolchain WHERE scan_id = ?1",
                    rusqlite::params![id],
                )
                .map_err(store_err)?;
        }
        report.removed_scans = report.incomplete_scans.len() + report.count_mismatches.len();
        report.removed_findings = rows_of_removed_scans + report.orphan_findings.len();
        report.removed_inventory = removed_inventory;
        txn.commit().map_err(store_err)?;
    }

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli;
    use crate::report;
    use crate::scan::scan_workspace;
    use std::path::PathBuf;

    fn tempdir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("wanyrix-store-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A real doctor payload: the exact JSON `wanyrix doctor --json`
    /// emits for the tiny-ws fixture (scan → analyze → report → serialize).
    fn tiny_ws_payload() -> String {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/tiny-ws");
        let scan = scan_workspace(&root).unwrap();
        let findings = cli::doctor(&scan);
        let r = report::doctor_report(&scan, &findings, "2026-09-18T13:28:56Z".to_owned());
        cli::serialize_json(&r, false).unwrap()
    }

    #[test]
    fn init_creates_schema_and_is_idempotent() {
        let dir = tempdir("init");
        let db = dir.join("scans.db");
        init(&db).unwrap();
        init(&db).unwrap(); // second init must not fail or duplicate
        let conn = open_existing(&db).unwrap();
        let tables: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('scans','findings')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tables, 2, "both tables exist exactly once");
        let user_version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            user_version, STORE_SCHEMA_VERSION,
            "layout version pinned in the header"
        );
        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn wal_mode_is_persistent_across_reopen() {
        let dir = tempdir("wal");
        let db = dir.join("scans.db");
        init(&db).unwrap();
        // A fresh connection reads the mode from the DB header: WAL stuck.
        let conn = Connection::open(&db).unwrap();
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            mode, "wal",
            "journal_mode=wal persists in the database header"
        );
        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_and_list_round_trip_tiny_ws() {
        let dir = tempdir("roundtrip");
        let db = dir.join("scans.db");
        init(&db).unwrap();
        let payload = tiny_ws_payload();
        let v: serde_json::Value = serde_json::from_str(&payload).unwrap();
        let outcome = save(&db, &payload).unwrap();
        assert_eq!(outcome.workspace, "tiny-ws");
        assert_eq!(outcome.findings, 4, "tiny-ws has exactly 4 findings");
        assert_eq!(
            outcome.findings,
            v["summary"]["total"].as_u64().unwrap() as usize
        );

        let rows = list(&db, None).unwrap();
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.workspace, "tiny-ws");
        assert_eq!(
            row.finished_at, 1_789_738_136,
            "generatedAt parsed to the integer epoch"
        );
        assert_eq!(row.finding_count, 4);
        assert_eq!(row.severity_critical, 0);
        assert_eq!(row.severity_warning, 4);
        assert_eq!(row.severity_info, 0);
        assert_eq!(
            row.schema_version, 1,
            "doctor payload schema wanyrix.doctor/v1 → 1"
        );
        let line = row.line();
        assert!(
            line.contains("tiny-ws")
                && line.contains("2026-09-18T13:28:56Z")
                && line.contains("v1"),
            "list row renders the measured fields: {line}"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn evidence_json_is_stored_verbatim() {
        let dir = tempdir("evidence");
        let db = dir.join("scans.db");
        init(&db).unwrap();
        let payload = tiny_ws_payload();
        let v: serde_json::Value = serde_json::from_str(&payload).unwrap();
        save(&db, &payload).unwrap();
        let conn = open_existing(&db).unwrap();
        let mut stmt = conn
            .prepare("SELECT finding_id, evidence_json FROM findings ORDER BY finding_id")
            .unwrap();
        let rows: Vec<(String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(rows.len(), 4);
        for (finding_id, evidence_json) in rows {
            let expected = &v["findings"]
                .as_array()
                .unwrap()
                .iter()
                .find(|f| f["id"] == finding_id.as_str())
                .unwrap()["evidence"];
            let stored: serde_json::Value = serde_json::from_str(&evidence_json).unwrap();
            assert_eq!(
                &stored, expected,
                "evidence stored verbatim for {finding_id}"
            );
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn list_filters_by_workspace_exactly() {
        let dir = tempdir("filter");
        let db = dir.join("scans.db");
        init(&db).unwrap();
        save(&db, &tiny_ws_payload()).unwrap();
        // a second, differently-named workspace payload
        let other =
            tiny_ws_payload().replace("\"workspace\":\"tiny-ws\"", "\"workspace\":\"other-ws\"");
        save(&db, &other).unwrap();
        assert_eq!(list(&db, None).unwrap().len(), 2);
        let filtered = list(&db, Some("other-ws")).unwrap();
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].workspace, "other-ws");
        assert!(list(&db, Some("no-such-workspace")).unwrap().is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn self_inconsistent_payload_is_rejected_not_persisted() {
        let dir = tempdir("reject");
        let db = dir.join("scans.db");
        init(&db).unwrap();
        let mut v: serde_json::Value = serde_json::from_str(&tiny_ws_payload()).unwrap();
        v["summary"]["total"] = serde_json::json!(99); // lie the store must catch
        let err = save(&db, &v.to_string()).unwrap_err();
        assert!(err.to_string().contains("self-inconsistent"), "got: {err}");
        assert!(list(&db, None).unwrap().is_empty(), "nothing was persisted");
        // wrong schema flavor is rejected too
        v["summary"]["total"] = serde_json::json!(4);
        v["schema"] = serde_json::json!("wanyrix.doctor/v9");
        let err = save(&db, &v.to_string()).unwrap_err();
        assert!(err.to_string().contains("only accepts"), "got: {err}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn inventory_round_trips_verbatim_for_issue_115() {
        let dir = tempdir("inventory");
        let db = dir.join("scans.db");
        init(&db).unwrap();
        let outcome = save(&db, &tiny_ws_payload()).unwrap();
        assert_eq!(outcome.inventory, 4, "1 toolchain row + 3 crate rows");
        assert_eq!(
            toolchain_for(&db, outcome.scan_id).unwrap().as_deref(),
            Some("unspecified (no rust-toolchain.toml)"),
            "the measured toolchain string is stored verbatim"
        );
        let crates = crates_for(&db, outcome.scan_id).unwrap();
        assert_eq!(
            crates.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            vec!["alpha", "beta", "gamma"],
            "crates read back in deterministic (name) order"
        );
        assert_eq!(crates[0].version, "0.1.0");
        assert_eq!(crates[0].manifest_path, "alpha/Cargo.toml");
        assert_eq!(crates[0].band, "lib");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn seam_save_without_inventory_reads_as_not_recorded() {
        let dir = tempdir("no-inventory");
        let db = dir.join("scans.db");
        init(&db).unwrap();
        let scan = parse_payload(&tiny_ws_payload()).unwrap();
        let scan_id = save_scan_row(&db, &scan).unwrap();
        save_findings_rows(&db, scan_id, &scan.findings).unwrap();
        assert_eq!(
            toolchain_for(&db, scan_id).unwrap(),
            None,
            "a scan saved before the inventory commit has NO recorded toolchain"
        );
        assert!(crates_for(&db, scan_id).unwrap().is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn fsck_detects_and_repairs_orphan_inventory_rows() {
        let dir = tempdir("orphan-inventory");
        let db = dir.join("scans.db");
        init(&db).unwrap();
        save(&db, &tiny_ws_payload()).unwrap();

        // A tool without FK enforcement injects inventory rows for a scan
        // that does not exist — the file state fsck must clean up.
        {
            let conn = Connection::open(&db).unwrap();
            conn.pragma_update(None, "foreign_keys", "OFF").unwrap();
            conn.execute(
                "INSERT INTO scan_crates (scan_id, name, version, band, node_kind, manifest_path)
                 VALUES (999, 'ghost', '0.1.0', 'lib', 'workspace', 'ghost/Cargo.toml')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO scan_toolchain (scan_id, toolchain) VALUES (999, 'ghost-toolchain')",
                [],
            )
            .unwrap();
        }

        let report = fsck(&db, false).unwrap();
        assert!(
            !report.healthy(),
            "orphan inventory makes the store unhealthy"
        );
        assert_eq!(report.orphan_inventory, vec![999]);
        assert!(
            report.summary().contains("orphan inventory rows"),
            "the summary names the class: {}",
            report.summary()
        );

        let repaired = fsck(&db, true).unwrap();
        assert_eq!(repaired.removed_inventory, 2, "both orphan rows removed");
        assert!(
            fsck(&db, false).unwrap().healthy(),
            "store consistent after repair"
        );
        // The healthy scan survived untouched.
        assert_eq!(list(&db, None).unwrap().len(), 1);
        assert_eq!(crates_for(&db, 1).unwrap().len(), 3);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn legacy_store_without_inventory_tables_reads_as_not_recorded() {
        let dir = tempdir("legacy-tables");
        let db = dir.join("scans.db");
        // Simulate a pre-#115 store: init, save, then DROP the inventory
        // tables (what an old engine's file looks like to the new binary).
        init(&db).unwrap();
        save(&db, &tiny_ws_payload()).unwrap();
        let conn = open_existing(&db).unwrap();
        conn.execute_batch("DROP TABLE scan_crates; DROP TABLE scan_toolchain;")
            .unwrap();
        drop(conn);
        assert_eq!(
            toolchain_for(&db, 1).unwrap(),
            None,
            "missing tables read as not-recorded"
        );
        assert!(crates_for(&db, 1).unwrap().is_empty());
        // ...and the write path self-heals: the next save re-creates them.
        save(&db, &tiny_ws_payload()).unwrap();
        assert!(toolchain_for(&db, 2).unwrap().is_some());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_on_uninitialized_store_is_an_honest_error() {
        let dir = tempdir("uninit");
        let db = dir.join("never-initialized.db");
        let err = save(&db, &tiny_ws_payload()).unwrap_err();
        assert!(err.to_string().contains("store not found"), "got: {err}");
        std::fs::remove_dir_all(&dir).ok();
    }
}
