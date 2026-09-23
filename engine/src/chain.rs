//! Engineering-memory chain query — `wanyrix.chain/v1` (issue #100).
//!
//! One deterministic, OFFLINE, read-only query that reconstructs the full
//! evidence chain for a workspace's stored artifacts:
//!
//! ```text
//! scan (SQLite store) → finding(s) → experiment(s) → measurement(s)
//!                                        └→ verification verdict
//! ```
//!
//! joined from the three stores the engine already keeps:
//!
//! - the scan store (`--db`, `wanyrix store save`) — scans + findings rows,
//! - the experiment ledger (`<path>/.wanyrix/experiments.jsonl`) —
//!   hypotheses, real measurements and the verification verdict,
//! - the durable event log (`<path>/.wanyrix/events.jsonl`) — the
//!   append-only transition mirror.
//!
//! # Honesty contract
//!
//! 1. **Evidence labels are echoed VERBATIM.** `status`
//!    (`estimated` / `measured` / `verified`), severities and measurement
//!    records are copied from the stored records byte-for-byte — the chain
//!    NEVER upgrades or downgrades an evidence tier, and never re-computes a
//!    verdict (a verdict exists only because the ledger's verify gate minted
//!    it).
//! 2. **Links are stored, never guessed.** An experiment is attached to a
//!    finding only via its stored `findingId` (`experiment record
//!    --finding <id>`). The chain never infers links from claim text or
//!    timestamps.
//! 3. **Scope ids are operator input → named refusals.** An unknown
//!    `--finding`/`--scan` id, a scope that belongs to a different
//!    workspace than the one measured at `--path`, or both flags at once
//!    are `EngineError::Chain` refusals (exit 2).
//! 4. **Data-level problems are NAMED, never fatal and never silent.** The
//!    chain is read-only, so orphaned experiment→finding links, corrupt
//!    ledger/event lines, non-JSON evidence and inconsistent store rows are
//!    named inside the envelope while everything provable is still served.
//! 5. **No wall-clock.** The chain is a deterministic query over stored
//!    facts: `generatedAt` carries the literal `not-measured` (the
//!    `wanyrix.export/v1` precedent) and is declared LAST, so repeat
//!    queries over unchanged inputs are byte-identical — team-diffable
//!    evidence, like export.
//! 6. **No absolute paths in the envelope.** Records are echoed verbatim;
//!    nothing about the machine's filesystem layout leaks into the JSON.

use std::collections::BTreeSet;
use std::path::Path;

use serde::Serialize;

use crate::events;
use crate::export::NOT_MEASURED_TIMESTAMP;
use crate::model::EngineError;
use crate::product::ExperimentRecord;
use crate::scan::scan_workspace;
use crate::store::{self, FindingRow, ScanRow};
use crate::timestamp::iso8601_from_unix;

/// Schema of the chain envelope.
pub const CHAIN_SCHEMA: &str = "wanyrix.chain/v1";

/// Echoed honesty note — pinned wording (tests assert it).
pub const EVIDENCE_LABELS_NOTE: &str = "evidence labels (estimated / measured / verified) are echoed verbatim from the stored records — the chain never upgrades or downgrades evidence tiers";

/// Echoed determinism note — pinned wording (tests assert it).
pub const DETERMINISM_NOTE: &str = "generatedAt carries the literal \"not-measured\" — the chain is a read-only query over stored records and repeat queries over unchanged inputs are byte-identical";

/// What the chain was scoped to (echoed so the envelope is self-describing).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChainScope {
    /// `workspace` | `finding` | `scan`.
    pub mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finding_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scan_id: Option<i64>,
}

/// One finding with the experiments that investigate it (ledger order —
/// append order — within a finding; findings are ordered by id).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChainFinding {
    pub finding_id: String,
    /// Echoed verbatim from the stored row.
    pub severity: String,
    /// Echoed verbatim from the stored row.
    pub title: String,
    /// The stored evidence array verbatim (never re-typed); `null` when the
    /// stored evidence is not valid JSON — named in `storeInconsistencies`.
    pub evidence: serde_json::Value,
    /// Experiments whose stored `findingId` is this finding, in ledger
    /// (append) order. Records echoed verbatim.
    pub experiments: Vec<ExperimentRecord>,
}

/// One stored scan with its (in-scope) findings.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChainScan {
    pub scan_id: i64,
    /// The payload's measured `generatedAt`, rendered from the stored epoch.
    pub finished_at: String,
    pub finding_count: i64,
    pub severity_critical: i64,
    pub severity_warning: i64,
    pub severity_info: i64,
    pub schema_version: i64,
    pub findings: Vec<ChainFinding>,
}

/// The transition trail for the in-scope experiments (metadata only — the
/// full payload is the experiment record itself, already embedded verbatim
/// under its finding; `wanyrix events` prints payloads). Ordered by event id.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChainEvent {
    pub id: u64,
    pub kind: String,
    pub subject: String,
    pub emitted_at: String,
}

/// An experiment whose stored `findingId` does not resolve to any finding in
/// this chain's scope — a dangling link, NAMED (with the record attached,
/// verbatim) instead of dropped or silently re-linked.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrphanLink {
    /// The full experiment record, verbatim.
    pub experiment: ExperimentRecord,
    /// The dangling finding id, verbatim.
    pub finding_id: String,
    pub note: String,
}

