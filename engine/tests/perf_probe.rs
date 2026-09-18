//! Performance measurement harness (issue #58, 500-crate evidence).
//!
//! NOT part of the normal test run — this is a measuring instrument, not a
//! gate. Run it with:
//!
//! ```sh
//! cargo test --release --test perf_probe -- --ignored --nocapture
//! ```
//!
//! Every number it prints is MEASURED with `std::time::Instant` on this
//! machine, at this moment, in the profile you invoked (`--release` is the
//! representative one). Timings are relative evidence for the #58 epic,
//! never absolute claims; engine/BENCHMARKS.md records a transcribed run
//! with the machine-context honesty note. The assertions inside pin
//! CORRECTNESS of what is being measured (crates found, rows written), not
//! speed — no timing threshold is asserted anywhere.

use std::path::PathBuf;
use std::time::Instant;

use wanyrix_engine::cli;
use wanyrix_engine::daemon::DaemonState;
use wanyrix_engine::graph::build_graph;
use wanyrix_engine::report;
use wanyrix_engine::scan::scan_workspace;
use wanyrix_engine::store;
use wanyrix_engine::synth;

const CRATES: usize = 500;
const SEED: u64 = synth::DEFAULT_SEED;
const RUNS: usize = 3;

fn median(samples: &mut [u128]) -> u128 {
    samples.sort_unstable();
    samples[samples.len() / 2]
}

