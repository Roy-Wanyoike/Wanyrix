//! Doctor analysis: turn a measured [`WorkspaceScan`] into findings.
//!
//! Finding-ID registry (stable, deterministic — format `FER-ENG-<rule>[-<slug>]`):
//!
//! | ID prefix     | Rule                                                            | Severity |
//! |---------------|-----------------------------------------------------------------|----------|
//! | FER-ENG-001   | `[package]` missing `license`/`license-file`                    | warning  |
//! | FER-ENG-002   | `[package]` missing `description`                               | warning  |
//! | FER-ENG-003   | intra-workspace path dependency without a `version`             | warning  |
//! | FER-ENG-004   | same dependency declared in multiple sections of one manifest   | warning  |
//! | FER-ENG-005   | workspace dependency cycle containing a hard (normal/build) edge| critical |
//! | FER-ENG-006   | dev-only dependency cycle (legal in cargo, still notable)       | info     |
//! | FER-ENG-007   | broken path dependency (target does not exist)                  | critical |
//! | FER-ENG-008   | path dependency target outside the analyzed crate set           | info     |
//! | FER-ENG-ERR-n | unparseable/unreadable manifest                                 | critical |
//!
//! Honesty contract (Gate 21): every finding is `measurementStatus:
//! "measured"`, `confidenceClass: "deterministic"`, `confidence: 100` —
//! these are direct filesystem facts, never projections. No finding ever
//! claims `verified` (nothing was benchmark-verified) and no timing impact
//! is asserted (`impactSeconds` stays unset).

use serde::Serialize;

use crate::graph;
use crate::manifest::DepSpec;
use crate::model::{EdgeKind, WorkspaceScan};

pub const SEVERITY_CRITICAL: &str = "critical";
pub const SEVERITY_WARNING: &str = "warning";
pub const SEVERITY_INFO: &str = "info";

/// Web-contract evidence entry (`Evidence` in src/lib/wanyrix/types.ts).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub label: String,
    pub value: String,
    pub source: String,
}

/// A doctor finding — field-for-field conformant with the web contract
/// `Finding` interface (types.ts). `impactSeconds` is omitted (never
/// fabricated); `experimentEligible` is always present.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub id: String,
    pub section: &'static str,
    pub severity: &'static str,
    pub title: String,
    pub description: String,
    pub evidence: Vec<Evidence>,
    pub affected: Vec<String>,
    pub impact: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub impact_seconds: Option<u64>,
    pub recommendation: String,
    pub remediation_kind: &'static str,
    pub verification_path: String,
    pub confidence_class: &'static str,
    pub confidence: u8,
    pub detection: String,
    pub measurement_status: &'static str,
    pub experiment_eligible: bool,
}

impl Finding {
    /// Factory enforcing the honesty contract at construction time: engine
    /// v1 findings are always deterministic, measured manifest facts.
    #[allow(clippy::too_many_arguments)]
    fn measured(
        id: String,
        section: &'static str,
        severity: &'static str,
        title: impl Into<String>,
        description: impl Into<String>,
        evidence: Vec<Evidence>,
        affected: Vec<String>,
        impact: impl Into<String>,
        recommendation: impl Into<String>,
        remediation_kind: &'static str,
        verification_path: impl Into<String>,
        detection: impl Into<String>,
        experiment_eligible: bool,
    ) -> Self {
        Finding {
            id,
            section,
            severity,
            title: title.into(),
            description: description.into(),
            evidence,
            affected,
            impact: impact.into(),
            impact_seconds: None,
            recommendation: recommendation.into(),
            remediation_kind,
            verification_path: verification_path.into(),
            confidence_class: "deterministic",
            confidence: 100,
            detection: detection.into(),
            measurement_status: "measured",
            experiment_eligible,
        }
    }
}

/// Web-contract section enum (`FindingSection` in types.ts).
pub const SECTIONS: [&str; 6] = ["Build", "Workspace", "IDE", "CI", "Async", "Dependencies"];

fn ev(label: &str, value: &str, source: &str) -> Evidence {
    Evidence {
        label: label.to_owned(),
        value: value.to_owned(),
        source: source.to_owned(),
    }
}

const FS_SOURCE: &str = "filesystem — parsed Cargo.toml (measured)";

