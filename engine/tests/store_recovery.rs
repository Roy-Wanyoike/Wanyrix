//! Crash-recovery acceptance tests for the SQLite scan store (issue #58,
//! acceptance items (a), (b), (c)).
//!
//! Simulation technique (per the issue's mandate): an abrupt kill is
//! simulated by DROPPING the connection — either with an uncommitted
//! transaction open (scenario (a): WAL must discard it and keep previously
//! committed data) or right after the first of the two save commits
//! (scenario (b): the orphan scan must be detectable by `store fsck` and
//! repairable). SQLite's WAL guarantees make the drop-connection
//! simulation equivalent to a process kill for anything AFTER the last
//! committed frame — and these tests pin exactly that behavior.
//!
//! Everything runs in a fresh tempdir; no fixture files are written to the
//! repo tree.

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use wanyrix_engine::cli;
use wanyrix_engine::report;
use wanyrix_engine::scan::scan_workspace;
use wanyrix_engine::store;

fn tempdir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("wanyrix-recovery-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// The exact JSON `wanyrix doctor --json` emits for the tiny-ws fixture,
/// with a pinned generatedAt so the stored epochs are assertable.
fn tiny_ws_payload(generated_at: &str) -> String {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/tiny-ws");
    let scan = scan_workspace(&root).unwrap();
    let findings = cli::doctor(&scan);
    let r = report::doctor_report(&scan, &findings, generated_at.to_owned());
    cli::serialize_json(&r, false).unwrap()
}

fn count_rows(db: &Path, sql: &str) -> i64 {
    let conn = Connection::open(db).unwrap();
    let n: i64 = conn.query_row(sql, [], |r| r.get(0)).unwrap();
    n
}

/// (a) A scan is fully committed. Then a second write is begun and the
/// connection is dropped WITHOUT committing (the kill). On reopen, WAL
/// recovery must have discarded the uncommitted frames while every
/// previously committed byte survives; the database passes
/// `PRAGMA integrity_check`.
#[test]
fn recovery_a_uncommitted_txn_is_lost_committed_data_survives() {
    let dir = tempdir("a-uncommitted-txn");
    let db = dir.join("scans.db");
    store::init(&db).unwrap();

    // Committed baseline: two complete scans.
    store::save(&db, &tiny_ws_payload("2026-09-18T13:28:56Z")).unwrap();
    store::save(&db, &tiny_ws_payload("2026-09-18T14:00:00Z")).unwrap();
    assert_eq!(count_rows(&db, "SELECT count(*) FROM scans"), 2);
    assert_eq!(count_rows(&db, "SELECT count(*) FROM findings"), 8);

    // The kill: open a connection, start a transaction, insert a scan row
    // (and a finding for it), then drop the connection with the
    // transaction still open — no commit, no rollback statement.
    {
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(
            "BEGIN IMMEDIATE;
             INSERT INTO scans (workspace, started_at, finished_at, finding_count, severity_critical, severity_warning, severity_info, schema_version)
             VALUES ('ghost-ws', 1, 1, 1, 0, 0, 1, 1);",
        )
        .unwrap();
        let ghost_id: i64 = conn
            .query_row("SELECT last_insert_rowid()", [], |r| r.get(0))
            .unwrap();
        conn.execute(
            "INSERT INTO findings (scan_id, finding_id, severity, title, evidence_json) VALUES (?1, 'FER-ENG-000-ghost', 'info', 'uncommitted', '[]')",
            rusqlite::params![ghost_id],
        )
        .unwrap();
        // simulate the abrupt kill — drop without commit
        drop(conn);
    }

    // Reopen: WAL recovery discards the uncommitted transaction.
    assert_eq!(
        count_rows(&db, "SELECT count(*) FROM scans"),
        2,
        "uncommitted scan row is gone"
    );
    assert_eq!(
        count_rows(&db, "SELECT count(*) FROM findings"),
        8,
        "uncommitted finding is gone"
    );
    assert!(
        count_rows(
            &db,
            "SELECT count(*) FROM scans WHERE workspace = 'ghost-ws'"
        ) == 0
    );

    // The committed data is intact AND the store reports it correctly.
    let rows = store::list(&db, None).unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].workspace, "tiny-ws");
    assert_eq!(rows[0].finding_count, 4);
    assert!(
        store::fsck(&db, false).unwrap().healthy(),
        "store is consistent after WAL recovery"
    );

    let conn = Connection::open(&db).unwrap();
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap();
    assert_eq!(integrity, "ok");
    drop(conn);
    std::fs::remove_dir_all(&dir).ok();
}

