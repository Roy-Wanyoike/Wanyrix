# wanyrix-engine

The Rust engineering-intelligence engine for [Wanyrix](../README.md) — an
evidence-first analysis tool for Rust workspaces. This is the crate behind
the web dashboard's honesty-first product identity (AUDIT-I8): every number
it reports is **measured**, and anything it cannot measure is labeled, never
simulated.

## Status — engine v0.5.0

**Built:** filesystem manifest analysis, local persistence, an incremental
analysis daemon, redacted rustc-telemetry ingestion, an INSTRUMENTED BUILD
runner (the engine now executes and measures a real `cargo build`), and a
synthetic fixture generator. The engine walks a Rust workspace, parses every
`Cargo.toml`, resolves intra-workspace path dependencies into ONE canonical
edge list, and serves versioned JSON flavors computed from measured inputs:

| Command | Flavor schema | Emits |
| --- | --- | --- |
| `wanyrix doctor --path <dir> [--json] [--pretty]` | `wanyrix.doctor/v1` | workspace name, crate list, `FER-ENG-*` findings, severity summary, scan provenance |
| `wanyrix graph --path <dir> [--json] [--pretty]` | `wanyrix.graph/v1` | nodes + edges, per-crate fanIn/fanOut, downstream/recompileImpact closure (derived from the served edges only — no ghost nodes) |
| `wanyrix health --path <dir> [--json] [--pretty]` | `wanyrix.health/v1` | KPI summary derived from doctor + graph results |
| `wanyrix build --path <dir> [--json] [--pretty]` | `wanyrix.build/v1` | MEASURED instrumented `cargo build`: wall clock, fresh/cache-hit rate, per-artifact stream activity, redacted diagnostics |
| `wanyrix store init/save/list/fsck --db <file>` | local SQLite (layout v1) | WAL-backed scan history; two-phase commit; crash-detecting `fsck` |
| `wanyrix daemon start/call` | `wanyrix.daemon/v1` | persistent in-process scan cache over a Unix socket; fingerprint-invalidated incremental analysis |
| `wanyrix telemetry ingest` | `wanyrix.telemetry/v1` | redacted, aggregated rustc JSON diagnostics (source + secrets stripped by default) |
| `wanyrix synth --crates N --seed S` | synthetic fixture | deterministic synthetic workspace for scale testing |

Exit codes: `0` succeeded (findings do NOT affect the exit code — CI
consumers parse the JSON; a `wanyrix build` whose cargo run FAILED also
exits 0 with `buildSuccess: false` — the failed build is data;
`daemon call` reports `ok:false` as exit 2), `2` failed (scan error,
build could not be STARTED — missing path or missing cargo executable,
bad store/db, telemetry input error).
Omitting `--json` prints a human summary (deterministic for the
static-analysis flavors; the `build` summary contains live measured
durations by design). `--pretty` only affects JSON output.

