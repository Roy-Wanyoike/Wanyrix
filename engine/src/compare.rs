//! Deterministic diff of two STORED scans — the time-machine surface
//! (`wanyrix.compare/v1`, issue #115).
//!
//! `wanyrix what-changed` diffs a FRESH measured scan against the NEWEST
//! stored baseline; `wanyrix compare` diffs any two scans already in the
//! store — the offline/CI answer to "what changed between scan A and scan
//! B", available even when the workspace tree has since moved on.
//!
//! # Honesty contract (same class as `wanyrix.export/v1`)
//!
//! 1. Both sides are read back VERBATIM from the store (`findings_for`,
//!    `crates_for`, `toolchain_for`) — never re-derived, never re-shaped,
//!    never re-measured. The diff is exactly as good as what was persisted.
//! 2. NO wall-clock anywhere: the diff is between two records that already
//!    carry their own measured instants, so the envelope's `generatedAt`
//!    is the literal `not-measured` (the export convention) and repeated
//!    invocations are byte-identical. Determinism is the product.
//! 3. Coverage is labeled, never faked: the store persists doctor
//!    payloads — findings, summary counts, the crate/toolchain inventory
//!    (issue #115) — and NO dependency edges (those are graph-envelope
//!    data). `coverage.edgesRecorded` is therefore always `false` with a
//!    named note; a scan saved before inventory persistence reports
//!    `cratesRecorded`/`toolchainRecorded` `false`. Absent data is
//!    labeled, never guessed into an empty delta.
//! 4. Corrupt store entries are NAMED refusals (exit 2): a scan whose
//!    findings rows disagree with its committed count is exactly the
//!    kill-between-commits state `store fsck` exists for — compare refuses
//!    rather than diff a lie.
//! 5. Integer math only; every list sorted; `generatedAt` LAST.
//!
//! # The diff core (reusable)
//!
//! [`diff_findings`] and [`diff_crates`] are the pairing engine, public so
//! the follow-on PR-regression surface (issue #116) reuses ONE diff
//! definition. [`crate::change::what_changed`] carries an inline sibling
//! of the same duplicate-safe algorithm (kept as-is here to avoid churn in
//! a shipped contract); issue #116 standardizes on this module.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Serialize;

use crate::model::EngineError;
use crate::store::{self, CrateSnapshot, FindingRow, ScanRow};
use crate::timestamp::iso8601_from_unix;

/// Envelope schema identifier for `wanyrix compare --json`.
pub const COMPARE_SCHEMA: &str = "wanyrix.compare/v1";

/// The clock-free `generatedAt` literal — re-exported from the export
/// surface so the "no wall-clock in an artifact" convention has ONE home.
pub use crate::export::NOT_MEASURED_TIMESTAMP;

/// The envelope's honesty note (carried in the envelope itself so the
/// artifact is self-describing, like `wanyrix.export/v1`'s manifest).
pub const COMPARE_MEASUREMENT: &str = "both sides are read back verbatim from the scan store and diffed — nothing is re-measured, nothing simulated; the diff is exactly as complete as what the store persisted (coverage labels name the gaps); generatedAt carries the literal \"not-measured\" because both records already carry their own measured instants (issue #115)";

/// The named limitation about edges — always carried, because the store
/// genuinely does not persist them (never an empty-delta lie).
pub const EDGES_NOTE: &str = "dependency edges are not recorded per scan: the store persists wanyrix.doctor/v1 payloads, which carry no edge list (edges are wanyrix.graph/v1 data) — edge deltas are labeled not-recorded, never guessed; a store layout that records edges is a tracked follow-up";

/// One added/removed crate in the diff (name + persisted version).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffCrate {
    pub name: String,
    pub version: String,
}

/// A crate present on both sides whose measured version changed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionChangedCrate {
    pub name: String,
    pub from_version: String,
    pub to_version: String,
}

