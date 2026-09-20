//! Chaos / failure-injection acceptance tests (issue #64, resilience program).
//!
//! Mandate: hostile or corrupted inputs must produce an HONEST error (exit 2
//! path, message preserved) and must never corrupt authoritative state or
//! panic. Every scenario writes only into a fresh tempdir.
//!
//! Covered failure classes:
//! 1. truncated / malformed doctor payloads into `store save`
//! 2. a garbage (non-SQLite) file substituted for the scan store
//! 3. a scan store db missing entirely (list / fsck / save)
//! 4. a malformed Cargo.toml workspace (parse failure is a FINDING, not a crash)
//! 5. daemon `call` against a dead socket path
//! 6. corrupted experiment ledger lines + corrupted init state.json
//! 7. store save with a valid payload into an unwritable directory (read-only)

use std::fs;
use std::path::PathBuf;

use wanyrix_engine::cli;
use wanyrix_engine::product;
use wanyrix_engine::scan::scan_workspace;
use wanyrix_engine::store;

fn tempdir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("wanyrix-chaos-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn valid_scan_json(root: &std::path::Path) -> String {
    let scan = scan_workspace(root).unwrap();
    let findings = cli::doctor(&scan);
    let report =
        wanyrix_engine::report::doctor_report(&scan, &findings, "2026-01-01T00:00:00Z".to_owned());
    serde_json::to_string(&report).unwrap()
}

// ---------------------------------------------------------------------------
// 1. truncated doctor payloads
// ---------------------------------------------------------------------------

#[test]
fn truncated_scan_payload_is_an_honest_error_and_persists_nothing() {
    let ws = tempdir("trunc-ws");
    let db = ws.join("scans.db");
    crate_synthetic(&ws, 2);

    store::init(&db).unwrap();
    let full = valid_scan_json(&ws);
    let truncated = &full[..full.len() / 2];

    let err = store::save(&db, truncated).unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("store") || msg.contains("payload") || msg.contains("json"),
        "error must name the storage/parse problem, got: {msg}"
    );

    // Authoritative state is untouched: zero rows, fsck clean (field-level,
    // not summary-text, assertions).
    assert_eq!(store::list(&db, None).unwrap().len(), 0);
    let report = store::fsck(&db, false).unwrap();
    assert!(
        report.incomplete_scans.is_empty(),
        "no kill-between-commits orphans"
    );
    assert!(report.count_mismatches.is_empty());
    assert!(report.orphan_findings.is_empty());
    fs::remove_dir_all(&ws).unwrap();
}

#[test]
fn empty_and_null_byte_payloads_are_rejected_not_swallowed() {
    let ws = tempdir("nullbyte-ws");
    let db = ws.join("scans.db");
    crate_synthetic(&ws, 1);
    store::init(&db).unwrap();

    assert!(
        store::save(&db, "").is_err(),
        "empty payload cannot be a scan"
    );
    assert!(
        store::save(&db, "\u{0}\u{0}\u{0}").is_err(),
        "binary garbage cannot be a scan"
    );
    assert_eq!(store::list(&db, None).unwrap().len(), 0);
    fs::remove_dir_all(&ws).unwrap();
}

// ---------------------------------------------------------------------------
// 2. garbage file substituted for the store db
// ---------------------------------------------------------------------------

#[test]
fn garbage_db_file_is_an_honest_error_never_a_panic() {
    let ws = tempdir("garbage-db");
    let db = ws.join("scans.db");
    crate_synthetic(&ws, 1);

    fs::write(&db, b"definitely not a sqlite database \x01\x02\x03").unwrap();
    assert!(
        store::list(&db, None).is_err(),
        "list on garbage db must error"
    );
    assert!(
        store::fsck(&db, false).is_err(),
        "fsck on garbage db must error"
    );
    assert!(
        store::init(&db).is_err(),
        "init over a non-SQLite file must refuse (never silently overwrite user data)"
    );
    fs::remove_dir_all(&ws).unwrap();
}

// ---------------------------------------------------------------------------
// 3. missing store db
// ---------------------------------------------------------------------------

#[test]
fn missing_store_db_is_a_named_error() {
    let ws = tempdir("missing-db");
    let db = ws.join("does-not-exist.db");
    crate_synthetic(&ws, 1);
    let err = store::list(&db, None).unwrap_err().to_string();
    assert!(
        err.contains("not found") || err.contains("store init"),
        "got: {err}"
    );
    // `save` validates the payload schema first, so probe the missing-db path
    // with a VALID payload (that ordering is itself the honest contract).
    let err2 = store::save(&db, &valid_scan_json(&ws))
        .unwrap_err()
        .to_string();
    assert!(err2.contains("not found"), "got: {err2}");
    fs::remove_dir_all(&ws).unwrap();
}