/// Severity rank for deterministic ordering (critical first).
fn severity_rank(sev: &str) -> u8 {
    match sev {
        SEVERITY_CRITICAL => 0,
        SEVERITY_WARNING => 1,
        _ => 2,
    }
}

/// Run every doctor rule over the scan. Output order is deterministic:
/// by severity (critical → warning → info), then by finding id.
pub fn analyze(scan: &WorkspaceScan) -> Vec<Finding> {
    let mut findings = Vec::new();
    findings.extend(missing_metadata_findings(scan));
    findings.extend(path_dep_findings(scan));
    findings.extend(duplicate_dep_findings(scan));
    findings.extend(cycle_findings(scan));
    findings.extend(parse_failure_findings(scan));
    findings.sort_by(|a, b| {
        severity_rank(a.severity)
            .cmp(&severity_rank(b.severity))
            .then(a.id.cmp(&b.id))
    });
    findings
}

/// FER-ENG-001 / FER-ENG-002 — measured absent package metadata.
fn missing_metadata_findings(scan: &WorkspaceScan) -> Vec<Finding> {
    let mut out = Vec::new();
    for c in scan.crates.iter() {
        if c.license.is_none() {
            out.push(Finding::measured(
                format!("FER-ENG-001-{}", c.name),
                "Workspace",
                SEVERITY_WARNING,
                format!("Missing license field (crate `{}`)", c.name),
                format!(
                    "The manifest of crate `{}` ({})) declares no `license` or `license-file` key in its [package] table. Without it the crate cannot be published to crates.io and consuming tools cannot determine redistribution terms.",
                    c.name, c.manifest_path
                ),
                vec![
                    ev("manifest", &c.manifest_path, FS_SOURCE),
                    ev("field", "license: absent (license-file also absent)", FS_SOURCE),
                    ev("measured at", &scan.root.display().to_string(), "scan root (canonical path)"),
                ],
                vec![c.name.clone()],
                "Publishing to crates.io is blocked; license compliance tooling has no signal for this crate.",
                format!(
                    "Add `license = \"<SPDX>\"` (or `license-file = \"LICENSE\"`) to the [package] table of {}.",
                    c.manifest_path
                ),
                "config",
                format!(
                    "Re-run `wanyrix doctor --path <root> --json` — FER-ENG-001-{} disappears; `cargo publish --dry-run -p {}` stops warning about the missing license.",
                    c.name, c.name
                ),
                "wanyrix doctor rule FER-ENG-001 — [package] key scan of the parsed manifest".to_owned(),
                false,
            ));
        }
        if c.description.is_none() {
            out.push(Finding::measured(
                format!("FER-ENG-002-{}", c.name),
                "Workspace",
                SEVERITY_WARNING,
                format!("Missing description field (crate `{}`)", c.name),
                format!(
                    "The manifest of crate `{}` ({}) declares no `description` key in its [package] table. crates.io requires a description and registry consumers index by it.",
                    c.name, c.manifest_path
                ),
                vec![
                    ev("manifest", &c.manifest_path, FS_SOURCE),
                    ev("field", "description: absent", FS_SOURCE),
                ],
                vec![c.name.clone()],
                "Publishing to crates.io is blocked; generated docs and indexes lack a summary for this crate.",
                format!(
                    "Add a one-sentence `description = \"…\"` to the [package] table of {}.",
                    c.manifest_path
                ),
                "config",
                format!(
                    "Re-run `wanyrix doctor --path <root> --json` — FER-ENG-002-{} disappears.",
                    c.name
                ),
                "wanyrix doctor rule FER-ENG-002 — [package] key scan of the parsed manifest".to_owned(),
                false,
            ));
        }
    }
    out
}

