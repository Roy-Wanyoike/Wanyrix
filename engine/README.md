# wanyrix-engine

The Rust engineering-intelligence engine for [Wanyrix](../README.md) — an
evidence-first analysis tool for Rust workspaces. This is the crate behind
the web dashboard's honesty-first product identity (AUDIT-I8): every number
it reports is **measured**, and anything it cannot measure is labeled, never
simulated.

## Status — engine v1 (this round)

**Built:** filesystem manifest analysis. The engine walks a Rust workspace,
parses every `Cargo.toml`, resolves intra-workspace path dependencies into
ONE canonical edge list, and serves three versioned JSON flavors computed
from that single measured source:

| Command | Flavor schema | Emits |
| --- | --- | --- |
| `wanyrix doctor --path <dir> [--json] [--pretty]` | `wanyrix.doctor/v1` | workspace name, crate list, `FER-ENG-*` findings, severity summary, scan provenance |
| `wanyrix graph --path <dir> [--json] [--pretty]` | `wanyrix.graph/v1` | nodes + edges, per-crate fanIn/fanOut, downstream/recompileImpact closure (derived from the served edges only — no ghost nodes) |
| `wanyrix health --path <dir> [--json] [--pretty]` | `wanyrix.health/v1` | KPI summary derived from doctor + graph results |

Exit codes: `0` scan succeeded (findings do NOT affect the exit code — CI
consumers parse the JSON), `2` scan failed (path missing, no manifests).
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
4. **No network. No daemons. No telemetry.** The binary only reads the
   filesystem under the given path.

Finding-ID registry (stable, deterministic — one finding per rule/crate):
`FER-ENG-001` missing license · `FER-ENG-002` missing description ·
`FER-ENG-003` path-only intra-workspace dep without version (normal/build
only — cargo strips path-only dev-deps on publish) · `FER-ENG-004` duplicate
dependency declaration across sections · `FER-ENG-005` dependency cycle with
a hard edge (critical) · `FER-ENG-006` dev-only cycle (info) ·
`FER-ENG-007` broken path dependency (critical) · `FER-ENG-008` path dep
outside the analyzed set (info) · `FER-ENG-ERR-n` unparseable manifest
(critical).

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
cargo test             # 25 tests (23 unit + 2 conformance) — fixtures in tests/fixtures/
cargo clippy --all-targets -- -D warnings   # zero warnings
./target/debug/wanyrix doctor --path tests/fixtures/tiny-ws --json | python3 -m json.tool
```

Fixtures: `tests/fixtures/tiny-ws` (3 crates, exactly 4 warnings) and
`tests/fixtures/cycle-ws` (hard cycle + dev-only cycle; the graph still
renders without hanging). Architecture is `lib.rs` + thin `main.rs`, so
tests drive the exact CLI code path through the library API. No `unwrap`
on user-input paths; serialization errors surface as exit code 2, never a
silent `{}`.

## Roadmap (explicitly NOT built yet)

- **Build telemetry** — measured dev/CI build times, cache hit rates,
  critical path with real seconds (requires instrumented `cargo` runs).
- **Daemon / server mode** — persistent scans, API serving the web payloads.
- **SQLite persistence** — scan history, trends, change frequency from VCS.
- **Experiment runner** — before/after benchmark verification (the only
  path by which a claim may ever become `verified`).
- **PR regression analysis, runtime telemetry, AI explain integration.**