/// The crate delta between two stored scans. Duplicate crate names (a
/// scan tree may legitimately contain two crates with the same name) are
/// paired positionally within each name group in a canonical order — the
/// same duplicate-safe rule the findings diff uses.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CratesDiff {
    pub added: Vec<DiffCrate>,
    pub removed: Vec<DiffCrate>,
    pub version_changed: Vec<VersionChangedCrate>,
    /// Pairs present on both sides with an identical measured version.
    pub unchanged: usize,
}

/// A diffed finding, keyed by stable `finding_id`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFinding {
    pub id: String,
    pub severity: String,
    pub title: String,
}

/// A finding whose severity or evidence changed between the two scans.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFinding {
    pub id: String,
    pub title: String,
    pub previous_severity: String,
    pub severity: String,
}

/// The findings delta between two stored scans.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindingsDiff {
    pub added: Vec<DiffFinding>,
    pub resolved: Vec<DiffFinding>,
    pub changed: Vec<ChangedFinding>,
}

/// Measured severity-count deltas (to − from; negative = fewer).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeverityDelta {
    pub critical: i64,
    pub warning: i64,
    pub info: i64,
}

/// One side of the comparison — the stored record rendered honestly.
/// `finishedAt` is the record's own measured `generatedAt` (ISO-8601 from
/// the stored epoch); `toolchain` is `None` when the scan has no recorded
/// inventory (labeled downstream, never fabricated).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRef {
    pub scan_id: i64,
    pub workspace: String,
    pub finished_at: String,
    pub finding_count: i64,
    pub critical: i64,
    pub warning: i64,
    pub info: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub toolchain: Option<String>,
}

/// What the store actually persisted for BOTH scans — the diff's coverage
/// label. `edgesRecorded` is always `false` today (see [`EDGES_NOTE`]);
/// findings are always recorded (they ARE the store's core, and their
/// integrity is enforced before any diff runs).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Coverage {
    pub findings_recorded: bool,
    pub crates_recorded: bool,
    pub toolchain_recorded: bool,
    pub edges_recorded: bool,
}

/// `wanyrix.compare/v1` — the time-machine diff of two stored scans.
/// Field order is the wire contract; `generatedAt` is LAST and carries the
/// literal `not-measured`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareReport {
    pub schema: String,
    /// The store both scans were read from (operator-provided path, as
    /// given — relative stays relative, per the export path contract).
    pub db: String,
    pub from: ScanRef,
    pub to: ScanRef,
    pub crates: CratesDiff,
    pub findings: FindingsDiff,
    pub severity_delta: SeverityDelta,
    pub coverage: Coverage,
    /// Named coverage/remediation notes; absent when coverage is complete.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<String>,
    pub measurement: String,
    /// LAST key — the literal `not-measured` (no wall-clock in a diff of
    /// two records that carry their own measured instants).
    pub generated_at: String,
}

// ------------------------------------------------------------ diff core