/// FER-ENG-003 / FER-ENG-007 / FER-ENG-008 — measured path-dependency facts.
///
/// FER-ENG-003 deliberately covers only normal/build path dependencies:
/// cargo strips path-only DEV-dependencies when packaging/publishing, so a
/// missing version there is not a publish blocker (measured cargo behavior,
/// stated here rather than guessed).
fn path_dep_findings(scan: &WorkspaceScan) -> Vec<Finding> {
    let mut out = Vec::new();

    // 003: intra-workspace path deps without a version (publish blockers).
    for c in scan.crates.iter() {
        let offenders: Vec<&crate::model::PathDepRecord> = scan
            .path_deps
            .iter()
            .filter(|d| {
                d.from == c.name
                    && d.resolved_to.is_some()
                    && !d.has_version
                    && d.kind != EdgeKind::Dev
            })
            .collect();
        if offenders.is_empty() {
            continue;
        }
        let dep_list = offenders
            .iter()
            .map(|d| format!("{} = {{ path = \"{}\" }}", d.dep, d.rel_path))
            .collect::<Vec<_>>()
            .join("; ");
        out.push(Finding::measured(
            format!("FER-ENG-003-{}", c.name),
            "Dependencies",
            SEVERITY_WARNING,
            format!("Intra-workspace path dependency without version (crate `{}`)", c.name),
            format!(
                "Crate `{}` declares {} intra-workspace path dependency(ies) without a `version` key: {}. A path-only dependency cannot be published to crates.io and pins the consumer to the workspace layout.",
                offenders.len(),
                c.name,
                dep_list
            ),
            vec![
                ev("manifest", &c.manifest_path, FS_SOURCE),
                ev("declarations", &dep_list, FS_SOURCE),
                ev(
                    "resolved targets",
                    &offenders
                        .iter()
                        .map(|d| d.resolved_to.clone().unwrap_or_default())
                        .collect::<Vec<_>>()
                        .join(", "),
                    FS_SOURCE,
                ),
            ],
            vec![c.name.clone()],
            "The crate cannot be published; out-of-workspace consumers cannot resolve the dependency.",
            format!(
                "Add a matching `version = \"<semver>\"` alongside each `path` (e.g. {} = {{ path = \"…\", version = \"0.1.0\" }}), or publish-configure the crate as workspace-internal.",
                offenders[0].dep
            ),
            "config",
            format!(
                "Re-run `wanyrix doctor` — FER-ENG-003-{} disappears; `cargo publish --dry-run -p {}` proceeds past dependency resolution.",
                c.name, c.name
            ),
            "wanyrix doctor rule FER-ENG-003 — path-dependency scan of parsed manifests".to_owned(),
            false,
        ));
    }

    // 007: broken path deps; 008: escaped path deps.
    for d in scan.path_deps.iter().filter(|d| d.resolved_to.is_none()) {
        if d.escaped {
            out.push(Finding::measured(
                format!("FER-ENG-008-{}-{}", d.from, d.dep),
                "Dependencies",
                SEVERITY_INFO,
                format!(
                    "Path dependency target outside the analyzed set (`{}` → `{}`)",
                    d.from, d.dep
                ),
                format!(
                    "The path dependency `{}` declared by crate `{}` (path = \"{}\") resolves to a manifest that is not part of the analyzed crate set (outside the scanned root, or its manifest failed to parse). It is excluded from the dependency graph — the graph only contains measured, analyzed crates (no ghost nodes).",
                    d.dep, d.from, d.rel_path
                ),
                vec![
                    ev("declaration", &format!("{} = {{ path = \"{}\" }}", d.dep, d.rel_path), FS_SOURCE),
                    ev("declared by", &d.from, FS_SOURCE),
                    ev("section", d.kind.as_str(), "manifest dependency section (measured)"),
                ],
                vec![d.from.clone()],
                "The graph understates this crate's true dependency surface; coverage of the scan is partial for this edge.",
                "Widen the scan root to include the dependency target (or fix the crate's manifest so the target parses) and re-scan.",
                "config",
                "Re-run with the widened `--path`; the finding disappears and the edge appears in `wanyrix graph` output.",
                "wanyrix doctor rule FER-ENG-008 — path-dependency resolution scan".to_owned(),
                false,
            ));
        } else {
            out.push(Finding::measured(
                format!("FER-ENG-007-{}-{}", d.from, d.dep),
                "Dependencies",
                SEVERITY_CRITICAL,
                format!("Broken path dependency (`{}` → `{}`)", d.from, d.dep),
                format!(
                    "The path dependency `{}` declared by crate `{}` (path = \"{}\") points to a location with no readable Cargo.toml. Cargo itself will fail this build during dependency resolution.",
                    d.dep, d.from, d.rel_path
                ),
                vec![
                    ev("declaration", &format!("{} = {{ path = \"{}\" }}", d.dep, d.rel_path), FS_SOURCE),
                    ev("target", "no parseable Cargo.toml at the resolved path", FS_SOURCE),
                ],
                vec![d.from.clone()],
                "The workspace does not build until this dependency is fixed.",
                format!(
                    "Fix or remove the `{} = {{ path = \"{}\" }}` entry in {}'s manifest.",
                    d.dep, d.rel_path, d.from
                ),
                "config",
                "Re-run `wanyrix doctor` — FER-ENG-007 disappears; `cargo metadata` succeeds for the workspace.",
                "wanyrix doctor rule FER-ENG-007 — path-dependency resolution scan".to_owned(),
                false,
            ));
        }
    }
    out
}

