//! Conformance tests: the engine's JSON output must carry EVERY required
//! key of the web contract defined in `src/lib/wanyrix/types.ts` (the web
//! app is the reference consumer).
//!
//! Pinned required-field lists (read from types.ts at authoring time):
//!
//! - `Finding`: id, section, severity, title, description, evidence,
//!   affected, impact, recommendation, remediationKind, verificationPath,
//!   confidenceClass, confidence, detection, measurementStatus
//!   (+ optional impactSeconds, experimentEligible — we always emit
//!   experimentEligible; impactSeconds is honestly absent).
//! - `Evidence`: label, value, source.
//! - `GraphNode`: id, band, kind, buildTime, fanIn, fanOut, downstream,
//!   changeFreq (+ optional versions, duplicate, critical).
//! - `GraphEdge`: from, to.
//! - `GraphPayload.meta`: workspaceCrates, totalEdges, lastScan, scope,
//!   servedNodes, servedEdges, aggregateSource, note.
//! - `HealthPayload`: workspace, crates, edges, toolchain, cacheHitRate,
//!   kpis{buildPerformance, ciCost, dependencyRisk, prRegressions,
//!   architectureDebt, runtimeBottlenecks}, buildTrend, slowestCrates
//!   {name, seconds, downstream}, activity, findingCounts, lastScan*
//!   (+ optional insight).
//!
//! Documented intentional divergences (also in report.rs + engine/README.md):
//! 1. The engine envelopes are NEW versioned schemas (`wanyrix.doctor/v1`,
//!    `wanyrix.graph/v1`, `wanyrix.health/v1`). The web `DoctorReport`
//!    envelope's build-telemetry fields (buildTime, estimatedRange,
//!    criticalPath, phases, summary.developerBuild/ciBuild/diskUsage) are
//!    deliberately NOT emitted — engine v1 measures no build times and
//!    fabricating them would violate Gate 21. Findings inside remain
//!    field-for-field conformant.
//! 2. `meta.scope` is "full-manifest-graph" (the engine serves the FULL
//!    measured graph), not the web demo's 'backbone-subset' literal — a
//!    scope upgrade, not a contradiction; the TS literal needs widening.
//! 3. `HealthPayload.lastScan` is served at top level as `generatedAt`
//!    (same instant; key renamed so the deterministic payload can be
//!    audited independently of the timestamp).
//! 4. Node extras: buildTimeStatus/changeFreqStatus/recompileImpact/path —
//!    additive engine honesty fields (unknown keys are ignored by TS).

use serde_json::Value;
use wanyrix_engine::cli;
use wanyrix_engine::report;
use wanyrix_engine::scan::scan_workspace;

const REQUIRED_FINDING_KEYS: [&str; 15] = [
    "id",
    "section",
    "severity",
    "title",
    "description",
    "evidence",
    "affected",
    "impact",
    "recommendation",
    "remediationKind",
    "verificationPath",
    "confidenceClass",
    "confidence",
    "detection",
    "measurementStatus",
];

const REQUIRED_EVIDENCE_KEYS: [&str; 3] = ["label", "value", "source"];

const REQUIRED_GRAPH_NODE_KEYS: [&str; 8] = [
    "id",
    "band",
    "kind",
    "buildTime",
    "fanIn",
    "fanOut",
    "downstream",
    "changeFreq",
];

const REQUIRED_META_KEYS: [&str; 8] = [
    "workspaceCrates",
    "totalEdges",
    "lastScan",
    "scope",
    "servedNodes",
    "servedEdges",
    "aggregateSource",
    "note",
];

const REQUIRED_HEALTH_KEYS: [&str; 12] = [
    "workspace",
    "crates",
    "edges",
    "toolchain",
    "cacheHitRate",
    "kpis",
    "buildTrend",
    "slowestCrates",
    "activity",
    "findingCounts",
    "insight",
    "generatedAt",
];

const REQUIRED_KPI_KEYS: [&str; 6] = [
    "buildPerformance",
    "ciCost",
    "dependencyRisk",
    "prRegressions",
    "architectureDebt",
    "runtimeBottlenecks",
];

const SECTIONS: [&str; 6] = ["Build", "Workspace", "IDE", "CI", "Async", "Dependencies"];
const SEVERITIES: [&str; 3] = ["critical", "warning", "info"];
const REMEDIATION: [&str; 5] = ["command", "config", "architecture", "experiment", "patch"];
const CONFIDENCE_CLASSES: [&str; 4] = ["deterministic", "high", "medium", "estimated"];
const MEASUREMENT_STATUSES: [&str; 3] = ["measured", "estimated", "verified"];

struct Fixture {
    doctor: Value,
    graph: Value,
    health: Value,
}