/// The duplicate-safe findings pairing core: group both sides by stable
/// finding id, sort each group by the canonical key (severity, title,
/// evidence) and pair positionally. Identical rows diff to zero; real
/// changes surface exactly. Severity OR evidence drift ⇒ `changed`;
/// unpaired current rows ⇒ `added`; unpaired baseline rows ⇒ `resolved`.
pub fn diff_findings(baseline: &[FindingRow], current: &[FindingRow]) -> FindingsDiff {
    let canonical_key = |r: &FindingRow| -> (String, String, String) {
        (r.severity.clone(), r.title.clone(), r.evidence_json.clone())
    };
    let mut baseline_groups: BTreeMap<&str, Vec<&FindingRow>> = BTreeMap::new();
    for r in baseline {
        baseline_groups
            .entry(r.finding_id.as_str())
            .or_default()
            .push(r);
    }
    let mut current_groups: BTreeMap<&str, Vec<&FindingRow>> = BTreeMap::new();
    for r in current {
        current_groups
            .entry(r.finding_id.as_str())
            .or_default()
            .push(r);
    }

    let mut added = Vec::new();
    let mut resolved = Vec::new();
    let mut changed = Vec::new();
    let ids = baseline_groups
        .keys()
        .chain(current_groups.keys())
        .copied()
        .collect::<std::collections::BTreeSet<_>>();
    for id in ids {
        let mut bs: Vec<&&FindingRow> = baseline_groups
            .get(id)
            .map(|v| v.iter().collect())
            .unwrap_or_default();
        let mut cs: Vec<&&FindingRow> = current_groups
            .get(id)
            .map(|v| v.iter().collect())
            .unwrap_or_default();
        // Sort each group by the canonical key — positionally stable
        // pairing even when the same finding id legitimately appears twice.
        bs.sort_by_key(|r| canonical_key(r));
        cs.sort_by_key(|r| canonical_key(r));
        let paired = bs.len().min(cs.len());
        for i in 0..paired {
            let (prev, cur) = (bs[i], cs[i]);
            if prev.severity != cur.severity || prev.evidence_json != cur.evidence_json {
                changed.push(ChangedFinding {
                    id: cur.finding_id.clone(),
                    title: cur.title.clone(),
                    previous_severity: prev.severity.clone(),
                    severity: cur.severity.clone(),
                });
            }
        }
        for cur in cs.iter().skip(paired) {
            added.push(DiffFinding {
                id: cur.finding_id.clone(),
                severity: cur.severity.clone(),
                title: cur.title.clone(),
            });
        }
        for prev in bs.iter().skip(paired) {
            resolved.push(DiffFinding {
                id: prev.finding_id.clone(),
                severity: prev.severity.clone(),
                title: prev.title.clone(),
            });
        }
    }
    added.sort_by(|a, b| a.id.cmp(&b.id).then(a.title.cmp(&b.title)));
    resolved.sort_by(|a, b| a.id.cmp(&b.id).then(a.title.cmp(&b.title)));
    changed.sort_by(|a, b| a.id.cmp(&b.id).then(a.title.cmp(&b.title)));
    FindingsDiff {
        added,
        resolved,
        changed,
    }
}

/// The duplicate-safe crate pairing core: group both sides by crate name,
/// sort each group by the canonical key (version, manifest_path, band,
/// node kind) and pair positionally. Paired rows with differing versions
/// are `version_changed`; unpaired rows are `added`/`removed`.
pub fn diff_crates(baseline: &[CrateSnapshot], current: &[CrateSnapshot]) -> CratesDiff {
    let canonical_key = |c: &CrateSnapshot| -> (String, String, String, String) {
        (
            c.version.clone(),
            c.manifest_path.clone(),
            c.band.clone(),
            c.node_kind.clone(),
        )
    };
    let mut baseline_groups: BTreeMap<&str, Vec<&CrateSnapshot>> = BTreeMap::new();
    for c in baseline {
        baseline_groups.entry(c.name.as_str()).or_default().push(c);
    }
    let mut current_groups: BTreeMap<&str, Vec<&CrateSnapshot>> = BTreeMap::new();
    for c in current {
        current_groups.entry(c.name.as_str()).or_default().push(c);
    }

    let mut added = Vec::new();
    let mut removed = Vec::new();
    let mut version_changed = Vec::new();
    let mut unchanged = 0usize;
    let names = baseline_groups
        .keys()
        .chain(current_groups.keys())
        .copied()
        .collect::<std::collections::BTreeSet<_>>();
    for name in names {
        let mut bs: Vec<&&CrateSnapshot> = baseline_groups
            .get(name)
            .map(|v| v.iter().collect())
            .unwrap_or_default();
        let mut cs: Vec<&&CrateSnapshot> = current_groups
            .get(name)
            .map(|v| v.iter().collect())
            .unwrap_or_default();
        bs.sort_by_key(|c| canonical_key(c));
        cs.sort_by_key(|c| canonical_key(c));
        let paired = bs.len().min(cs.len());
        for i in 0..paired {
            let (prev, cur) = (bs[i], cs[i]);
            if prev.version != cur.version {
                version_changed.push(VersionChangedCrate {
                    name: (*name).to_owned(),
                    from_version: prev.version.clone(),
                    to_version: cur.version.clone(),
                });
            } else {
                unchanged += 1;
            }
        }
        for cur in cs.iter().skip(paired) {
            added.push(DiffCrate {
                name: (*name).to_owned(),
                version: cur.version.clone(),
            });
        }
        for prev in bs.iter().skip(paired) {
            removed.push(DiffCrate {
                name: (*name).to_owned(),
                version: prev.version.clone(),
            });
        }
    }
    added.sort_by(|a, b| a.name.cmp(&b.name).then(a.version.cmp(&b.version)));
    removed.sort_by(|a, b| a.name.cmp(&b.name).then(a.version.cmp(&b.version)));
    version_changed.sort_by(|a, b| a.name.cmp(&b.name));
    CratesDiff {
        added,
        removed,
        version_changed,
        unchanged,
    }
}

