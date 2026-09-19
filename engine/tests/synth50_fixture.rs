//! Integration tests over the COMMITTED 50-crate synthetic fixture
//! (`tests/fixtures/synth-50`, generated once via
//! `wanyrix synth --crates 50 --seed 7`). This fixture gives graph/health
//! integration tests a mid-scale DAG without committing a 500-crate tree.
//!
//! The pinned numbers below are MEASURED from the fixture on disk (doctor
//! summary: 83 warnings = 17 missing-license + 17 missing-description +
//! 49 crates with version-less path deps). A final test regenerates the
//! fixture from the pinned seed and diffs it byte-for-byte, so any edit to
//! the fixture or drift in the generator fails loudly.

use std::path::{Path, PathBuf};
use wanyrix_engine::cli;
use wanyrix_engine::graph::build_graph;
use wanyrix_engine::report;
use wanyrix_engine::scan::scan_workspace;
use wanyrix_engine::synth;

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/synth-50")
}

/// The committed fixture scans to exactly the shape the generator
/// documents: 50 crates + root manifest, 97 backward-only edges, and the
/// pinned doctor finding set.
#[test]
fn synth50_fixture_scans_to_pinned_shape() {
    let scan = scan_workspace(&fixture()).unwrap();
    assert_eq!(scan.workspace_name, "synth-50");
    assert_eq!(scan.crates.len(), 50);
    assert_eq!(
        scan.manifests_found, 51,
        "root virtual manifest + 50 crates"
    );
    assert_eq!(scan.parse_failures, 0);
    assert_eq!(
        scan.edges.len(),
        97,
        "measured edge count of the committed fixture"
    );

    // DAG invariant on the measured edge list: backward-only.
    let idx = |name: &str| -> usize { name.trim_start_matches('c').parse().unwrap() };
    for e in &scan.edges {
        assert!(
            idx(&e.from) > idx(&e.to),
            "edge {}→{} must point backward",
            e.from,
            e.to
        );
    }

    // Pinned doctor findings (measured from the fixture at pinning time).
    let findings = cli::doctor(&scan);
    assert_eq!(findings.len(), 83);
    let count = |prefix: &str| findings.iter().filter(|f| f.id.starts_with(prefix)).count();
    assert_eq!(count("FER-ENG-001"), 17, "missing-license findings");
    assert_eq!(count("FER-ENG-002"), 17, "missing-description findings");
    assert_eq!(
        count("FER-ENG-003"),
        49,
        "version-less path-dep findings (every crate with deps)"
    );
    assert_eq!(count("FER-ENG-005"), 0, "no cycles");
    assert_eq!(count("FER-ENG-007"), 0, "no broken deps");
}

/// The full graph + health pipeline over 50 nodes: aggregates derive from
/// the served edge list (no ghost nodes) and the DAG has no SCCs.
#[test]
fn synth50_graph_and_health_build_over_the_dag() {
    let scan = scan_workspace(&fixture()).unwrap();
    let findings = cli::doctor(&scan);
    let g = build_graph(&scan);

    assert_eq!(g.nodes.len(), 50);
    assert_eq!(g.edges.len(), 97);
    // A backward-only DAG has no cycles: the Tarjan pass (used by the
    // cycle findings) finds nothing — asserted via doctor in the test
    // above; here we pin the closure property instead. Every dependency
    // chain strictly decreases in index, so it MUST terminate at c0000
    // (the only crate with no earlier target) — c0000 is downstream of
    // all other 49 crates.
    for n in &g.nodes {
        let fan_in = g.edges.iter().filter(|e| e.to == n.id).count();
        let fan_out = g.edges.iter().filter(|e| e.from == n.id).count();
        assert_eq!(n.fan_in, fan_in, "fanIn of {} derived from edges", n.id);
        assert_eq!(n.fan_out, fan_out, "fanOut of {} derived from edges", n.id);
    }
    let root = g.nodes.iter().find(|n| n.id == "c0000").unwrap();
    assert_eq!(root.fan_out, 0);
    assert_eq!(
        root.recompile_impact.len(),
        49,
        "every crate transitively reaches c0000"
    );
    assert_eq!(root.downstream, 49);

    let (kpis, slowest, counts, insight) = cli::health(&scan, &findings, &g);
    let health = report::health_report(
        &scan,
        &findings,
        &g,
        kpis,
        slowest,
        counts,
        insight,
        "2026-09-18T13:28:56Z".to_owned(),
    );
    let text = cli::serialize_json(&health, false).unwrap();
    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(v["schema"], "wanyrix.health/v1");
    assert_eq!(v["crates"], 50);
    assert_eq!(v["edges"], 97);
}

/// Guard against fixture drift: regenerating from the pinned seed
/// (`--crates 50 --seed 7`) must reproduce the committed tree
/// byte-for-byte. Any generator change that would silently alter the
/// committed fixture fails here.
#[test]
fn synth50_fixture_regenerates_byte_identically() {
    let regenerated = PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("synth50-regen-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&regenerated);
    synth::synth(&regenerated, 50, 7).unwrap();

    fn listing(root: &Path) -> Vec<(String, Vec<u8>)> {
        fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
            for entry in std::fs::read_dir(dir).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(root, &path, out);
                } else {
                    let rel = path
                        .strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .into_owned();
                    out.push((rel, std::fs::read(&path).unwrap()));
                }
            }
        }
        let mut out = Vec::new();
        walk(root, root, &mut out);
        out.sort();
        out
    }

    assert_eq!(
        listing(&regenerated),
        listing(&fixture()),
        "committed synth-50 must equal a fresh seed-7 regeneration"
    );
    std::fs::remove_dir_all(&regenerated).ok();
}
