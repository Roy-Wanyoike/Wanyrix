//! Deterministic synthetic Rust-workspace generator (`wanyrix synth`).
//!
//! Produces an N-crate workspace used as a measured-scale fixture for
//! benchmarks and integration tests (GitHub issue #58, 500-crate slice).
//!
//! # Determinism contract
//!
//! The only randomness source is splitmix64 (Sebastiano Vigna) seeded from
//! `--seed` (default [`DEFAULT_SEED`]). Same `(seed, crate-count)` ⇒ a
//! byte-identical tree, every time, on every platform — pinned by tests
//! that generate twice and diff the trees. NO external `rand` dependency:
//! 10 lines of integer arithmetic are auditable in a way a dependency
//! chain is not.
//!
//! # Shape (fixed by issue #58)
//!
//! - Directories `c0000..c0N-1` under `--out`, each a crate with
//!   `Cargo.toml` (name = directory name, version 0.1.0) and `src/lib.rs`
//!   carrying a generated comment.
//! - Every crate after the first declares 1–3 `path` dependencies on
//!   STRICTLY EARLIER crates — the graph is a DAG by construction (an
//!   edge can only point backwards), which the tests assert over the
//!   generated manifests, not just over the in-memory plan.
//! - ~60% of crates get `license` + `description`; the rest intentionally
//!   omit them so `wanyrix doctor` has real findings to surface (plus
//!   FER-ENG-003: the path deps carry no `version` — exactly what the
//!   publish-readiness rule exists to flag).
//! - A root virtual `[workspace]` manifest lists all members, so the
//!   generated tree is a valid cargo workspace shape.
//!
//! # Honesty
//!
//! Synthetic fixtures are NOT measured data and never presented as such:
//! every emitted tree is labeled generated (root manifest header, every
//! lib.rs comment). The generator measures nothing about build behavior —
//! it only writes manifests. Regenerating into an existing directory
//! overwrites the files it owns and leaves unknown files untouched (it
//! writes; it does not clean).

use std::path::Path;

use crate::model::EngineError;

/// Default PRNG seed when `--seed` is omitted.
pub const DEFAULT_SEED: u64 = 42;

/// The generator refuses absurd sizes: 100k crates ≈ 300k files, far past
/// any benchmark this tool claims to characterize. Honest hard limit, not
/// a silent cliff.
pub const MAX_CRATES: usize = 100_000;

/// License+description coverage target (~60% get them, rest incomplete).
const COMPLETE_PCT: u64 = 60;

/// splitmix64 — the exact algorithm from Vigna's paper (public domain).
/// Full-period, single u64 of state, trivially deterministic.
pub struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    pub fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform-ish value in `[0, n)`. (`%` modulo bias is negligible for
    /// fixture shaping and documented rather than hidden.)
    pub fn below(&mut self, n: u64) -> u64 {
        self.next_u64() % n.max(1)
    }
}

/// Directory (and package) name for crate index `i`, zero-padded to a
/// common width (≥ 4: `c0000..c0499` for the 500-crate fixture).
pub fn dir_name(i: usize, width: usize) -> String {
    format!("c{:0width$}", i, width = width)
}

/// Decimal digit count of `n` (0 → 1 digit).
fn digits(n: usize) -> usize {
    let mut n = n;
    let mut d = 1;
    while n >= 10 {
        n /= 10;
        d += 1;
    }
    d
}

/// One planned crate: deterministic output of [`plan`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedCrate {
    pub index: usize,
    pub name: String,
    /// Indices of earlier crates this one depends on (sorted).
    pub deps: Vec<usize>,
    /// true = carries license+description; false = intentionally incomplete.
    pub complete: bool,
}

/// The full deterministic plan for `n` crates.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SynthPlan {
    pub seed: u64,
    pub crates: Vec<PlannedCrate>,
}

impl SynthPlan {
    /// Zero-pad width shared by every generated directory name.
    pub fn width(&self) -> usize {
        digits(self.crates.len().saturating_sub(1)).max(4)
    }
}

