//! Health KPI summary — derived EXCLUSIVELY from the doctor findings and the
//! graph aggregates (which themselves derive from the one measured edge
//! list). Nothing in here is invented: fields the engine cannot measure are
//! zeroed with an explicit status/note, never simulated (Gate 21).

use serde::Serialize;

use crate::analysis::Finding;
use crate::graph::Graph;
use crate::model::WorkspaceScan;

/// Web-contract KPI shapes (`HealthPayload.kpis` in types.ts).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KpiDelta {
    pub delta: i64,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KpiCount {
    pub count: u64,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Kpis {
    pub build_performance: KpiDelta,
    pub ci_cost: KpiDelta,
    pub dependency_risk: KpiDelta,
    pub pr_regressions: KpiCount,
    pub architecture_debt: KpiCount,
    pub runtime_bottlenecks: KpiCount,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlowCrate {
    pub name: String,
    /// Not measured by engine v1 — always 0 with the honesty note; ranking
    /// is by measured recompute impact (downstream closure) instead.
    pub seconds: u64,
    pub downstream: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionCount {
    pub section: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Insight {
    pub text: String,
    pub question: String,
}

/// Build the health KPI payload from measured inputs.
pub fn build_health(
    scan: &WorkspaceScan,
    findings: &[Finding],
    graph: &Graph,
) -> (Kpis, Vec<SlowCrate>, Vec<SectionCount>, Option<Insight>) {
    let count_in = |section: &str| findings.iter().filter(|f| f.section == section).count();
    let build_findings = count_in("Build");
    let ci_findings = count_in("CI");
    let dep_findings = count_in("Dependencies");
    let ws_findings = count_in("Workspace");
    let critical = findings.iter().filter(|f| f.severity == "critical").count();

    let kpis = Kpis {
        build_performance: KpiDelta {
            delta: 0,
            label: format!(
                "engine v1 measures no build telemetry — delta not measurable ({build_findings} Build-section finding(s) reported)"
            ),
        },
        ci_cost: KpiDelta {
            delta: 0,
            label: format!(
                "engine v1 measures no CI telemetry — delta not measurable ({ci_findings} CI-section finding(s) reported)"
            ),
        },
        dependency_risk: KpiDelta {
            delta: dep_findings as i64,
            label: format!(
                "{dep_findings} measured dependency finding(s) — cycles, duplicate declarations and path-only deps counted; no timing projection"
            ),
        },
        pr_regressions: KpiCount {
            count: 0,
            label: "PR regression analysis is not built in engine v1 (roadmap) — honestly zero, not measured zero".to_owned(),
        },
        architecture_debt: KpiCount {
            count: ws_findings as u64,
            label: format!(
                "{ws_findings} measured Workspace-section finding(s) (package metadata debt)"
            ),
        },
        runtime_bottlenecks: KpiCount {
            count: 0,
            label: "runtime telemetry is not instrumented in engine v1 (AUDIT-I8 roadmap) — honestly zero".to_owned(),
        },
    };

    // slowestCrates: ranked by MEASURED recompute impact (downstream closure
    // over the served edge list); `seconds` is 0 = not measured, labeled.
    let mut slowest: Vec<SlowCrate> = graph
        .nodes
        .iter()
        .map(|n| SlowCrate {
            name: n.id.clone(),
            seconds: 0,
            downstream: n.downstream,
        })
        .collect();
    slowest.sort_by(|a, b| b.downstream.cmp(&a.downstream).then(a.name.cmp(&b.name)));
    slowest.truncate(5);

    let mut finding_counts: Vec<SectionCount> = crate::analysis::SECTIONS
        .iter()
        .map(|s| SectionCount {
            section: (*s).to_owned(),
            count: count_in(s),
        })
        .collect();
    finding_counts.sort_by(|a, b| a.section.cmp(&b.section));

    // Deterministic headline insight derived from measured data only.
    let top = slowest.first();
    let insight = Some(Insight {
        text: format!(
            "{total_crates} crates, {total_edges} intra-workspace edges, {findings} measured finding(s) ({critical} critical). Deepest recompute impact: {top_name} — {top_down} downstream crate(s).",
            total_crates = scan.crates.len(),
            total_edges = graph.edges.len(),
            findings = findings.len(),
            top_name = top.map(|c| c.name.as_str()).unwrap_or("n/a"),
            top_down = top.map(|c| c.downstream).unwrap_or(0),
        ),
        question: top
            .filter(|c| c.downstream > 0)
            .map(|c| {
                format!(
                    "Which of the {} downstream chains through `{}` could be shortened by splitting the crate?",
                    c.downstream, c.name
                )
            })
            .unwrap_or_else(|| "Which dependency edges here could be removed entirely?".to_owned()),
    });

    (kpis, slowest, finding_counts, insight)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::analyze;
    use crate::graph::build_graph;
    use crate::scan::scan_workspace;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

    #[test]
    fn health_kpis_derive_from_doctor_and_graph() {
        let scan = scan_workspace(&fixture("tiny-ws")).unwrap();
        let findings = analyze(&scan);
        let g = build_graph(&scan);
        let (kpis, slowest, counts, insight) = build_health(&scan, &findings, &g);
        assert_eq!(kpis.dependency_risk.delta, 2, "003-beta + 004-beta-log");
        assert_eq!(kpis.architecture_debt.count, 2, "001 + 002 on gamma");
        assert_eq!(kpis.pr_regressions.count, 0);
        assert_eq!(slowest[0].name, "alpha");
        assert_eq!(slowest[0].downstream, 1);
        assert_eq!(slowest[0].seconds, 0);
        let ws = counts.iter().find(|c| c.section == "Workspace").unwrap();
        assert_eq!(ws.count, 2);
        assert!(insight.is_some());
        let text = insight.unwrap().text;
        assert!(text.contains("3 crates"), "{text}");
    }
}