// ------------------------------------------------------------- assembly

/// Read one stored scan row by id (from the ordered `list` scan — ids are
/// monotonic, so this is a binary search; no extra SQL surface needed).
fn scan_row_by_id(rows: &[ScanRow], id: i64) -> Option<&ScanRow> {
    rows.iter().find(|r| r.id == id)
}

/// Render the stored record as the envelope's side reference.
fn scan_ref(row: &ScanRow, toolchain: Option<String>) -> ScanRef {
    ScanRef {
        scan_id: row.id,
        workspace: row.workspace.clone(),
        finished_at: iso8601_from_unix(row.finished_at.max(0) as u64),
        finding_count: row.finding_count,
        critical: row.severity_critical,
        warning: row.severity_warning,
        info: row.severity_info,
        toolchain,
    }
}

/// Refuse a scan whose committed findings row set is missing or disagrees
/// with its committed count — the store-corruption state `store fsck`
/// exists for. Diffing a lie is never an option.
fn integrity_check(
    db: &Path,
    row: &ScanRow,
    actual_rows: &[FindingRow],
) -> Result<(), EngineError> {
    let actual = actual_rows.len() as i64;
    if actual != row.finding_count {
        return Err(EngineError::Compare(format!(
            "scan #{} in {} is corrupt: committed finding_count={}, but {} findings rows exist — run `wanyrix store fsck --db {}` to inspect (add --repair to remove the broken scan), then re-save",
            row.id,
            db.display(),
            row.finding_count,
            actual,
            db.display()
        )));
    }
    Ok(())
}

