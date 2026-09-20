//! Deterministic change intelligence: reverse-dependency blast radius
//! (wanyrix.impact/v1) and snapshot diffing (wanyrix.what-changed/v1).
//!
//! Wanyrix's core promise — "what does this change touch?" — is answered
//! here, deterministically, from data the engine already measured:
//!
//! - `impact` walks the REVERSE of the measured edge list (the same list
//!   every other aggregate derives from — no invented edges). Documented
//!   rule: only `normal` + `build` edges propagate; a `dev`-only break
//!   surfaces as a test finding, not a rebuild. AI is never involved.
//! - `what-changed` diffs a fresh measured scan against the NEWEST stored
//!   scan for the same workspace. The baseline side is exactly what the
//!   store persisted (read back verbatim via `store::findings_for`) — the
//!   store is the single source of truth for "last analysis".
//!
//! Honesty contract: no baseline is not an error — it is a valid envelope
//! with `against: null` and a `baselineNote` naming the remediation
//! (`wanyrix store save`). Unknown crates are a named refusal (mirroring
//! the verify-ledger pattern). Integer math only — the report format has
//! no float keys. `generatedAt` stays the LAST envelope field.

use std::collections::BTreeSet;
use std::path::Path;

use serde::Serialize;

use crate::analysis::Finding;
use crate::model::{EdgeKind, EngineError, WorkspaceScan};
use crate::store::{self, FindingRow};
use crate::timestamp::{iso8601_from_unix, iso8601_now};

/// Envelope schema identifier for `wanyrix impact --json`.
pub const IMPACT_SCHEMA: &str = "wanyrix.impact/v1";
/// Envelope schema identifier for `wanyrix what-changed --json`.
pub const WHAT_CHANGED_SCHEMA: &str = "wanyrix.what-changed/v1";

/// The documented propagation rule, quoted in every envelope.
pub const IMPACT_NOTE: &str =
    "rebuild scope estimated from measured dependency edges only; dev-dependency edges do not propagate impact";

// ----------------------------------------------------------------- impact

/// Reverse-dependency blast radius for one workspace crate.
/// Field order is the wire contract; `generated_at` stays LAST.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImpactReport {
    pub schema: String,
    /// Absolute scan root the edge list was measured under.
    pub root: String,
    /// The crate whose dependents were measured.
    pub crate_name: String,
    /// Direct dependents grouped by declared edge kind (each sorted).
    pub direct_dependents_by_kind: DependentsByKind,
    /// Union of all direct dependents, sorted, deduped.
    pub direct_dependents: Vec<String>,
    /// Transitive dependents: closure over normal+build reverse edges only,
    /// sorted, self excluded. Cycle-safe (visited set).
    pub transitive_dependents: Vec<String>,
    /// Length of `transitive_dependents`.
    pub transitive_count: usize,
    /// Total scanned crates in the workspace.
    pub workspace_crate_count: usize,
    /// Affected share of the workspace, in per-mille (integer math:
    /// `(1 + transitive_count) * 1000 / workspace_crate_count`). No floats
    /// by honesty contract.
    pub blast_radius_per_mille: u64,
    /// The documented estimation rule (quoted, not hidden).
    pub note: String,
    /// LAST field (honesty rule: timestamps last).
    pub generated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependentsByKind {
    pub normal: Vec<String>,
    pub build: Vec<String>,
    pub dev: Vec<String>,
}

