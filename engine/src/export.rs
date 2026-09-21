//! `wanyrix export` — artifacts-as-code for team collaboration (issue #91).
//!
//! One measured pass (the SAME pipeline `wanyrix analyze` runs: doctor →
//! graph → health through the shared report constructors — zero re-shaping
//! drift) is written VERBATIM as three deterministic JSON artifacts under
//! `<out>` (default `<path>/.wanyrix/exports`, the engine's own `.wanyrix`
//! state-dir convention), plus an `index.json` manifest binding every
//! artifact to its exact bytes with a sha256 digest.
//!
//! Team-diffability contract (the whole point of artifacts-as-code):
//! - NO wall-clock timestamps anywhere: the envelopes' `generatedAt` (and
//!   `meta.lastScan`, which mirrors it) carry the literal `not-measured`
//!   instead of a clock stamp — honestly labeled, never fabricated — so
//!   repeat exports of unchanged input are byte-identical across machines.
//!   The measured content (findings, graph, KPIs, statuses) is untouched:
//!   the envelopes' internal not-measured tiers are preserved exactly.
//! - RELATIVE paths only: `--path` and `--out` must be relative (named
//!   refusal otherwise), so no artifact can embed an absolute path.
//! - Named refusals: an `<out>` that exists as a FILE and an unwritable
//!   target are `EngineError::Export` errors with the transport detail
//!   verbatim — never a silent failure, never a partial export presented
//!   as success.
//!
//! The sha256 digest is hand-rolled (FIPS 180-4) per the engine's
//! dependency policy: the digest binds the manifest to artifact bytes, so
//! it lives in the auditable tree rather than in a new dependency.

use std::path::Path;

use serde::Serialize;

use crate::model::EngineError;

/// The manifest envelope schema (`index.json` + the `--json` payload).
pub const EXPORT_SCHEMA: &str = "wanyrix.export/v1";

/// The literal written into each artifact's `generatedAt` /
/// `meta.lastScan` — the honest "no clock here" label that keeps repeat
/// exports byte-identical (same tier vocabulary the engine already uses
/// for unmeasurable values).
pub const NOT_MEASURED_TIMESTAMP: &str = "not-measured";

/// Fixed artifact file names, in pipeline order (deterministic on purpose).
pub const DOCTOR_ARTIFACT: &str = "doctor.json";
pub const GRAPH_ARTIFACT: &str = "graph.json";
pub const HEALTH_ARTIFACT: &str = "health.json";
pub const MANIFEST_FILE: &str = "index.json";

/// The manifest's honesty note — carried in `index.json` itself so the
/// exported artifact set is self-describing (a teammate reading a PR diff
/// sees WHY there is no timestamp without opening the docs).
pub const EXPORT_MEASUREMENT: &str = "artifacts are the verbatim wanyrix.doctor/v1, wanyrix.graph/v1 and wanyrix.health/v1 envelopes of one measured scan (the same pipeline as wanyrix analyze); the envelopes' internal not-measured tiers are preserved, never fabricated; generatedAt (and meta.lastScan) inside each artifact carry the literal \"not-measured\" instead of a wall-clock stamp so repeat exports of unchanged input are byte-identical and team-diffable (issue #91)";

/// One exported artifact row in the manifest.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportArtifact {
    /// File name relative to the export directory (never a path).
    pub file: String,
    /// The envelope schema the file carries verbatim.
    pub schema: String,
    /// Exact byte length of the file as written.
    pub bytes: usize,
    /// sha256 hex digest of the exact file bytes (lowercase).
    pub sha256: String,
}

/// `wanyrix.export/v1` — the `index.json` manifest (and the `--json`
/// stdout payload). Keys are in constructor order (serde, same as every
/// other envelope); there is deliberately NO wall-clock timestamp field.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportManifest {
    pub schema: String,
    /// Engine version that measured + wrote the artifacts.
    pub engine: String,
    /// The measured workspace name (from the scan, never invented).
    pub workspace: String,
    /// Normalized operator exclusions (`--exclude`), echoed per the #76
    /// pattern; absent for a default export so the no-flag wire contract
    /// stays byte-identical.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub excludes: Vec<String>,
    /// The exported envelope artifacts, in pipeline order.
    pub artifacts: Vec<ExportArtifact>,
    /// Honesty note: what the artifacts are and why no timestamp exists.
    pub measurement: String,
}