fn run_fixture(name: &str) -> Fixture {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    let scan = scan_workspace(&path).expect("fixture scan succeeds");
    let findings = cli::doctor(&scan);
    let g = cli::graph(&scan);
    let (kpis, slowest, counts, insight) = cli::health(&scan, &findings, &g);
    let doctor = serde_json::to_value(report::doctor_report(&scan, &findings, cli::now_iso8601()))
        .expect("doctor serializes");
    let graph = serde_json::to_value(report::graph_report(&scan, &g, cli::now_iso8601()))
        .expect("graph serializes");
    let health = serde_json::to_value(report::health_report(
        &scan,
        &findings,
        &g,
        kpis,
        slowest,
        counts,
        insight,
        cli::now_iso8601(),
    ))
    .expect("health serializes");
    Fixture {
        doctor,
        graph,
        health,
    }
}

fn assert_keys(obj: &Value, keys: &[&str], ctx: &str) {
    let Value::Object(map) = obj else {
        panic!("{ctx} is not a JSON object");
    };
    for k in keys {
        assert!(
            map.contains_key(*k),
            "{ctx} missing required key `{k}` (keys present: {:?})",
            map.keys().collect::<Vec<_>>()
        );
    }
}

fn check_findings(doctor: &Value, ws: &str) {
    assert_eq!(doctor["schema"], "wanyrix.doctor/v1");
    assert_keys(
        doctor,
        &[
            "schema",
            "workspace",
            "crates",
            "findings",
            "summary",
            "measurement",
            "generatedAt",
        ],
        "doctor envelope",
    );
    let findings = doctor["findings"].as_array().expect("findings array");
    assert!(!findings.is_empty(), "{ws}: fixture must surface findings");
    for f in findings {
        let id = f["id"].as_str().unwrap_or("?").to_owned();
        assert_keys(f, &REQUIRED_FINDING_KEYS, &format!("finding {id}"));
        assert!(
            SECTIONS.contains(&f["section"].as_str().unwrap()),
            "{id}: section enum"
        );
        assert!(
            SEVERITIES.contains(&f["severity"].as_str().unwrap()),
            "{id}: severity enum"
        );
        assert!(
            REMEDIATION.contains(&f["remediationKind"].as_str().unwrap()),
            "{id}: remediationKind enum"
        );
        assert!(
            CONFIDENCE_CLASSES.contains(&f["confidenceClass"].as_str().unwrap()),
            "{id}: confidenceClass enum"
        );
        assert!(
            MEASUREMENT_STATUSES.contains(&f["measurementStatus"].as_str().unwrap()),
            "{id}: measurementStatus enum"
        );
        assert!(f["confidence"].is_u64(), "{id}: confidence is a number");
        assert!(f["affected"].is_array(), "{id}: affected is an array");
        // evidence entries conform to the web Evidence shape
        let evidence = f["evidence"].as_array().expect("evidence array");
        assert!(!evidence.is_empty(), "{id}: evidence non-empty");
        for e in evidence {
            assert_keys(e, &REQUIRED_EVIDENCE_KEYS, &format!("evidence of {id}"));
        }
    }
    // crate list is measured and shaped
    let crates = doctor["crates"].as_array().expect("crates array");
    for c in crates {
        assert_keys(
            c,
            &["name", "version", "manifestPath", "band", "kind"],
            "crate entry",
        );
    }
    // severity counts agree with the findings array (derived, never typed)
    let summary = &doctor["summary"];
    let count = |s: &str| findings.iter().filter(|f| f["severity"] == s).count();
    assert_eq!(summary["critical"].as_u64(), Some(count("critical") as u64));
    assert_eq!(summary["warning"].as_u64(), Some(count("warning") as u64));
    assert_eq!(summary["info"].as_u64(), Some(count("info") as u64));
    assert_eq!(summary["total"].as_u64(), Some(findings.len() as u64));
}

fn check_graph(graph: &Value, ws: &str) {
    assert_eq!(graph["schema"], "wanyrix.graph/v1");
    assert_keys(
        graph,
        &[
            "schema",
            "workspace",
            "nodes",
            "edges",
            "meta",
            "measurement",
            "generatedAt",
        ],
        "graph envelope",
    );
    let nodes = graph["nodes"].as_array().expect("nodes array");
    let edges = graph["edges"].as_array().expect("edges array");
    assert!(!nodes.is_empty(), "{ws}: graph has nodes");
    for n in nodes {
        let id = n["id"].as_str().unwrap_or("?").to_owned();
        assert_keys(n, &REQUIRED_GRAPH_NODE_KEYS, &format!("node {id}"));
        assert!(
            ["bin", "lib", "external"].contains(&n["band"].as_str().unwrap()),
            "{id}: band enum"
        );
        assert!(
            ["workspace", "external", "proc-macro"].contains(&n["kind"].as_str().unwrap()),
            "{id}: kind enum"
        );
        assert!(n["versions"].is_array());
        // engine honesty extras
        assert_eq!(n["buildTimeStatus"], "not-measured");
        assert_eq!(n["changeFreqStatus"], "not-measured");
        assert!(n["recompileImpact"].is_array());
        // aggregates agree with the served edge list (derived, never typed)
        let fan_in = edges.iter().filter(|e| e["to"] == n["id"]).count();
        let fan_out = edges.iter().filter(|e| e["from"] == n["id"]).count();
        assert_eq!(
            n["fanIn"].as_u64(),
            Some(fan_in as u64),
            "{id}: fanIn derived from edges"
        );
        assert_eq!(
            n["fanOut"].as_u64(),
            Some(fan_out as u64),
            "{id}: fanOut derived from edges"
        );
        let downstream = n["recompileImpact"]
            .as_array()
            .expect("recompileImpact array")
            .len();
        assert_eq!(
            n["downstream"].as_u64(),
            Some(downstream as u64),
            "{id}: downstream == recompileImpact.len()"
        );
    }
    for e in edges {
        assert_keys(e, &["from", "to"], "graph edge");
        // no ghost nodes: both endpoints must be served nodes
        let node_ids: Vec<&str> = nodes.iter().filter_map(|n| n["id"].as_str()).collect();
        assert!(
            node_ids.contains(&e["from"].as_str().unwrap()),
            "edge from-node served"
        );
        assert!(
            node_ids.contains(&e["to"].as_str().unwrap()),
            "edge to-node served"
        );
    }
    assert_keys(&graph["meta"], &REQUIRED_META_KEYS, "graph meta");
    assert_eq!(graph["meta"]["aggregateSource"], "served-edges");
    assert_eq!(
        graph["meta"]["servedNodes"].as_u64(),
        Some(nodes.len() as u64)
    );
    assert_eq!(
        graph["meta"]["servedEdges"].as_u64(),
        Some(edges.len() as u64)
    );
}