/// Build the deterministic plan (no filesystem access — pure function of
/// `(n, seed)`, which is what makes the generator testable).
pub fn plan(n: usize, seed: u64) -> Result<SynthPlan, EngineError> {
    if n > MAX_CRATES {
        return Err(EngineError::Synth(format!(
            "--crates {n} exceeds the generator cap of {MAX_CRATES} (a fixture past this size would outlive the disk it was measured on)"
        )));
    }
    let mut rng = SplitMix64::new(seed);
    let mut crates = Vec::with_capacity(n);
    for i in 0..n {
        // 1–3 deps for every crate that HAS earlier crates to point at.
        let want = if i == 0 { 0 } else { 1 + rng.below(3) as usize };
        let want = want.min(i);
        let mut deps = Vec::with_capacity(want);
        while deps.len() < want {
            // strictly-earlier target ⇒ DAG by construction; the
            // retry loop only needs finitely many draws and terminates
            // deterministically for a fixed seed.
            let j = rng.below(i as u64) as usize;
            if !deps.contains(&j) {
                deps.push(j);
            }
        }
        deps.sort_unstable();
        let complete = rng.below(100) < COMPLETE_PCT;
        crates.push(PlannedCrate {
            index: i,
            name: String::new(), // filled below (needs the width)
            deps,
            complete,
        });
    }
    let width = digits(n.saturating_sub(1)).max(4);
    for c in crates.iter_mut() {
        c.name = dir_name(c.index, width);
    }
    Ok(SynthPlan { seed, crates })
}

/// What one `wanyrix synth` run wrote (all counts measured from the
/// filesystem work performed, not projected).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SynthOutcome {
    pub root: std::path::PathBuf,
    pub seed: u64,
    pub crates_written: usize,
    pub complete_crates: usize,
    pub dep_edges: usize,
    pub files_written: usize,
}

/// Generate the planned workspace into `out_dir`.
pub fn generate(out_dir: &Path, plan: &SynthPlan) -> Result<SynthOutcome, EngineError> {
    let width = plan.width();
    std::fs::create_dir_all(out_dir).map_err(|e| {
        EngineError::Synth(format!(
            "cannot create output dir {}: {e}",
            out_dir.display()
        ))
    })?;

    // Root virtual manifest: valid cargo workspace shape + honest label.
    let mut members = String::new();
    for c in &plan.crates {
        members.push_str(&format!("    \"{}\",\n", c.name));
    }
    let root_manifest = format!(
        "# Generated by `wanyrix synth --crates {} --seed {}` — a deterministic SYNTHETIC\n\
         # fixture (issue #58) for engine benchmarks and tests, not a real workspace.\n\
         [workspace]\n\
         resolver = \"2\"\n\
         members = [\n{}]\n",
        plan.crates.len(),
        plan.seed,
        members
    );
    std::fs::write(out_dir.join("Cargo.toml"), root_manifest)
        .map_err(|e| EngineError::Synth(format!("write root manifest: {e}")))?;
    let mut files = 1usize;

    for c in &plan.crates {
        let dir = out_dir.join(&c.name);
        std::fs::create_dir_all(dir.join("src"))
            .map_err(|e| EngineError::Synth(format!("create {}: {e}", dir.display())))?;

        let mut manifest = format!(
            "# Synthetic crate {} (index {} of {}, seed {}) — wanyrix synth fixture.\n\
             [package]\n\
             name = \"{}\"\n\
             version = \"0.1.0\"\n",
            c.name,
            c.index,
            plan.crates.len(),
            plan.seed,
            c.name
        );
        if c.complete {
            // ~60%: publishable metadata so doctor's baseline is mixed
            manifest.push_str("license = \"MIT OR Apache-2.0\"\n");
            manifest.push_str(&format!(
                "description = \"Synthetic dependency-DAG fixture crate {} (seed {})\"\n",
                c.name, plan.seed
            ));
        } else {
            // Intentionally incomplete: doctor must find FER-ENG-001/002.
            manifest.push_str(
                "# license and description intentionally omitted (doctor findings fixture)\n",
            );
        }
        if !c.deps.is_empty() {
            manifest.push_str("\n[dependencies]\n");
            for &d in &c.deps {
                let dep = dir_name(d, width);
                // Path deps carry no version — measured FER-ENG-003 food.
                manifest.push_str(&format!("{} = {{ path = \"../{}\" }}\n", dep, dep));
            }
        }
        std::fs::write(dir.join("Cargo.toml"), manifest)
            .map_err(|e| EngineError::Synth(format!("write {}: {e}", dir.display())))?;
        files += 1;

        let lib = format!(
            "//! Synthetic crate {} — generated by `wanyrix synth --crates {} --seed {}` (index {}).\n\
             //! Deterministic fixture for engine benchmarks/tests (issue #58); not real code.\n",
            c.name, plan.crates.len(), plan.seed, c.index
        );
        std::fs::write(dir.join("src").join("lib.rs"), lib)
            .map_err(|e| EngineError::Synth(format!("write {}/src/lib.rs: {e}", dir.display())))?;
        files += 1;
    }

    let dep_edges = plan.crates.iter().map(|c| c.deps.len()).sum();
    let complete_crates = plan.crates.iter().filter(|c| c.complete).count();
    Ok(SynthOutcome {
        root: out_dir.to_path_buf(),
        seed: plan.seed,
        crates_written: plan.crates.len(),
        complete_crates,
        dep_edges,
        files_written: files,
    })
}