/// FER-ENG-004 — the same dependency declared in several sections of one
/// manifest (e.g. `serde` in both [dependencies] and [dev-dependencies]).
fn duplicate_dep_findings(scan: &WorkspaceScan) -> Vec<Finding> {
    let mut out = Vec::new();
    for record in scan.manifests.iter() {
        let Some(m) = record.manifest() else { continue };
        let Some(name) = m.package_name() else {
            continue;
        };

        // group section entries by real dependency name (rename-aware)
        let mut by_dep: std::collections::BTreeMap<&str, Vec<(&str, &DepSpec)>> =
            std::collections::BTreeMap::new();
        for (section, table) in m.dep_sections() {
            for (key, spec) in table {
                by_dep
                    .entry(DepSpec::dep_name(key, spec))
                    .or_default()
                    .push((section, spec));
            }
        }
        for (dep_name, entries) in by_dep {
            if entries.len() < 2 {
                continue;
            }
            let rendered = entries
                .iter()
                .map(|(sec, spec)| match spec.version_text() {
                    Some(v) => format!("{sec}: {dep_name} = \"{v}\""),
                    None => format!("{sec}: {dep_name} = {{ … }}"),
                })
                .collect::<Vec<_>>()
                .join("; ");
            out.push(Finding::measured(
                format!("FER-ENG-004-{name}-{dep_name}"),
                "Dependencies",
                SEVERITY_WARNING,
                format!("Duplicate dependency declaration (`{dep_name}` in `{name}`)"),
                format!(
                    "Crate `{name}` declares the dependency `{dep_name}` in {n} dependency sections ({sections}). Duplicate declarations drift out of sync — usually the dev copy lags the normal one after upgrades.",
                    n = entries.len(),
                    sections = entries.iter().map(|(s, _)| *s).collect::<Vec<_>>().join(" + "),
                ),
                vec![
                    ev("manifest", &record.rel, FS_SOURCE),
                    ev("declarations", &rendered, FS_SOURCE),
                ],
                vec![name.to_owned()],
                "Version/feature drift between sections produces builds that behave differently under `cargo build` vs `cargo test`.",
                format!(
                    "Keep a single `{dep_name}` entry in [dependencies] and reference it from dev-dependencies via `{dep_name} = {{ workspace = true }}` in [workspace.dependencies], or align the two declarations explicitly."
                ),
                "config",
                format!("Re-run `wanyrix doctor` — FER-ENG-004-{name}-{dep_name} disappears."),
                "wanyrix doctor rule FER-ENG-004 — cross-section dependency-name scan".to_owned(),
                false,
            ));
        }
    }
    out
}

