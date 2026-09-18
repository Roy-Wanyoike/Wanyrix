//! End-to-end tests for the deterministic synthetic-workspace generator
//! (`wanyrix synth`, issue #58): the generated tree must be byte-identical
//! for a fixed seed, form a DAG the engine measures as backward-only
//! edges, and give doctor exactly the expected findings shape. The
//! 500-crate scale gate runs against `CARGO_TARGET_TMPDIR` (generated at
//! test time — the 500-crate tree is never committed; see the pinned
//! 50-crate fixture under tests/fixtures/synth-50).

use std::path::{Path, PathBuf};
use wanyrix_engine::cli;
use wanyrix_engine::graph::build_graph;
use wanyrix_engine::report;
use wanyrix_engine::scan::scan_workspace;
use wanyrix_engine::synth::{self, DEFAULT_SEED};

fn tempdir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("wanyrix-synth-e2e-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn tree_listing(root: &Path) -> Vec<(String, Vec<u8>)> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
        for entry in std::fs::read_dir(dir).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(root, &path, out);
            } else {
                let rel = path.strip_prefix(root).unwrap().to_string_lossy().into_owned();
                out.push((rel, std::fs::read(&path).unwrap()));
            }
        }
    }
    let mut out = Vec::new();
    walk(root, root, &mut out);
    out.sort();
    out
}

/// Same (seed, count) ⇒ byte-identical trees — the generator's core
/// determinism contract, checked end-to-end over the filesystem.
#[test]
fn synth_same_seed_is_byte_identical() {
    let dir = tempdir("determinism");
    let a = synth::synth(&dir.join("a"), 40, 2026).unwrap();
    let b = synth::synth(&dir.join("b"), 40, 2026).unwrap();
    assert_eq!(tree_listing(&dir.join("a")), tree_listing(&dir.join("b")));
    assert_eq!(a.crates_written, 40);
    assert_eq!(b.files_written, 81, "root manifest + 2 files per crate");
    // Different seed ⇒ different tree (same shape).
    synth::synth(&dir.join("c"), 40, 2027).unwrap();
    assert_ne!(tree_listing(&dir.join("a")), tree_listing(&dir.join("c")));
    std::fs::remove_dir_all(&dir).ok();
}

/// The engine's MEASURED edge list over a generated tree must be a DAG:
/// every edge points from a higher index to a strictly lower one, each
/// crate has 1–3 deps (0 for c0000), and the graph aggregates derive from
/// those edges without cycles (no FER-ENG-005/006 findings).
#[test]
fn synth_tree_is_a_dag_measured_by_the_engine() {
    let dir = tempdir("dag");
    let out = dir.join("ws");
    synth::synth(&out, 30, DEFAULT_SEED).unwrap();

    let scan = scan_workspace(&out).unwrap();
    assert_eq!(scan.crates.len(), 30, "all generated crates discovered");
    assert_eq!(scan.manifests_found, 31, "root virtual manifest + 30 crates");
    assert_eq!(scan.parse_failures, 0, "generated manifests are valid TOML");

    let idx = |name: &str| -> usize { name.trim_start_matches('c').parse().unwrap() };
    for e in &scan.edges {
        assert!(idx(&e.from) > idx(&e.to), "edge {}→{} must point backward (DAG)", e.from, e.to);
    }
    for c in &scan.crates {
        let out = scan.edges.iter().filter(|e| e.from == c.name).count();
        if c.name == "c0000" {
            assert_eq!(out, 0, "c0000 has no earlier crates to depend on");
        } else {
            assert!((1..=3).contains(&out), "{} has {} deps, want 1–3", c.name, out);
        }
    }

    // Doctor agrees: no cycles (005/006), no broken deps (007).
    let findings = cli::doctor(&scan);
    for f in &findings {
        let bad = f.id.starts_with("FER-ENG-005") || f.id.starts_with("FER-ENG-006") || f.id.starts_with("FER-ENG-007");
        assert!(!bad, "synthetic DAG must not surface {}: {}", f.id, f.title);
    }
    std::fs::remove_dir_all(&dir).ok();
}

/// Doctor must find the intentional incompleteness: missing
/// license/description findings (FER-ENG-001/002) and version-less path
/// deps (FER-ENG-003) — the fixture exists so doctor has things to say.
#[test]
fn synth_gives_doctor_real_findings() {
    let dir = tempdir("findings");
    let out = dir.join("ws");
    synth::synth(&out, 20, 5).unwrap();
    let scan = scan_workspace(&out).unwrap();
    let findings = cli::doctor(&scan);

    let has = |prefix: &str| findings.iter().any(|f| f.id.starts_with(prefix));
    assert!(has("FER-ENG-001"), "incomplete crates must trigger missing-license");
    assert!(has("FER-ENG-002"), "incomplete crates must trigger missing-description");
    assert!(has("FER-ENG-003"), "path deps carry no version — publish-readiness flags them");

    // The doctor JSON envelope is exactly what `store save` consumes.
    let doc = report::doctor_report(&scan, &findings, "2026-09-18T13:28:56Z".to_owned());
    let text = cli::serialize_json(&doc, false).unwrap();
    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(v["schema"], "wanyrix.doctor/v1");
    assert_eq!(v["crates"].as_array().unwrap().len(), 20);
    std::fs::remove_dir_all(&dir).ok();
}

/// The 500-crate scale gate (issue #58): generate into CARGO_TARGET_TMPDIR
/// at test time, then doctor must report exactly 500 crates and the
/// graph/health flavors must build over the whole tree.
#[test]
fn synth_500_doctor_graph_health_scale_gate() {
    // CARGO_TARGET_TMPDIR is `target/tmp` for integration tests — a
    // gitignored scratch area, per the issue-#58 mandate (never commit a
    // 500-crate tree).
    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("synth500-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    let outcome = synth::synth(&dir, 500, DEFAULT_SEED).unwrap();
    assert_eq!(outcome.crates_written, 500);
    assert!(outcome.complete_crates > 250 && outcome.complete_crates < 350, "~60% complete, got {}", outcome.complete_crates);

    let scan = scan_workspace(&dir).unwrap();
    assert_eq!(scan.crates.len(), 500, "doctor must see all 500 crates");
    let findings = cli::doctor(&scan);
    let doc = report::doctor_report(&scan, &findings, "2026-09-18T13:28:56Z".to_owned());
    let text = cli::serialize_json(&doc, false).unwrap();
    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(v["crates"].as_array().unwrap().len(), 500, "doctor JSON carries 500 crates");

    let g = build_graph(&scan);
    assert_eq!(g.nodes.len(), 500);
    assert!(g.edges.len() >= 499, "every crate after c0000 has ≥1 dep");

    let (kpis, slowest, counts, insight) = cli::health(&scan, &findings, &g);
    let health = report::health_report(&scan, &findings, &g, kpis, slowest, counts, insight, "2026-09-18T13:28:56Z".to_owned());
    let htext = cli::serialize_json(&health, false).unwrap();
    let hv: serde_json::Value = serde_json::from_str(&htext).unwrap();
    assert_eq!(hv["crates"], 500);

    std::fs::remove_dir_all(&dir).ok();
}