/// `plan` + `generate` in one call (the CLI path).
pub fn synth(out_dir: &Path, n: usize, seed: u64) -> Result<SynthOutcome, EngineError> {
    let plan = plan(n, seed)?;
    generate(out_dir, &plan)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splitmix64_matches_reference_values() {
        // Reference sequence from Vigna's splitmix64 paper/test vectors
        // (seed 0): the generator is hand-auditable against the constants
        // above — a wrong constant changes this test, deterministically.
        let mut rng = SplitMix64::new(0);
        assert_eq!(rng.next_u64(), 0xE220_A839_7B1D_CDAF);
        assert_eq!(rng.next_u64(), 0x6E78_9E6A_A1B9_65F4);
        assert_eq!(rng.next_u64(), 0x06C4_5D18_8009_454F);
    }

    #[test]
    fn plan_is_a_pure_function_of_n_and_seed() {
        let a = plan(50, 7).unwrap();
        let b = plan(50, 7).unwrap();
        assert_eq!(a, b, "same (n, seed) ⇒ identical plan");
        let c = plan(50, 8).unwrap();
        assert_ne!(a, c, "different seed ⇒ different plan");
    }

    #[test]
    fn plan_dag_invariants_hold() {
        for n in [1usize, 2, 3, 10, 500] {
            let p = plan(n, DEFAULT_SEED).unwrap();
            assert_eq!(p.crates.len(), n);
            for c in &p.crates {
                assert!(c.deps.len() <= 3, "{}: at most 3 deps", c.index);
                if c.index > 0 {
                    assert!(!c.deps.is_empty(), "{}: has 1–3 deps", c.index);
                } else {
                    assert!(c.deps.is_empty(), "crate 0 has no earlier targets");
                }
                for d in &c.deps {
                    assert!(d < &c.index, "edge {}→{} points BACKWARD only", c.index, d);
                }
                let mut sorted = c.deps.clone();
                sorted.sort_unstable();
                sorted.dedup();
                assert_eq!(sorted, c.deps, "deps sorted + distinct");
            }
            // widths: every name has the same length and matches its index
            let width = p.width();
            for c in &p.crates {
                assert_eq!(c.name, dir_name(c.index, width));
                assert_eq!(c.name.len(), width + 1);
            }
        }
    }

    #[test]
    fn plan_license_split_is_near_60pct() {
        // "~60%" is a shape contract, not an exact ratio — assert the
        // deterministic split lands in a sane band for the pinned seed.
        for seed in [DEFAULT_SEED, 7, 123] {
            let p = plan(500, seed).unwrap();
            let complete = p.crates.iter().filter(|c| c.complete).count();
            let pct = complete as f64 / 500.0 * 100.0;
            assert!(
                (45.0..=75.0).contains(&pct),
                "seed {seed}: {pct}% complete crates"
            );
        }
    }

    #[test]
    fn over_cap_is_an_honest_error() {
        let err = plan(MAX_CRATES + 1, 0).unwrap_err();
        assert!(err.to_string().contains("exceeds the generator cap"));
    }

    #[test]
    fn generated_tree_is_byte_identical_for_same_seed() {
        let dir = std::env::temp_dir().join(format!("wanyrix-synth-det-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a");
        let b = dir.join("b");
        synth(&a, 12, 9).unwrap();
        synth(&b, 12, 9).unwrap();
        let listing = |root: &Path| -> Vec<(String, Vec<u8>)> {
            let mut out = Vec::new();
            walk(root, root, &mut out);
            out.sort();
            out
        };
        assert_eq!(listing(&a), listing(&b), "same seed ⇒ byte-identical trees");
        std::fs::remove_dir_all(&dir).ok();
    }

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
}
