# wanyrix-engine

The Rust engineering-intelligence engine for [Wanyrix](../README.md) — an
evidence-first analysis tool for Rust workspaces. This is the crate behind
the web dashboard's honesty-first product identity (AUDIT-I8): every number
it reports is **measured**, and anything it cannot measure is labeled, never
simulated.

## Status — engine v0.3.0

**Built:** filesystem manifest analysis, local persistence, an incremental
analysis daemon, redacted rustc-telemetry ingestion, and a synthetic
fixture generator. The engine walks a Rust workspace, parses every
`Cargo.toml`, resolves intra-workspace path dependencies into ONE canonical
edge list, and serves three versioned JSON flavors computed from that
single measured source:

| Command | Flavor schema | Emits |
| --- | --- | --- |
| `wanyrix doctor --path <dir> [--json] [--pretty]` | `wanyrix.doctor/v1` | workspace name, crate list, `FER-ENG-*` findings, severity summary, scan provenance |
| `wanyrix graph --path <dir> [--json] [--pretty]` | `wanyrix.graph/v1` | nodes + edges, per-crate fanIn/fanOut, downstream/recompileImpact closure (derived from the served edges only — no ghost nodes) |
| `wanyrix health --path <dir> [--json] [--pretty]` | `wanyrix.health/v1` | KPI summary derived from doctor + graph results |
| `wanyrix store init/save/list/fsck --db <file>` | local SQLite (layout v1) | WAL-backed scan history; two-phase commit; crash-detecting `fsck` |
| `wanyrix daemon start/call` | `wanyrix.daemon/v1` | persistent in-process scan cache over a Unix socket; fingerprint-invalidated incremental analysis |
| `wanyrix telemetry ingest` | `wanyrix.telemetry/v1` | redacted, aggregated rustc JSON diagnostics (source + secrets stripped by default) |
| `wanyrix synth --crates N --seed S` | synthetic fixture | deterministic synthetic workspace for scale testing |

Exit codes: `0` succeeded (findings do NOT affect the exit code — CI
consumers parse the JSON; `daemon call` reports `ok:false` as exit 2),
`2` failed (scan error, bad store/db, telemetry input error).
Omitting `--json` prints a deterministic human summary; `--pretty` only
affects JSON output.

Determinism: identical input ⇒ byte-identical output except `generatedAt`
(and `meta.lastScan`, which mirrors it). Every list is sorted and the
timestamp key is emitted LAST.

## Honesty contract (non-negotiable — Gate 21 / Gate 7)

1. **Everything is measured.** Findings come from real filesystem parsing.
   `measurementStatus` is always `"measured"`, `confidenceClass`
   `"deterministic"`. Nothing is labeled `verified` (nothing here was
   benchmark-verified) and no timing is asserted (`impactSeconds` is unset).
2. **Absent telemetry is labeled, never invented.** The web contract
   requires fields the engine cannot measure yet (`buildTime`,
   `changeFreq`, `cacheHitRate`, …). They are emitted as `0` with an
   explicit `not-measured` status field (`buildTimeStatus`,
   `changeFreqStatus`, `cacheHitRateStatus`) — a visible zero plus a status,
   never an estimate in disguise.
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
cargo test             # 88 tests — fixtures in tests/fixtures/
cargo clippy --all-targets -- -D warnings   # zero warnings
./target/debug/wanyrix doctor --path tests/fixtures/tiny-ws --json | python3 -m json.tool
```

Suites: unit tests per module (protocol, redaction, fingerprint, store,
synth rules) + integration tests that spawn the real binary
(`daemon_ipc.rs` — full IPC lifecycle, live-socket theft refusal, RSS
budget; `telemetry_cli.rs` — end-to-end redaction via the CLI;
`conformance.rs` — web-contract shape pinning; `store_recovery.rs` —
WAL crash recovery). Fixtures: `tests/fixtures/tiny-ws` (3 crates, exactly
4 warnings) and `tests/fixtures/cycle-ws` (hard cycle + dev-only cycle; the
graph still renders without hanging). Architecture is `lib.rs` + thin
`main.rs`, so tests drive the exact CLI code path through the library API.
No `unwrap` on user-input paths; serialization errors surface as exit code
2, never a silent `{}`.

## Roadmap

**Built (v0.3.0):**
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

**Explicitly NOT built yet:**
- **Build telemetry** — measured dev/CI build times, cache hit rates,
  critical path with real seconds (requires instrumented `cargo` runs;
  `telemetry ingest` consumes existing rustc JSON streams but does not
  instrument builds itself).
- **Experiment runner** — before/after benchmark verification (the only
  path by which a claim may ever become `verified`).
- **PR regression analysis, runtime telemetry, AI explain integration.**
