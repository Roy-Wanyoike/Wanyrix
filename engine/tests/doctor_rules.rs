//! Doctor rule pins (issue #89, A1-F4 remainder): FER-ENG-008 is the only
//! doctor rule whose emission conditions no test asserted. This file pins
//! them — and, as control groups, the two neighbouring outcomes a path
//! dependency can have (resolved, broken) so 008 cannot silently grow into
//! a catch-all.
//!
//! Emission conditions under test (src/analysis.rs `path_dep_findings`):
//!   FER-ENG-008 (info)   — the path-dep target manifest EXISTS but is
//!                          OUTSIDE the analyzed crate set (escaped).
//!   FER-ENG-007 (critical, control) — the target has NO readable manifest.
//!   (no finding, control) — the target resolves to a scanned crate.

use std::path::{Path, PathBuf};

use wanyrix_engine::analysis::{self};
use wanyrix_engine::cli;
use wanyrix_engine::scan::scan_workspace;

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wanyrix-doctor-rules-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// One minimal lib-type crate with a `[dependencies]` table.
fn write_crate(dir: &Path, name: &str, deps: &str) {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(
        dir.join("Cargo.toml"),
        format!("[package]\nname = \"{name}\"\nversion = \"0.1.0\"\nedition = \"2021\"\nlicense = \"MIT\"\ndescription = \"pin fixture\"\n\n[dependencies]\n{deps}\n"),
    )
    .unwrap();
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(dir.join("src/lib.rs"), "pub fn pin() {}\n").unwrap();
}

/// A scanned root + an OUTSIDE sibling carrying a valid manifest, with
/// `alpha` depending on it via a relative path — the 008 shape.
fn escaped_fixture(name: &str) -> PathBuf {
    let parent = temp_dir(name);
    let root = parent.join("scan-root");
    write_crate(
        &root.join("alpha"),
        "alpha",
        // relative to alpha's dir: `../..` leaves the scanned root
        "escapee = { path = \"../../outside/escapee\" }",
    );
    write_crate(&parent.join("outside/escapee"), "escapee", "");
    root
}

#[test]
fn fer_eng_008_fires_when_the_dep_target_lives_outside_the_analyzed_set() {
    let root = escaped_fixture("escaped");
    let scan = scan_workspace(&root).unwrap();
    let findings = cli::doctor(&scan);

    let hits: Vec<_> = findings
        .iter()
        .filter(|f| f.id.starts_with("FER-ENG-008"))
        .collect();
    assert_eq!(hits.len(), 1, "exactly one 008, got: {findings:?}");
    let f = hits[0];
    assert_eq!(f.id, "FER-ENG-008-alpha-escapee", "stable per-dep id");
    assert_eq!(f.severity, analysis::SEVERITY_INFO);
    assert_eq!(f.section, "Dependencies");
    assert_eq!(f.affected, vec!["alpha".to_owned()]);
    assert!(
        f.title.contains("outside the analyzed set"),
        "title names the escape: {f:?}"
    );
    assert!(
        f.description.contains("outside the scanned root"),
        "the description states WHERE it went: {f:?}"
    );
    assert_eq!(f.measurement_status, "measured");
    assert_eq!(f.confidence_class, "deterministic");
    assert!(
        f.detection.contains("FER-ENG-008"),
        "the detection line names the rule: {f:?}"
    );
    assert!(
        f.recommendation.contains("--path") || f.recommendation.contains("scan root"),
        "the remediation points at widening the scan root: {f:?}"
    );

    // Control: the same fixture must NOT mint the broken-dep rule — the
    // target manifest exists and parses, it is just out of scope.
    assert!(
        !findings.iter().any(|f| f.id.starts_with("FER-ENG-007")),
        "an escaped dep is not a broken dep: {findings:?}"
    );

    // The graph serves no ghost node for the escaped target.
    let g = cli::graph(&scan);
    assert!(
        !g.nodes.iter().any(|n| n.id == "escapee"),
        "no ghost node for a target outside the analyzed set"
    );
    std::fs::remove_dir_all(root.parent().unwrap()).ok();
}

#[test]
fn fer_eng_007_fires_when_the_dep_target_has_no_manifest() {
    let parent = temp_dir("broken");
    let root = parent.join("scan-root");
    write_crate(&root.join("alpha"), "alpha", "ghost = { path = \"../../gone\" }");
    // `gone` exists as a DIRECTORY but carries no Cargo.toml → broken, not
    // escaped (the measured distinction in src/scan.rs).
    std::fs::create_dir_all(parent.join("gone")).unwrap();

    let scan = scan_workspace(&root).unwrap();
    let findings = cli::doctor(&scan);
    let hits: Vec<_> = findings
        .iter()
        .filter(|f| f.id.starts_with("FER-ENG-007"))
        .collect();
    assert_eq!(hits.len(), 1, "exactly one 007, got: {findings:?}");
    assert_eq!(hits[0].id, "FER-ENG-007-alpha-ghost");
    assert_eq!(hits[0].severity, analysis::SEVERITY_CRITICAL);
    assert!(
        !findings.iter().any(|f| f.id.starts_with("FER-ENG-008")),
        "a manifestless target is 007, never 008: {findings:?}"
    );
    std::fs::remove_dir_all(&parent).ok();
}

#[test]
fn a_resolved_intra_workspace_path_dep_mints_neither_007_nor_008() {
    let parent = temp_dir("resolved");
    let root = parent.join("scan-root");
    write_crate(&root.join("alpha"), "alpha", "beta = { path = \"../beta\" }");
    write_crate(&root.join("beta"), "beta", "");

    let scan = scan_workspace(&root).unwrap();
    let findings = cli::doctor(&scan);
    assert!(
        !findings
            .iter()
            .any(|f| f.id.starts_with("FER-ENG-007") || f.id.starts_with("FER-ENG-008")),
        "a resolved edge is nobody's finding: {findings:?}"
    );
    let g = cli::graph(&scan);
    assert!(
        g.edges.iter().any(|e| e.from == "alpha" && e.to == "beta"),
        "the resolved edge is served"
    );
    std::fs::remove_dir_all(&parent).ok();
}