/* ------------------------------------------------------------- sha256 ---- */

/// SHA-256 round constants (FIPS 180-4, §4.2.3).
const SHA256_K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/// SHA-256 (FIPS 180-4) over `data` — hand-rolled, no panics, no deps.
fn sha256(data: &[u8]) -> [u8; 32] {
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];

    // Padding: 0x80, zeros up to 56 mod 64, then the 64-bit big-endian bit length.
    let bit_len = (data.len() as u64).wrapping_mul(8);
    let mut msg = Vec::with_capacity(data.len() + 72);
    msg.extend_from_slice(data);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for block in msg.as_chunks::<64>().0 {
        let mut w = [0u32; 64];
        for (i, word) in block.as_chunks::<4>().0.iter().enumerate() {
            w[i] = u32::from_be_bytes(*word);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let (mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh) =
            (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]);
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let t1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(SHA256_K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut out = [0u8; 32];
    for (i, v) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&v.to_be_bytes());
    }
    out
}

/// Lowercase hex digest of the exact bytes.
fn sha256_hex(data: &[u8]) -> String {
    sha256(data).iter().map(|b| format!("{b:02x}")).collect()
}

/* ------------------------------------------------------------ pipeline ---- */

/// Resolve + validate the export target directory. The default is the
/// engine's own `.wanyrix` state-dir convention under the scan root
/// (`<path>/.wanyrix/exports`) so artifacts live WITH the workspace they
/// measured (artifacts-as-code: committable, diffable in PRs).
fn resolve_out_dir(
    scan_path: &Path,
    out: Option<&Path>,
) -> Result<std::path::PathBuf, EngineError> {
    let out_dir = match out {
        Some(o) => o.to_path_buf(),
        None => scan_path.join(".wanyrix").join("exports"),
    };
    if out_dir.is_absolute() {
        return Err(EngineError::Export(format!(
            "--out {} is absolute; export writes RELATIVE paths only (run from the workspace root and pass a relative --out) so no artifact can embed an absolute path",
            out_dir.display()
        )));
    }
    if out_dir.is_file() {
        return Err(EngineError::Export(format!(
            "export target {} exists as a FILE — pass --out <dir> (the artifacts need a directory)",
            out_dir.display()
        )));
    }
    Ok(out_dir)
}

/// Serialize one envelope to the exact artifact bytes: the same
/// `serialize_json` flavor the CLI prints (compact by default, `--pretty`
/// keeps every JSON byte-string here line-diffable) plus a trailing
/// newline (POSIX-friendly; the digest covers what is on disk).
fn artifact_bytes<T: serde::Serialize>(value: &T, pretty: bool) -> Result<Vec<u8>, EngineError> {
    let mut bytes = crate::cli::serialize_json(value, pretty)?.into_bytes();
    bytes.push(b'\n');
    Ok(bytes)
}

fn write_file(path: &Path, bytes: &[u8]) -> Result<(), EngineError> {
    std::fs::write(path, bytes).map_err(|e| {
        EngineError::Export(format!(
            "cannot write {}: {e} (unwritable target — named, never silent)",
            path.display()
        ))
    })
}

/// Serialize one envelope, write it as an artifact and record its digest
/// binding in the manifest. The SAME serde structs the CLI prints — zero
/// re-shaping drift between `doctor --json` and `export`.
fn push_artifact<T: serde::Serialize>(
    artifacts: &mut Vec<ExportArtifact>,
    out_dir: &Path,
    file: &str,
    schema: &str,
    value: &T,
    pretty: bool,
) -> Result<(), EngineError> {
    let bytes = artifact_bytes(value, pretty)?;
    write_file(&out_dir.join(file), &bytes)?;
    artifacts.push(ExportArtifact {
        file: file.to_owned(),
        schema: schema.to_owned(),
        bytes: bytes.len(),
        sha256: sha256_hex(&bytes),
    });
    Ok(())
}