Determinism: identical input ⇒ byte-identical output except `generatedAt`
(and `meta.lastScan`, which mirrors it). Every list is sorted and the
timestamp key is emitted LAST. SCOPE: the static-analysis flavors
(doctor/graph/health). `wanyrix build` is a LIVE measurement — identical
input legitimately yields different durations, because the durations ARE
the data (the envelope's notes say so).

## Honesty contract (non-negotiable — Gate 21 / Gate 7)

1. **Everything is measured.** Findings come from real filesystem parsing.
   `measurementStatus` is always `"measured"`, `confidenceClass`
   `"deterministic"`. Nothing is labeled `verified` (nothing here was
   benchmark-verified) and the static-analysis flavors assert no timing
   (`impactSeconds` is unset). The ONE measured-timing surface is
   `wanyrix build`, which actually executes a build — its durations are
   measurements of a real process, and its envelope says exactly that.
2. **Absent telemetry is labeled, never invented.** The web contract
   requires fields the static-analysis engine cannot measure (`buildTime`,
   `changeFreq`, …). They are emitted as `0` with an explicit
   `not-measured` status field (`buildTimeStatus`, `changeFreqStatus`) — a
   visible zero plus a status, never an estimate in disguise. The
   exception is `cacheHitRate`: since v0.4.0 `wanyrix build` MEASURES it
   from a real cargo build's fresh flags (envelope `wanyrix.build/v1`).
3. **Single source of truth.** `fanIn`, `fanOut`, `downstream` and
   `recompileImpact` are computed exclusively from the served edge list;
   every edge endpoint is a served node.
4. **No network, no fabrication.** The daemon speaks only over a local
   Unix domain socket (mode `0600`); there is no TCP listener anywhere.
   Telemetry ingestion reads a LOCAL rustc/cargo JSON stream and redacts it
   before emission — source snippets are dropped unconditionally and secret
   shapes are scrubbed (policy `wanyrix.telemetry-redaction/v1`); nothing
   ever leaves the machine.
5. **The daemon cache cannot serve stale analysis.** A cache hit requires a
   fingerprint over the CONTENT of every file the engine reads (manifests +
   toolchain files). Any change ⇒ different fingerprint ⇒ full re-scan;
   source files are never read by the analysis, so they are correctly
   outside the key.

Finding-ID registry (stable, deterministic — one finding per rule/crate):
`FER-ENG-001` missing license · `FER-ENG-002` missing description ·
`FER-ENG-003` path-only intra-workspace dep without version (normal/build
only — cargo strips path-only dev-deps on publish) · `FER-ENG-004` duplicate
dependency declaration across sections · `FER-ENG-005` dependency cycle with
a hard edge (critical) · `FER-ENG-006` dev-only cycle (info) ·
`FER-ENG-007` broken path dependency (critical) · `FER-ENG-008` path dep
outside the analyzed set (info) · `FER-ENG-ERR-n` unparseable manifest
(critical).

## Build telemetry — instrumented cargo builds (`wanyrix.build/v1`)

```sh
wanyrix build --path . --json            # build THIS directory, measure it
wanyrix build --path . --json --pretty   # eyeball the envelope
```

The engine spawns a REAL `cargo build --message-format=json`, classifies
the stream, and emits: measured wall clock; per-artifact `fresh` flags →
`cacheHitRate` (the engine's first MEASURED cache-hit rate — the web demo
labels the same field `not-measured`); per-artifact `arrivalDeltaMs`
stream activity; diagnostics counted by level/code. Redaction holds by
construction: `rendered`, span text and suggestions are NEVER emitted
(diagnostics are counted, not copied); retained identifiers still pass
the secret scrubber (`policy wanyrix.telemetry-redaction/v1`, counter
`redaction.secretsScrubbed`). A build that RAN but failed is data
(`buildSuccess: false` + scrubbed `cargoStderrTail`); a build that could
not START (missing path, missing cargo) is an honest exit-2 error —
nothing is ever fabricated.

**The parallelism honesty note (in every envelope):** cargo builds run
with parallel jobs, so per-artifact `arrivalDeltaMs` values OVERLAP —
they are real measurements of stream activity, NOT per-crate build
times. `wallClockMs` is the only exact duration. Measured on the engine
crate itself (v0.4.0, warm): 60 artifacts, 60/60 fresh, cache-hit rate
100, wall clock ≈50 ms — numbers + scope in
[`BENCHMARKS.md`](BENCHMARKS.md).

## The daemon — incremental analysis (`wanyrix.daemon/v1`)

```sh
wanyrix daemon start --socket /tmp/wanyrix.sock   # serve until shutdown
wanyrix daemon call --socket /tmp/wanyrix.sock --method doctor --path .   # cold: full measured scan
wanyrix daemon call --socket /tmp/wanyrix.sock --method doctor --path .   # warm: cache hit, 0 manifests parsed
wanyrix daemon call --socket /tmp/wanyrix.sock --method status            # measured counters + pid
wanyrix daemon call --socket /tmp/wanyrix.sock --method shutdown
```

The response frame wraps the same versioned payloads the CLI emits, with a
`cached` flag: `false` = full measured scan, `true` = served from the
cache after a content-fingerprint match. Measured on the 500-crate
synthetic workspace: warm responses cut wall-clock by ~3–4× and re-parse
ZERO manifests (numbers + honesty note in
[`BENCHMARKS.md`](BENCHMARKS.md); the structural zero-parse guarantee is
pinned by unit tests, which is the part that cannot drift with machine
speed). Idle RSS ≈ 1.8 MB; RSS after a 500-crate scan ≈ 17 MB — the
issue-#58 budget is 100 MB, enforced by a test on Linux via `/proc`.

## Telemetry — redacted rustc diagnostics (`wanyrix.telemetry/v1`)

```sh
cargo build --message-format=json > build.jsonl   # rustc JSON goes to stdout
wanyrix telemetry ingest --input build.jsonl --out telemetry.json
wanyrix telemetry ingest --input - --summary-only        # stdin, aggregates only
```

Redaction is default-on and partially non-negotiable: `rendered`,
`spans[].text` and suggested replacements (all source text) are dropped
unconditionally; span paths reduce to basenames (`--keep-paths` opts into
full paths — never snippets); every retained string is scrubbed against a
fixed secret-shape list (GitHub/AWS/Slack/OpenAI tokens, JWTs, bearer
headers, private-key headers, `api_key = …` assignments), and the report
counts exactly what was removed (`redaction.secretsScrubbed`). Malformed
and non-diagnostic lines are counted honestly, never dropped silently.

## Contract conformance vs. the web dashboard

Findings, evidence entries, graph nodes/edges and health KPIs conform
field-for-field to the shapes in `src/lib/wanyrix/types.ts` (pinned by
`tests/conformance.rs`). Documented intentional divergences:

1. **Engine envelopes are new versioned schemas** (`wanyrix.doctor/v1` etc.).
   The web `DoctorReport` envelope's build-telemetry fields (`buildTime`,
   `estimatedRange`, `criticalPath`, `phases`,
   `summary.developerBuild/ciBuild/diskUsage`) are deliberately NOT emitted —
   engine v1 measures no build times, and fabricating them would violate the
   honesty gates. Findings inside remain fully conformant.