/// Compute the impact report for `crate_name` from the scan's measured
/// edge list.
pub fn impact_report(scan: &WorkspaceScan, crate_name: &str) -> Result<ImpactReport, EngineError> {
    // Named refusal for unknown crates — mirroring the verify-ledger
    // pattern. Never an empty "all clear" for a name that was never here.
    if !scan.crates.iter().any(|c| c.name == crate_name) {
        return Err(EngineError::Impact(format!(
            "crate '{crate_name}' is not a workspace crate under {}",
            scan.root.display()
        )));
    }

    let mut by_kind = DependentsByKind {
        normal: Vec::new(),
        build: Vec::new(),
        dev: Vec::new(),
    };
    for e in &scan.edges {
        if e.to == crate_name {
            let from = e.from.clone();
            match e.kind {
                EdgeKind::Normal => by_kind.normal.push(from),
                EdgeKind::Build => by_kind.build.push(from),
                EdgeKind::Dev => by_kind.dev.push(from),
            }
        }
    }
    // The scan's edge list is pre-deduped per (from, to, kind) and sorted;
    // sort again anyway so the report never trusts upstream ordering.
    for v in [&mut by_kind.normal, &mut by_kind.build, &mut by_kind.dev] {
        v.sort();
        v.dedup();
    }

    let mut direct: BTreeSet<String> = BTreeSet::new();
    for v in [&by_kind.normal, &by_kind.build, &by_kind.dev] {
        direct.extend(v.iter().cloned());
    }

    let transitive = propagate_closure(scan, crate_name);
    let transitive_count = transitive.len();
    let workspace_crate_count = scan.crates.len();
    let blast_radius_per_mille =
        ((1 + transitive_count) as u64 * 1000) / workspace_crate_count.max(1) as u64;

    Ok(ImpactReport {
        schema: IMPACT_SCHEMA.to_string(),
        root: scan.root.display().to_string(),
        crate_name: crate_name.to_string(),
        direct_dependents_by_kind: by_kind,
        direct_dependents: direct.into_iter().collect(),
        transitive_dependents: transitive,
        transitive_count,
        workspace_crate_count,
        blast_radius_per_mille,
        note: IMPACT_NOTE.to_string(),
        generated_at: iso8601_now(),
    })
}

/// Reverse-reachability closure over normal+build edges only, excluding
/// `crate_name` itself. Visited-set based, so cyclic workspaces terminate.
fn propagate_closure(scan: &WorkspaceScan, crate_name: &str) -> Vec<String> {
    // Reverse adjacency (dependents) over normal+build edges only — same
    // measured edge list every other aggregate derives from.
    let mut dependents: std::collections::BTreeMap<&str, Vec<&str>> =
        std::collections::BTreeMap::new();
    for e in &scan.edges {
        if matches!(e.kind, EdgeKind::Normal | EdgeKind::Build) {
            dependents
                .entry(e.to.as_str())
                .or_default()
                .push(e.from.as_str());
        }
    }
    let mut visited: BTreeSet<&str> = BTreeSet::new();
    let mut frontier: Vec<&str> = vec![crate_name];
    while let Some(current) = frontier.pop() {
        if let Some(parents) = dependents.get(current) {
            for from in parents {
                if visited.insert(from) {
                    frontier.push(from);
                }
            }
        }
    }
    visited.remove(crate_name);
    visited.into_iter().map(|s| s.to_string()).collect()
}

/// Human-readable impact summary (the non-`--json` flavor). Deterministic.
pub fn impact_human(r: &ImpactReport) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "wanyrix impact — {} ({})\n",
        r.crate_name, r.schema
    ));
    out.push_str(&format!("root: {}\n", r.root));
    let k = &r.direct_dependents_by_kind;
    out.push_str(&format!(
        "direct dependents: {} normal, {} build, {} dev\n",
        k.normal.len(),
        k.build.len(),
        k.dev.len()
    ));
    for (label, list) in [("normal", &k.normal), ("build", &k.build), ("dev", &k.dev)] {
        if !list.is_empty() {
            out.push_str(&format!("  {label}: {}\n", list.join(", ")));
        }
    }
    out.push_str(&format!(
        "transitive dependents ({}): {}\n",
        r.transitive_count,
        if r.transitive_dependents.is_empty() {
            "(none)".to_string()
        } else {
            r.transitive_dependents.join(", ")
        }
    ));
    out.push_str(&format!(
        "blast radius: {}/{} crates affected ({}‰ of workspace)\n",
        1 + r.transitive_count,
        r.workspace_crate_count,
        r.blast_radius_per_mille
    ));
    out.push_str(&format!("note: {}\n", r.note));
    out
}

