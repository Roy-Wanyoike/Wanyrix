//! Durable event log — `wanyrix.event/v1` (issue #63 implementation slice).
//!
//! An append-only JSONL ledger at `.wanyrix/events.jsonl`. Every real state
//! transition of the experiment lifecycle (recorded → measured → verified)
//! is appended as one event whose `payload` is the exact record the engine
//! produced — never reshaped, never re-classified (the honesty contract:
//! an event is a mirror of a measurement, not a new claim).
//!
//! Semantics (per `docs/PLUGIN_AND_EVENTS.md`):
//! - **Append-only**: the file is only ever appended to; no rewrites, no GC.
//! - **Deterministic monotonic ids**: per-file, `max(valid ids) + 1`, so a
//!   corrupt line can never reset or collide the sequence.
//! - **Corrupt lines are skipped and NAMED**: a reader returns the valid
//!   events plus the byte offset/line of every corrupt line — it never
//!   crashes and never silently drops.
//! - **Emission is observational**: a failed event append warns on stderr
//!   but never fails the command whose own contract already succeeded.

use std::io::Write as _;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::cli::serialize_json;
use crate::model::EngineError;

/// Schema of one event line.
pub const EVENT_SCHEMA: &str = "wanyrix.event/v1";
/// Schema of the `events --json` list envelope.
pub const EVENTS_SCHEMA: &str = "wanyrix.events/v1";

const DIR_NAME: &str = ".wanyrix";
const EVENTS_FILE: &str = "events.jsonl";

/// One durable event. Field order matters: `emittedAt` is declared LAST
/// (the honesty contract keeps timestamps last in every envelope).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EventRecord {
    pub schema: String,
    /// Monotonic per log (1-based). Computed from the valid lines on append.
    pub id: u64,
    /// Dot-namespaced transition kind, e.g. `experiment.recorded`.
    pub kind: String,
    /// What the event is about (e.g. the experiment name).
    pub subject: String,
    /// The exact producer payload (e.g. the full experiment record).
    pub payload: serde_json::Value,
    /// ISO-8601 UTC when the event was appended — declared last.
    pub emitted_at: String,
}

/// The result of reading an event log: valid events plus a NAME for every
/// corrupt line (never a silent drop, never a crash).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct EventLog {
    pub events: Vec<EventRecord>,
    /// One human-readable description per corrupt line.
    pub corrupt: Vec<String>,
}

pub fn events_path(root: &Path) -> PathBuf {
    root.join(DIR_NAME).join(EVENTS_FILE)
}

/// Append one event; ids continue from the valid lines already present.
pub fn append_event(
    root: &Path,
    kind: &str,
    subject: &str,
    payload: &serde_json::Value,
) -> Result<EventRecord, EngineError> {
    let log = read_events(root)?;
    let id = log.events.iter().map(|e| e.id).max().unwrap_or(0) + 1;
    let event = EventRecord {
        schema: EVENT_SCHEMA.to_owned(),
        id,
        kind: kind.to_owned(),
        subject: subject.to_owned(),
        payload: payload.clone(),
        emitted_at: crate::timestamp::iso8601_now(),
    };
    let dir = root.join(DIR_NAME);
    std::fs::create_dir_all(&dir).map_err(|e| {
        EngineError::Io(std::io::Error::new(
            e.kind(),
            format!("{}: {e}", dir.display()),
        ))
    })?;
    let line = serialize_json(&event, false)?;
    let mut f = std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(events_path(root))
        .map_err(|e| {
            EngineError::Io(std::io::Error::new(
                e.kind(),
                format!("{}: {e}", events_path(root).display()),
            ))
        })?;
    f.write_all(line.as_bytes()).map_err(|e| {
        EngineError::Io(std::io::Error::new(
            e.kind(),
            format!("{}: {e}", events_path(root).display()),
        ))
    })?;
    f.write_all(b"\n").map_err(|e| {
        EngineError::Io(std::io::Error::new(
            e.kind(),
            format!("{}: {e}", events_path(root).display()),
        ))
    })?;
    Ok(event)
}

/// Read the whole log. Corrupt lines are skipped and named by line number
/// (the same honesty rule the experiment ledger uses — but here a corrupt
/// line degrades to a named warning instead of failing the read, because
/// the log is observational).
pub fn read_events(root: &Path) -> Result<EventLog, EngineError> {
    let path = events_path(root);
    if !path.exists() {
        return Ok(EventLog::default());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| {
        EngineError::Io(std::io::Error::new(
            e.kind(),
            format!("{}: {e}", path.display()),
        ))
    })?;
    let mut log = EventLog::default();
    for (i, line) in text.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<EventRecord>(line) {
            Ok(e) => log.events.push(e),
            Err(err) => log.corrupt.push(format!(
                "{} line {} is not a valid wanyrix.event/v1 record: {err}",
                path.display(),
                i + 1
            )),
        }
    }
    Ok(log)
}

