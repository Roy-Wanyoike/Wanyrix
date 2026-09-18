//! JSON report envelopes for the three CLI flavors.
//!
//! Envelope design (documented divergence from the web `DoctorReport`):
//! the web payload's `buildTime`, `estimatedRange`, `criticalPath`,
//! `summary.developerBuild/ciBuild/diskUsage` and `phases` are
//! build-telemetry-backed fields. Engine v1 does NOT compile anything and
//! measures no timings — fabricating them would violate the honesty gates
//! (Gate 21). The engine envelope therefore replaces those fields with the
//! measured crate list + scan provenance, while EVERY finding inside is
//! field-for-field conformant with the web `Finding` contract. See
//! engine/README.md → "Contract conformance".
//!
//! Determinism: identical input ⇒ byte-identical output except `generatedAt`
//! (and `meta.lastScan`, which mirrors it). Everything is sorted; the
//! timestamp keys are declared LAST so they trail the deterministic payload.

use serde::Serialize;

use crate::analysis::{Finding, SECTIONS};
use crate::graph::{Graph, GraphEdge, GraphNode};
use crate::health::{Insight, Kpis, SectionCount, SlowCrate};
use crate::model::WorkspaceScan;

pub const DOCTOR_SCHEMA: &str = "wanyrix.doctor/v1";
pub const GRAPH_SCHEMA: &str = "wanyrix.graph/v1";
pub const HEALTH_SCHEMA: &str = "wanyrix.health/v1";

pub const MEASUREMENT_NOTE: &str = "measured — real filesystem analysis of every Cargo.toml under the scan root; no value in this report is simulated. Absent telemetry (build times, cache hit rates, change frequency) is labeled not-measured, never estimated in disguise (Gate 21).";

pub const HONESTY_NOTES: [&str; 4] = [
    "Every finding is measured from the filesystem (parsed Cargo.toml manifests); none is projected, and nothing is labeled verified because nothing was benchmark-verified.",
    "Graph aggregates (fanIn, fanOut, downstream / recompileImpact) are computed exclusively from the served edge list — never hand-typed, no ghost nodes.",
    "buildTime, changeFreq, cacheHitRate and seconds fields that the web contract requires are emitted as 0 with status not-measured — engine v1 does not compile crates; build telemetry is a roadmap phase.",
    "generatedAt (and meta.lastScan, which mirrors it) is the only non-deterministic key; identical inputs otherwise produce identical output — every list is sorted.",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceJson {
    pub label: String,
    pub value: String,
    pub source: String,
}

/// Field order mirrors the web `Finding` interface (types.ts).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindingJson {
    pub id: String,
    pub section: String,
    pub severity: String,
    pub title: String,
    pub description: String,
    pub evidence: Vec<EvidenceJson>,
    pub affected: Vec<String>,
    pub impact: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub impact_seconds: Option<u64>,
    pub recommendation: String,
    pub remediation_kind: String,
    pub verification_path: String,
    pub confidence_class: String,
    pub confidence: u8,
    pub detection: String,
    pub measurement_status: String,
    pub experiment_eligible: bool,
}