// ------------------------------------------------------------ what-changed

/// A diffed finding, keyed by stable `finding_id`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFinding {
    pub id: String,
    pub severity: String,
    pub title: String,
}

/// A finding whose severity or evidence changed since the baseline.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFinding {
    pub id: String,
    pub title: String,
    pub previous_severity: String,
    pub severity: String,
}

/// Measured severity-count deltas vs the baseline row (negative = fewer).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeverityDelta {
    pub critical: i64,
    pub warning: i64,
    pub info: i64,
}

/// The baseline reference (`against: null` when the store has no scan for
/// this workspace yet — see `baseline_note`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Against {
    pub scan_id: i64,
    /// ISO-8601 rendering of the baseline's measured `generatedAt`.
    pub finished_at: String,
}

/// Snapshot diff: fresh measured scan vs the newest stored scan for the
/// same workspace. Field order is the wire contract; `generated_at` LAST.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhatChangedReport {
    pub schema: String,
    /// Absolute scan root of the fresh measurement.
    pub root: String,
    pub workspace: String,
    /// The store the baseline was read from (operator-provided path).
    pub db: String,
    /// Baseline reference; `None` when no stored scan exists yet.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub against: Option<Against>,
    /// Present only with `against: null`: the named remediation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baseline_note: Option<String>,
    pub findings: FindingsDiff,
    pub severity_delta: SeverityDelta,
    /// LAST field (honesty rule: timestamps last).
    pub generated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindingsDiff {
    pub added: Vec<DiffFinding>,
    pub resolved: Vec<DiffFinding>,
    pub changed: Vec<ChangedFinding>,
}

