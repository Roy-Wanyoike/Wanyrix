//! wanyrix-engine — the Rust engineering-intelligence engine for Wanyrix.
//!
//! Engine v1 scope (AUDIT-I8): filesystem manifest analysis. It walks a Rust
//! workspace, parses every `Cargo.toml`, derives ONE edge list of
//! intra-workspace path dependencies, and serves three versioned JSON
//! flavors — `wanyrix.doctor/v1`, `wanyrix.graph/v1`, `wanyrix.health/v1` —
//! all computed from that single measured source.
//!
//! Phase-2 slice (GitHub issue #58): [`store`] persists exactly what
//! `doctor --json` measured into a WAL-backed SQLite database (two-phase
//! commit + `fsck` for crash detection), [`synth`] generates
//! deterministic synthetic workspaces so scale claims can be measured, not
//! asserted, [`daemon`] serves cached measured scans over a local Unix
//! socket (manifest-fingerprint invalidation — the incremental-analysis
//! surface), and [`telemetry`] ingests rustc JSON diagnostics with
//! default-on source/secret redaction.
//!
//! Phase-3 slice (engine v0.4.0): [`build`] instruments a REAL
//! `cargo build --message-format=json` and measures it — wall clock, the
//! fresh/cache-hit rate read from the stream's artifact flags, and counted
//! diagnostics with the same redaction guarantees — emitting
//! `wanyrix.build/v1`. The engine now MEASURES build telemetry instead of
//! labeling it not-measured (the envelope stays honest about what a
//! parallel build can and cannot attribute).
//!
//! # Honesty contract (the product's core identity — Gate 21 / Gate 7)
//!
//! 1. Everything emitted is MEASURED from the real filesystem. Nothing is
//!    simulated, no defaults are invented, no network is contacted (the
//!    [`daemon`] speaks only over a local Unix socket; [`telemetry`] reads
//!    local rustc/cargo JSON streams and redacts them before emission).
//!    Sole deliberate exception (v0.7.0): [`ai`] sends ONE loopback HTTP
//!    request to the LOCAL model server the user pointed it at — the payload
//!    is the evidence digest only, never source code.
//! 2. Findings are `measurementStatus: "measured"`,
//!    `confidenceClass: "deterministic"`. The engine never emits
//!    `verified` (nothing here was benchmark-verified) and never claims a
//!    timing (`impactSeconds` stays unset).
//! 3. Fields the web contract requires but the engine cannot measure (build
//!    times, cache hit rates, change frequency) are emitted as 0 with an
//!    explicit `not-measured` status — a visible zero plus a status, never
//!    an estimate in disguise. EXCEPTION (v0.4.0): `wanyrix build` MEASURES
//!    the wall clock and cache-hit rate of a real cargo build it executed —
//!    those fields carry a `measured` status and real numbers instead.
//! 4. Deterministic output: identical input ⇒ identical JSON except
//!    `generatedAt`, which is declared LAST in every envelope.
//!
//! # Layout
//!
//! - [`ai`] — local-model explanation surface over a user-invoked LOCAL
//!   model server (`wanyrix.ai/v1`; digest-only transmission, Ollama-class
//!   HTTP client hand-rolled on `TcpStream`)
//! - [`scan`] — directory walk + manifest parsing (measured inputs) + the
//!   manifest fingerprint used for incremental re-analysis
//! - [`analysis`] — doctor rules (`FER-ENG-*` finding registry)
//! - [`graph`] — graph aggregates + Tarjan SCC (single edge source)
//! - [`health`] — KPI summary derived from doctor + graph
//! - [`report`] — the three versioned JSON envelopes
//! - [`store`] — SQLite persistence for doctor scans (WAL, crash-tested)
//! - [`daemon`] — local Unix-socket server serving cached measured scans
//!   (`wanyrix.daemon/v1`; fingerprint invalidation, mode-0600 socket)
//! - [`telemetry`] — rustc JSON diagnostics ingest with default-on
//!   source/secret redaction (`wanyrix.telemetry/v1`)
//! - [`build`] — instrumented cargo-build runner measuring wall clock, the
//!   fresh/cache-hit rate and redacted diagnostics (`wanyrix.build/v1`)
//! - [`synth`] — deterministic synthetic workspace generator (fixtures)
//! - [`export`] — artifacts-as-code export (issue #91): one measured pass
//!   written as clock-free, path-relative JSON artifacts + a sha256-bound
//!   manifest (`wanyrix.export/v1`) so teams can diff evidence in PRs
//! - [`sync`] — serverless team sync (issue #92): a git REGISTRY BRANCH is
//!   the shared store; push commits the export bundle as exactly one
//!   deterministic commit (byte-identical re-pushes are no-ops), pull
//!   merges by (workspace id, finding id) + content hash with conflicts as
//!   named findings and evidence tiers that never upgrade
//!   (`wanyrix.sync/v1`)
//! - [`cli`] — clap definition + human formatting (`main.rs` is a wrapper)