/// Run the export pipeline and return the manifest. Every step is
/// measured or named — there is no partial success: either all three
/// envelope artifacts + the manifest are written, or an error is returned
/// and nothing pretends to have exported.
pub fn export_run(
    scan_path: &Path,
    out: Option<&Path>,
    excludes: &[String],
    pretty: bool,
) -> Result<(ExportManifest, std::path::PathBuf), EngineError> {
    // Relative-paths-only contract (checked BEFORE touching the disk —
    // an absolute --path would leak into every envelope's `root` field).
    if scan_path.is_absolute() {
        return Err(EngineError::Export(format!(
            "--path {} is absolute; export measures RELATIVE paths only (run from the workspace root and pass e.g. --path engine) so no artifact can embed an absolute path",
            scan_path.display()
        )));
    }
    let out_dir = resolve_out_dir(scan_path, out)?;

    // The measured input. A missing/unscannable workspace is a named
    // refusal (PathNotFound / NoManifests / InvalidExclude) — export never
    // fabricates an empty envelope for absent input.
    let mut scan = crate::cli::scan_excluding(scan_path, excludes)?;
    // Artifacts-as-code provenance: the envelopes echo the operator's
    // RELATIVE --path, not the machine-local canonical root the scan
    // canonicalized to internally. This is the relative-paths-only
    // contract (issue #91) — two machines exporting the same tree produce
    // identical `root` echoes, and no absolute path can leak into any
    // artifact. Measurement is unaffected: crate paths, edges and findings
    // were already resolved against the real tree and are relative strings.
    scan.root = scan_path.to_path_buf();

    // The analyze pipeline, call-for-call (zero re-shaping drift), with the
    // clock-free stamp in place of `iso8601_now()`.
    let findings = crate::cli::doctor(&scan);
    let g = crate::cli::graph(&scan);
    let (kpis, slowest, counts, insight) = crate::cli::health(&scan, &findings, &g);
    let stamp = NOT_MEASURED_TIMESTAMP.to_owned();
    let doctor = crate::report::doctor_report(&scan, &findings, stamp.clone());
    let graph = crate::report::graph_report(&scan, &g, stamp.clone());
    let health =
        crate::report::health_report(&scan, &findings, &g, kpis, slowest, counts, insight, stamp);

    // Write the artifacts (created last → create the dir first) and bind
    // each one to its exact bytes in the manifest.
    std::fs::create_dir_all(&out_dir).map_err(|e| {
        EngineError::Export(format!(
            "cannot create export directory {}: {e} (unwritable target — named, never silent)",
            out_dir.display()
        ))
    })?;

    let mut artifacts = Vec::with_capacity(3);
    push_artifact(
        &mut artifacts,
        &out_dir,
        DOCTOR_ARTIFACT,
        crate::report::DOCTOR_SCHEMA,
        &doctor,
        pretty,
    )?;
    push_artifact(
        &mut artifacts,
        &out_dir,
        GRAPH_ARTIFACT,
        crate::report::GRAPH_SCHEMA,
        &graph,
        pretty,
    )?;
    push_artifact(
        &mut artifacts,
        &out_dir,
        HEALTH_ARTIFACT,
        crate::report::HEALTH_SCHEMA,
        &health,
        pretty,
    )?;

    let manifest = ExportManifest {
        schema: EXPORT_SCHEMA.to_owned(),
        engine: env!("CARGO_PKG_VERSION").to_owned(),
        workspace: scan.workspace_name.clone(),
        excludes: scan.excludes.clone(),
        artifacts,
        measurement: EXPORT_MEASUREMENT.to_owned(),
    };

    // index.json — the same object the `--json` flavor prints (same flavor
    // flag, so a fixed command re-runs byte-identical; the manifest is
    // excluded from its own artifact list — nothing can self-digest).
    let manifest_bytes = artifact_bytes(&manifest, pretty)?;
    write_file(&out_dir.join(MANIFEST_FILE), &manifest_bytes)?;

    Ok((manifest, out_dir))
}