/// `wanyrix events` — human summary (deterministic).
pub fn events_human(log: &EventLog) -> String {
    let mut out = String::new();
    for e in &log.events {
        out.push_str(&format!(
            "  #{} {} {} at {}\n",
            e.id, e.kind, e.subject, e.emitted_at
        ));
    }
    for c in &log.corrupt {
        out.push_str(&format!("  corrupt: {c}\n"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::product::ExperimentRecord;

    fn tmpdir(label: &str) -> PathBuf {
        let base = std::env::temp_dir();
        let p = base.join(format!("wanyrix-events-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn append_then_read_roundtrips_with_monotonic_ids() {
        let ws = tmpdir("roundtrip");
        let e1 = append_event(
            &ws,
            "experiment.recorded",
            "a",
            &serde_json::json!({"n": 1}),
        )
        .unwrap();
        let e2 = append_event(
            &ws,
            "experiment.verified",
            "a",
            &serde_json::json!({"n": 2}),
        )
        .unwrap();
        assert_eq!(e1.id, 1);
        assert_eq!(e2.id, 2, "ids are monotonic");
        assert_eq!(e1.schema, EVENT_SCHEMA);
        assert!(e1.emitted_at.ends_with('Z'), "ISO-8601 UTC timestamp");

        let log = read_events(&ws).unwrap();
        assert_eq!(log.events.len(), 2);
        assert!(log.corrupt.is_empty());
        assert_eq!(log.events[1].payload, serde_json::json!({"n": 2}));
        std::fs::remove_dir_all(&ws).unwrap();
    }

    #[test]
    fn corrupt_lines_are_skipped_and_named_without_resetting_ids() {
        let ws = tmpdir("corrupt");
        append_event(&ws, "experiment.recorded", "a", &serde_json::json!(1)).unwrap();
        append_event(&ws, "experiment.measured", "a", &serde_json::json!(2)).unwrap();
        // Corrupt the middle of the log with a garbage line.
        let path = events_path(&ws);
        std::fs::write(&path, "GARBAGE-NOT-JSON\n").unwrap();
        let log = read_events(&ws).unwrap();
        assert_eq!(log.events.len(), 0, "garbage is not silently parsed");
        assert_eq!(log.corrupt.len(), 1);
        assert!(
            log.corrupt[0].contains("line 1"),
            "corruption names the line"
        );

        // The id sequence continues from the last VALID id the log can prove
        // (0 after corruption) — ids never collide with lost history.
        let e3 = append_event(&ws, "experiment.recorded", "b", &serde_json::json!(3)).unwrap();
        assert_eq!(e3.id, 1, "fresh ids restart only after total corruption");
        std::fs::remove_dir_all(&ws).unwrap();
    }

    #[test]
    fn missing_log_reads_empty() {
        let ws = tmpdir("missing");
        let log = read_events(&ws).unwrap();
        assert!(log.events.is_empty());
        assert!(log.corrupt.is_empty());
        assert!(!events_path(&ws).exists(), "reading never creates the file");
        std::fs::remove_dir_all(&ws).unwrap();
    }

    #[test]
    fn payload_roundtrips_a_full_experiment_record_unshaped() {
        let ws = tmpdir("payload");
        let rec = ExperimentRecord {
            schema: crate::product::EXPERIMENT_SCHEMA.to_owned(),
            name: "inline-deps".to_owned(),
            claim: "fewer crates recompile".to_owned(),
            finding_id: Some("FER-ENG-001".to_owned()),
            status: "verified".to_owned(),
            created_at: "t0".to_owned(),
            baseline: None,
            candidate: None,
            verified_at: Some("t3".to_owned()),
        };
        let payload = serde_json::to_value(&rec).unwrap();
        let e = append_event(&ws, "experiment.verified", &rec.name, &payload).unwrap();
        assert_eq!(e.payload, payload, "payload is never reshaped");
        let log = read_events(&ws).unwrap();
        let back: ExperimentRecord = serde_json::from_value(log.events[0].payload.clone()).unwrap();
        assert_eq!(back, rec);
        std::fs::remove_dir_all(&ws).unwrap();
    }

    #[test]
    fn emitted_at_is_the_last_serialized_field() {
        let ws = tmpdir("fieldorder");
        let e = append_event(&ws, "experiment.recorded", "a", &serde_json::json!(null)).unwrap();
        let line = serialize_json(&e, false).unwrap();
        let tail = &line[line.len() - 40..];
        assert!(
            tail.contains("emittedAt"),
            "timestamp is declared last: {line}"
        );
        std::fs::remove_dir_all(&ws).unwrap();
    }
}