/// `wanyrix.chain/v1` — the engineering-memory chain envelope.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChainReport {
    pub schema: String,
    pub workspace: String,
    pub scope: ChainScope,
    pub scans: Vec<ChainScan>,
    /// Ledger experiments with NO finding link (pre-#100 records or
    /// deliberately workspace-level hypotheses). Verbatim records.
    pub unlinked_experiments: Vec<ExperimentRecord>,
    pub orphan_links: Vec<OrphanLink>,
    /// Corrupt experiment-ledger lines (path, line number, reason) — named,
    /// never a silent drop; the valid records around them still serve.
    pub corrupt_ledger_lines: Vec<String>,
    /// Corrupt event-log lines, same honesty rule.
    pub corrupt_event_lines: Vec<String>,
    /// Store-level inconsistencies detected read-only (the `store fsck`
    /// classes restricted to this chain's scope, plus unattributable orphan
    /// finding rows) and non-JSON evidence rows.
    pub store_inconsistencies: Vec<String>,
    pub events: Vec<ChainEvent>,
    pub notes: Vec<String>,
    /// LAST key — deliberately `"not-measured"` (no wall-clock in a
    /// deterministic query; byte-identical reruns).
    pub generated_at: String,
}

/// Build the chain report. `finding`/`scan_id` scope the chain (mutually
/// exclusive; neither = the whole measured workspace).
pub fn chain_report(
    root: &Path,
    db_path: &Path,
    finding: Option<&str>,
    scan_id: Option<i64>,
) -> Result<ChainReport, EngineError> {
    if finding.is_some() && scan_id.is_some() {
        return Err(EngineError::Chain(
            "--finding and --scan are mutually exclusive scopes — pass exactly one (or neither for the whole workspace chain)".into(),
        ));
    }
    // The workspace identity is MEASURED at --path (the same honesty rule as
    // what-changed): the ledger + event log live under <path>/.wanyrix and
    // the store is keyed by the workspace name, so a chain without a real
    // workspace would join nothing.
    let scan = scan_workspace(root)?;
    let workspace = scan.workspace_name;

    // Scope resolution — operator input errors are named refusals here.
    let in_scope: Vec<(ScanRow, Vec<FindingRow>)> = match (finding, scan_id) {
        (Some(fid), _) => {
            let occurrences = store::finding_occurrences(db_path, fid)?;
            if occurrences.is_empty() {
                return Err(EngineError::Chain(format!(
                    "unknown finding id {fid:?} — no stored scan in the store contains it (save scans with: wanyrix doctor --json | wanyrix store save --db <db> --scan -)"
                )));
            }
            let here: Vec<&store::FindingOccurrence> = occurrences
                .iter()
                .filter(|o| o.scan.workspace == workspace)
                .collect();
            if here.is_empty() {
                let workspaces = store::finding_workspaces(db_path, fid)?;
                return Err(EngineError::Chain(format!(
                    "finding {fid:?} is stored only under workspace(s) {workspaces:?} — this chain is scoped to workspace {workspace:?} (measured at --path); point --path at the workspace root that owns the finding"
                )));
            }
            // Group by scan, preserving scan-id order (occurrences are
            // ordered by scan id).
            let mut grouped: Vec<(ScanRow, Vec<FindingRow>)> = Vec::new();
            for o in here {
                match grouped.last_mut() {
                    Some((scan, findings)) if scan.id == o.scan.id => {
                        findings.push(o.finding.clone())
                    }
                    _ => grouped.push((o.scan.clone(), vec![o.finding.clone()])),
                }
            }
            grouped
        }
        (None, Some(id)) => {
            let row = store::scan_by_id(db_path, id)?;
            match row {
                None => {
                    return Err(EngineError::Chain(format!(
                        "unknown scan id {id} — `wanyrix store list --db <db>` prints the stored scan ids"
                    )));
                }
                Some(row) if row.workspace != workspace => {
                    return Err(EngineError::Chain(format!(
                        "scan {id} belongs to workspace {:?} — this chain is scoped to workspace {workspace:?} (measured at --path); point --path at that workspace's root",
                        row.workspace
                    )));
                }
                Some(row) => {
                    let findings = store::findings_for(db_path, row.id)?;
                    vec![(row, findings)]
                }
            }
        }
        (None, None) => {
            // Workspace scope: every stored scan of this workspace, all its
            // findings. An empty result is a VALID envelope (notes say how
            // to seed the store) — an empty store is not an operator error.
            let rows = store::list(db_path, Some(&workspace))?;
            let mut grouped = Vec::with_capacity(rows.len());
            for row in rows {
                let findings = store::findings_for(db_path, row.id)?;
                grouped.push((row, findings));
            }
            grouped
        }
    };

    // Findings → chain findings (ordered by finding_id within a scan; the
    // store readers already order them). Evidence is served verbatim; a
    // non-JSON evidence row is named and served as null.
    let mut scans = Vec::with_capacity(in_scope.len());
    let mut scope_finding_ids: BTreeSet<String> = BTreeSet::new();
    let mut inconsistencies: Vec<String> = Vec::new();
    for (row, findings) in in_scope {
        let mut chain_findings = Vec::with_capacity(findings.len());
        for f in findings {
            scope_finding_ids.insert(f.finding_id.clone());
            let evidence = match serde_json::from_str(&f.evidence_json) {
                Ok(v) => v,
                Err(e) => {
                    inconsistencies.push(format!(
                        "scan {} finding {}: stored evidence is not valid JSON ({e}) — served as null (repair the row or run `wanyrix store fsck`)",
                        row.id, f.finding_id
                    ));
                    serde_json::Value::Null
                }
            };
            chain_findings.push(ChainFinding {
                finding_id: f.finding_id,
                severity: f.severity,
                title: f.title,
                evidence,
                experiments: Vec::new(),
            });
        }
        scans.push(ChainScan {
            scan_id: row.id,
            finished_at: iso8601_from_unix(row.finished_at.max(0) as u64),
            finding_count: row.finding_count,
            severity_critical: row.severity_critical,
            severity_warning: row.severity_warning,
            severity_info: row.severity_info,
            schema_version: row.schema_version,
            findings: chain_findings,
        });
    }

    // Read the store's integrity report (read-only) and keep the classes
    // that touch this chain's scope; orphan finding rows cannot be
    // attributed to a workspace, so they are always named.
    let fsck = store::fsck(db_path, false)?;
    for (id, stored, actual) in &fsck.incomplete_scans {
        if scans.iter().any(|s| s.scan_id == *id) {
            inconsistencies.push(format!(
                "scan {id}: committed without its full findings row set (finding_count={stored}, findings rows={actual}) — `wanyrix store fsck` reports and can repair this"
            ));
        }
    }
    for (id, stored, actual) in &fsck.count_mismatches {
        if scans.iter().any(|s| s.scan_id == *id) {
            inconsistencies.push(format!(
                "scan {id}: finding_count={stored} but {actual} findings rows exist — `wanyrix store fsck` reports and can repair this"
            ));
        }
    }
    for rowid in &fsck.orphan_findings {
        inconsistencies.push(format!(
            "finding row {rowid}: references a scan that does not exist (dangling row) — `wanyrix store fsck` reports and can repair this"
        ));
    }
    inconsistencies.sort();

    // The experiment ledger — read tolerantly: a corrupt line is named and
    // skipped, the valid records around it still serve (the chain is
    // read-only; failing the whole query over one bad line would hide the
    // rest of the evidence).
    let (records, corrupt_ledger_lines) = read_ledger_tolerant(root)?;

    // Partition the ledger: attached (findingId resolves in scope),
    // orphaned (findingId set but dangling here), unlinked (no findingId).
    // Every ledger record lands in exactly one partition, in ledger order.
    let mut unlinked_experiments: Vec<ExperimentRecord> = Vec::new();
    let mut orphan_links: Vec<OrphanLink> = Vec::new();
    let mut scope_experiment_names: BTreeSet<String> = BTreeSet::new();
    for rec in records {
        scope_experiment_names.insert(rec.name.clone());
        match rec.finding_id.clone() {
            None => unlinked_experiments.push(rec),
            Some(fid) => match scope_finding_ids.contains(&fid) {
                true => {
                    for s in &mut scans {
                        for f in &mut s.findings {
                            if f.finding_id == fid {
                                f.experiments.push(rec.clone());
                            }
                        }
                    }
                }
                false => orphan_links.push(OrphanLink {
                    note: format!(
                        "experiment {:?} links finding {fid:?}, but no stored finding with that id is in this chain's scope — the link is dangling here (check the workspace scope or store contents; the id is echoed verbatim, never re-linked by guesswork)",
                        rec.name
                    ),
                    experiment: rec,
                    finding_id: fid,
                }),
            },
        }
    }

    // The event trail for the in-scope experiments (any partition), ordered
    // by event id; corrupt event lines are named, not fatal.
    let log = events::read_events(root)?;
    let mut chain_events: Vec<ChainEvent> = log
        .events
        .iter()
        .filter(|e| scope_experiment_names.contains(&e.subject))
        .map(|e| ChainEvent {
            id: e.id,
            kind: e.kind.clone(),
            subject: e.subject.clone(),
            emitted_at: e.emitted_at.clone(),
        })
        .collect();
    chain_events.sort_by_key(|e| e.id);

    // Honesty notes (deterministic; the seeded-store remediation is
    // appended only when the workspace scope found nothing).
    let mut notes = vec![EVIDENCE_LABELS_NOTE.to_owned(), DETERMINISM_NOTE.to_owned()];
    let mode = if finding.is_some() {
        "finding"
    } else if scan_id.is_some() {
        "scan"
    } else {
        "workspace"
    };
    if mode == "workspace" && scans.is_empty() {
        notes.push(format!(
            "no stored scans for workspace {workspace:?} in this store — seed one with: wanyrix doctor --json | wanyrix store save --db <db> --scan -"
        ));
    }

    Ok(ChainReport {
        schema: CHAIN_SCHEMA.to_owned(),
        workspace,
        scope: ChainScope {
            mode: mode.to_owned(),
            finding_id: finding.map(|f| f.to_owned()),
            scan_id,
        },
        scans,
        unlinked_experiments,
        orphan_links,
        corrupt_ledger_lines,
        corrupt_event_lines: log.corrupt,
        store_inconsistencies: inconsistencies,
        events: chain_events,
        notes,
        generated_at: NOT_MEASURED_TIMESTAMP.to_owned(),
    })
}