#[test]
#[ignore = "measurement harness: cargo test --release --test perf_probe -- --ignored --nocapture"]
fn measure_engine_on_synth500() {
    // ---- fixture generation (target/tmp — never committed) ----
    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("perf-synth500-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    let t0 = Instant::now();
    let outcome = synth::synth(&dir, CRATES, SEED).unwrap();
    let synth_ms = t0.elapsed().as_millis();
    assert_eq!(outcome.crates_written, CRATES);

    // ---- doctor / graph / health: RUNS runs each, full CLI code path ----
    let mut doctor_samples = Vec::new();
    let mut graph_samples = Vec::new();
    let mut health_samples = Vec::new();
    let mut last_doctor_text = String::new();
    for _ in 0..RUNS {
        let t = Instant::now();
        let scan = scan_workspace(&dir).unwrap();
        let findings = cli::doctor(&scan);
        let doc = report::doctor_report(&scan, &findings, "2026-09-18T13:28:56Z".to_owned());
        let text = cli::serialize_json(&doc, false).unwrap();
        doctor_samples.push(t.elapsed().as_millis());
        assert_eq!(scan.crates.len(), CRATES);
        last_doctor_text = text;

        let t = Instant::now();
        let scan = scan_workspace(&dir).unwrap();
        let g = build_graph(&scan);
        let rep = report::graph_report(&scan, &g, "2026-09-18T13:28:56Z".to_owned());
        let text = cli::serialize_json(&rep, false).unwrap();
        graph_samples.push(t.elapsed().as_millis());
        assert_eq!(g.nodes.len(), CRATES);
        assert!(!text.is_empty());

        let t = Instant::now();
        let scan = scan_workspace(&dir).unwrap();
        let findings = cli::doctor(&scan);
        let g = build_graph(&scan);
        let (kpis, slowest, counts, insight) = cli::health(&scan, &findings, &g);
        let rep = report::health_report(&scan, &findings, &g, kpis, slowest, counts, insight, "2026-09-18T13:28:56Z".to_owned());
        let text = cli::serialize_json(&rep, false).unwrap();
        health_samples.push(t.elapsed().as_millis());
        assert!(!text.is_empty());
    }

    let doctor_findings = {
        let v: serde_json::Value = serde_json::from_str(&last_doctor_text).unwrap();
        v["summary"]["total"].as_u64().unwrap()
    };

    // ---- store: init + save + list on the 500-crate doctor payload ----
    let db = dir.join("bench-scans.db");
    let t = Instant::now();
    store::init(&db).unwrap();
    let init_ms = t.elapsed().as_millis();

    let mut save_samples = Vec::new();
    let mut list_samples = Vec::new();
    for i in 0..RUNS {
        // Same payload each run — save is measured per-call, and the list
        // assertion below uses the growing row count.
        let t = Instant::now();
        let outcome = store::save(&db, &last_doctor_text).unwrap();
        save_samples.push(t.elapsed().as_millis());
        assert_eq!(outcome.findings as u64, doctor_findings);
        assert!(outcome.scan_id >= 1);

        let t = Instant::now();
        let rows = store::list(&db, None).unwrap();
        list_samples.push(t.elapsed().as_millis());
        assert_eq!(rows.len(), i + 1);
    }

    let doctor_median = median(&mut doctor_samples);
    let graph_median = median(&mut graph_samples);
    let health_median = median(&mut health_samples);
    let save_median = median(&mut save_samples);
    let list_median = median(&mut list_samples);

    println!("\n===== MEASURED — wanyrix engine on synthetic {}-crate workspace (seed {}) =====", CRATES, SEED);
    println!("profile: {} (see command in this file's doc comment)", if cfg!(debug_assertions) { "debug" } else { "release" });
    println!("MEASURED synth generation ({} crates, {} files): {} ms", CRATES, outcome.files_written, synth_ms);
    println!("MEASURED doctor   x{}: {:?} ms → median {} ms ({} findings)", RUNS, doctor_samples, doctor_median, doctor_findings);
    println!("MEASURED graph    x{}: {:?} ms → median {} ms", RUNS, graph_samples, graph_median);
    println!("MEASURED health   x{}: {:?} ms → median {} ms", RUNS, health_samples, health_median);
    println!("MEASURED store init: {} ms", init_ms);
    println!("MEASURED store save x{} (full doctor payload, 2 commits): {:?} ms → median {} ms", RUNS, save_samples, save_median);
    println!("MEASURED store list x{}: {:?} ms → median {} ms", RUNS, list_samples, list_median);
    println!("timing note: wall-clock Instant deltas on the sandbox runner; relative evidence only — see engine/BENCHMARKS.md honesty note");

    std::fs::remove_dir_all(&dir).ok();
}

/// Incremental-analysis evidence (issue #58): the daemon serves a warm
/// doctor response from the manifest-fingerprint cache — the measured
/// inputs are re-HASHED (read), but never re-PARSED or re-ANALYZED. The
/// cold/warm delta below is wall-clock Instant evidence on this machine;
/// the STRUCTURAL guarantee (zero manifests parsed on a hit) is pinned by
/// unit tests, which is the part that cannot drift with machine speed.
#[test]
#[ignore = "measurement harness: cargo test --release --test perf_probe -- --ignored --nocapture"]
fn measure_daemon_incremental_on_synth500() {
    let dir = std::env::temp_dir().join(format!("wanyrix-perf-daemon-{}", std::process::id()));
    let outcome = synth::synth(&dir, CRATES, SEED).unwrap();
    assert_eq!(outcome.crates_written, CRATES);

    let request = format!(
        r#"{{"id":"perf","method":"doctor","params":{{"path":"{}"}}}}"#,
        dir.display()
    );
    let fixed_now = "2026-01-01T00:00:00Z";

    let mut cold_samples: Vec<u128> = Vec::new();
    let mut warm_samples: Vec<u128> = Vec::new();
    for _ in 0..RUNS {
        // Cold: fresh daemon state ⇒ fingerprint walk + full scan + analyze + serialize.
        let mut cold_state = DaemonState::new();
        let t = Instant::now();
        let cold_response = cold_state.handle_request(&request, fixed_now);
        cold_samples.push(t.elapsed().as_millis());
        // Warm: same state ⇒ fingerprint walk + cached scan + serialize.
        let t = Instant::now();
        let warm_response = cold_state.handle_request(&request, fixed_now);
        warm_samples.push(t.elapsed().as_millis());
        // Correctness of what is measured: warm must be a cache hit with a
        // payload identical to the cold one (same fixed `now` ⇒ identical
        // envelope; only the frame's `cached` flag may differ).
        assert!(cold_response.contains("\"cached\":false"));
        assert!(warm_response.contains("\"cached\":true"));
        let cold_v: serde_json::Value = serde_json::from_str(&cold_response).unwrap();
        let warm_v: serde_json::Value = serde_json::from_str(&warm_response).unwrap();
        assert_eq!(cold_v["data"], warm_v["data"], "cached payload is identical to the cold payload");
    }

    let cold_median = median(&mut cold_samples);
    let warm_median = median(&mut warm_samples);
    let reduction = 100.0 * (1.0 - warm_median as f64 / cold_median as f64);

    println!("\n===== MEASURED — daemon incremental analysis on synthetic {}-crate workspace (seed {}) =====", CRATES, SEED);
    println!("MEASURED doctor COLD (full measured scan) x{}: {:?} ms → median {} ms", RUNS, cold_samples, cold_median);
    println!("MEASURED doctor WARM (fingerprint cache hit, 0 manifests parsed) x{}: {:?} ms → median {} ms", RUNS, warm_samples, warm_median);
    println!("MEASURED wall-clock reduction: {:.1}% ({} ms → {} ms; structural guarantee: 0 manifests parsed on a hit — pinned by unit tests)", reduction, cold_median, warm_median);
    println!("timing note: relative evidence only; the fingerprint check reads every measured file (hash), skipping parse + analysis + graph + report assembly");

    std::fs::remove_dir_all(&dir).ok();
}