/// Human-readable summary (used when `--json` is absent). Deterministic;
/// the artifact line carries count + digests (12-hex short hashes).
pub fn export_human(manifest: &ExportManifest, out_dir: &Path) -> String {
    let total: usize = manifest.artifacts.iter().map(|a| a.bytes).sum();
    let list = manifest
        .artifacts
        .iter()
        .map(|a| format!("{} {}", a.file, &a.sha256[..12]))
        .collect::<Vec<_>>()
        .join(" · ");
    let mut out = String::new();
    out.push_str(&format!(
        "wanyrix export — {} (wanyrix.export/v1)\n",
        manifest.workspace
    ));
    out.push_str(&format!(
        "out: {} (relative to the launch directory; index.json binds every artifact to its exact bytes)\n",
        out_dir.display()
    ));
    out.push_str(&format!(
        "artifacts ({}): {list}\n",
        manifest.artifacts.len()
    ));
    out.push_str(&format!("total: {total} bytes\n"));
    if !manifest.excludes.is_empty() {
        out.push_str(&format!(
            "excluded: {} (counted in skipped entries)\n",
            manifest.excludes.join(", ")
        ));
    }
    out.push_str(&format!("measurement: {}\n", manifest.measurement));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// RELATIVE temp workspace (the export contract refuses absolute
    /// paths, so the fixtures must be relative to the test cwd — the
    /// engine crate dir; `target/` is gitignored and never scanned).
    fn rel_ws(tag: &str) -> PathBuf {
        let d = PathBuf::new().join(format!(
            "target/wanyrix-export-test-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn read_export(dir: &Path, file: &str) -> Vec<u8> {
        std::fs::read(dir.join(file)).unwrap()
    }

    /* ------------------------------------------------------- sha256 ---- */

    #[test]
    fn sha256_matches_the_nist_vectors() {
        // FIPS 180-4 / NIST CAVP known answers.
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            sha256_hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
        // Multi-block + length-carry boundary (1,000,000 × 'a').
        let million = vec![b'a'; 1_000_000];
        assert_eq!(
            sha256_hex(&million),
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
        );
    }

    #[test]
    fn sha256_is_length_sensitive() {
        assert_ne!(sha256_hex(b"wanyrix"), sha256_hex(b"wanyrix "));
    }

    /* ------------------------------------------------- export pipeline -- */

    #[test]
    fn fresh_export_writes_all_artifacts_and_a_binding_manifest() {
        let ws = rel_ws("fresh");
        crate::synth::synth(&ws, 2, 42).unwrap();
        let (manifest, out_dir) = export_run(&ws, None, &[], false).unwrap();

        assert_eq!(manifest.schema, EXPORT_SCHEMA);
        assert_eq!(manifest.engine, env!("CARGO_PKG_VERSION"));
        assert!(
            manifest.workspace.starts_with("wanyrix-export-test-fresh"),
            "workspace name is the measured root dir name: {}",
            manifest.workspace
        );
        assert_eq!(manifest.artifacts.len(), 3);
        let names: Vec<_> = manifest.artifacts.iter().map(|a| a.file.as_str()).collect();
        assert_eq!(
            names,
            vec![DOCTOR_ARTIFACT, GRAPH_ARTIFACT, HEALTH_ARTIFACT]
        );
        let schemas: Vec<_> = manifest
            .artifacts
            .iter()
            .map(|a| a.schema.as_str())
            .collect();
        assert_eq!(
            schemas,
            vec![
                crate::report::DOCTOR_SCHEMA,
                crate::report::GRAPH_SCHEMA,
                crate::report::HEALTH_SCHEMA
            ]
        );
        for a in &manifest.artifacts {
            assert_eq!(a.sha256.len(), 64, "hex digest");
            let on_disk = read_export(&out_dir, &a.file);
            assert_eq!(on_disk.len(), a.bytes, "{}: byte count", a.file);
            assert_eq!(
                sha256_hex(&on_disk),
                a.sha256,
                "{}: manifest digest must bind the exact file bytes",
                a.file
            );
        }
        assert!(out_dir.join(MANIFEST_FILE).exists(), "index.json written");
        assert!(manifest.excludes.is_empty());
        std::fs::remove_dir_all(&ws).ok();
    }

    #[test]
    fn re_export_is_idempotent_byte_identical_with_stable_digests() {
        let ws = rel_ws("idempotent");
        crate::synth::synth(&ws, 3, 7).unwrap();
        let (first, out_dir) = export_run(&ws, None, &[], false).unwrap();
        let first_files: Vec<(String, Vec<u8>)> = [
            DOCTOR_ARTIFACT,
            GRAPH_ARTIFACT,
            HEALTH_ARTIFACT,
            MANIFEST_FILE,
        ]
        .iter()
        .map(|f| (f.to_string(), read_export(&out_dir, f)))
        .collect();

        // Re-export over the same directory (overwrites, never appends).
        let (second, out_dir2) = export_run(&ws, None, &[], false).unwrap();
        assert_eq!(out_dir, out_dir2);
        for (file, before) in &first_files {
            assert_eq!(
                &read_export(&out_dir2, file),
                before,
                "{file}: repeat export must be byte-identical"
            );
        }
        // The manifest (including every digest) is identical too.
        assert_eq!(
            serde_json::to_string(&first).unwrap(),
            serde_json::to_string(&second).unwrap()
        );
        std::fs::remove_dir_all(&ws).ok();
    }

    #[test]
    fn artifacts_are_clock_free_and_shaped_like_their_envelopes() {
        let ws = rel_ws("clockfree");
        crate::synth::synth(&ws, 2, 42).unwrap();
        let (_, out_dir) = export_run(&ws, None, &[], false).unwrap();
        for file in [DOCTOR_ARTIFACT, GRAPH_ARTIFACT, HEALTH_ARTIFACT] {
            let value: serde_json::Value =
                serde_json::from_slice(&read_export(&out_dir, file)).unwrap();
            // The clock-free stamp is the ONLY non-deterministic key in a
            // fresh export — and it is honestly labeled, never a fake time.
            assert_eq!(value["generatedAt"], NOT_MEASURED_TIMESTAMP);
        }
        // The doctor artifact's findings keep their measured tier (zero
        // re-labeling): every finding inside stays `measured`/deterministic.
        let doctor: serde_json::Value =
            serde_json::from_slice(&read_export(&out_dir, DOCTOR_ARTIFACT)).unwrap();
        for f in doctor["findings"].as_array().unwrap() {
            assert_eq!(f["measurementStatus"], "measured");
        }
        std::fs::remove_dir_all(&ws).ok();
    }

    #[test]
    fn artifacts_never_embed_absolute_paths() {
        let ws = rel_ws("abspaths");
        crate::synth::synth(&ws, 2, 42).unwrap();
        let (_, out_dir) = export_run(&ws, None, &[], false).unwrap();
        let canonical = std::fs::canonicalize(&ws).unwrap();
        let canonical = canonical.display().to_string();
        for file in [
            DOCTOR_ARTIFACT,
            GRAPH_ARTIFACT,
            HEALTH_ARTIFACT,
            MANIFEST_FILE,
        ] {
            let text = String::from_utf8(read_export(&out_dir, file)).unwrap();
            assert!(
                !text.contains(&canonical),
                "{file} must not embed the absolute workspace path"
            );
            // The envelope `root` echoes the operator's RELATIVE input.
            if file != MANIFEST_FILE {
                let value: serde_json::Value = serde_json::from_str(&text).unwrap();
                assert_eq!(
                    value["root"].as_str().unwrap(),
                    ws.display().to_string(),
                    "{file}: root stays the relative scan path"
                );
                assert!(!value["root"].as_str().unwrap().starts_with('/'));
            }
        }
        std::fs::remove_dir_all(&ws).ok();
    }

    #[test]
    fn manifest_keys_are_in_constructor_order_and_schema_first() {
        let ws = rel_ws("keyorder");
        crate::synth::synth(&ws, 2, 42).unwrap();
        let (manifest, _) = export_run(&ws, None, &[], false).unwrap();
        let text = serde_json::to_string(&manifest).unwrap();
        assert!(text.starts_with("{\"schema\":\"wanyrix.export/v1\",\"engine\":"));
        // Excludes absent for a default export (byte-identical no-flag wire).
        assert!(!text.contains("\"excludes\""));
        std::fs::remove_dir_all(&ws).ok();
    }

    #[test]
    fn excludes_are_echoed_in_the_manifest_per_the_76_pattern() {
        let ws = rel_ws("excludes");
        crate::synth::synth(&ws, 2, 42).unwrap();
        let vendor = ws.join("vendor/junk");
        std::fs::create_dir_all(&vendor).unwrap();
        std::fs::write(vendor.join("Cargo.toml"), "not toml {{{").unwrap();

        let (manifest, _) = export_run(&ws, None, &["vendor".to_owned()], false).unwrap();
        assert_eq!(manifest.excludes, vec!["vendor".to_owned()]);

        let (_, out_dir) = export_run(&ws, None, &["vendor".to_owned()], false).unwrap();
        let text = String::from_utf8(read_export(&out_dir, MANIFEST_FILE)).unwrap();
        assert!(text.contains("\"excludes\":[\"vendor\"]"));
        // The doctor artifact echoes the same normalized list (zero drift).
        let doctor_text = String::from_utf8(read_export(&out_dir, DOCTOR_ARTIFACT)).unwrap();
        assert!(doctor_text.contains("\"excludes\":[\"vendor\"]"));
        std::fs::remove_dir_all(&ws).ok();
    }

    /* ---------------------------------------------------- refusals ----- */

    #[test]
    fn absolute_path_is_a_named_refusal() {
        let abs = std::env::temp_dir().join("wanyrix-export-abs-refusal");
        let err = export_run(&abs, None, &[], false).unwrap_err();
        match &err {
            EngineError::Export(msg) => {
                assert!(msg.contains("absolute"), "got: {msg}");
                assert!(msg.contains("RELATIVE"), "got: {msg}");
            }
            other => panic!("expected EngineError::Export, got {other:?}"),
        }
        // …and nothing was written.
        assert!(!abs.join(".wanyrix").exists());
    }

    #[test]
    fn absolute_out_is_a_named_refusal() {
        let ws = rel_ws("absout");
        crate::synth::synth(&ws, 2, 42).unwrap();
        let abs_out = std::env::temp_dir().join("wanyrix-export-abs-out-refusal");
        let err = export_run(&ws, Some(&abs_out), &[], false).unwrap_err();
        assert!(matches!(err, EngineError::Export(ref m) if m.contains("absolute")));
        std::fs::remove_dir_all(&ws).ok();
    }

    #[test]
    fn out_existing_as_a_file_is_a_named_refusal() {
        let ws = rel_ws("outfile");
        crate::synth::synth(&ws, 2, 42).unwrap();
        let out_file = ws.join("occupied");
        std::fs::write(&out_file, "not a directory").unwrap();
        let err = export_run(&ws, Some(&out_file), &[], false).unwrap_err();
        match &err {
            EngineError::Export(msg) => assert!(msg.contains("exists as a FILE"), "got: {msg}"),
            other => panic!("expected EngineError::Export, got {other:?}"),
        }
        std::fs::remove_dir_all(&ws).ok();
    }

    #[test]
    fn unwritable_target_is_a_named_refusal_not_a_panic() {
        let ws = rel_ws("unwritable");
        crate::synth::synth(&ws, 2, 42).unwrap();
        // A FILE where a parent DIRECTORY is required — create_dir_all
        // fails deterministically (ENOTDIR), independent of uid/root.
        let blocker = ws.join("blocker");
        std::fs::write(&blocker, "file").unwrap();
        let out = blocker.join("exports");
        let err = export_run(&ws, Some(&out), &[], false).unwrap_err();
        match &err {
            EngineError::Export(msg) => {
                assert!(msg.contains("cannot create export directory"), "got: {msg}");
            }
            other => panic!("expected EngineError::Export, got {other:?}"),
        }
        std::fs::remove_dir_all(&ws).ok();
    }

    #[test]
    fn missing_measured_input_is_a_named_refusal_never_a_fabricated_envelope() {
        // Empty directory: the scan measures nothing → NoManifests (the
        // canonical root is carried in the error; the variant is the contract).
        let ws = rel_ws("nomanifests");
        let err = export_run(&ws, None, &[], false).unwrap_err();
        assert!(matches!(err, EngineError::NoManifests(_)), "got: {err:?}");
        // Invalid operator exclusion keeps its own named variant (#76).
        let err = export_run(&ws, None, &["..".to_owned()], false).unwrap_err();
        assert!(
            matches!(err, EngineError::InvalidExclude(_)),
            "got: {err:?}"
        );
        std::fs::remove_dir_all(&ws).ok();
    }

    /* ---------------------------------------------------- human flavor -- */

    #[test]
    fn human_summary_carries_count_bytes_and_short_digests() {
        let ws = rel_ws("human");
        crate::synth::synth(&ws, 2, 42).unwrap();
        let (manifest, out_dir) = export_run(&ws, None, &[], false).unwrap();
        let text = export_human(&manifest, &out_dir);
        assert!(text.contains("wanyrix export — "), "{text}");
        assert!(text.contains("artifacts (3): "), "{text}");
        assert!(text.contains("total: "), "{text}");
        for a in &manifest.artifacts {
            assert!(
                text.contains(&format!("{} {}", a.file, &a.sha256[..12])),
                "short digest for {} missing: {text}",
                a.file
            );
        }
        std::fs::remove_dir_all(&ws).ok();
    }
}
