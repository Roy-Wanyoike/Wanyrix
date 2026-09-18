# engine/BENCHMARKS.md — measured performance evidence (issue #58, phase-2 slice)

> **Honesty note — read before quoting any number here.**
> Measured on a **sandbox runner, specs unknown — timings are relative
> evidence, not absolute claims**. Every figure below is a wall-clock
> measurement taken with `std::time::Instant` (in-process harness) or
> `time.perf_counter` (subprocess harness) during the Task 7-a round on
> the engine v0.2.0 phase-2 working tree. Nothing here is projected,
> estimated, or benchmark-verified — no `verified` label may be derived
> from this file (Gate 21). Single-machine, single-run-day numbers:
> growth curves and variance across machines are explicitly NOT
> characterized yet.

## What was measured

- **Fixture**: `wanyrix synth --crates 500 --seed 42` — 500 crates in
  `c0000..c0499`, 1,013 backward-only path-dependency edges (DAG), 301
  crates with license+description / 199 intentionally incomplete, 1,001
  files. Generated into a scratch dir (`target/tmp` / `/tmp`), never
  committed; the committed mid-scale fixture is `tests/fixtures/synth-50`
  (50 crates, 97 edges, seed 7).
- **In-process harness**: `tests/perf_probe.rs` (a `#[ignore]`d test — a
  measuring instrument, not a gate; it asserts correctness of what it
  measures, never a timing threshold):

  ```sh
  cargo test --release --test perf_probe -- --ignored --nocapture
  ```

- **Subprocess corroboration**: the release binary (`target/release/wanyrix`)
  invoked end-to-end (process spawn + full run) 3× per command,
  median reported.
- **Runs**: 3 per configuration, **median** reported (all samples shown
  for the in-process harness — no sample was discarded or cherry-picked).

## Results — daemon incremental analysis + memory budget (issue #58 tranche 2, engine v0.3.0)

Measured on the same sandbox runner under the same honesty note as above
(relative evidence only; the STRUCTURAL guarantee — zero manifests parsed,
zero findings recomputed on a cache hit — is pinned by unit tests in
`src/daemon.rs`, which is the part that cannot drift with machine speed).

- **Fixture**: `wanyrix synth --crates 500 --seed 42` (501 manifests + 500
  source stubs), analyzed via the in-process harness
  `tests/perf_probe.rs::measure_daemon_incremental_on_synth500`
  (`cargo test --release --test perf_probe -- --ignored --nocapture`).
- **Warm hit definition**: a `doctor` request answered from the daemon's
  cache after a content-fingerprint match over all 501 measured files —
  the fingerprint READS + HASHES every measured file (parallel), and
  reuses the serialized report VALUES; it never re-parses, re-analyzes or
  re-serializes the payload from scratch.

| Configuration | Samples (ms) | **Median (ms)** |
| --- | --- | --- |
| `doctor` COLD — fresh daemon state, full measured scan (run A) | [64, 67, 78] | **67** |
| `doctor` WARM — fingerprint cache hit, 0 manifests parsed (run A) | [15, 16, 17] | **16** |
| `doctor` COLD (run B, quieter box) | [38, 42, 50] | **42** |
| `doctor` WARM (run B) | [14, 14, 15] | **14** |

- Measured wall-clock reduction: **66.7%–76.1%** across the two runs
  (~3–4× faster warm). The dominant remaining warm cost is the fingerprint
  pass reading 501 files — deliberate: it is what makes a stale hit
  IMPOSSIBLE. On machines with faster page caches the warm path shrinks
  further; no threshold is asserted anywhere.

**Memory (measured via `/proc/<pid>/status` on the release binary, and
enforced by `tests/daemon_ipc.rs` on Linux with a hard 100 MB gate):**

| Daemon state | VmRSS |
| --- | --- |
| Idle (listening, nothing scanned) | **1,848 kB** |
| After one cold doctor scan of the 500-crate workspace | **17,608 kB** |

Issue-#58 budget: idle < 100 MB — met with ~54× headroom.

## Results — synthetic 500-crate workspace (seed 42, release profile)

| Operation (release) | Samples (ms) | **Median (ms)** |
| --- | --- | --- |
| `synth` generation, 500 crates / 1,001 files (in-process) | 141 (single run) | **141** |
| `doctor` on synth-500 — full scan + findings + JSON serialize | [23, 24, 30] | **24** |
| `graph` on synth-500 | [26, 27, 28] | **27** |
| `health` on synth-500 (doctor + graph + KPIs) | [27, 29, 30] | **29** |
| `store init` (schema + WAL) | 1 (single run) | **1** |
| `store save` — full 500-crate doctor payload (897 findings, 2 transactions) | [9, 9, 9] | **9** |
| `store list` — full table scan of stored scans | [0, 0, 0] | **0** |

The doctor pass measured **897 findings** on synth-500 (FER-ENG-001/002 on
the ~199 incomplete crates + FER-ENG-003 on the version-less path deps) —
the fixture is doing its job: doctor has real things to find at scale.

### CLI subprocess corroboration (release binary, includes process spawn)

| Command (median of 3) | Median (ms) |
| --- | --- |
| `wanyrix synth --crates 500 --out <dir> --seed 42` (2nd+ runs, warm dir) | 27.4 |
| `wanyrix doctor --path <synth-500> --json` | 25.6 |
| `wanyrix graph --path <synth-500> --json` | 23.9 |
| `wanyrix health --path <synth-500> --json` | 26.4 |

In-process vs subprocess agree within a few milliseconds — the CLI layer
(parsing, printing, process start) is not the bottleneck; the measured
work is the analysis itself.

### Binary size (MEASURED, `ls -l`, this tree)

| Artifact | Bytes |
| --- | --- |
| `target/release/wanyrix` (with bundled SQLite) | 4,480,536 (~4.3 MiB) |
| `target/debug/wanyrix` | 36,470,736 (~34.8 MiB) |

## Reference point — tiny fixtures

For calibration: the committed `tiny-ws` fixture (3 crates, 4 findings)
runs doctor end-to-end via the CLI in single-digit milliseconds on the
same runner; the pinned 50-crate fixture (`synth-50`) completes all three
flavors in low tens of milliseconds. Both are covered by the normal test
suite; they are context, not the headline measurement.

## What this evidence supports (and what it does not)

- **Supports**: the #58 claim that the engine comfortably handles a
  500-crate workspace — all three JSON flavors and a full store round-trip
  complete in tens of milliseconds on this runner; fixture generation is
  sub-second. 500 crates is well inside comfortable range.
- **Does NOT support**: any extrapolation ("so 5,000 crates would take
  ~250 ms") — growth rate was not measured. Any claim about CI-time
  impact on real workspaces. Any comparison against other tools. Any
  `verified` status — verification requires the (not-built) experiment
  runner with before/after re-measurement.

## Reproduction

```sh
cd engine
cargo test --release --test perf_probe -- --ignored --nocapture   # in-process MEASURED numbers
cargo run --release -- synth --crates 500 --out /tmp/synth500     # regenerate the fixture
cargo run --release -- doctor --path /tmp/synth500 --json         # eyeball the payload
```

The fixture is deterministic (`--seed 42` ⇒ byte-identical tree), so the
input side of these measurements is reproducible; the timing side is not
(different machine = different numbers — that is what the honesty note at
the top is for).
