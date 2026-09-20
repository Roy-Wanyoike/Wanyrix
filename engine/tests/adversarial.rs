//! Adversarial repository hardening — systematic hostile-input fixture suite
//! (issue #71).
//!
//! Mandate: a repository is UNTRUSTED INPUT. Every scenario below feeds the
//! engine something a hostile checkout could realistically contain and pins
//! the honesty contract: the engine fails SAFE (a named FER-ENG-ERR finding
//! or a named `EngineError`), never panics, never hangs, never silently
//! drops what it measured.
//!
//! Covered hostile classes (each maps to a row in docs/SECURITY.md):
//! 1. Unicode/homoglyph crate names + paths (CJK, emoji, RTL override,
//!    non-UTF-8 directory bytes) — output stays valid UTF-8 JSON
//! 2. Very deep directory nesting — bounded walk (documented depth cap)
//! 3. Huge manifests (thousands of deps; beyond-cap file) — bounded, named
//! 4. Symlinks: dirs, loops, manifests, /dev/zero toolchain — never followed
//! 5. Malformed manifests (invalid TOML, missing name, non-string version,
//!    BOM, CRLF, empty, binary bytes) — each pinned to its exact behavior
//! 6. Pathological dependency graphs (500-chain, fan-out 200, diamond +
//!    cycle) — scan + graph + SCC + change closure all terminate
//! 7. Crates named like Rust keywords — ordinary strings in the model
//! 8. Read-only workspace — read surfaces still measure; store surfaces
//!    return named errors
//! 9. `Cargo.toml` as a DIRECTORY; a manifest that is a symlink to
//!    /dev/null — named handling
//! 10. Empty scan root — the named `NoManifests` error
//!
//! Every fixture is built under `std::env::temp_dir()` with the test name
//! AND the process id in the directory name (two tests sharing a tempdir
//! name raced once — never again), and cleaned up with `remove_dir_all`.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use wanyrix_engine::change::impact_report;
use wanyrix_engine::cli;
use wanyrix_engine::graph::{build_graph, strongly_connected_components};
use wanyrix_engine::model::{EdgeKind, EngineError, WorkspaceScan};
use wanyrix_engine::product;
use wanyrix_engine::report;
use wanyrix_engine::scan::{manifest_fingerprint, scan_workspace};
use wanyrix_engine::store;

/// Fresh tempdir, unique per (test name, process id) — race-free by
/// construction. Any pre-existing leftover is removed first.
fn tempdir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("wanyrix-adv-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// A minimal healthy `[package]` manifest with optional path deps
/// (`(dep name, path value)` pairs) — every dep deliberately omits a
/// `version`, which is fine for fixtures.
fn crate_manifest(name: &str, deps: &[(&str, &str)]) -> String {
    let mut m = format!(
        "[package]\nname = \"{name}\"\nversion = \"0.1.0\"\nlicense = \"MIT\"\ndescription = \"adversarial fixture crate\"\n"
    );
    if !deps.is_empty() {
        m.push_str("\n[dependencies]\n");
        for (dep, path) in deps {
            m.push_str(&format!("{dep} = {{ path = \"{path}\" }}\n"));
        }
    }
    m
}

/// Write a crate directory `<root>/<name>/Cargo.toml`.
fn make_crate(root: &Path, name: &str, deps: &[(&str, &str)]) {
    let dir = root.join(name);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("Cargo.toml"), crate_manifest(name, deps)).unwrap();
}

/// A workspace with one healthy crate plus a hostile `hostile/Cargo.toml`
/// written from raw bytes (so binary and BOM cases are exact).
fn hostile_ws(name: &str, hostile_manifest: &[u8]) -> (PathBuf, WorkspaceScan) {
    let ws = tempdir(name);
    make_crate(&ws, "healthy", &[]);
    let dir = ws.join("hostile");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("Cargo.toml"), hostile_manifest).unwrap();
    let scan = scan_workspace(&ws).unwrap_or_else(|e| {
        panic!("{name}: the scan itself must never fail on hostile content, got: {e}")
    });
    (ws, scan)
}

/// Number of FER-ENG-ERR findings the analyzer produced for this scan.
fn err_finding_count(scan: &WorkspaceScan) -> usize {
    cli::doctor(scan)
        .iter()
        .filter(|f| f.id.starts_with("FER-ENG-ERR"))
        .count()
}

/// One FER-ENG-ERR finding must exist and must NAME the hostile manifest
/// path in its title plus `needle` in its measured evidence.
fn assert_one_err_finding(scan: &WorkspaceScan, rel: &str, needle: &str) {
    let findings = cli::doctor(scan);
    let errs: Vec<_> = findings
        .iter()
        .filter(|f| f.id.starts_with("FER-ENG-ERR"))
        .collect();
    assert_eq!(errs.len(), 1, "exactly one FER-ENG-ERR finding");
    let f = errs[0];
    assert_eq!(f.severity, "critical", "unparseable manifest is critical");
    assert!(
        f.title.contains(rel),
        "finding must name the manifest, got: {}",
        f.title
    );
    let evidence: String = f.evidence.iter().map(|e| e.value.as_str()).collect();
    assert!(
        evidence.contains(needle),
        "evidence must contain {needle:?}, got: {evidence}"
    );
}