impl From<&Finding> for FindingJson {
    fn from(f: &Finding) -> Self {
        FindingJson {
            id: f.id.clone(),
            section: f.section.to_owned(),
            severity: f.severity.to_owned(),
            title: f.title.clone(),
            description: f.description.clone(),
            evidence: f
                .evidence
                .iter()
                .map(|e| EvidenceJson {
                    label: e.label.clone(),
                    value: e.value.clone(),
                    source: e.source.clone(),
                })
                .collect(),
            affected: f.affected.clone(),
            impact: f.impact.clone(),
            impact_seconds: f.impact_seconds,
            recommendation: f.recommendation.clone(),
            remediation_kind: f.remediation_kind.to_owned(),
            verification_path: f.verification_path.clone(),
            confidence_class: f.confidence_class.to_owned(),
            confidence: f.confidence,
            detection: f.detection.clone(),
            measurement_status: f.measurement_status.to_owned(),
            experiment_eligible: f.experiment_eligible,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrateJson {
    pub name: String,
    pub version: String,
    pub manifest_path: String,
    pub crate_root: String,
    pub band: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProvenance {
    /// `wanyrix-engine <version> — filesystem manifest analysis`.
    pub generated_by: String,
    pub manifests_found: usize,
    pub parse_failures: usize,
    pub skipped_entries: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorSummary {
    pub critical: usize,
    pub warning: usize,
    pub info: usize,
    pub total: usize,
}

/// `wanyrix.doctor/v1` — engine envelope (see module docs for the
/// documented divergence from the web `DoctorReport` envelope).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorReport {
    pub schema: String,
    pub workspace: String,
    pub profile: String,
    pub root: String,
    pub toolchain: String,
    pub crates: Vec<CrateJson>,
    pub findings: Vec<FindingJson>,
    pub summary: DoctorSummary,
    pub scan: ScanProvenance,
    pub measurement: String,
    pub honesty_notes: Vec<String>,
    /// LAST key — the only non-deterministic field.
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphMeta {
    pub workspace_crates: usize,
    pub total_edges: usize,
    pub last_scan: String,
    /// "full-manifest-graph": the engine serves every measured crate and
    /// edge (documented divergence from the web demo's 'backbone-subset').
    pub scope: String,
    pub served_nodes: usize,
    pub served_edges: usize,
    pub aggregate_source: String,
    pub note: String,
}

/// `wanyrix.graph/v1`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphReport {
    pub schema: String,
    pub workspace: String,
    pub root: String,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub meta: GraphMeta,
    pub measurement: String,
    pub honesty_notes: Vec<String>,
    /// LAST key — the only non-deterministic field.
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindingCountJson {
    pub section: String,
    pub count: usize,
}

/// `wanyrix.health/v1` — engine envelope keyed to the web `HealthPayload`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthReport {
    pub schema: String,
    pub workspace: String,
    pub root: String,
    pub toolchain: String,
    pub crates: usize,
    pub edges: usize,
    pub cache_hit_rate: u64,
    pub cache_hit_rate_status: String,
    pub kpis: Kpis,
    pub build_trend: Vec<String>,
    pub slowest_crates: Vec<SlowCrate>,
    pub activity: Vec<String>,
    pub finding_counts: Vec<FindingCountJson>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub insight: Option<Insight>,
    pub measurement: String,
    pub honesty_notes: Vec<String>,
    /// LAST key — the only non-deterministic field.
    pub generated_at: String,
}

const PROFILE: &str = "manifest-static-v1";

fn root_str(scan: &WorkspaceScan) -> String {
    scan.root.display().to_string()
}

fn honesty_notes_vec() -> Vec<String> {
    HONESTY_NOTES.iter().map(|s| (*s).to_owned()).collect()
}

/// Assemble the doctor envelope from a scan + its findings.
pub fn doctor_report(scan: &WorkspaceScan, findings: &[Finding], generated_at: String) -> DoctorReport {
    let summary = DoctorSummary {
        critical: findings.iter().filter(|f| f.severity == "critical").count(),
        warning: findings.iter().filter(|f| f.severity == "warning").count(),
        info: findings.iter().filter(|f| f.severity == "info").count(),
        total: findings.len(),
    };
    DoctorReport {
        schema: DOCTOR_SCHEMA.to_owned(),
        workspace: scan.workspace_name.clone(),
        profile: PROFILE.to_owned(),
        root: root_str(scan),
        toolchain: scan.toolchain.clone(),
        crates: scan
            .crates
            .iter()
            .map(|c| CrateJson {
                name: c.name.clone(),
                version: c.version.clone(),
                manifest_path: c.manifest_path.clone(),
                crate_root: c.crate_root.clone(),
                band: c.band.as_str().to_owned(),
                kind: c.kind.as_str().to_owned(),
                license: c.license.clone(),
                description: c.description.clone(),
            })
            .collect(),
        findings: findings.iter().map(FindingJson::from).collect(),
        summary,
        scan: ScanProvenance {
            generated_by: format!("wanyrix-engine v{} — filesystem manifest analysis", env!("CARGO_PKG_VERSION")),
            manifests_found: scan.manifests_found,
            parse_failures: scan.parse_failures,
            skipped_entries: scan.skipped,
        },
        measurement: MEASUREMENT_NOTE.to_owned(),
        honesty_notes: honesty_notes_vec(),
        generated_at,
    }
}

/// Assemble the graph envelope (all aggregates precomputed in `Graph`).
pub fn graph_report(scan: &WorkspaceScan, graph: &Graph, generated_at: String) -> GraphReport {
    let meta = GraphMeta {
        workspace_crates: graph.nodes.len(),
        total_edges: graph.edges.len(),
        last_scan: generated_at.clone(),
        scope: "full-manifest-graph".to_owned(),
        served_nodes: graph.nodes.len(),
        served_edges: graph.edges.len(),
        aggregate_source: "served-edges".to_owned(),
        note: "Every node is a measured crate from the scanned manifests; every edge is a resolved intra-workspace path dependency. Per-node aggregates (fanIn, fanOut, downstream) are derived from this served edge list. buildTime/changeFreq are 0 = not-measured (engine v1 has no build or VCS telemetry).".to_owned(),
    };
    GraphReport {
        schema: GRAPH_SCHEMA.to_owned(),
        workspace: scan.workspace_name.clone(),
        root: root_str(scan),
        nodes: graph.nodes.clone(),
        edges: graph.edges.clone(),
        meta,
        measurement: MEASUREMENT_NOTE.to_owned(),
        honesty_notes: honesty_notes_vec(),
        generated_at,
    }
}

/// Assemble the health envelope from doctor + graph results.
#[allow(clippy::too_many_arguments)]
pub fn health_report(
    scan: &WorkspaceScan,
    _findings: &[Finding],
    graph: &Graph,
    kpis: Kpis,
    slowest: Vec<SlowCrate>,
    counts: Vec<SectionCount>,
    insight: Option<Insight>,
    generated_at: String,
) -> HealthReport {
    let _ = SECTIONS; // sections live in analysis; counts already computed there
    HealthReport {
        schema: HEALTH_SCHEMA.to_owned(),
        workspace: scan.workspace_name.clone(),
        root: root_str(scan),
        toolchain: scan.toolchain.clone(),
        crates: graph.nodes.len(),
        edges: graph.edges.len(),
        cache_hit_rate: 0,
        cache_hit_rate_status: "not-measured".to_owned(),
        kpis,
        build_trend: Vec::new(),
        slowest_crates: slowest,
        activity: Vec::new(),
        finding_counts: counts
            .into_iter()
            .map(|c| FindingCountJson { section: c.section, count: c.count })
            .collect(),
        insight,
        measurement: MEASUREMENT_NOTE.to_owned(),
        honesty_notes: honesty_notes_vec(),
        generated_at,
    }
}