/// Compute the time-machine diff between two stored scans (`--from`,
/// `--to` ids in the store at `db`). Refusals are named and actionable:
/// unknown ids, cross-workspace pairs, and corrupt (incomplete/mismatched)
/// store entries. Identical scans are a valid zero-delta envelope.
pub fn compare_scan_refs(db: &Path, from_id: i64, to_id: i64) -> Result<CompareReport, EngineError> {
    let rows = store::list(db, None)?;
    let not_found = |id: i64| {
        EngineError::Compare(format!(
            "scan #{id} not found in {} — run `wanyrix store list --db {}` to see the stored scan ids",
            db.display(),
            db.display()
        ))
    };
    let from_row = scan_row_by_id(&rows, from_id).ok_or_else(|| not_found(from_id))?;
    let to_row = scan_row_by_id(&rows, to_id).ok_or_else(|| not_found(to_id))?;

    if from_row.workspace != to_row.workspace {
        return Err(EngineError::Compare(format!(
            "scan #{} ({}) and scan #{} ({}) are different workspaces — `wanyrix compare` diffs two scans of the SAME workspace; filter candidates with `wanyrix store list --db {} --workspace <name>`",
            from_row.id,
            from_row.workspace,
            to_row.id,
            to_row.workspace,
            db.display()
        )));
    }

    // Read both sides back verbatim — findings first, with the integrity
    // gate before anything is diffed.
    let from_findings = store::findings_for(db, from_row.id)?;
    let to_findings = store::findings_for(db, to_row.id)?;
    integrity_check(db, from_row, &from_findings)?;
    integrity_check(db, to_row, &to_findings)?;

    // Inventory (issue #115): Option::None = not recorded, honestly.
    let from_toolchain = store::toolchain_for(db, from_row.id)?;
    let to_toolchain = store::toolchain_for(db, to_row.id)?;
    let from_crates = store::crates_for(db, from_row.id)?;
    let to_crates = store::crates_for(db, to_row.id)?;
    let from_recorded = from_toolchain.is_some();
    let to_recorded = to_toolchain.is_some();
    let crates_recorded = from_recorded && to_recorded;
    let toolchain_recorded = crates_recorded;

    let crates_diff = diff_crates(&from_crates, &to_crates);
    let findings_diff = diff_findings(&from_findings, &to_findings);
    let severity_delta = SeverityDelta {
        critical: to_row.severity_critical - from_row.severity_critical,
        warning: to_row.severity_warning - from_row.severity_warning,
        info: to_row.severity_info - from_row.severity_info,
    };

    let mut notes = Vec::new();
    for (side, row, recorded) in [("from", from_row, from_recorded), ("to", to_row, to_recorded)] {
        if !recorded {
            notes.push(format!(
                "scan #{} ({}) has no recorded crate/toolchain inventory — saved by an older engine or the save was interrupted before the inventory commit; crate and toolchain deltas are labeled not-recorded (re-save the scan to record them)",
                row.id, side
            ));
        }
    }
    notes.push(EDGES_NOTE.to_owned());

    Ok(CompareReport {
        schema: COMPARE_SCHEMA.to_string(),
        db: db.display().to_string(),
        from: scan_ref(from_row, from_toolchain),
        to: scan_ref(to_row, to_toolchain),
        crates: crates_diff,
        findings: findings_diff,
        severity_delta,
        coverage: Coverage {
            findings_recorded: true,
            crates_recorded,
            toolchain_recorded,
            edges_recorded: false,
        },
        notes,
        measurement: COMPARE_MEASUREMENT.to_string(),
        generated_at: NOT_MEASURED_TIMESTAMP.to_string(),
    })
}