// ---------------------------------------------------------------------------
// 4. malformed Cargo.toml workspace — a FINDING, never a crash
// ---------------------------------------------------------------------------

#[test]
fn malformed_manifest_becomes_a_finding_not_a_panic() {
    let ws = tempdir("bad-manifest");
    let crate_dir = ws.join("broken-crate");
    fs::create_dir_all(&crate_dir).unwrap();
    fs::write(
        crate_dir.join("Cargo.toml"),
        "[package\nname = \"broken-crate\"\nversion = \"0.1.0\"\nthis is not valid toml {{{",
    )
    .unwrap();

    // The scan itself must succeed (it measures the tree) and the analyzer
    // must surface the parse failure as a finding.
    let scan = scan_workspace(&ws).expect("scan must not fail on a malformed manifest");
    assert_eq!(
        scan.parse_failures, 1,
        "the broken manifest is measured as a parse failure"
    );
    let findings = cli::doctor(&scan);
    assert!(
        findings.iter().any(|f| f.id.contains("ERR")
            || f.section.to_lowercase().contains("manifest")
            || f.title.to_lowercase().contains("parse")),
        "parse failure must surface as a finding, got: {:?}",
        findings.iter().map(|f| &f.id).collect::<Vec<_>>()
    );
    fs::remove_dir_all(&ws).unwrap();
}

// ---------------------------------------------------------------------------
// 5. daemon call against a dead socket
// ---------------------------------------------------------------------------

#[test]
fn daemon_call_to_missing_socket_is_an_honest_error() {
    let ws = tempdir("dead-socket");
    let sock = ws.join("no-daemon.sock");
    let err = cli::daemon_run(wanyrix_engine::cli::DaemonCmd::Call {
        socket: sock.clone(),
        method: "status".into(),
        path: ws.clone(),
        pretty: false,
    })
    .unwrap_err()
    .to_string();
    assert!(
        err.to_lowercase().contains("daemon")
            || err.to_lowercase().contains("socket")
            || err.to_lowercase().contains("connect"),
        "error must name the transport problem, got: {err}"
    );
    fs::remove_dir_all(&ws).unwrap();
}

// ---------------------------------------------------------------------------
// 6. corrupted local state files
// ---------------------------------------------------------------------------

#[test]
fn corrupted_experiment_ledger_names_the_offending_line() {
    let ws = tempdir("bad-ledger");
    crate_synthetic(&ws, 1);
    let dir = ws.join(".wanyrix");
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("experiments.jsonl"),
        concat!(
            "{\"schema\":\"wanyrix.experiment/v1\",\"name\":\"ok\",\"claim\":\"c\",\"status\":\"estimated\",\"createdAt\":\"2026-01-01T00:00:00Z\"}\n",
            "this line is not json at all\n",
        ),
    )
    .unwrap();

    let err = product::experiment_list(&ws).unwrap_err().to_string();
    assert!(
        err.contains("line 2"),
        "error must name the corrupt line, got: {err}"
    );
    fs::remove_dir_all(&ws).unwrap();
}

#[test]
fn corrupted_init_state_is_an_honest_error() {
    let ws = tempdir("bad-state");
    crate_synthetic(&ws, 1);
    let dir = ws.join(".wanyrix");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("state.json"), "{ not json").unwrap();

    let err = product::status(&ws, None, None).unwrap_err().to_string();
    assert!(
        err.contains("state"),
        "error must name the state file, got: {err}"
    );
    fs::remove_dir_all(&ws).unwrap();
}

// ---------------------------------------------------------------------------
// 7. unwritable store location
// ---------------------------------------------------------------------------

#[test]
fn read_only_store_directory_is_an_honest_error() {
    let ws = tempdir("ro-store");
    let db_dir = ws.join("ro");
    fs::create_dir_all(&db_dir).unwrap();

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&db_dir, fs::Permissions::from_mode(0o555)).unwrap();
        let db = db_dir.join("scans.db");
        let result = store::init(&db);
        // Restore before asserting so cleanup always succeeds.
        fs::set_permissions(&db_dir, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(
            result.is_err(),
            "init into a read-only dir must error honestly"
        );
    }
    fs::remove_dir_all(&ws).unwrap();
}

// ---------------------------------------------------------------------------

/// Minimal synthetic workspace (reuses the deterministic generator).
fn crate_synthetic(root: &std::path::Path, crates: usize) {
    wanyrix_engine::synth::synth(root, crates, 42).unwrap();
}