fn check_health(health: &Value, ws: &str) {
    assert_eq!(health["schema"], "wanyrix.health/v1");
    assert_keys(health, &REQUIRED_HEALTH_KEYS, "health envelope");
    assert_eq!(health["workspace"], ws);
    assert!(health["cacheHitRate"].is_u64());
    assert_eq!(health["cacheHitRateStatus"], "not-measured");
    for k in REQUIRED_KPI_KEYS {
        assert_keys(&health["kpis"], &[k], "health kpis");
    }
    // delta-shaped vs count-shaped KPIs per the web contract
    for k in ["buildPerformance", "ciCost", "dependencyRisk"] {
        assert!(
            health["kpis"][k]["delta"].is_i64(),
            "kpis.{k}.delta is a number"
        );
        assert!(
            health["kpis"][k]["label"].is_string(),
            "kpis.{k}.label is a string"
        );
    }
    for k in ["prRegressions", "architectureDebt", "runtimeBottlenecks"] {
        assert!(
            health["kpis"][k]["count"].is_u64(),
            "kpis.{k}.count is a number"
        );
        assert!(
            health["kpis"][k]["label"].is_string(),
            "kpis.{k}.label is a string"
        );
    }
    assert!(health["buildTrend"].is_array());
    assert!(health["activity"].is_array());
    for s in health["slowestCrates"]
        .as_array()
        .expect("slowestCrates array")
    {
        assert_keys(s, &["name", "seconds", "downstream"], "slowestCrate entry");
    }
    for c in health["findingCounts"]
        .as_array()
        .expect("findingCounts array")
    {
        assert_keys(c, &["section", "count"], "findingCount entry");
        assert!(
            SECTIONS.contains(&c["section"].as_str().unwrap()),
            "section enum in findingCounts"
        );
    }
}

#[test]
fn conformance_tiny_ws() {
    let f = run_fixture("tiny-ws");
    check_findings(&f.doctor, "tiny-ws");
    check_graph(&f.graph, "tiny-ws");
    check_health(&f.health, "tiny-ws");
    // pinned measured outcomes
    let ids: Vec<&str> = f.doctor["findings"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|x| x["id"].as_str())
        .collect();
    assert_eq!(
        ids,
        vec![
            "FER-ENG-001-gamma",
            "FER-ENG-002-gamma",
            "FER-ENG-003-beta",
            "FER-ENG-004-beta-log"
        ]
    );
    assert_eq!(f.graph["meta"]["workspaceCrates"], 3);
    assert_eq!(f.graph["meta"]["totalEdges"], 1);
}

#[test]
fn conformance_cycle_ws() {
    let f = run_fixture("cycle-ws");
    check_findings(&f.doctor, "cycle-ws");
    check_graph(&f.graph, "cycle-ws");
    check_health(&f.health, "cycle-ws");
    let ids: Vec<&str> = f.doctor["findings"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|x| x["id"].as_str())
        .collect();
    assert_eq!(
        ids,
        vec![
            "FER-ENG-005-ping",
            "FER-ENG-003-ping",
            "FER-ENG-003-pong",
            "FER-ENG-006-deva"
        ]
    );
    assert_eq!(f.graph["meta"]["workspaceCrates"], 4);
    assert_eq!(f.graph["meta"]["totalEdges"], 4);
    // the cyclic graph still renders a complete, closed edge set
    let ids: Vec<&str> = f.doctor["findings"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|x| x["id"].as_str())
        .collect();
    assert!(ids.contains(&"FER-ENG-005-ping"));
    assert!(
        f.health["kpis"]["dependencyRisk"]["delta"]
            .as_i64()
            .unwrap()
            >= 2
    );
}