/// Human-readable compare summary. Deterministic — no clock, stable order,
/// the same +/-/~ markers the what-changed surface established.
pub fn compare_human(r: &CompareReport) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "wanyrix compare — {} ({})\n",
        r.from.workspace, r.schema
    ));
    out.push_str(&format!("db: {}\n", r.db));
    for (side, s) in [("from", &r.from), ("to", &r.to)] {
        out.push_str(&format!(
            "{side}: scan #{} (measured {}) — {} findings ({} critical, {} warning, {} info)\n",
            s.scan_id, s.finished_at, s.finding_count, s.critical, s.warning, s.info
        ));
    }
    match (&r.from.toolchain, &r.to.toolchain) {
        (Some(a), Some(b)) if a == b => out.push_str(&format!("toolchain: stable ({a})\n")),
        (Some(a), Some(b)) => out.push_str(&format!("toolchain: changed ({a} → {b})\n")),
        _ => out.push_str(
            "toolchain: not recorded (one or both scans predate crate-inventory persistence)\n",
        ),
    }
    let c = &r.crates;
    out.push_str(&format!(
        "crates: {} added, {} removed, {} version-changed, {} unchanged\n",
        c.added.len(),
        c.removed.len(),
        c.version_changed.len(),
        c.unchanged
    ));
    for a in &c.added {
        out.push_str(&format!("  + {} {}\n", a.name, a.version));
    }
    for v in &c.removed {
        out.push_str(&format!("  - {} {}\n", v.name, v.version));
    }
    for v in &c.version_changed {
        out.push_str(&format!(
            "  ~ {} {} → {}\n",
            v.name, v.from_version, v.to_version
        ));
    }
    let f = &r.findings;
    out.push_str(&format!(
        "findings: {} added, {} resolved, {} changed\n",
        f.added.len(),
        f.resolved.len(),
        f.changed.len()
    ));
    for a in &f.added {
        out.push_str(&format!("  + [{}] {} — {}\n", a.severity, a.id, a.title));
    }
    for ch in &f.changed {
        out.push_str(&format!(
            "  ~ [{} → {}] {} — {}\n",
            ch.previous_severity, ch.severity, ch.id, ch.title
        ));
    }
    for x in &f.resolved {
        out.push_str(&format!("  - [{}] {} — {}\n", x.severity, x.id, x.title));
    }
    out.push_str(&format!(
        "severity delta: {} critical, {} warning, {} info (negative = fewer)\n",
        r.severity_delta.critical, r.severity_delta.warning, r.severity_delta.info
    ));
    out.push_str(&format!(
        "coverage: findings {} · crates {} · toolchain {} · edges {}\n",
        recorded_label(r.coverage.findings_recorded),
        recorded_label(r.coverage.crates_recorded),
        recorded_label(r.coverage.toolchain_recorded),
        recorded_label(r.coverage.edges_recorded),
    ));
    for n in &r.notes {
        out.push_str(&format!("  note: {n}\n"));
    }
    out
}