/// (b) The save commit order is: scans row FIRST, findings rows SECOND.
/// A kill between the two commits leaves a committed scan with NO findings
/// rows — the orphan state `wanyrix store fsck` exists to catch. This test
/// drives the public crash seam (`save_scan_row` without
/// `save_findings_rows`), reopens (the WAL replays the committed scan
/// row), verifies fsck detects + repairs the orphan, and verifies a
/// PARTIAL findings row set (killed mid-findings) is caught the same way.
#[test]
fn recovery_b_kill_between_commits_is_detectable_and_repairable() {
    let dir = tempdir("b-kill-between-commits");
    let db = dir.join("scans.db");
    store::init(&db).unwrap();

    // Commit the scans row, then "die" before committing findings.
    let scan = store::parse_payload(&tiny_ws_payload("2026-09-18T13:28:56Z")).unwrap();
    let scan_id = store::save_scan_row(&db, &scan).unwrap();

    // Reopen — the store MUST see the orphan (it was committed).
    assert_eq!(count_rows(&db, "SELECT count(*) FROM scans"), 1);
    assert_eq!(count_rows(&db, "SELECT count(*) FROM findings"), 0);
    let rows = store::list(&db, None).unwrap();
    assert_eq!(rows.len(), 1, "the orphan scan is committed and listed");
    assert_eq!(
        rows[0].finding_count, 4,
        "the orphan claims 4 findings it does not have"
    );

    // fsck (report-only) flags it as incomplete.
    let report = store::fsck(&db, false).unwrap();
    assert!(!report.healthy());
    assert_eq!(report.incomplete_scans, vec![(scan_id, 4, 0)]);
    assert!(report.count_mismatches.is_empty());
    assert!(report.orphan_findings.is_empty());
    assert!(report.summary().contains(
        "scan 1: committed without its full findings row set (finding_count=4, findings rows=0)"
    ));
    assert_eq!(report.removed_scans, 0, "report-only fsck deletes nothing");

    // Repair removes the orphan scan (0 findings rows existed).
    let repaired = store::fsck(&db, true).unwrap();
    assert_eq!(repaired.incomplete_scans, vec![(scan_id, 4, 0)]);
    assert_eq!(repaired.removed_scans, 1);
    assert_eq!(repaired.removed_findings, 0);
    assert_eq!(
        count_rows(&db, "SELECT count(*) FROM scans"),
        0,
        "orphan scan removed"
    );
    assert!(
        store::fsck(&db, false).unwrap().healthy(),
        "store consistent after repair"
    );

    // ---- Same story for a PARTIAL findings set (kill mid-findings): ----
    let scan = store::parse_payload(&tiny_ws_payload("2026-09-18T13:29:56Z")).unwrap();
    let scan_id = store::save_scan_row(&db, &scan).unwrap();
    // Commit only 2 of the 4 findings rows, then drop the connection
    // before the rest (the connection drop here IS the simulation; the 2
    // rows were already committed by save_findings_rows' transaction).
    let committed = store::save_findings_rows(&db, scan_id, &scan.findings[..2]).unwrap();
    assert_eq!(committed, 2);
    assert_eq!(count_rows(&db, "SELECT count(*) FROM findings"), 2);

    let report = store::fsck(&db, false).unwrap();
    assert!(!report.healthy());
    assert_eq!(report.incomplete_scans, vec![(scan_id, 4, 2)]);
    assert!(report
        .summary()
        .contains("finding_count=4, findings rows=2"));

    let repaired = store::fsck(&db, true).unwrap();
    assert_eq!(repaired.removed_scans, 1);
    assert_eq!(
        repaired.removed_findings, 2,
        "partial findings rows removed with their scan"
    );
    assert_eq!(count_rows(&db, "SELECT count(*) FROM findings"), 0);
    assert!(store::fsck(&db, false).unwrap().healthy());
    std::fs::remove_dir_all(&dir).ok();
}

/// (b2) The store enforces the findings→scan foreign key, so dangling
/// findings rows cannot be written through the store API; fsck's
/// orphan-findings check still removes rows injected by tools that did not
/// enforce the constraint (older writers, manual edits).
#[test]
fn recovery_b2_orphan_findings_rows_are_detected_and_removed() {
    let dir = tempdir("b2-orphan-findings");
    let db = dir.join("scans.db");
    store::init(&db).unwrap();

    // One healthy scan...
    store::save(&db, &tiny_ws_payload("2026-09-18T13:28:56Z")).unwrap();

    // The store's own connections REJECT dangling rows (FK enforced):
    {
        let conn = store::open_existing(&db).unwrap();
        let rejected = conn.execute(
            "INSERT INTO findings (scan_id, finding_id, severity, title, evidence_json) VALUES (999, 'FER-ENG-000-x', 'info', 'x', '[]')",
            [],
        );
        assert!(rejected.is_err(), "findings.scan_id FK must be enforced");
    }

    // ...a tool without FK enforcement (raw connection, pragmas off) can
    // still inject one — exactly the file state fsck must clean up.
    {
        let conn = Connection::open(&db).unwrap();
        conn.pragma_update(None, "foreign_keys", "OFF").unwrap();
        conn.execute(
            "INSERT INTO findings (scan_id, finding_id, severity, title, evidence_json) VALUES (999, 'FER-ENG-000-dangling', 'info', 'dangling', '[]')",
            [],
        )
        .unwrap();
    }

    let report = store::fsck(&db, false).unwrap();
    assert!(!report.healthy());
    assert!(report.incomplete_scans.is_empty(), "healthy scan untouched");
    assert_eq!(report.orphan_findings.len(), 1);

    let repaired = store::fsck(&db, true).unwrap();
    assert_eq!(repaired.removed_findings, 1);
    assert_eq!(repaired.removed_scans, 0);
    assert_eq!(
        count_rows(&db, "SELECT count(*) FROM findings"),
        4,
        "healthy scan's rows kept"
    );
    let rows = store::list(&db, None).unwrap();
    assert_eq!(rows.len(), 1, "healthy scan survived the repair");
    assert!(store::fsck(&db, false).unwrap().healthy());
    std::fs::remove_dir_all(&dir).ok();
}