/// FER-ENG-005 / FER-ENG-006 — dependency cycles (SCC-based).
///
/// Classification is honest about cargo semantics: a cycle whose edges are
/// ALL dev-dependencies is legal (test-only) → info; any cycle containing a
/// normal or build edge cannot build → critical.
fn cycle_findings(scan: &WorkspaceScan) -> Vec<Finding> {
    let sccs = graph::strongly_connected_components(&scan.crates, &scan.edges);
    let mut out = Vec::new();
    for scc in sccs {
        let members = scc.members.clone();
        let dev_only = scc.internal_edges.iter().all(|e| e.kind == EdgeKind::Dev);
        let kinds = {
            let mut ks: Vec<&str> = scc.internal_edges.iter().map(|e| e.kind.as_str()).collect();
            ks.sort_unstable();
            ks.dedup();
            ks.join(", ")
        };
        let (id_prefix, severity, title) = if dev_only {
            ("FER-ENG-006", SEVERITY_INFO, "Dev-only dependency cycle")
        } else {
            (
                "FER-ENG-005",
                SEVERITY_CRITICAL,
                "Workspace dependency cycle",
            )
        };
        let start = members.first().cloned().unwrap_or_default();
        out.push(Finding::measured(
            format!("{id_prefix}-{start}"),
            "Dependencies",
            severity,
            format!("{title} ({})", members.join(" ↔ ")),
            format!(
                "Crates {} form a closed dependency loop over intra-workspace path dependencies (edge kinds: {kinds}). {semantics}",
                members.iter().map(|m| format!("`{m}`")).collect::<Vec<_>>().join(", "),
                semantics = if dev_only {
                    "Cargo permits this because every edge is a dev-dependency (test-only), but the loop couples the crates' test builds and usually signals misplaced test helpers."
                } else {
                    "Cargo rejects cycles that contain a normal or build dependency edge — this workspace does not build until the loop is broken."
                }
            ),
            vec![
                ev("cycle", &scc.path, FS_SOURCE),
                ev("members", &members.join(", "), "measured crate list"),
                ev("edge kinds", &kinds, "manifest dependency sections (measured)"),
            ],
            members.clone(),
            if dev_only {
                "Test builds of the involved crates are mutually recursive; refactors of either crate's test surface ripple into the other."
            } else {
                "The workspace cannot compile at all until the cycle is broken."
            },
            if dev_only {
                format!(
                    "Move the shared test helpers into a separate leaf crate, or gate one direction behind a feature, so the dev-dependency loop {} dissolves.",
                    members.join(" ↔ ")
                )
            } else {
                format!(
                    "Break the loop by extracting the shared items into a new leaf crate that both sides can depend on (e.g. start from `{}`), then re-scan.",
                    start
                )
            }
            ,
            "architecture",
            format!(
                "Re-run `wanyrix doctor` — {id_prefix}-{start} disappears; `cargo metadata --no-deps` no longer reports the cycle for {}.",
                members.join("/")
            ),
            "wanyrix doctor rules FER-ENG-005/006 — Tarjan SCC over the measured intra-workspace edge list".to_owned(),
            true,
        ));
    }
    out
}

/// FER-ENG-ERR-n — unparseable/unreadable manifests (never silently dropped).
fn parse_failure_findings(scan: &WorkspaceScan) -> Vec<Finding> {
    let mut out = Vec::new();
    for (i, record) in scan.manifests.iter().enumerate() {
        let Err(reason) = record.result.as_ref() else {
            continue;
        };
        out.push(Finding::measured(
            format!("FER-ENG-ERR-{:02}", i + 1),
            "Build",
            SEVERITY_CRITICAL,
            format!("Unparseable manifest ({})", record.rel),
            format!(
                "The manifest {} could not be parsed, so its crate (if any) is NOT part of the analysis: {reason}. This report under-covers whatever that manifest declares.",
                record.rel
            ),
            vec![
                ev("manifest", &record.rel, FS_SOURCE),
                ev("parse error", reason, "toml parser (measured)"),
            ],
            vec![record.rel.clone()],
            "The crate is invisible to every wanyrix view until the manifest parses — the scan is honestly incomplete.",
            format!("Fix the TOML syntax in {} and re-run the scan.", record.rel),
            "patch",
            format!("Re-run `wanyrix doctor` — FER-ENG-ERR-{:02} disappears and the crate appears in the crate list.", i + 1),
            "wanyrix doctor — manifest parse retained from the filesystem scan".to_owned(),
            false,
        ));
    }
    out
}

/// Sanity gate used by tests + lib honesty checks: the registry above must
/// never emit a status other than these, and never `verified`.
pub const ALLOWED_SEVERITIES: [&str; 3] = [SEVERITY_CRITICAL, SEVERITY_WARNING, SEVERITY_INFO];
pub const ALLOWED_SECTIONS: [&str; 6] = SECTIONS;
pub const ALLOWED_REMEDIATION: [&str; 5] =
    ["command", "config", "architecture", "experiment", "patch"];