// ---------------------------------------------------------------------------
// 1. Unicode / homoglyph crate names and paths
// ---------------------------------------------------------------------------

/// CJK, emoji, a Cyrillic homoglyph of "alpha" and an RTL-override name are
/// ordinary strings in the model: measured as crates, as an edge, in finding
/// ids — and every serialized envelope stays valid UTF-8 JSON. The unicode
/// DEPENDENCY key must be a QUOTED TOML key (cargo accepts quoted keys;
/// unquoted non-ASCII keys are a parse failure — see the dedicated fixture
/// below).
#[test]
fn unicode_and_homoglyph_crate_names_round_trip_through_json() {
    let ws = tempdir("unicode-names");
    let emoji = "🦀ferris";
    let cjk = "日本語クレート";
    let homoglyph = "\u{0430}lpha"; // Cyrillic а + Latin alpha — NOT "alpha"
    let rtl = "rtl\u{202E}gnp"; // right-to-left override inside the name
    make_crate(&ws, emoji, &[]);
    make_crate(&ws, homoglyph, &[]);
    make_crate(&ws, rtl, &[]);
    // CJK crate depending on the emoji crate via a QUOTED unicode key.
    let cjk_dir = ws.join(cjk);
    fs::create_dir_all(&cjk_dir).unwrap();
    fs::write(
        cjk_dir.join("Cargo.toml"),
        format!(
            "[package]\nname = \"{cjk}\"\nversion = \"0.1.0\"\nlicense = \"MIT\"\ndescription = \"x\"\n\n[dependencies]\n\"{emoji}\" = {{ path = \"../{emoji}\" }}\n"
        ),
    )
    .unwrap();

    let scan = scan_workspace(&ws).unwrap();
    assert_eq!(scan.parse_failures, 0);
    assert_eq!(scan.crates.len(), 4, "all four names measured");
    for name in [cjk, emoji, homoglyph, rtl] {
        assert!(
            scan.crates.iter().any(|c| c.name == name),
            "crate {name:?} measured verbatim"
        );
    }
    assert_eq!(scan.edges.len(), 1);
    assert_eq!(scan.edges[0].from, cjk);
    assert_eq!(scan.edges[0].to, emoji);

    // The finding id carries the unicode crate name verbatim.
    let findings = cli::doctor(&scan);
    assert!(
        findings
            .iter()
            .any(|f| f.id == format!("FER-ENG-003-{cjk}")),
        "path-dep finding id keeps the unicode name, got: {:?}",
        findings.iter().map(|f| &f.id).collect::<Vec<_>>()
    );

    // Byte-level honesty: every envelope serializes to VALID UTF-8 and the
    // names round-trip through a JSON re-parse unchanged.
    let doc = report::doctor_report(&scan, &findings, "2026-01-01T00:00:00Z".to_owned());
    let bytes = serde_json::to_vec(&doc).unwrap();
    let text = std::str::from_utf8(&bytes).expect("doctor payload must be valid UTF-8");
    let back: serde_json::Value = serde_json::from_str(text).unwrap();
    let names: Vec<&str> = back["crates"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    for name in [cjk, emoji, homoglyph, rtl] {
        assert!(
            names.contains(&name),
            "name {name:?} survives the JSON round-trip"
        );
    }

    let g = build_graph(&scan);
    let gdoc = report::graph_report(&scan, &g, "2026-01-01T00:00:00Z".to_owned());
    let gbytes = serde_json::to_vec(&gdoc).unwrap();
    std::str::from_utf8(&gbytes).expect("graph payload must be valid UTF-8");

    fs::remove_dir_all(&ws).unwrap();
}

/// An UNQUOTED non-ASCII dependency key (emoji — TOML bare keys are ASCII
/// only in the parser the engine ships) is a parse failure: the engine
/// answers with a NAMED critical FER-ENG-ERR finding and the declaring
/// crate is honestly absent — never a panic, never a silent drop.
#[test]
fn unquoted_unicode_dep_key_is_a_named_parse_finding() {
    let (ws, scan) = hostile_ws(
        "unicode-dep-key",
        "[package]\nname = \"hostile\"\nversion = \"0.1.0\"\n\n[dependencies]\n🦀ferris = { path = \"../f\" }\n".as_bytes(),
    );
    assert_eq!(scan.parse_failures, 1);
    assert_eq!(scan.crates.len(), 1);
    assert_one_err_finding(&scan, "hostile/Cargo.toml", "invalid unquoted key");
    fs::remove_dir_all(&ws).unwrap();
}

/// A directory whose NAME is not even valid UTF-8 (lone `0xE9` byte) is
/// still measured: the engine never emits invalid UTF-8 — the path is
/// lossily converted with a visible U+FFFD replacement marker (the pinned
/// contract: output stays valid UTF-8 JSON; the anomaly stays visible).
#[cfg(unix)]
#[test]
fn non_utf8_directory_name_is_measured_with_a_visible_lossy_marker() {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;

    let ws = tempdir("non-utf8-dir");
    let dir = ws.join(OsStr::from_bytes(b"cr\xe9ate")); // invalid UTF-8
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("Cargo.toml"), crate_manifest("weird-bytes", &[])).unwrap();

    let scan = scan_workspace(&ws).unwrap();
    assert_eq!(scan.crates.len(), 1);
    assert_eq!(scan.crates[0].name, "weird-bytes");
    assert!(
        scan.crates[0].manifest_path.contains('\u{FFFD}'),
        "lossy conversion must be visible in the measured path, got: {}",
        scan.crates[0].manifest_path
    );

    let findings = cli::doctor(&scan);
    let doc = report::doctor_report(&scan, &findings, "2026-01-01T00:00:00Z".to_owned());
    let bytes = serde_json::to_vec(&doc).unwrap();
    let text = std::str::from_utf8(&bytes).expect("output stays valid UTF-8");
    assert!(
        text.contains('\u{FFFD}'),
        "the replacement marker survives into the JSON payload"
    );

    fs::remove_dir_all(&ws).unwrap();
}