/// (c) After an explicit WAL checkpoint (TRUNCATE), every connection is
/// closed, and the store is reopened, all committed data is still readable
/// and consistent — the WAL/checkpoint cycle never loses acknowledged
/// writes.
#[test]
fn recovery_c_reopen_and_read_after_wal_checkpoint() {
    let dir = tempdir("c-checkpoint");
    let db = dir.join("scans.db");
    let wal_path = dir.join("scans.db-wal");
    store::init(&db).unwrap();

    // Hold one connection open across the saves so the WAL file keeps its
    // frames. Measured SQLite subtlety (empirically verified while writing
    // this test): a connection that has never READ the database holds no
    // shared lock, so closing the writer still counts as "last connection
    // closes" and deletes the WAL. The read below therefore is not
    // decoration — it is what makes this connection hold the WAL open.
    let held = Connection::open(&db).unwrap();
    let _probe: i64 = held
        .query_row("SELECT count(*) FROM scans", [], |r| r.get(0))
        .unwrap();
    store::save(&db, &tiny_ws_payload("2026-09-18T13:28:56Z")).unwrap();
    store::save(&db, &tiny_ws_payload("2026-09-18T14:00:00Z")).unwrap();
    store::save(&db, &tiny_ws_payload("2026-09-18T15:30:00Z")).unwrap();
    assert_eq!(store::list(&db, None).unwrap().len(), 3);

    // Observable WAL behavior: after writes with a connection still open,
    // the -wal file exists and holds frames (WAL mode really is in use).
    let wal_len_before = std::fs::metadata(&wal_path).map(|m| m.len()).unwrap_or(0);
    assert!(
        wal_len_before > 0,
        "WAL file holds frames after writes (len={wal_len_before})"
    );

    // Checkpoint: flush the WAL into the main database and truncate it.
    // (The pragma's log/ckpt counters empirically report 0 for these tiny
    // transactions even when the truncate succeeds, so the acceptance
    // asserts on observable file state, not on the counters.)
    {
        let (busy, _log, _ckpt): (i64, i64, i64) = held
            .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!(busy, 0, "checkpoint must not be blocked");
        let wal_len = std::fs::metadata(&wal_path).map(|m| m.len()).unwrap_or(0);
        assert_eq!(wal_len, 0, "TRUNCATE checkpoint leaves a zero-length WAL");
    }
    drop(held);

    // Full close (the -wal file is removed by SQLite on last close) and a
    // completely fresh reopen — read everything back.
    let rows = store::list(&db, None).unwrap();
    assert_eq!(
        rows.len(),
        3,
        "all three scans readable after checkpoint + reopen"
    );
    for (i, r) in rows.iter().enumerate() {
        assert_eq!(r.finding_count, 4);
        assert_eq!(r.severity_warning, 4);
        assert_eq!(r.id, (i + 1) as i64);
    }
    let report = store::fsck(&db, false).unwrap();
    assert!(report.healthy());
    assert_eq!(report.scans_checked, 3);
    assert_eq!(report.findings_rows, 12);

    let conn = Connection::open(&db).unwrap();
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap();
    assert_eq!(integrity, "ok");
    drop(conn);
    std::fs::remove_dir_all(&dir).ok();
}

/// Full lifecycle through the same code path the CLI drives:
/// init → save (tiny-ws doctor payload) → list → fsck — the acceptance
/// round-trip on the smallest real fixture.
#[test]
fn full_lifecycle_round_trip_on_tiny_ws_scan() {
    let dir = tempdir("lifecycle");
    let db = dir.join("scans.db");
    let payload = tiny_ws_payload("2026-09-18T13:28:56Z");

    store::init(&db).unwrap();
    let outcome = store::save(&db, &payload).unwrap();
    assert_eq!(outcome.scan_id, 1);
    assert_eq!(outcome.findings, 4);
    assert_eq!(outcome.workspace, "tiny-ws");

    let rows = store::list(&db, Some("tiny-ws")).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].finished_at, 1_789_738_136);
    assert!(list_line_matches(&rows[0].line()));

    let report = store::fsck(&db, false).unwrap();
    assert!(report.healthy());
    assert_eq!(report.scans_checked, 1);
    assert_eq!(report.findings_rows, 4);
    std::fs::remove_dir_all(&dir).ok();
}

/// The list line is deterministic and carries id/workspace/date/counts.
fn list_line_matches(line: &str) -> bool {
    line.contains("1")
        && line.contains("tiny-ws")
        && line.contains("2026-09-18T13:28:56Z")
        && line.contains("v1")
}