pub mod ai;
pub mod analysis;
pub mod build;
pub mod change;
pub mod cli;
pub mod daemon;
pub mod events;
pub mod export;
pub mod git;
pub mod graph;
pub mod health;
pub mod manifest;
pub mod model;
pub mod pathutil;
pub mod product;
pub mod report;
pub mod scan;
pub mod store;
pub mod sync;
pub mod synth;
pub mod telemetry;
pub mod timestamp;

pub use analysis::{Evidence, Finding};
pub use build::{ArtifactRow, BuildOptions, BuildReport, BUILD_PROFILE, BUILD_SCHEMA};
pub use export::{sha256_hex, ExportArtifact, ExportBundle, ExportManifest, EXPORT_SCHEMA};
pub use graph::{Graph, GraphEdge, GraphNode};
pub use model::{
    Band, CrateInfo, Edge, EdgeKind, EngineError, NodeKind, PathDepRecord, WorkspaceScan,
};
pub use report::{DoctorReport, GraphReport, HealthReport};
pub use scan::{scan_workspace, scan_workspace_excluding};
pub use store::{SaveOutcome, ScanRow, STORE_SCHEMA_VERSION};
pub use sync::{workspace_id, SyncPullReport, SyncPushReport, SYNC_SCHEMA};
pub use synth::{SynthOutcome, SynthPlan, DEFAULT_SEED, MAX_CRATES};
pub use telemetry::{TelemetryReport, TELEMETRY_SCHEMA};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

    fn doctor_json(ws: &str) -> serde_json::Value {
        let scan = scan_workspace(&fixture(ws)).unwrap();
        let findings = cli::doctor(&scan);
        let report = report::doctor_report(&scan, &findings, cli::now_iso8601());
        serde_json::to_value(&report).unwrap()
    }

    /// End-to-end honesty gate: every finding in every flavor of every
    /// fixture is measured + deterministic, never verified, never timed.
    #[test]
    fn honesty_gate_no_verified_no_estimated_no_timings() {
        for ws in ["tiny-ws", "cycle-ws"] {
            let scan = scan_workspace(&fixture(ws)).unwrap();
            let findings = cli::doctor(&scan);
            assert!(!findings.is_empty(), "{ws} should surface findings");
            for f in findings.iter() {
                assert_eq!(f.measurement_status, "measured");
                assert_eq!(f.confidence_class, "deterministic");
                assert!(f.impact_seconds.is_none());
            }
            let doc = report::doctor_report(&scan, &findings, cli::now_iso8601());
            let text = serde_json::to_string(&doc).unwrap();
            // `verified` may only appear inside honesty PROSE, never as a
            // JSON value (which would be a quoted string).
            assert!(
                !text.contains("\"verified\""),
                "flavor must not claim verified status"
            );
        }
    }

    /// Determinism gate: two runs over the same input differ ONLY in
    /// generatedAt / meta.lastScan, and `generatedAt` is the LAST emitted
    /// key in the serialized envelope (checked on the string, since struct
    /// field order — not the JSON map — is the contract).
    #[test]
    fn deterministic_output_generated_at_last() {
        for ws in ["tiny-ws", "cycle-ws"] {
            let scan = scan_workspace(&fixture(ws)).unwrap();
            let findings = cli::doctor(&scan);
            let a = report::doctor_report(&scan, &findings, "1970-01-01T00:00:00Z".to_owned());
            let b = report::doctor_report(&scan, &findings, "2000-02-29T00:00:00Z".to_owned());
            let a_str = serde_json::to_string(&a).unwrap();
            let b_str = serde_json::to_string(&b).unwrap();
            let a_stripped = a_str.replace("1970-01-01T00:00:00Z", "T");
            let b_stripped = b_str.replace("2000-02-29T00:00:00Z", "T");
            assert_eq!(a_stripped, b_stripped, "{ws} output must be deterministic");
            // generatedAt is the LAST key of the envelope
            let tail = &a_str[a_str.len().saturating_sub(60)..];
            assert!(
                tail.contains("\"generatedAt\":\""),
                "generatedAt must trail the envelope, tail: {tail}"
            );
            assert!(a_str.ends_with('}'));
        }
    }

    /// The one measured input the fixtures cannot pin: schema strings.
    #[test]
    fn schema_strings_are_versioned() {
        let doc = doctor_json("tiny-ws");
        assert_eq!(doc["schema"], "wanyrix.doctor/v1");
        assert_eq!(doc["workspace"], "tiny-ws");
        assert_eq!(doc["profile"], "manifest-static-v1");
    }
}