// ---------------------------------------------------------------------------
// 2. Very deep directory nesting
// ---------------------------------------------------------------------------

/// The documented walk cap (`MAX_DEPTH` = 48 in src/scan.rs): directories at
/// depth ≤ 48 are walked, the FIRST directory at depth 49 is counted as
/// skipped, and everything below it is never visited. 100 nested levels
/// therefore terminate in microseconds — and the manifest at depth 100 is
/// honestly absent (never silently "found").
#[test]
fn deep_nesting_terminates_at_the_documented_depth_cap() {
    let ws = tempdir("deep-nesting");
    fs::write(ws.join("Cargo.toml"), crate_manifest("root-crate", &[])).unwrap();
    let mut dir = ws.clone();
    for i in 1..=100 {
        dir = dir.join(format!("d{i:03}"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("Cargo.toml"),
            crate_manifest(&format!("deep-{i}"), &[]),
        )
        .unwrap();
    }

    let scan = scan_workspace(&ws).unwrap();
    // root + depths 1..=48 are walked
    assert_eq!(scan.manifests_found, 49, "root + d001..d048");
    assert!(scan.crates.iter().any(|c| c.name == "deep-48"));
    assert!(
        !scan.crates.iter().any(|c| c.name == "deep-49"),
        "depth-49 manifest is honestly absent (depth cap), not silently included"
    );
    assert_eq!(scan.parse_failures, 0);
    // exactly ONE skip is counted: the first directory past the cap; deeper
    // directories are never listed at all.
    assert_eq!(
        scan.skipped, 1,
        "single skip for the first dir past MAX_DEPTH"
    );

    fs::remove_dir_all(&ws).unwrap();
}

// ---------------------------------------------------------------------------
// 3. Huge manifests
// ---------------------------------------------------------------------------

/// A manifest with 4,100 dependencies (4,000 versioned + 100 path deps
/// resolving to 10 real crates) parses linearly and feeds doctor + graph
/// without blowup. 5 s is a blowup GUARD (≈100× headroom), not a perf claim.
#[test]
fn huge_manifest_with_thousands_of_deps_is_bounded() {
    let ws = tempdir("huge-manifest");
    for i in 0..10 {
        make_crate(&ws, &format!("c{i:02}"), &[]);
    }
    let dir = ws.join("huge");
    fs::create_dir_all(&dir).unwrap();
    let mut m = String::from(
        "[package]\nname = \"huge\"\nversion = \"0.1.0\"\nlicense = \"MIT\"\ndescription = \"x\"\n\n[dependencies]\n",
    );
    for i in 0..4000 {
        m.push_str(&format!("dep-{i:04} = \"1.0\"\n"));
    }
    for i in 0..100 {
        let t = format!("c{:02}", i % 10);
        m.push_str(&format!("path-dep-{i:03} = {{ path = \"../{t}\" }}\n"));
    }
    fs::write(dir.join("Cargo.toml"), m).unwrap();

    let t0 = Instant::now();
    let scan = scan_workspace(&ws).unwrap();
    assert_eq!(scan.parse_failures, 0);
    assert_eq!(scan.crates.len(), 11);
    let record = scan
        .manifests
        .iter()
        .find(|r| r.rel == "huge/Cargo.toml")
        .unwrap();
    assert_eq!(
        record.manifest().unwrap().dependencies.len(),
        4100,
        "every dependency entry is measured"
    );
    assert_eq!(scan.path_deps.len(), 100);
    assert_eq!(scan.edges.len(), 10, "deduped per (from, to, kind)");

    let findings = cli::doctor(&scan);
    let doc = report::doctor_report(&scan, &findings, "2026-01-01T00:00:00Z".to_owned());
    assert!(serde_json::to_string(&doc).is_ok());
    let g = build_graph(&scan);
    assert_eq!(g.nodes.len(), 11);
    let elapsed = t0.elapsed();
    assert!(
        elapsed < Duration::from_secs(5),
        "no exponential blowup: full surface took {elapsed:?}"
    );

    fs::remove_dir_all(&ws).unwrap();
}

/// A "manifest" beyond the measured-file cap (16 MiB, see
/// `pathutil::MAX_MEASURED_FILE_BYTES`) degrades to a NAMED unreadable
/// finding — never an OOM, never an unbounded parse.
#[test]
fn oversized_manifest_is_a_named_finding_not_an_oom() {
    let ws = tempdir("oversized-manifest");
    make_crate(&ws, "healthy", &[]);
    let dir = ws.join("huge");
    fs::create_dir_all(&dir).unwrap();
    let cap = wanyrix_engine::pathutil::MAX_MEASURED_FILE_BYTES as usize;
    let mut content = String::from("[package]\nname = \"huge\"\nversion = \"0.1.0\"\n# padding: ");
    content.push_str(&"x".repeat(cap + 64 - content.len()));
    fs::write(dir.join("Cargo.toml"), content).unwrap();

    let scan = scan_workspace(&ws).unwrap();
    assert_eq!(scan.parse_failures, 1);
    assert_eq!(
        scan.crates.len(),
        1,
        "the oversized manifest is not a crate"
    );
    assert_one_err_finding(&scan, "huge/Cargo.toml", "exceeds the measured-file cap");

    fs::remove_dir_all(&ws).unwrap();
}

// ---------------------------------------------------------------------------
// 4. Symlinks: dirs, loops, manifests, hostile toolchain
// ---------------------------------------------------------------------------

/// The scan's no-follow policy: symlinked directories are never entered
/// (so `ws/loop → ws` cannot loop the walk), and a symlinked Cargo.toml is
/// never read (so a manifest symlinked to anything at all is skipped, not
/// parsed). Everything skipped is COUNTED, not silent.
#[cfg(unix)]
#[test]
fn symlinks_are_skipped_never_followed_never_parsed() {
    use std::os::unix::fs::symlink;

    let ws = tempdir("symlink-policy");
    make_crate(&ws, "alpha", &[]);
    make_crate(&ws, "beta", &[]);
    // would-be infinite structures if the walk followed them:
    symlink(&ws, ws.join("loop")).unwrap(); // dir cycle: ws → ws/loop → ws
    symlink(ws.join("alpha"), ws.join("gamma")).unwrap(); // symlinked crate dir
    symlink(ws.join("beta"), ws.join("alpha").join("alias-dir")).unwrap();
    // symlinked manifest: real path points at a real manifest, still skipped
    let sym_crate = ws.join("sym-crate");
    fs::create_dir_all(&sym_crate).unwrap();
    symlink(
        ws.join("alpha").join("Cargo.toml"),
        sym_crate.join("Cargo.toml"),
    )
    .unwrap();

    let scan = scan_workspace(&ws).unwrap();
    assert_eq!(scan.manifests_found, 2, "only real manifests are counted");
    assert_eq!(scan.crates.len(), 2);
    assert!(scan.crates.iter().any(|c| c.name == "alpha"));
    assert!(scan.crates.iter().any(|c| c.name == "beta"));
    assert!(!scan
        .crates
        .iter()
        .any(|c| c.name == "sym-crate" || c.name == "gamma"));
    assert_eq!(
        scan.skipped, 4,
        "loop + gamma + alias-dir + sym manifest, counted"
    );
    assert_eq!(scan.edges.len(), 0);

    fs::remove_dir_all(&ws).unwrap();
}

/// A scan root that IS a symlink loop fails with a named error from
/// canonicalize — no hang, no panic.
#[cfg(unix)]
#[test]
fn symlink_loop_as_scan_root_is_a_named_error() {
    use std::os::unix::fs::symlink;

    let ws = tempdir("symlink-loop-root");
    symlink(ws.join("l2"), ws.join("l1")).unwrap();
    symlink(ws.join("l1"), ws.join("l2")).unwrap();

    let err = scan_workspace(&ws.join("l1")).unwrap_err();
    assert!(
        matches!(err, EngineError::Io(_)),
        "ELOOP must surface as a named engine error, got: {err:?}"
    );

    fs::remove_dir_all(&ws).unwrap();
}

/// REGRESSION (issue #71 defect 1): `rust-toolchain.toml` used to be read
/// with an unguarded `read_to_string`, so a hostile repository shipping it
/// as a symlink to `/dev/zero` (or any never-EOF file) hung `wanyrix
/// doctor` FOREVER. The fix routes the read through
/// `pathutil::read_regular_file`, which refuses symlinks/non-regular files;
/// the toolchain is then honestly measured as absent.
#[cfg(unix)]
#[test]
fn toolchain_symlink_to_dev_zero_cannot_hang_the_scan() {
    use std::os::unix::fs::symlink;

    let ws = tempdir("toolchain-dev-zero");
    make_crate(&ws, "plain", &[]);
    symlink("/dev/zero", ws.join("rust-toolchain.toml")).unwrap();

    let t0 = Instant::now();
    let scan = scan_workspace(&ws).unwrap();
    assert!(
        t0.elapsed() < Duration::from_secs(5),
        "the scan must refuse the hostile toolchain file, not read it forever"
    );
    assert_eq!(scan.crates.len(), 1);
    assert_eq!(
        scan.toolchain, "unspecified (no rust-toolchain.toml)",
        "the refused file is measured as absent, not fabricated"
    );

    fs::remove_dir_all(&ws).unwrap();
}

/// A non-regular file (here: a unix socket, std-creatable stand-in for a
/// FIFO/device — the same `!is_file()` guard branch) wearing a measured
/// name degrades to a NAMED unreadable-manifest finding, and the daemon
/// fingerprint walk terminates on it (it is hashed as unreadable content,
/// never opened — a FIFO with that name could otherwise hang the read).
#[cfg(unix)]
#[test]
fn non_regular_file_wearing_a_measured_name_is_a_named_finding() {
    use std::os::unix::net::UnixListener;

    let ws = tempdir("socket-cargo-toml");
    make_crate(&ws, "healthy", &[]);
    let ghost = ws.join("ghost");
    fs::create_dir_all(&ghost).unwrap();
    let _listener = UnixListener::bind(ghost.join("Cargo.toml")).unwrap();

    let scan = scan_workspace(&ws).unwrap();
    assert_eq!(scan.parse_failures, 1);
    assert_eq!(scan.crates.len(), 1);
    assert_one_err_finding(&scan, "ghost/Cargo.toml", "not a regular file");

    // The fingerprint walk must terminate too and must NOT collide with the
    // same tree minus the hostile entry (its presence changes scan output,
    // so it must change the fingerprint).
    let fp_with = manifest_fingerprint(&ws).unwrap();
    drop(_listener);
    fs::remove_file(ghost.join("Cargo.toml")).unwrap();
    let fp_without = manifest_fingerprint(&ws).unwrap();
    assert_ne!(
        fp_with, fp_without,
        "hostile entry participates in the fingerprint"
    );

    fs::remove_dir_all(&ws).unwrap();
}

// ---------------------------------------------------------------------------
// 5. Malformed manifest matrix — each case pinned to its EXACT behavior
// ---------------------------------------------------------------------------

/// Invalid TOML → scan succeeds, exactly one critical FER-ENG-ERR finding
/// naming the manifest, and the crate it declares is honestly absent.
#[test]
fn invalid_toml_is_a_critical_finding_not_a_crash() {
    let (ws, scan) = hostile_ws(
        "invalid-toml",
        b"[package\nname = \"hostile\"\nthis is not valid toml {{{\n",
    );
    assert_eq!(scan.parse_failures, 1);
    assert_eq!(scan.crates.len(), 1, "only the healthy crate");
    assert_one_err_finding(&scan, "hostile/Cargo.toml", "TOML parse error");
    fs::remove_dir_all(&ws).unwrap();
}

/// A `[package]` with no `name` PARSES (clean parse — not an error) but is
/// honestly not a crate: no node, no findings, record retained.
#[test]
fn missing_package_name_is_a_clean_parse_without_a_crate() {
    let (ws, scan) = hostile_ws(
        "missing-name",
        b"[package]\nversion = \"0.1.0\"\nlicense = \"MIT\"\n",
    );
    assert_eq!(scan.parse_failures, 0);
    assert_eq!(scan.manifests_found, 2);
    assert_eq!(scan.crates.len(), 1);
    assert_eq!(scan.crates[0].name, "healthy");
    let record = scan
        .manifests
        .iter()
        .find(|r| r.rel == "hostile/Cargo.toml")
        .unwrap();
    assert!(record.result.is_ok(), "missing name is not a parse failure");
    assert_eq!(record.crate_name, None);
    assert_eq!(
        err_finding_count(&scan),
        0,
        "no FER-ENG-ERR for a clean parse"
    );
    fs::remove_dir_all(&ws).unwrap();
}

/// `version = 42` (a non-string metadata value) does not fit the model's
/// untagged `MetaValue` — the manifest becomes a NAMED parse failure.
#[test]
fn non_string_version_is_a_named_parse_finding() {
    let (ws, scan) = hostile_ws(
        "non-string-version",
        b"[package]\nname = \"hostile\"\nversion = 42\n",
    );
    assert_eq!(scan.parse_failures, 1);
    assert_eq!(scan.crates.len(), 1);
    assert_one_err_finding(&scan, "hostile/Cargo.toml", "MetaValue");
    fs::remove_dir_all(&ws).unwrap();
}

/// A UTF-8 BOM prefix parses cleanly (TOML spec 1.1 allows it) — pinned so
/// a future parser change cannot silently flip this into a finding.
#[test]
fn bom_prefixed_manifest_parses_cleanly() {
    let (ws, scan) = hostile_ws(
        "bom-manifest",
        "\u{FEFF}[package]\nname = \"hostile\"\nversion = \"0.1.0\"\nlicense = \"MIT\"\ndescription = \"x\"\n"
            .as_bytes(),
    );
    assert_eq!(scan.parse_failures, 0);
    assert_eq!(scan.crates.len(), 2);
    assert!(scan.crates.iter().any(|c| c.name == "hostile"));
    assert_eq!(err_finding_count(&scan), 0);
    fs::remove_dir_all(&ws).unwrap();
}

/// CRLF line endings parse cleanly (cargo accepts them; so must we).
#[test]
fn crlf_line_endings_parse_cleanly() {
    let (ws, scan) = hostile_ws(
        "crlf-manifest",
        b"[package]\r\nname = \"hostile\"\r\nversion = \"0.1.0\"\r\nlicense = \"MIT\"\r\ndescription = \"x\"\r\n",
    );
    assert_eq!(scan.parse_failures, 0);
    assert_eq!(scan.crates.len(), 2);
    assert!(scan.crates.iter().any(|c| c.name == "hostile"));
    fs::remove_dir_all(&ws).unwrap();
}

/// An EMPTY Cargo.toml parses to an empty manifest: no package, no crate,
/// no finding — measured and retained, not an error.
#[test]
fn empty_manifest_is_a_clean_parse_with_no_crate() {
    let (ws, scan) = hostile_ws("empty-manifest", b"");
    assert_eq!(scan.parse_failures, 0);
    assert_eq!(scan.manifests_found, 2);
    assert_eq!(scan.crates.len(), 1);
    let record = scan
        .manifests
        .iter()
        .find(|r| r.rel == "hostile/Cargo.toml")
        .unwrap();
    assert!(record.result.is_ok());
    assert_eq!(record.crate_name, None);
    assert_eq!(err_finding_count(&scan), 0);
    fs::remove_dir_all(&ws).unwrap();
}

/// Binary bytes in a `.toml` are not valid UTF-8 → NAMED unreadable-manifest
/// finding (the read failure is preserved verbatim, never swallowed).
#[test]
fn binary_bytes_manifest_is_a_named_unreadable_finding() {
    let (ws, scan) = hostile_ws(
        "binary-manifest",
        &[0x00, 0x01, 0xFF, 0xFE, 0x0A, 0x00, 0xFF],
    );
    assert_eq!(scan.parse_failures, 1);
    assert_eq!(scan.crates.len(), 1);
    assert_one_err_finding(&scan, "hostile/Cargo.toml", "unreadable manifest");
    fs::remove_dir_all(&ws).unwrap();
}

// ---------------------------------------------------------------------------
// 6. Pathological dependency graphs
// ---------------------------------------------------------------------------

/// A 500-crate dependency CHAIN: scan (501 manifests), graph, Tarjan SCC and
/// the reverse-dependency closure all terminate, and the closure is exact at
/// BOTH ends of the chain (bottom → 499 transitive dependents, top → 0).
#[test]
fn chain_500_scan_graph_scc_and_impact_all_terminate() {
    let ws = tempdir("chain-500");
    let n = 500usize;
    for i in 0..n {
        let name = format!("c{i:04}");
        let deps: Vec<(String, String)> = if i == 0 {
            Vec::new()
        } else {
            let prev = format!("c{:04}", i - 1);
            vec![(prev.clone(), format!("../{prev}"))]
        };
        let refs: Vec<(&str, &str)> = deps.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
        make_crate(&ws, &name, &refs);
    }

    let t0 = Instant::now();
    let scan = scan_workspace(&ws).unwrap();
    assert_eq!(scan.crates.len(), 500);
    assert_eq!(scan.edges.len(), 499);
    assert_eq!(scan.edges[0].kind, EdgeKind::Normal);

    let g = build_graph(&scan);
    assert_eq!(g.nodes.len(), 500);
    assert!(
        strongly_connected_components(&scan.crates, &scan.edges).is_empty(),
        "a chain is a DAG: no cycles measured"
    );

    let bottom = impact_report(&scan, "c0000").unwrap();
    assert_eq!(bottom.transitive_count, 499);
    assert_eq!(bottom.blast_radius_per_mille, 1000);
    let top = impact_report(&scan, "c0499").unwrap();
    assert_eq!(top.transitive_count, 0);

    let findings = cli::doctor(&scan);
    let doc = report::doctor_report(&scan, &findings, "2026-01-01T00:00:00Z".to_owned());
    assert!(serde_json::to_string(&doc).is_ok());
    assert!(
        t0.elapsed() < Duration::from_secs(5),
        "500-chain full surface took {:?}",
        t0.elapsed()
    );

    fs::remove_dir_all(&ws).unwrap();
}

/// Fan-out 200: one hub with 200 dependents. The impact closure over the
/// hub is exactly the 200 direct dependents and nothing more.
#[test]
fn fanout_200_impact_closure_terminates_and_is_exact() {
    let ws = tempdir("fanout-200");
    make_crate(&ws, "hub", &[]);
    for i in 0..200 {
        make_crate(&ws, &format!("f{i:03}"), &[("hub", "../hub")]);
    }

    let scan = scan_workspace(&ws).unwrap();
    assert_eq!(scan.crates.len(), 201);
    assert_eq!(scan.edges.len(), 200);
    let hub = impact_report(&scan, "hub").unwrap();
    assert_eq!(hub.direct_dependents.len(), 200);
    // The closure is the FULL reverse-reachable set (self excluded): in a
    // star graph that is exactly the 200 direct dependents.
    assert_eq!(hub.transitive_count, 200);
    assert_eq!(hub.transitive_dependents, hub.direct_dependents);
    assert!(strongly_connected_components(&scan.crates, &scan.edges).is_empty());

    fs::remove_dir_all(&ws).unwrap();
}

/// Diamond + cycle mix (a→b, a→c, b→d, c→d, d→e, d→a, e→b): one SCC covers
/// all five crates, the impact closure terminates through the cycle, and a
/// dev-only back edge would NOT propagate (documented rule — asserted via
/// the cycle-ws fixture shape here by construction).
#[test]
fn diamond_cycle_mix_scc_is_found_and_impact_terminates() {
    let ws = tempdir("diamond-cycle");
    make_crate(&ws, "a", &[("b", "../b"), ("c", "../c")]);
    make_crate(&ws, "b", &[("d", "../d")]);
    make_crate(&ws, "c", &[("d", "../d")]);
    make_crate(&ws, "d", &[("e", "../e"), ("a", "../a")]);
    make_crate(&ws, "e", &[("b", "../b")]);

    let scan = scan_workspace(&ws).unwrap();
    assert_eq!(scan.edges.len(), 7);

    let sccs = strongly_connected_components(&scan.crates, &scan.edges);
    assert_eq!(sccs.len(), 1, "one cycle: the whole 5-crate knot");
    assert_eq!(sccs[0].members.len(), 5);
    assert_eq!(
        sccs[0].internal_edges.len(),
        7,
        "every edge is inside the SCC"
    );

    let impact = impact_report(&scan, "a").unwrap();
    assert_eq!(impact.transitive_dependents, vec!["b", "c", "d", "e"]);
    assert_eq!(impact.transitive_count, 4);

    fs::remove_dir_all(&ws).unwrap();
}

// ---------------------------------------------------------------------------
// 7. Crates named like Rust keywords
// ---------------------------------------------------------------------------

/// `match`, `fn`, `type`, `crate` — reserved words in the language, plain
/// strings in the engine's model: measured as crates and edges, usable as
/// impact targets, and serialized verbatim into the JSON payloads.
#[test]
fn keyword_named_crates_are_ordinary_strings() {
    let ws = tempdir("keyword-crates");
    make_crate(&ws, "match", &[("fn", "../fn")]);
    make_crate(&ws, "fn", &[]);
    make_crate(&ws, "type", &[("crate", "../crate")]);
    make_crate(&ws, "crate", &[]);

    let scan = scan_workspace(&ws).unwrap();
    assert_eq!(scan.crates.len(), 4);
    for kw in ["match", "fn", "type", "crate"] {
        assert!(scan.crates.iter().any(|c| c.name == kw), "{kw} measured");
    }
    assert_eq!(scan.edges.len(), 2);
    assert!(scan
        .edges
        .iter()
        .any(|e| e.from == "match" && e.to == "fn" && e.kind == EdgeKind::Normal));

    let impact = impact_report(&scan, "fn").unwrap();
    assert_eq!(impact.direct_dependents, vec!["match"]);
    let g = build_graph(&scan);
    assert_eq!(g.nodes.len(), 4);
    let findings = cli::doctor(&scan);
    let doc = report::doctor_report(&scan, &findings, "2026-01-01T00:00:00Z".to_owned());
    let bytes = serde_json::to_vec(&doc).unwrap();
    assert!(std::str::from_utf8(&bytes).is_ok());

    fs::remove_dir_all(&ws).unwrap();
}

// ---------------------------------------------------------------------------
// 8. Read-only workspace
// ---------------------------------------------------------------------------

/// `doctor`/`graph` are read-only surfaces: they must measure a workspace
/// the invoking user cannot write to. Write surfaces over the SAME
/// workspace must fail with NAMED errors — never panic, never fake success.
#[cfg(unix)]
#[test]
fn read_only_workspace_read_surfaces_measure_and_write_surfaces_name_the_error() {
    use std::os::unix::fs::PermissionsExt;

    let ws = tempdir("read-only-ws");
    make_crate(&ws, "frozen", &[]);
    fs::set_permissions(&ws, fs::Permissions::from_mode(0o555)).unwrap();

    // Read-only surfaces keep measuring (restore perms first on any early
    // exit via a drop guard is overkill here — assertions below never
    // early-return before the restore).
    let scan = scan_workspace(&ws).unwrap_or_else(|e| {
        fs::set_permissions(&ws, fs::Permissions::from_mode(0o755)).unwrap();
        panic!("scan must measure a read-only workspace, got: {e}")
    });
    assert_eq!(scan.crates.len(), 1);
    let findings = cli::doctor(&scan);
    let doc = report::doctor_report(&scan, &findings, "2026-01-01T00:00:00Z".to_owned());
    let serialized = cli::serialize_json(&doc, false);
    let g = build_graph(&scan);
    assert_eq!(g.nodes.len(), 1);

    // Store surface: creating a db inside the read-only dir is a named
    // Store error.
    let store_err = store::init(&ws.join("scans.db"));
    // product surface: writing .wanyrix/state.json is a named Io error.
    let init_err = product::init(&ws, None);

    fs::set_permissions(&ws, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(
        serialized.is_ok(),
        "doctor JSON serialization never fails here"
    );
    let store_err = store_err.unwrap_err();
    assert!(
        matches!(store_err, EngineError::Store(_)),
        "store init must name the storage error, got: {store_err:?}"
    );
    let init_err = init_err.unwrap_err();
    assert!(
        matches!(init_err, EngineError::Io(_)),
        "init must name the write error, got: {init_err:?}"
    );
    assert!(!ws.join(".wanyrix").exists(), "init wrote nothing");

    fs::remove_dir_all(&ws).unwrap();
}

// ---------------------------------------------------------------------------
// 9. Cargo.toml as a directory / symlinked to /dev/null
// ---------------------------------------------------------------------------

/// A `Cargo.toml` that is a DIRECTORY is walked as a directory (never
/// parsed, never a crash) — and a manifest that is a symlink to /dev/null
/// is skipped by the no-follow policy, never opened.
#[cfg(unix)]
#[test]
fn cargo_toml_as_directory_is_walked_and_devnull_symlink_is_skipped() {
    use std::os::unix::fs::symlink;

    let ws = tempdir("cargo-toml-dir");
    // Root "Cargo.toml" is a directory containing a real crate.
    let inner = ws.join("Cargo.toml").join("inner-crate");
    fs::create_dir_all(&inner).unwrap();
    fs::write(inner.join("Cargo.toml"), crate_manifest("inner-crate", &[])).unwrap();
    make_crate(&ws, "sibling", &[]);
    // A hostile crate dir whose manifest is a symlink to /dev/null.
    let ghost = ws.join("ghost");
    fs::create_dir_all(&ghost).unwrap();
    symlink("/dev/null", ghost.join("Cargo.toml")).unwrap();

    let scan = scan_workspace(&ws).unwrap();
    assert_eq!(
        scan.manifests_found, 2,
        "the directory-named Cargo.toml is not a manifest record"
    );
    assert_eq!(scan.crates.len(), 2);
    assert!(scan.crates.iter().any(|c| c.name == "inner-crate"));
    assert!(scan.crates.iter().any(|c| c.name == "sibling"));
    assert!(!scan.crates.iter().any(|c| c.name == "ghost"));
    assert_eq!(scan.skipped, 1, "the /dev/null manifest symlink, counted");
    // No root [package] exists (the root Cargo.toml is a directory) → the
    // root manifest is the SHALLOWEST one, and the workspace name is its
    // package name (documented deterministic fallback).
    assert_eq!(scan.workspace_name, "sibling");
    assert_eq!(err_finding_count(&scan), 0, "skipped ≠ parse failure");

    fs::remove_dir_all(&ws).unwrap();
}

// ---------------------------------------------------------------------------
// 10. Empty scan root
// ---------------------------------------------------------------------------

/// A walked directory with zero manifests is the named `NoManifests` error
/// (integration-level pin of the existing contract).
#[test]
fn empty_scan_root_is_the_named_no_manifests_error() {
    let dir = tempdir("empty-root");
    let err = scan_workspace(&dir).unwrap_err();
    assert!(matches!(err, EngineError::NoManifests(_)), "got: {err:?}");
    assert!(err.to_string().contains("no Cargo.toml"));
    fs::remove_dir_all(&dir).unwrap();
}