pub const ALLOWED_CONFIDENCE: [&str; 4] = ["deterministic", "high", "medium", "estimated"];
pub const ALLOWED_MEASUREMENT: [&str; 3] = ["measured", "estimated", "verified"];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scan::scan_workspace;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

    #[test]
    fn tiny_ws_emits_exactly_the_expected_findings() {
        let scan = scan_workspace(&fixture("tiny-ws")).unwrap();
        let findings = analyze(&scan);
        let ids: Vec<&str> = findings.iter().map(|f| f.id.as_str()).collect();
        assert_eq!(
            ids,
            vec![
                "FER-ENG-001-gamma",
                "FER-ENG-002-gamma",
                "FER-ENG-003-beta",
                "FER-ENG-004-beta-log",
            ]
        );
        assert!(findings.iter().all(|f| f.severity == SEVERITY_WARNING));
    }

    #[test]
    fn cycle_ws_emits_critical_hard_cycle_and_info_dev_cycle() {
        let scan = scan_workspace(&fixture("cycle-ws")).unwrap();
        let findings = analyze(&scan);
        let hard = findings
            .iter()
            .find(|f| f.id == "FER-ENG-005-ping")
            .expect("hard cycle");
        assert_eq!(hard.severity, SEVERITY_CRITICAL);
        assert!(hard.affected.contains(&"ping".to_owned()));
        assert!(hard.affected.contains(&"pong".to_owned()));
        let dev = findings
            .iter()
            .find(|f| f.id == "FER-ENG-006-deva")
            .expect("dev cycle");
        assert_eq!(dev.severity, SEVERITY_INFO);
        // ping/pong also carry FER-ENG-003 (path-only normal deps, no version);
        // deva/devb do NOT (cargo strips path-only dev-deps on publish).
        assert_eq!(
            findings.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
            vec![
                "FER-ENG-005-ping",
                "FER-ENG-003-ping",
                "FER-ENG-003-pong",
                "FER-ENG-006-deva"
            ]
        );
    }

    #[test]
    fn every_finding_is_measured_deterministic_and_never_verified() {
        for ws in ["tiny-ws", "cycle-ws"] {
            let scan = scan_workspace(&fixture(ws)).unwrap();
            for f in analyze(&scan) {
                assert_eq!(
                    f.measurement_status, "measured",
                    "{} claimed non-measured",
                    f.id
                );
                assert_eq!(f.confidence_class, "deterministic");
                assert_eq!(f.confidence, 100);
                assert!(f.impact_seconds.is_none(), "{} asserts a timing", f.id);
                assert!(ALLOWED_SEVERITIES.contains(&f.severity));
                assert!(ALLOWED_SECTIONS.contains(&f.section));
                assert!(ALLOWED_REMEDIATION.contains(&f.remediation_kind));
                assert!(ALLOWED_CONFIDENCE.contains(&f.confidence_class));
                assert!(ALLOWED_MEASUREMENT.contains(&f.measurement_status));
                assert!(!f.evidence.is_empty(), "{} has no evidence", f.id);
            }
        }
    }

    #[test]
    fn clean_workspace_has_zero_findings() {
        let dir = std::env::temp_dir().join(format!("wanyrix-clean-{}", std::process::id()));
        let crate_dir = dir.join("solo");
        std::fs::create_dir_all(crate_dir.join("src")).unwrap();
        std::fs::write(
            dir.join("Cargo.toml"),
            "[workspace]\nmembers = [\"solo\"]\n",
        )
        .unwrap();
        std::fs::write(
            crate_dir.join("Cargo.toml"),
            "[package]\nname = \"solo\"\nversion = \"0.2.0\"\nlicense = \"Apache-2.0\"\ndescription = \"clean\"\n",
        )
        .unwrap();
        std::fs::write(crate_dir.join("src").join("lib.rs"), "pub fn x() {}\n").unwrap();
        let scan = scan_workspace(&dir).unwrap();
        let findings = analyze(&scan);
        assert!(
            findings.is_empty(),
            "unexpected: {ids:?}",
            ids = findings.iter().map(|f| f.id.clone()).collect::<Vec<_>>()
        );
        std::fs::remove_dir_all(&dir).ok();
    }
}