2. **`meta.scope` is `"full-manifest-graph"`**, not the web demo's
   `'backbone-subset'` literal — the engine serves the complete measured
   graph. The TS literal needs widening when the API is wired up.
3. **Health `lastScan` is served as top-level `generatedAt`** (same instant;
   renamed so the deterministic payload can be audited independently).
4. **Additive node extras**: `buildTimeStatus`, `changeFreqStatus`,
   `recompileImpact`, `path` (unknown keys are ignored by TS consumers).

## Development

```sh
cargo build            # clean, zero warnings
cargo test             # 120 tests — fixtures in tests/fixtures/ (plus 2 opt-in perf probes: cargo test --release --test perf_probe -- --ignored)
cargo clippy --all-targets -- -D warnings   # zero warnings
./target/debug/wanyrix doctor --path tests/fixtures/tiny-ws --json | python3 -m json.tool
```

Suites: unit tests per module (protocol, redaction, fingerprint, store,
synth rules, build-stream classification) + integration tests that spawn
the real binary (`daemon_ipc.rs` — full IPC lifecycle, live-socket theft
refusal, RSS budget; `telemetry_cli.rs` — end-to-end redaction via the
CLI; `build_cli.rs` — real instrumented builds, cold/warm cache-hit
measurement, failed-build-is-data; `conformance.rs` — web-contract shape
pinning; `store_recovery.rs` — WAL crash recovery). Fixtures:
`tests/fixtures/tiny-ws` (3 crates, exactly 4 warnings) and
`tests/fixtures/cycle-ws` (hard cycle + dev-only cycle; the graph still
renders without hanging). Architecture is `lib.rs` + thin `main.rs`, so
tests drive the exact CLI code path through the library API. No `unwrap`
on user-input paths; serialization errors surface as exit code 2, never a
silent `{}`.

## Roadmap

**Built (v0.4.0):**
- `wanyrix doctor|graph|health` — measured filesystem analysis (v0.1.0)
- `wanyrix synth` — deterministic synthetic-workspace generator (`--crates N --seed S`;
  same seed ⇒ byte-identical tree; every artifact is synthetic, never presented as measured)
- `wanyrix store` — SQLite persistence (WAL, two-phase commit order scans→findings,
  `fsck` detects/repairs kill-between-commits orphans). Measured timings in
  [`BENCHMARKS.md`](BENCHMARKS.md). (v0.2.0)
- `wanyrix daemon` — incremental analysis over a local Unix socket
  (`wanyrix.daemon/v1`); content-fingerprint invalidation; measured RSS +
  warm/cold evidence in [`BENCHMARKS.md`](BENCHMARKS.md). (v0.3.0)
- `wanyrix telemetry ingest` — redacted rustc JSON diagnostics
  (`wanyrix.telemetry/v1`); default-on source/secret redaction. (v0.3.0)
- `wanyrix build` — instrumented cargo-build runner measuring wall clock,
  fresh/cache-hit rate and redacted diagnostics (`wanyrix.build/v1`). (v0.4.0)
- **Product contract (v0.5.0)** — `wanyrix init` (measured workspace identity in
  `.wanyrix/state.json`, idempotent), `wanyrix status` (fresh scan + init drift +
  newest store row + daemon liveness probe), `wanyrix analyze` (doctor + graph +
  health embedded verbatim under `wanyrix.analyze/v1`), `wanyrix dependencies`
  (direct deps/dependents, fan-in/out, duplicates, path-dep resolution tallies,
  measured cycles), and the `wanyrix experiment` ledger
  (`wanyrix.experiment/v1`): a hypothesis is `estimated`; two REAL `wanyrix
  build` runs make it `measured`; only a real measured improvement between two
  successful builds grants `verified`. Verification cannot be faked, bought,
  or retro-fitted.

**Explicitly NOT built yet:**
- **Full build-time attribution** — per-crate build seconds that survive
  cargo's parallel jobs (requires the experimental `cargo` parallelism
  model or `--timings` parsing; `wanyrix build` measures the exact wall
  clock and honest per-artifact stream activity, and says so).
- **Experiment runner** — before/after benchmark verification (the only
  path by which a claim may ever become `verified`).
- **PR regression analysis, runtime telemetry, AI explain integration.**