fn recorded_label(recorded: bool) -> &'static str {
    if recorded {
        "recorded"
    } else {
        "NOT recorded"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{self, CrateSnapshot, FindingRow};
    use std::path::PathBuf;

    fn tempdir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("wanyrix-compare-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The exact JSON `wanyrix doctor --json` emits for the tiny-ws fixture
    /// with a pinned generatedAt (deterministic store input).
    fn tiny_ws_payload(generated_at: &str) -> String {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/tiny-ws");
        let scan = crate::scan::scan_workspace(&root).unwrap();
        let findings = crate::cli::doctor(&scan);
        let r = crate::report::doctor_report(&scan, &findings, generated_at.to_owned());
        crate::cli::serialize_json(&r, false).unwrap()
    }

    fn row(id: &str, severity: &str, evidence: &str) -> FindingRow {
        FindingRow {
            finding_id: id.to_owned(),
            severity: severity.to_owned(),
            title: format!("title {id}"),
            evidence_json: evidence.to_owned(),
        }
    }

    fn snap(name: &str, version: &str) -> CrateSnapshot {
        CrateSnapshot {
            name: name.to_owned(),
            version: version.to_owned(),
            band: "lib".to_owned(),
            node_kind: "workspace".to_owned(),
            manifest_path: format!("{name}/Cargo.toml"),
        }
    }

    #[test]
    fn diff_findings_pairs_duplicates_and_names_all_three_buckets() {
        let baseline = vec![
            row("FER-A", "info", "[]"),
            row("FER-B", "warning", "[]"),
            row("FER-B", "warning", "[]"),
        ];
        let current = vec![
            row("FER-A", "warning", "[]"), // severity changed
            row("FER-B", "warning", "[]"), // one of the two resolved
            row("FER-C", "info", "[]"),    // added
        ];
        let d = diff_findings(&baseline, &current);
        assert_eq!(d.added.len(), 1);
        assert_eq!(d.added[0].id, "FER-C");
        assert_eq!(d.resolved.len(), 1);
        assert_eq!(d.resolved[0].id, "FER-B");
        assert_eq!(d.changed.len(), 1);
        assert_eq!(d.changed[0].id, "FER-A");
        assert_eq!(d.changed[0].previous_severity, "info");
        assert_eq!(d.changed[0].severity, "warning");
    }

    #[test]
    fn diff_findings_evidence_drift_is_a_change_even_with_equal_severity() {
        let baseline = vec![row("FER-A", "warning", r#"[{"k":"v1"}]"#)];
        let current = vec![row("FER-A", "warning", r#"[{"k":"v2"}]"#)];
        let d = diff_findings(&baseline, &current);
        assert!(d.added.is_empty() && d.resolved.is_empty());
        assert_eq!(d.changed.len(), 1, "evidence drift is a measured change");
        // Identical inputs diff to zero — the idempotence core.
        assert_eq!(
            diff_findings(&baseline, &baseline),
            FindingsDiff {
                added: vec![],
                resolved: vec![],
                changed: vec![]
            }
        );
    }

    #[test]
    fn diff_crates_names_add_remove_version_and_unchanged() {
        let baseline = vec![
            snap("alpha", "0.1.0"),
            snap("beta", "0.1.0"),
            snap("gamma", "0.2.0"),
            snap("dup", "0.1.0"),
            snap("dup", "0.1.0"),
        ];
        let current = vec![
            snap("alpha", "0.2.0"), // version changed
            snap("beta", "0.1.0"),  // unchanged
            snap("dup", "0.1.0"),   // one of the two removed
            snap("delta", "0.3.0"), // added
        ];
        let d = diff_crates(&baseline, &current);
        assert_eq!(d.added, vec![DiffCrate { name: "delta".into(), version: "0.3.0".into() }]);
        assert_eq!(
            d.removed,
            vec![
                DiffCrate { name: "dup".into(), version: "0.1.0".into() },
                DiffCrate { name: "gamma".into(), version: "0.2.0".into() },
            ],
            "removed rows are sorted by (name, version)"
        );
        assert_eq!(
            d.version_changed,
            vec![VersionChangedCrate {
                name: "alpha".into(),
                from_version: "0.1.0".into(),
                to_version: "0.2.0".into()
            }]
        );
        assert_eq!(d.unchanged, 2, "beta plus the paired dup row");
    }

    #[test]
    fn compare_refuses_unknown_ids_and_cross_workspace_pairs() {
        let dir = tempdir("refusals");
        let db = dir.join("scans.db");
        store::init(&db).unwrap();
        store::save(&db, &tiny_ws_payload("2026-09-18T13:28:56Z")).unwrap();

        let err = compare_scan_refs(&db, 99, 1).unwrap_err().to_string();
        assert!(
            err.contains("compare error: scan #99 not found") && err.contains("store list"),
            "named unknown-id refusal with remediation, got: {err}"
        );
        let err = compare_scan_refs(&db, 1, 99).unwrap_err().to_string();
        assert!(err.contains("scan #99 not found"), "got: {err}");

        // A second, differently-named workspace in the same store.
        let other = tiny_ws_payload("2026-09-18T13:29:56Z")
            .replace("\"workspace\":\"tiny-ws\"", "\"workspace\":\"other-ws\"");
        store::save(&db, &other).unwrap();
        let err = compare_scan_refs(&db, 1, 2).unwrap_err().to_string();
        assert!(
            err.contains("different workspaces") && err.contains("tiny-ws") && err.contains("other-ws"),
            "cross-workspace pair is a named refusal, got: {err}"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn compare_refuses_a_scan_whose_findings_rows_disagree_with_its_count() {
        let dir = tempdir("corrupt");
        let db = dir.join("scans.db");
        store::init(&db).unwrap();
        // The public crash seam: scans row committed, findings row NEVER —
        // exactly the kill-between-commits state `store fsck` detects.
        let scan = store::parse_payload(&tiny_ws_payload("2026-09-18T13:28:56Z")).unwrap();
        let scan_id = store::save_scan_row(&db, &scan).unwrap();
        let err = compare_scan_refs(&db, scan_id, scan_id).unwrap_err().to_string();
        assert!(
            err.contains("compare error: scan #1 is corrupt")
                && err.contains("finding_count=4, but 0 findings rows exist")
                && err.contains("store fsck"),
            "corrupt entry is a named refusal naming the remediation, got: {err}"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn compare_labels_missing_inventory_and_still_diffs_findings() {
        let dir = tempdir("no-inventory");
        let db = dir.join("scans.db");
        store::init(&db).unwrap();
        // A pre-#115-style save: findings committed, inventory never.
        let scan = store::parse_payload(&tiny_ws_payload("2026-09-18T13:28:56Z")).unwrap();
        let scan_id = store::save_scan_row(&db, &scan).unwrap();
        store::save_findings_rows(&db, scan_id, &scan.findings).unwrap();

        let r = compare_scan_refs(&db, scan_id, scan_id).unwrap();
        assert!(!r.coverage.crates_recorded && !r.coverage.toolchain_recorded);
        assert!(r.coverage.findings_recorded && !r.coverage.edges_recorded);
        assert!(
            r.notes.iter().any(|n| n.contains("no recorded crate/toolchain inventory")),
            "the gap is named with a remediation, got: {:?}",
            r.notes
        );
        assert!(r.from.toolchain.is_none(), "no fabricated toolchain");
        // The diff itself runs on whatever WAS recorded (here: findings
        // only, both sides identical ⇒ zero deltas); the missing inventory
        // is carried by the coverage label above, never by invented data.
        assert!(r.crates.added.is_empty() && r.crates.removed.is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn compare_envelope_is_clock_free_and_byte_identical_across_runs() {
        let dir = tempdir("determinism");
        let db = dir.join("scans.db");
        store::init(&db).unwrap();
        store::save(&db, &tiny_ws_payload("2026-09-18T13:28:56Z")).unwrap();
        store::save(&db, &tiny_ws_payload("2026-09-18T14:00:00Z")).unwrap();
        let a = crate::cli::serialize_json(&compare_scan_refs(&db, 1, 2).unwrap(), false).unwrap();
        let b = crate::cli::serialize_json(&compare_scan_refs(&db, 1, 2).unwrap(), false).unwrap();
        assert_eq!(a, b, "repeated invocations are byte-identical");
        assert!(a.contains("\"generatedAt\":\"not-measured\""), "no wall-clock: {a}");
        // generatedAt is the LAST emitted key (envelope field order is the contract).
        let tail = &a[a.len().saturating_sub(60)..];
        assert!(
            tail.contains("\"generatedAt\":\"not-measured\"}"),
            "generatedAt must trail the envelope, tail: {tail}"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn compare_identical_scans_is_a_zero_delta_envelope() {
        let dir = tempdir("zero-delta");
        let db = dir.join("scans.db");
        store::init(&db).unwrap();
        store::save(&db, &tiny_ws_payload("2026-09-18T13:28:56Z")).unwrap();
        store::save(&db, &tiny_ws_payload("2026-09-18T13:28:56Z")).unwrap();
        for (from, to) in [(1, 2), (2, 2)] {
            let r = compare_scan_refs(&db, from, to).unwrap();
            assert_eq!(r.from.workspace, "tiny-ws");
            assert!(r.findings.added.is_empty() && r.findings.resolved.is_empty() && r.findings.changed.is_empty());
            assert!(r.crates.added.is_empty() && r.crates.removed.is_empty() && r.crates.version_changed.is_empty());
            assert_eq!(r.crates.unchanged, 3, "every crate paired unchanged");
            assert_eq!(
                r.severity_delta,
                SeverityDelta { critical: 0, warning: 0, info: 0 }
            );
            assert!(r.coverage.crates_recorded, "a full save records inventory");
        }
        std::fs::remove_dir_all(&dir).ok();
    }
}