/// Read the experiment ledger tolerantly: valid records + one named entry
/// per corrupt line (path + line number + reason). A MISSING ledger is an
/// empty one (the chain still serves the store side).
fn read_ledger_tolerant(root: &Path) -> Result<(Vec<ExperimentRecord>, Vec<String>), EngineError> {
    let path = crate::product::ledger_path(root);
    if !path.exists() {
        return Ok((Vec::new(), Vec::new()));
    }
    let text = std::fs::read_to_string(&path).map_err(|e| {
        EngineError::Io(std::io::Error::new(
            e.kind(),
            format!("{}: {e}", path.display()),
        ))
    })?;
    let mut records = Vec::new();
    let mut corrupt = Vec::new();
    for (i, line) in text.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str(line) {
            Ok(rec) => records.push(rec),
            Err(e) => corrupt.push(format!(
                "{} line {} is not a valid experiment record: {e}",
                path.display(),
                i + 1
            )),
        }
    }
    Ok((records, corrupt))
}

/// Human-readable chain tree (pinned format, deterministic — no wall-clock,
/// no absolute paths). The `--json` envelope is the contract; this is the
/// operator-facing rendering of the same facts.
pub fn chain_human(r: &ChainReport) -> String {
    let scope = match (r.scope.mode.as_str(), &r.scope.finding_id, r.scope.scan_id) {
        ("finding", Some(f), _) => format!("scope: finding {f}"),
        ("scan", _, Some(id)) => format!("scope: scan #{id}"),
        _ => "scope: workspace".to_owned(),
    };
    let attached: usize = r
        .scans
        .iter()
        .map(|s| {
            s.findings
                .iter()
                .map(|f| f.experiments.len())
                .sum::<usize>()
        })
        .sum();
    let mut out = format!("wanyrix chain — workspace {:?} ({scope})\n", r.workspace);
    out.push_str(&format!(
        "  scans: {} · findings: {} · experiments: {} ({} attached, {} unlinked, {} orphaned) · events: {}\n",
        r.scans.len(),
        r.scans.iter().map(|s| s.findings.len()).sum::<usize>(),
        attached + r.unlinked_experiments.len() + r.orphan_links.len(),
        attached,
        r.unlinked_experiments.len(),
        r.orphan_links.len(),
        r.events.len(),
    ));

    let total_scans = r.scans.len();
    for (si, s) in r.scans.iter().enumerate() {
        out.push_str(&format!(
            "  scan #{} — {} (v{}) — {} findings ({} critical, {} warning, {} info)\n",
            s.scan_id,
            s.finished_at,
            s.schema_version,
            s.findings.len(),
            s.severity_critical,
            s.severity_warning,
            s.severity_info,
        ));
        let last_f = si + 1 == total_scans;
        for (fi, f) in s.findings.iter().enumerate() {
            let branch = if fi + 1 == s.findings.len() && last_f {
                "    └─"
            } else {
                "    ├─"
            };
            out.push_str(&format!(
                "{branch} {} [{}] {}\n",
                f.finding_id, f.severity, f.title
            ));
            let cont = if fi + 1 == s.findings.len() && last_f {
                "         "
            } else {
                "    │    "
            };
            if f.experiments.is_empty() {
                out.push_str(&format!(
                    "{cont}└─ (no experiment linked — `wanyrix experiment record --finding {} --name <n> --claim <c>` records one)\n",
                    f.finding_id
                ));
            }
            for e in &f.experiments {
                out.push_str(&format!(
                    "{cont}└─ experiment {:?} [{}] — {}\n",
                    e.name, e.status, e.claim
                ));
                let mline = |label: &str, m: &Option<crate::product::Measurement>| match m {
                    Some(m) => format!(
                        "{cont}   {label}: {} ms (buildSuccess: {}) at {}\n",
                        m.wall_clock_ms, m.build_success, m.measured_at
                    ),
                    None => format!("{cont}   {label}: not measured\n"),
                };
                out.push_str(&mline("baseline", &e.baseline));
                out.push_str(&mline("candidate", &e.candidate));
                if let Some(v) = &e.verified_at {
                    out.push_str(&format!("{cont}   verdict: verified at {v}\n"));
                }
            }
        }
    }

    out.push_str(&format!(
        "  unlinked experiments ({})\n",
        r.unlinked_experiments.len()
    ));
    for e in &r.unlinked_experiments {
        out.push_str(&format!(
            "    └─ {:?} [{}] — {} (no findingId link — `wanyrix experiment record --finding <id> …` records one)\n",
            e.name, e.status, e.claim
        ));
    }
    out.push_str(&format!(
        "  orphaned experiment→finding links ({})\n",
        r.orphan_links.len()
    ));
    for o in &r.orphan_links {
        out.push_str(&format!(
            "    └─ experiment {:?} → finding {}: {}\n",
            o.experiment.name, o.finding_id, o.note
        ));
    }
    out.push_str(&format!(
        "  corrupt ledger lines ({}) · corrupt event lines ({}) · store inconsistencies ({})\n",
        r.corrupt_ledger_lines.len(),
        r.corrupt_event_lines.len(),
        r.store_inconsistencies.len()
    ));
    for c in r
        .corrupt_ledger_lines
        .iter()
        .chain(r.corrupt_event_lines.iter())
        .chain(r.store_inconsistencies.iter())
    {
        out.push_str(&format!("    ! {c}\n"));
    }
    if !r.events.is_empty() {
        out.push_str(&format!("  events ({})\n", r.events.len()));
        for e in &r.events {
            out.push_str(&format!(
                "    #{} {} {:?} at {}\n",
                e.id, e.kind, e.subject, e.emitted_at
            ));
        }
    }
    out.push_str("  notes:\n");
    for n in &r.notes {
        out.push_str(&format!("    - {n}\n"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli;
    use crate::product;
    use crate::synth;
    use std::path::PathBuf;

    fn tempdir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("wanyrix-chain-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Seed a real chain: a synth workspace, a doctor payload saved into a
    /// fresh store. Returns (ws, db, scan_id, stored finding rows).
    fn seeded(tag: &str) -> (PathBuf, PathBuf, i64, Vec<store::FindingRow>) {
        let ws = tempdir(tag);
        synth::synth(&ws, 2, 17).unwrap();
        let scan = scan_workspace(&ws).unwrap();
        let findings = cli::doctor(&scan);
        let payload =
            crate::report::doctor_report(&scan, &findings, "2026-09-18T13:28:56Z".to_owned());
        let db = tempdir(&format!("{tag}-db")).join("scans.db");
        store::init(&db).unwrap();
        let outcome = store::save(&db, &cli::serialize_json(&payload, false).unwrap()).unwrap();
        let rows = store::findings_for(&db, outcome.scan_id).unwrap();
        assert!(!rows.is_empty(), "the synth fixture has findings");
        (ws, db, outcome.scan_id, rows)
    }

    /// Persist records to the ledger exactly the way `product::write_ledger`
    /// does (the write path itself is exercised by the experiment tests and
    /// the binary suite; this keeps the chain tests cargo-free).
    fn write_ledger(ws: &Path, records: &[ExperimentRecord]) {
        let dir = ws.join(".wanyrix");
        std::fs::create_dir_all(&dir).unwrap();
        let mut text = String::new();
        for r in records {
            text.push_str(&cli::serialize_json(r, false).unwrap());
            text.push('\n');
        }
        std::fs::write(product::ledger_path(ws), text).unwrap();
    }

    #[test]
    fn happy_chain_joins_scan_finding_experiment_measurement_verdict() {
        let (ws, db, _scan_id, rows) = seeded("happy");
        let fid = rows[0].finding_id.clone();

        // estimated → measured → verified, linked to the stored finding.
        let rec =
            product::experiment_record(&ws, "halve-build", "cut wall clock", Some(&fid)).unwrap();
        let rec = product::apply_measurement(
            rec,
            "baseline",
            1_000,
            true,
            "cargo build",
            "2026-09-18T14:00:00Z",
        )
        .unwrap();
        let rec = product::apply_measurement(
            rec,
            "candidate",
            500,
            true,
            "cargo build",
            "2026-09-18T14:01:00Z",
        )
        .unwrap();
        let verified = match product::verify_record(rec, "2026-09-18T14:02:00Z").unwrap() {
            crate::product::VerifyOutcome::Verified(rec) => rec,
            other => panic!("expected Verified, got {other:?}"),
        };
        assert_eq!(verified.status, "verified");
        write_ledger(&ws, std::slice::from_ref(&verified));

        let r = chain_report(&ws, &db, None, None).unwrap();
        assert_eq!(r.schema, CHAIN_SCHEMA);
        assert_eq!(r.workspace, ws.file_name().unwrap().to_str().unwrap());
        assert_eq!(r.scope.mode, "workspace");
        assert_eq!(r.scans.len(), 1);
        assert_eq!(
            r.scans[0].findings.len(),
            rows.len(),
            "every stored finding of the scan is in the chain"
        );
        assert_eq!(r.scans[0].finished_at, "2026-09-18T13:28:56Z");

        let linked = r
            .scans
            .iter()
            .flat_map(|s| &s.findings)
            .find(|f| f.finding_id == fid)
            .expect("the linked finding is in the chain");
        assert_eq!(linked.experiments.len(), 1);
        let e = &linked.experiments[0];
        // VERBATIM echo: the label is exactly what the ledger recorded.
        assert_eq!(e.status, "verified");
        assert_eq!(e.verified_at.as_deref(), Some("2026-09-18T14:02:00Z"));
        assert_eq!(e.finding_id.as_deref(), Some(fid.as_str()));
        assert_eq!(e.baseline.as_ref().unwrap().wall_clock_ms, 1_000);
        assert_eq!(e.candidate.as_ref().unwrap().wall_clock_ms, 500);
        assert!(r.unlinked_experiments.is_empty());
        assert!(r.orphan_links.is_empty());
        assert!(r.corrupt_ledger_lines.is_empty());
        assert_eq!(r.events.len(), 1, "the record transition minted one event");
        assert_eq!(r.events[0].kind, "experiment.recorded");
        assert!(r.notes.contains(&EVIDENCE_LABELS_NOTE.to_owned()));
        assert!(r.notes.contains(&DETERMINISM_NOTE.to_owned()));
        std::fs::remove_dir_all(&ws).unwrap();
        std::fs::remove_dir_all(db.parent().unwrap()).unwrap();
    }

    #[test]
    fn chain_query_is_deterministic_byte_identical_and_clock_free() {
        let (ws, db, _, rows) = seeded("determinism");
        product::experiment_record(&ws, "exp", "claim", Some(&rows[0].finding_id)).unwrap();
        let a = chain_report(&ws, &db, None, None).unwrap();
        let b = chain_report(&ws, &db, None, None).unwrap();
        let a_str = cli::serialize_json(&a, false).unwrap();
        let b_str = cli::serialize_json(&b, false).unwrap();
        assert_eq!(a_str, b_str, "repeat queries are byte-identical");
        assert_eq!(a.generated_at, "not-measured");
        assert!(!a_str.contains("generatedAt\":\"2"), "no wall-clock stamp");
        // generatedAt is the LAST key of the envelope (honesty contract).
        let tail = &a_str[a_str.len() - 60..];
        assert!(
            tail.contains("\"generatedAt\":\"not-measured\"}"),
            "generatedAt must trail the envelope, tail: {tail}"
        );
        // The human tree is deterministic too.
        assert_eq!(chain_human(&a), chain_human(&b));
        std::fs::remove_dir_all(&ws).unwrap();
        std::fs::remove_dir_all(db.parent().unwrap()).unwrap();
    }

    #[test]
    fn unknown_finding_id_is_a_named_error() {
        let (ws, db, _, _) = seeded("unknown-finding");
        let err = chain_report(&ws, &db, Some("FER-NOPE-999"), None).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("memory chain error"), "named variant: {msg}");
        assert!(msg.contains("unknown finding id"), "actionable: {msg}");
        std::fs::remove_dir_all(&ws).unwrap();
        std::fs::remove_dir_all(db.parent().unwrap()).unwrap();
    }

    #[test]
    fn unknown_scan_id_is_a_named_error() {
        let (ws, db, _, _) = seeded("unknown-scan");
        let err = chain_report(&ws, &db, None, Some(999)).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("unknown scan id 999"), "got: {msg}");
        std::fs::remove_dir_all(&ws).unwrap();
        std::fs::remove_dir_all(db.parent().unwrap()).unwrap();
    }

    #[test]
    fn both_scope_flags_are_refused() {
        let (ws, db, _, rows) = seeded("both-scopes");
        let err = chain_report(&ws, &db, Some(&rows[0].finding_id), Some(1)).unwrap_err();
        assert!(err.to_string().contains("mutually exclusive"));
        std::fs::remove_dir_all(&ws).unwrap();
        std::fs::remove_dir_all(db.parent().unwrap()).unwrap();
    }

    #[test]
    fn finding_scope_limits_the_chain_and_cross_workspace_hits_name_the_remediation() {
        let (ws, db, _, rows) = seeded("finding-scope");
        let fid = rows[1].finding_id.clone();
        let r = chain_report(&ws, &db, Some(&fid), None).unwrap();
        assert_eq!(r.scope.mode, "finding");
        assert_eq!(r.scope.finding_id.as_deref(), Some(fid.as_str()));
        assert_eq!(r.scans.len(), 1);
        assert_eq!(r.scans[0].findings.len(), 1, "only the scoped finding");
        assert_eq!(r.scans[0].findings[0].finding_id, fid);

        // The same finding id, queried from the WRONG workspace root: named
        // refusal that names the owning workspace (actionable, not a drop).
        let other = tempdir("finding-scope-other");
        synth::synth(&other, 2, 17).unwrap();
        let err = chain_report(&other, &db, Some(&fid), None).unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("stored only under workspace")
                && msg.contains(ws.file_name().unwrap().to_str().unwrap()),
            "remediation names the owning workspace: {msg}"
        );
        std::fs::remove_dir_all(&ws).unwrap();
        std::fs::remove_dir_all(&other).unwrap();
        std::fs::remove_dir_all(db.parent().unwrap()).unwrap();
    }

    #[test]
    fn scan_scope_limits_the_chain_and_names_a_foreign_workspace() {
        let (ws, db, scan_id, rows) = seeded("scan-scope");
        let r = chain_report(&ws, &db, None, Some(scan_id)).unwrap();
        assert_eq!(r.scope.mode, "scan");
        assert_eq!(r.scope.scan_id, Some(scan_id));
        assert_eq!(r.scans.len(), 1);
        assert_eq!(
            r.scans[0].findings.len(),
            rows.len(),
            "every stored finding of the scoped scan is in the chain"
        );

        // A scan id that exists but belongs to another workspace.
        let other_ws = tempdir("scan-scope-other");
        synth::synth(&other_ws, 2, 17).unwrap();
        let scan = scan_workspace(&other_ws).unwrap();
        let findings = cli::doctor(&scan);
        let payload =
            crate::report::doctor_report(&scan, &findings, "2026-09-18T15:00:00Z".to_owned());
        let foreign_id = store::save(&db, &cli::serialize_json(&payload, false).unwrap())
            .unwrap()
            .scan_id;
        // The foreign scan is a VALID chain from its own workspace root —
        // and a named refusal from the WRONG one (this chain is scoped to
        // `ws`, the scan belongs to `other_ws`).
        let own = chain_report(&other_ws, &db, None, Some(foreign_id)).unwrap();
        assert_eq!(own.scope.scan_id, Some(foreign_id));
        assert_eq!(
            own.workspace,
            other_ws.file_name().unwrap().to_str().unwrap()
        );
        let err = chain_report(&ws, &db, None, Some(foreign_id)).unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains(&format!("scan {foreign_id} belongs to workspace"))
                && msg.contains(other_ws.file_name().unwrap().to_str().unwrap(),),
            "the refusal names the owning workspace: {msg}"
        );
        std::fs::remove_dir_all(&ws).unwrap();
        std::fs::remove_dir_all(&other_ws).unwrap();
        std::fs::remove_dir_all(db.parent().unwrap()).unwrap();
    }

    #[test]
    fn orphaned_links_are_named_not_fatal_and_never_silently_relinked() {
        let (ws, db, _, rows) = seeded("orphan");
        let fid0 = rows[0].finding_id.clone();
        // One valid link + one dangling link.
        product::experiment_record(&ws, "real", "claim", Some(&fid0)).unwrap();
        product::experiment_record(&ws, "ghost", "claim", Some("FER-GHOST-000")).unwrap();

        let r = chain_report(&ws, &db, None, None).unwrap();
        assert_eq!(r.orphan_links.len(), 1);
        assert_eq!(r.orphan_links[0].finding_id, "FER-GHOST-000");
        assert_eq!(r.orphan_links[0].experiment.name, "ghost");
        assert!(
            r.orphan_links[0].note.contains("dangling"),
            "the note says what is wrong: {}",
            r.orphan_links[0].note
        );
        // The valid chain still serves — a dangling link never hides evidence.
        let real = r
            .scans
            .iter()
            .flat_map(|s| &s.findings)
            .find(|f| f.finding_id == fid0)
            .unwrap();
        assert_eq!(real.experiments.len(), 1);
        // The ghost experiment is NOT attached anywhere by guesswork.
        let attached: usize = r
            .scans
            .iter()
            .flat_map(|s| &s.findings)
            .map(|f| f.experiments.len())
            .sum();
        assert_eq!(attached, 1);
        std::fs::remove_dir_all(&ws).unwrap();
        std::fs::remove_dir_all(db.parent().unwrap()).unwrap();
    }

    #[test]
    fn unlinked_experiments_are_listed_with_their_records() {
        let (ws, db, _, _) = seeded("unlinked");
        product::experiment_record(&ws, "free-floating", "claim", None).unwrap();
        let r = chain_report(&ws, &db, None, None).unwrap();
        assert_eq!(r.unlinked_experiments.len(), 1);
        assert_eq!(r.unlinked_experiments[0].name, "free-floating");
        assert!(r.unlinked_experiments[0].finding_id.is_none());
        std::fs::remove_dir_all(&ws).unwrap();
        std::fs::remove_dir_all(db.parent().unwrap()).unwrap();
    }

    #[test]
    fn corrupt_ledger_and_event_lines_are_named_and_skipped() {
        let (ws, db, _, rows) = seeded("corrupt");
        let fid = rows[0].finding_id.clone();
        product::experiment_record(&ws, "good", "claim", Some(&fid)).unwrap();
        let ledger = product::ledger_path(&ws);
        let mut text = std::fs::read_to_string(&ledger).unwrap();
        text.push_str("GARBAGE-NOT-JSON\n");
        std::fs::write(&ledger, text).unwrap();
        let events_path = events::events_path(&ws);
        std::fs::write(&events_path, "ALSO-GARBAGE\n").unwrap();

        let r = chain_report(&ws, &db, None, None).unwrap();
        assert_eq!(r.corrupt_ledger_lines.len(), 1);
        assert!(
            r.corrupt_ledger_lines[0].contains("line 2"),
            "the ledger line is named: {}",
            r.corrupt_ledger_lines[0]
        );
        assert_eq!(r.corrupt_event_lines.len(), 1);
        // The valid record still serves.
        assert_eq!(
            r.scans
                .iter()
                .flat_map(|s| &s.findings)
                .find(|f| f.finding_id == fid)
                .unwrap()
                .experiments
                .len(),
            1
        );
        std::fs::remove_dir_all(&ws).unwrap();
        std::fs::remove_dir_all(db.parent().unwrap()).unwrap();
    }

    #[test]
    fn corrupt_evidence_and_incomplete_scans_are_named_not_fatal() {
        let (ws, db, scan_id, rows) = seeded("inconsistent");
        let fid = rows[0].finding_id.clone();

        // (a) non-JSON evidence row — the chain names it and serves null.
        {
            let conn = store::open_existing(&db).unwrap();
            conn.execute(
                "UPDATE findings SET evidence_json = 'NOT-JSON' WHERE finding_id = ?1",
                rusqlite::params![fid],
            )
            .unwrap();
        }
        // (b) the two-phase crash seam: a scan row committed without its
        // findings rows (the exact kill-between-commits state fsck exists
        // for) — named, and the healthy scan still serves.
        let crash_scan = store::parse_payload(&{
            let scan = scan_workspace(&ws).unwrap();
            let findings = cli::doctor(&scan);
            let mut p =
                crate::report::doctor_report(&scan, &findings, "2026-09-18T16:00:00Z".to_owned());
            // rename the workspace so it lands in scope too
            p.workspace = "chain-inconsistent".to_owned();
            cli::serialize_json(&p, false).unwrap()
        })
        .unwrap();
        store::save_scan_row(&db, &crash_scan).unwrap();
        // drop the connection without the findings commit (the seam)

        let r = chain_report(&ws, &db, None, Some(scan_id)).unwrap();
        assert!(
            r.store_inconsistencies
                .iter()
                .any(|s| s.contains(&fid) && s.contains("not valid JSON")),
            "corrupt evidence named: {:?}",
            r.store_inconsistencies
        );
        let f = r
            .scans
            .iter()
            .flat_map(|s| &s.findings)
            .find(|f| f.finding_id == fid)
            .unwrap();
        assert_eq!(f.evidence, serde_json::Value::Null, "served as null");
        std::fs::remove_dir_all(&ws).unwrap();
        std::fs::remove_dir_all(db.parent().unwrap()).unwrap();
    }

    #[test]
    fn incomplete_scan_in_scope_is_named_via_the_fsck_classes() {
        let (ws, db, _, _) = seeded("fsck-class");
        // A second workspace whose scan row was committed WITHOUT its
        // findings rows (the two-phase crash seam) — out of chain scope, so
        // it must NOT be attributed to this chain.
        let other = tempdir("fsck-class-other");
        synth::synth(&other, 2, 17).unwrap();
        let scan = scan_workspace(&other).unwrap();
        let findings = cli::doctor(&scan);
        let payload =
            crate::report::doctor_report(&scan, &findings, "2026-09-18T17:00:00Z".to_owned());
        let parsed = store::parse_payload(&cli::serialize_json(&payload, false).unwrap()).unwrap();
        store::save_scan_row(&db, &parsed).unwrap();

        let r = chain_report(&ws, &db, None, None).unwrap();
        assert!(
            r.store_inconsistencies.is_empty(),
            "out-of-scope inconsistencies are not attributed: {:?}",
            r.store_inconsistencies
        );
        std::fs::remove_dir_all(&ws).unwrap();

        // Now scope to the broken workspace: the inconsistency is named.
        let r = chain_report(&other, &db, None, None).unwrap();
        assert!(
            r.store_inconsistencies
                .iter()
                .any(|s| s.contains("committed without its full findings row set")),
            "got: {:?}",
            r.store_inconsistencies
        );
        std::fs::remove_dir_all(&other).unwrap();
        std::fs::remove_dir_all(db.parent().unwrap()).unwrap();
    }

    #[test]
    fn empty_store_is_a_valid_envelope_with_the_seeding_note() {
        let (ws, db, _, _) = seeded("empty");
        // A DIFFERENT workspace chain over a store that holds nothing for it.
        let other = tempdir("empty-other");
        synth::synth(&other, 2, 17).unwrap();
        let r = chain_report(&other, &db, None, None).unwrap();
        assert!(r.scans.is_empty());
        assert!(
            r.notes
                .iter()
                .any(|n| n.contains("no stored scans for workspace")),
            "remediation note present: {:?}",
            r.notes
        );
        std::fs::remove_dir_all(&ws).unwrap();
        std::fs::remove_dir_all(&other).unwrap();
        std::fs::remove_dir_all(db.parent().unwrap()).unwrap();
    }

    #[test]
    fn missing_store_is_a_named_error() {
        let ws = tempdir("no-store");
        synth::synth(&ws, 2, 17).unwrap();
        let db = tempdir("no-store-db").join("never-initialized.db");
        let err = chain_report(&ws, &db, None, None).unwrap_err();
        assert!(err.to_string().contains("store not found"), "got: {err}");
        std::fs::remove_dir_all(&ws).unwrap();
        std::fs::remove_dir_all(db.parent().unwrap()).unwrap();
    }

    #[test]
    fn human_tree_renders_the_pinned_sections() {
        let (ws, db, _, rows) = seeded("human");
        let fid = rows[0].finding_id.clone();
        let severity = rows[0].severity.clone();
        let rec =
            product::experiment_record(&ws, "halve-build", "cut wall clock", Some(&fid)).unwrap();
        let rec =
            product::apply_measurement(rec, "baseline", 1_000, true, "cargo build", "t1").unwrap();
        let rec =
            product::apply_measurement(rec, "candidate", 500, true, "cargo build", "t2").unwrap();
        let verified = match product::verify_record(rec, "t3").unwrap() {
            crate::product::VerifyOutcome::Verified(rec) => rec,
            other => panic!("expected Verified, got {other:?}"),
        };
        write_ledger(&ws, &[verified]);

        let r = chain_report(&ws, &db, None, None).unwrap();
        let h = chain_human(&r);
        assert!(h.starts_with("wanyrix chain — workspace"), "header: {h}");
        assert!(h.contains("scope: workspace"));
        assert!(
            h.contains(&format!("├─ {fid} [{severity}]")),
            "finding line echoes the stored severity: {h}"
        );
        assert!(h.contains("experiment \"halve-build\" [verified]"));
        assert!(h.contains("baseline: 1000 ms (buildSuccess: true)"));
        assert!(h.contains("candidate: 500 ms (buildSuccess: true)"));
        assert!(h.contains("verdict: verified at t3"));
        assert!(h.contains("(no experiment linked"));
        assert!(h.contains("orphaned experiment→finding links (0)"));
        assert!(h.contains("notes:"));
        assert!(h.contains("echoed verbatim"));
        std::fs::remove_dir_all(&ws).unwrap();
        std::fs::remove_dir_all(db.parent().unwrap()).unwrap();
    }
}