/// Compute what changed: fresh scan + analyze vs the newest stored scan of
/// the same workspace in `db`.
pub fn what_changed(
    scan: &WorkspaceScan,
    findings: &[Finding],
    db: &Path,
) -> Result<WhatChangedReport, EngineError> {
    let rows = store::list(db, Some(&scan.workspace_name))?;
    let baseline_row = rows.last().cloned();

    let mut current: Vec<FindingRow> = Vec::with_capacity(findings.len());
    for f in findings {
        // Evidence kept verbatim (already redacted by analysis.rs) —
        // canonicalized through serde_json::Value so the byte form matches
        // exactly what the store persisted from the doctor payload (the
        // store round-trips through Value, which normalizes map key order).
        let canonical =
            serde_json::to_value(&f.evidence).map_err(|e| EngineError::Json(e.to_string()))?;
        current.push(FindingRow {
            finding_id: f.id.clone(),
            severity: f.severity.to_string(),
            title: f.title.clone(),
            evidence_json: serde_json::to_string(&canonical)
                .map_err(|e| EngineError::Json(e.to_string()))?,
        });
    }

    let against = baseline_row.as_ref().map(|row| Against {
        scan_id: row.id,
        finished_at: iso8601_from_unix(row.finished_at.max(0) as u64),
    });
    let baseline_rows: Vec<FindingRow> = match &baseline_row {
        Some(row) => store::findings_for(db, row.id)?,
        None => Vec::new(),
    };
    let baseline_note = baseline_row.as_ref().map_or_else(
        || {
            Some(format!(
                "no stored scan for workspace '{}' in {} — save a baseline with `wanyrix store save --db {}` first; every current finding is reported as added",
                scan.workspace_name,
                db.display(),
                db.display()
            ))
        },
        |_| None,
    );
    let base_counts = baseline_row.as_ref().map_or((0, 0, 0), |r| {
        (r.severity_critical, r.severity_warning, r.severity_info)
    });

    // Diff with DUPLICATE-SAFE pairing. Finding ids are stable per crate
    // NAME — but a scan tree may legitimately contain two crates with the
    // same name (e.g. fixture workspaces nested under the scan root), so
    // rows are grouped by id and paired positionally within each group,
    // in a canonical order (severity, title, evidence). Identical trees
    // therefore always diff to zero; real changes surface exactly.
    let canonical_key = |r: &FindingRow| -> (String, String, String) {
        (r.severity.clone(), r.title.clone(), r.evidence_json.clone())
    };
    let mut baseline_groups: std::collections::BTreeMap<&str, Vec<&FindingRow>> =
        std::collections::BTreeMap::new();
    for r in &baseline_rows {
        baseline_groups
            .entry(r.finding_id.as_str())
            .or_default()
            .push(r);
    }
    let mut current_groups: std::collections::BTreeMap<&str, Vec<&FindingRow>> =
        std::collections::BTreeMap::new();
    for r in &current {
        current_groups
            .entry(r.finding_id.as_str())
            .or_default()
            .push(r);
    }

    let mut added = Vec::new();
    let mut resolved = Vec::new();
    let mut changed = Vec::new();
    for id in baseline_groups
        .keys()
        .chain(current_groups.keys())
        .collect::<BTreeSet<_>>()
    {
        let mut b: Vec<&&FindingRow> = baseline_groups
            .get(id)
            .map(|v| v.iter().collect())
            .unwrap_or_default();
        let mut c: Vec<&&FindingRow> = current_groups
            .get(id)
            .map(|v| v.iter().collect())
            .unwrap_or_default();
        b.sort_by_key(|r| canonical_key(r));
        c.sort_by_key(|r| canonical_key(r));
        let paired = b.len().min(c.len());
        for i in 0..paired {
            let (prev, cur) = (b[i], c[i]);
            if prev.severity != cur.severity || prev.evidence_json != cur.evidence_json {
                changed.push(ChangedFinding {
                    id: cur.finding_id.clone(),
                    title: cur.title.clone(),
                    previous_severity: prev.severity.clone(),
                    severity: cur.severity.clone(),
                });
            }
        }
        for cur in c.iter().skip(paired) {
            added.push(DiffFinding {
                id: cur.finding_id.clone(),
                severity: cur.severity.clone(),
                title: cur.title.clone(),
            });
        }
        for prev in b.iter().skip(paired) {
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

    let count = |sev: &str| -> i64 { current.iter().filter(|f| f.severity == sev).count() as i64 };
    let severity_delta = SeverityDelta {
        critical: count("critical") - base_counts.0,
        warning: count("warning") - base_counts.1,
        info: count("info") - base_counts.2,
    };

    Ok(WhatChangedReport {
        schema: WHAT_CHANGED_SCHEMA.to_string(),
        root: scan.root.display().to_string(),
        workspace: scan.workspace_name.clone(),
        db: db.display().to_string(),
        against,
        baseline_note,
        findings: FindingsDiff {
            added,
            resolved,
            changed,
        },
        severity_delta,
        generated_at: iso8601_now(),
    })
}

/// Human-readable what-changed summary. Deterministic.
pub fn what_changed_human(r: &WhatChangedReport) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "wanyrix what-changed — {} ({})\n",
        r.workspace, r.schema
    ));
    out.push_str(&format!("root: {}\n", r.root));
    out.push_str(&format!("db: {}\n", r.db));
    match &r.against {
        Some(a) => out.push_str(&format!(
            "baseline: scan #{} (measured {})\n",
            a.scan_id, a.finished_at
        )),
        None => out.push_str(&format!(
            "baseline: none — {}\n",
            r.baseline_note.as_deref().unwrap_or("(unspecified)")
        )),
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
    for c in &f.changed {
        out.push_str(&format!(
            "  ~ [{} -> {}] {} — {}\n",
            c.previous_severity, c.severity, c.id, c.title
        ));
    }
    for x in &f.resolved {
        out.push_str(&format!("  - [{}] {} — {}\n", x.severity, x.id, x.title));
    }
    let d = &r.severity_delta;
    out.push_str(&format!(
        "severity delta: {:+} critical, {:+} warning, {:+} info\n",
        d.critical, d.warning, d.info
    ));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::analyze;
    use crate::report;
    use crate::scan::scan_workspace;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

    // ------------------------------------------------------------- impact

    #[test]
    fn diamond_impact_closure_is_exact() {
        // alpha <- beta <- delta, alpha <- gamma <- delta (the diamond), plus
        // epsilon with a DEV edge to delta (must not propagate).
        let scan = scan_workspace(&fixture("diamond-ws")).unwrap();
        let r = impact_report(&scan, "alpha").unwrap();

        assert_eq!(r.schema, IMPACT_SCHEMA);
        assert_eq!(r.direct_dependents_by_kind.normal, vec!["beta", "gamma"]);
        assert!(r.direct_dependents_by_kind.build.is_empty());
        assert!(r.direct_dependents_by_kind.dev.is_empty());
        assert_eq!(r.transitive_dependents, vec!["beta", "delta", "gamma"]);
        assert_eq!(r.transitive_count, 3);
        assert_eq!(r.workspace_crate_count, 5);
        // (1 + 3) * 1000 / 5 = 800‰
        assert_eq!(r.blast_radius_per_mille, 800);
        assert_eq!(r.note, IMPACT_NOTE);
    }

    #[test]
    fn dev_edges_are_direct_only_and_never_propagate() {
        let scan = scan_workspace(&fixture("diamond-ws")).unwrap();
        let r = impact_report(&scan, "delta").unwrap();
        // epsilon depends on delta — but only via a dev edge.
        assert_eq!(r.direct_dependents_by_kind.dev, vec!["epsilon"]);
        assert!(r.direct_dependents_by_kind.normal.is_empty());
        // Documented rule: dev edges do not propagate.
        assert!(r.transitive_dependents.is_empty());
        assert_eq!(r.blast_radius_per_mille, 200); // (1+0)*1000/5
    }

    #[test]
    fn leaf_crate_has_no_dependents_and_named_note() {
        let scan = scan_workspace(&fixture("diamond-ws")).unwrap();
        let r = impact_report(&scan, "epsilon").unwrap();
        assert!(r.direct_dependents.is_empty());
        assert!(r.transitive_dependents.is_empty());
        assert_eq!(r.transitive_count, 0);
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("dev-dependency edges do not propagate"));
    }

    #[test]
    fn unknown_crate_is_a_named_refusal() {
        let scan = scan_workspace(&fixture("diamond-ws")).unwrap();
        let err = impact_report(&scan, "ghost").unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("'ghost' is not a workspace crate under"),
            "{msg}"
        );
    }

    #[test]
    fn cycle_workspace_terminates_and_respects_edge_kinds() {
        let scan = scan_workspace(&fixture("cycle-ws")).unwrap();
        // cycle-ws: ping <-> pong (NORMAL cycle), deva <-> devb (DEV-only
        // cycle — legal in Cargo, test-only).
        let r = impact_report(&scan, "ping").unwrap();
        assert_eq!(r.transitive_dependents, vec!["pong"]);
        // Dev-only cycle: the dev edge is direct-only information and must
        // NOT propagate (the documented rule under test).
        let r2 = impact_report(&scan, "deva").unwrap();
        assert_eq!(r2.direct_dependents_by_kind.dev, vec!["devb"]);
        assert!(r2.transitive_dependents.is_empty());
        assert_eq!(r2.blast_radius_per_mille, 250); // (1+0)*1000/4
    }

    /// Assert `generatedAt` is the LAST key of the serialized envelope.
    fn assert_generated_at_last(json: &str) {
        let key = "\"generatedAt\":";
        let idx = json
            .rfind(key)
            .unwrap_or_else(|| panic!("generatedAt missing in: {json}"));
        let rest = &json[idx + key.len()..];
        assert!(
            rest.starts_with('"') && rest.ends_with("\"}"),
            "generatedAt must be the last field, got: {rest}"
        );
    }

    #[test]
    fn impact_envelope_field_order_and_determinism() {
        let scan = scan_workspace(&fixture("diamond-ws")).unwrap();
        let r = impact_report(&scan, "alpha").unwrap();
        let json = serde_json::to_string(&r).unwrap();
        assert_generated_at_last(&json);
        let h1 = impact_human(&r);
        let h2 = impact_human(&r);
        assert_eq!(h1, h2);
        assert!(h1.contains("wanyrix impact — alpha"));
        assert!(h1.contains("800‰"));
    }

    // -------------------------------------------------------- what-changed

    /// Build a real store + save a real doctor payload for the fixture.
    fn save_baseline(db: &Path, scan: &WorkspaceScan, findings: &[Finding]) -> i64 {
        store::init(db).unwrap();
        let payload = report::doctor_report(scan, findings, crate::timestamp::iso8601_now());
        let text = serde_json::to_string(&payload).unwrap();
        store::save(db, &text).unwrap().scan_id
    }

    #[test]
    fn no_baseline_is_a_valid_envelope_with_named_note() {
        let dir = std::env::temp_dir().join(format!("wanyrix-wc-empty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("scans.db");
        store::init(&db).unwrap();
        let scan = scan_workspace(&fixture("diamond-ws")).unwrap();
        let findings = analyze(&scan);
        let r = what_changed(&scan, &findings, &db).unwrap();

        assert_eq!(r.schema, WHAT_CHANGED_SCHEMA);
        assert!(r.against.is_none());
        let note = r.baseline_note.as_deref().unwrap_or("(none)");
        assert!(note.contains("no stored scan for workspace"), "{note}");
        assert!(note.contains("wanyrix store save"), "{note}");
        // Honest accounting: with no baseline every current finding is added.
        assert_eq!(r.findings.added.len(), findings.len());
        assert!(r.findings.resolved.is_empty());
        assert!(r.findings.changed.is_empty());
        assert_eq!(
            (
                r.severity_delta.critical,
                r.severity_delta.warning,
                r.severity_delta.info
            ),
            (
                findings.iter().filter(|f| f.severity == "critical").count() as i64,
                findings.iter().filter(|f| f.severity == "warning").count() as i64,
                findings.iter().filter(|f| f.severity == "info").count() as i64
            )
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn identical_tree_diffs_to_zero_everywhere() {
        let dir = std::env::temp_dir().join(format!("wanyrix-wc-same-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("scans.db");
        let scan = scan_workspace(&fixture("diamond-ws")).unwrap();
        let findings = analyze(&scan);
        save_baseline(&db, &scan, &findings);
        let r = what_changed(&scan, &findings, &db).unwrap();

        let against = r.against.as_ref().expect("baseline must exist");
        assert_eq!(against.scan_id, 1);
        assert!(r.baseline_note.is_none());
        assert!(r.findings.added.is_empty(), "{:?}", r.findings.added);
        assert!(r.findings.resolved.is_empty());
        assert!(r.findings.changed.is_empty(), "{:?}", r.findings.changed);
        assert_eq!(
            (
                r.severity_delta.critical,
                r.severity_delta.warning,
                r.severity_delta.info
            ),
            (0, 0, 0)
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn changed_tree_produces_exact_added_resolved_sets() {
        // Baseline from diamond-ws; "current" = tiny-ws under a DIFFERENT
        // tempdir but the workspace names differ... no — what-changed keys
        // on the workspace name, so rename the copy to match by scanning
        // diamond-ws with a mutated manifest instead: remove epsilon.
        let dir = std::env::temp_dir().join(format!("wanyrix-wc-mut-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("scans.db");

        let scan = scan_workspace(&fixture("diamond-ws")).unwrap();
        let findings = analyze(&scan);
        save_baseline(&db, &scan, &findings);

        // Mutate a COPY whose root directory keeps the workspace name
        // (the name derives from the root dir for virtual workspaces): the
        // finding set changes (epsilon's findings disappear) while the
        // store key still matches the baseline.
        let work = dir.join("diamond-ws");
        copy_tree(&fixture("diamond-ws"), &work);
        std::fs::remove_dir_all(work.join("epsilon")).unwrap();

        let scan2 = scan_workspace(&work).unwrap();
        let findings2 = analyze(&scan2);
        let r = what_changed(&scan2, &findings2, &db).unwrap();

        let against = r.against.as_ref().expect("baseline must exist");
        assert_eq!(against.scan_id, 1);
        assert_eq!(r.workspace, scan.workspace_name);
        // Every removed finding must be accounted for exactly once.
        let removed: Vec<&Finding> = findings
            .iter()
            .filter(|f| !findings2.iter().any(|g| g.id == f.id))
            .collect();
        assert_eq!(r.findings.resolved.len(), removed.len(), "{removed:?}");
        for x in &r.findings.resolved {
            assert!(
                removed.iter().any(|f| f.id == x.id),
                "resolved id {} is not actually removed",
                x.id
            );
        }
        // Added symmetric check.
        let added_new: Vec<&Finding> = findings2
            .iter()
            .filter(|f| !findings.iter().any(|g| g.id == f.id))
            .collect();
        assert_eq!(r.findings.added.len(), added_new.len());
        // Severity delta equals (current - baseline) tallies.
        let tally =
            |fs: &[Finding], sev: &str| fs.iter().filter(|f| f.severity == sev).count() as i64;
        assert_eq!(
            r.severity_delta.critical,
            tally(&findings2, "critical") - tally(&findings, "critical")
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn envelope_field_order_generated_at_last() {
        let dir = std::env::temp_dir().join(format!("wanyrix-wc-order-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("scans.db");
        let scan = scan_workspace(&fixture("diamond-ws")).unwrap();
        let findings = analyze(&scan);
        save_baseline(&db, &scan, &findings);
        let r = what_changed(&scan, &findings, &db).unwrap();
        let json = serde_json::to_string(&r).unwrap();
        assert_generated_at_last(&json);
        let h = what_changed_human(&r);
        assert!(h.contains("wanyrix what-changed —"));
        assert!(h.contains("baseline: scan #1"));
        assert!(h.contains("findings: 0 added, 0 resolved, 0 changed"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn duplicate_crate_names_across_fixture_workspaces_diff_to_zero() {
        // The tests/fixtures tree contains several sub-workspaces sharing
        // crate names (alpha/beta/gamma in tiny-ws AND diamond-ws), so
        // finding ids (per crate NAME) legitimately collide. The diff must
        // pair duplicates positionally: an identical tree diffs to ZERO —
        // never to phantom "changed" findings.
        let dir = std::env::temp_dir().join(format!("wanyrix-wc-dup-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("scans.db");

        let scan = scan_workspace(&fixture(".")).unwrap();
        assert!(
            scan.crates.len() > 5,
            "fixtures tree must contain multiple workspaces"
        );
        let findings = analyze(&scan);
        save_baseline(&db, &scan, &findings);
        let r = what_changed(&scan, &findings, &db).unwrap();

        assert!(r.findings.added.is_empty(), "{:?}", r.findings.added);
        assert!(r.findings.resolved.is_empty());
        assert!(r.findings.changed.is_empty(), "{:?}", r.findings.changed);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    fn copy_tree(src: &Path, dst: &Path) {
        std::fs::create_dir_all(dst).unwrap();
        for entry in std::fs::read_dir(src).unwrap() {
            let entry = entry.unwrap();
            let to = dst.join(entry.file_name());
            if entry.file_type().unwrap().is_dir() {
                copy_tree(&entry.path(), &to);
            } else {
                std::fs::copy(entry.path(), &to).unwrap();
            }
        }
    }
}
