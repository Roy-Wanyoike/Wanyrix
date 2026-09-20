<div align="center">

# Wanyrix — Engineering Intelligence Platform

**Rust made software safer. Wanyrix makes Rust development easier to understand and operate.**

[![CI](https://github.com/Roy-Wanyoike/wanyrix/actions/workflows/ci.yml/badge.svg)](https://github.com/Roy-Wanyoike/wanyrix/actions/workflows/ci.yml)
![Rust](https://img.shields.io/badge/Rust-1.98-DEA584?logo=rust&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Tests](https://img.shields.io/badge/tests-262_passing-2EA043)

</div>

---

Wanyrix continuously understands a Rust workspace and explains **why development is slow, fragile, complicated, or difficult** — with evidence, calibrated confidence, and a verification path for every claim. Its defining rule, enforced in code and pinned by tests:

> **Estimated ≠ Measured ≠ Verified.** Nothing upgrades its own status. Only a recorded experiment can make a claim *verified*.

| | |
| --- | --- |
| 🧪 **340 automated tests** | 237 web (bun) + 103 engine (cargo) — unit, live-API contract, conformance, crash-recovery, instrumented-build IPC |
| 🔍 **16 versioned API routes** | `wanyrix.*​/v1` JSON contracts; unknown workspace ⇒ 404, never wrong-workspace data |
| 🦀 **Real Rust engine** | `wanyrix-engine` v0.4: doctor · graph · health · build (instrumented cargo builds) · synth · SQLite store (WAL + crash recovery) · daemon · telemetry |
| 🖥️ **18-surface dashboard** | Next.js 16 + Tailwind 4 + shadcn/ui, light/dark, mobile-clean (0 px overflow @ 390 px) |
| 🤖 **Grounded AI, non-authoritative** | facts server-rendered; model output validated against evidence, violations redacted |
| 🔒 **Local-first, zero telemetry** | state in your browser; the one scaffold telemetry snippet was found and removed |

---

## The loop

```text
        ┌──────────────────────────────────────────────────────────────┐
        │                                                              │
   Cargo ─▶ Collectors ─▶ W-EIR ─▶ Engineering Graph ─▶ Analyzers    │
        │                                        │                    │
        │                              Findings ◀─┘                    │
        │                                 │                             │
        │              Recommendations ───┤                             │
        │                                 │                             │
        │        Experiments ─▶ Measurements ─▶ Verification ──────────┘
        │                    (the only path to "verified")
```

- **W-EIR** — the normalized evidence snapshot every surface derives from. One source of truth, versioned contracts.
- **Engineering Graph** — the dependency backbone behind blast radius, duplicate versions, hotspots, and impact estimation. All aggregates derive from a single edge list; no ghost nodes.
- **Findings** — stable-ID, evidence-cited diagnoses (`FER-BLD-001`…), never silent fixes.
- **Experiments** — the only road from *estimated* to *measured* to *verified*.

### Why it exists

Rust teams lose days to incremental-build pathologies, duplicate dependency trees, and borrow-checker bottlenecks nobody can quantify. Wanyrix answers the questions engineers actually ask — *what will this change cost? why is CI slow? what is safe to touch?* — with numbers that carry their own epistemic status.

### Who it is for

Rust engineers, platform/build teams, and engineering managers who want evidence instead of folklore. Recruiters: the [Engineering practice](#engineering-practice) section shows how this repo is built.

---

## Honesty architecture (non-negotiable)

1. **Estimated ≠ Measured ≠ Verified** — every number carries its status; badge contrast is WCAG-AA tested in both themes.
2. **Evidence first** — every finding carries a stable ID, evidence items with source attribution (`cargo build --timings`, `git log`, `cargo metadata`…), and a recommendation.
3. **Calibrated confidence** — `deterministic / high / medium / estimated`, machine-checked.
4. **AI is optional and grounded** — the FACT block is rendered server-side from evidence; the model may only fill `commentary / inference / recommendation / uncertainty`, and anything it asserts beyond the evidence is **stripped and reported**.
5. **No silent modification** — patches are reviewable diffs behind explicit approval.

---

## Quickstart

### Web dashboard

```bash
bun install
bun run dev            # → http://localhost:3000
bun run test           # 222 tests (skips live-API tests with a clear note if the server is down)
```

### Rust engine

```bash
cd engine
cargo build --release

# Measure a real Rust workspace
cargo run -- doctor --path /path/to/your/workspace --json   # wanyrix.doctor/v1
cargo run -- graph --path /path/to/your/workspace --json    # wanyrix.graph/v1
cargo run -- health --path /path/to/your/workspace --json   # wanyrix.health/v1

# Generate a synthetic 500-crate workspace (deterministic — same seed, same tree)
cargo run -- synth --crates 500 --seed 42 --out /tmp/synth500

# Persist scan results (SQLite, WAL, crash-safe)
cargo run -- store init --db scans.db
cargo run -- doctor --path /tmp/synth500 --json | cargo run -- store save --db scans.db --scan -
cargo run -- store list --db scans.db
cargo run -- store fsck --db scans.db
```

Every subcommand: deterministic output for identical input, `generatedAt` last, exit `0` on success / `2` on scan failure. Measured 500-crate timings: [`engine/BENCHMARKS.md`](engine/BENCHMARKS.md).

### 5-minute tour

1. **Overview** — KPI grid, build-time trend, slowest crates.
2. **Builds · Doctor** — run a scan; every finding lists evidence, sources, recommendation, and verification path. Human ⇄ `--json` modes.
3. **Findings** — severity/section filters; drill into any `FER-*` for its evidence table.
4. **Experiments** — baseline → candidate → measured delta. This is how *estimated* becomes *verified*.
5. **AI** — ask *why does this finding matter?* — grounded in the same evidence (real response below).

Full task-oriented guide: [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md).

---

## Grounded AI — real API response

`POST /api/wanyrix/explain` with `{"context":{"findingId":"FER-BLD-001"},"question":"Why does this matter for a Rust team?"}` (abridged — facts truncated from 18 to 3; everything else verbatim):

```json
{
  "ok": true,
  "grounded": true,
  "explanation": "OBSERVED FACT — common-runtime takes 18.3s to compile and blocks 41 downstream crates. … INFERENCE — … RECOMMENDATION — … UNCERTAINTY — …",
  "grounding": {
    "status": "registry",
    "facts": [
      { "statement": "id: FER-BLD-001", "derivedFrom": "registry:findings.id" },
      { "statement": "title: common-runtime sits on the critical path", "derivedFrom": "registry:findings.title" }
    ]
  },
  "ai": {
    "commentary": "…",
    "inference": "…",
    "recommendation": "…",
    "uncertainty": "While the estimated improvement is 12.4s, the actual measurement may vary. …"
  },
  "provenance": { "generatedBy": "ai-provider", "resolution": "context reference resolved against the findings registry → FER-BLD-001" }
}
```

`grounding.facts` is rendered **server-side** — the model cannot write it. Model output is confined to `ai.*`, post-validated against the evidence, and redacted into `groundingViolations` if it asserts anything the evidence does not contain. Provider down → deterministic fallback. No AI feature is load-bearing.

---

## API surface (16 routes, `/api/wanyrix/*`)

| Route | Purpose |
| --- | --- |
| `health`, `workspaces`, `storage` | platform status, workspace registry, local storage state |
| `doctor`, `graph`, `diagnostics` | findings, dependency graph, borrow/async explainers |
| `impact` | blast-radius / change-cost calculator (`estimated` by definition) |
| `experiments`, `gates`, `issues`, `pr` | verification loop, release scorecard, traceability, PR regression guard |
| `report` | workspace report — `?format=markdown\|json` and machine flavors `?flavor=scorecard\|scan-history` |
| `explain` | grounded AI — `context`+`question` ⇒ 400 if missing; GET ⇒ `405` (`Allow: POST`); >256 KB ⇒ `413` |
| `scan-runs` | durable scan-run log (`wanyrix.scan-runs/v1`) — browser runs POST here (idempotent upsert, optional findings-fingerprint `findingIds` per run); GET serves exactly what was synced, never fabricated (Gate 21) |
| `engine/doctor` | executes — spawns the real `wanyrix` binary from `engine/` and returns verbatim `wanyrix.doctor/v1` stdout (`wanyrix.engine-exec/v1`); 503 when not built on the host |
| `engine/build` | executes an INSTRUMENTED BUILD — the real binary runs a real `cargo build --message-format=json` and measures it (`wanyrix.build/v1`: measured wall clock, measured fresh/cache-hit rate, redacted diagnostics); a failed build is data (`buildSuccess: false`), not an HTTP error |

Every workspace-scoped route validates `?ws=`: unknown workspace ⇒ **404** `{error, knownWorkspaces}` — data is never silently served for the wrong workspace. Error semantics: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · machine contract: [`docs/CLI.md`](docs/CLI.md).

---

## Repository map

```text
├── src/                     # Web platform (Next.js 16 · TypeScript strict · Tailwind 4 · shadcn/ui)
│   ├── app/api/wanyrix/     #   16 versioned API routes
│   ├── components/wanyrix/  #   18-surface information architecture
│   └── lib/wanyrix/         #   stores, contracts, fixtures (17 domain modules), exporters
├── engine/                  # wanyrix-engine (Rust 2021, zero-dep core + rusqlite)
│   └── tests/fixtures/      #   deterministic workspaces incl. cycles + synth-50
├── tests/                   # bun test suite (unit + live API contracts)
├── scripts/                 # brand gate, fixture generator, GitHub automation kit
├── docs/                    # 16 documents (see map below)
└── .github/workflows/ci.yml # CI: lint · tsc · tests · brand gate · cargo build/clippy/test
```

---

## Engineering practice

This repository is built the way it asks you to build software — with verifiable claims:

- **262 tests, zero failures** — including live API-contract suites, graph-math invariants (aggregates must equal edge-list closure), honesty-badge WCAG-AA contrast (computed, not asserted), storage-migration goldens, engine conformance + WAL crash-recovery.
- **CI on every push/PR** — ESLint, `tsc --noEmit`, full test suite, legacy-token brand gate, `cargo build --locked` + `clippy -D warnings` + `cargo test --locked`.
- **Contract-first** — all machine payloads are versioned (`wanyrix.*​/v1`); determinism is pinned by tests (same input ⇒ byte-identical output, timestamp last).
- **Honesty is load-bearing** — the `estimated/verified` separation, workspace guards, and grounding redaction are *tested behaviors*, not documentation.
- **Auditable process** — every release decision is re-derived against a 57-gate acceptance matrix; issues close with evidence comments.

---

## Offline-first, online-enhanced

- **Offline** — the deterministic core (doctor, graph, findings, simulator, gates) is fully usable with zero network and zero AI. State persists locally.
- **Online** — the AI layer adds grounded explanations over the same evidence; unreachable/ungrounded providers degrade to the deterministic answer and never block the workflow.

## Security & privacy

- **Local-first** — workspaces, scan history, diff queue, and preferences live in your browser's localStorage. No background sync, no product telemetry. (A scaffolded anonymous page-view snippet was discovered and **removed** — see [`docs/SECURITY.md`](docs/SECURITY.md).)
- **AI explain** sends only what you explicitly submit (context payload + question), capped at 256 KB.
- **Cloud features are roadmap** (disabled today) — see [`docs/PRIVACY.md`](docs/PRIVACY.md).

## Documentation

| | | |
| --- | --- | --- |
| [User Guide](docs/USER_GUIDE.md) | [Architecture](docs/ARCHITECTURE.md) | [W-EIR schema](docs/W-EIR.md) |
| [CLI contract](docs/CLI.md) | [Engine README](engine/README.md) | [Engine benchmarks](engine/BENCHMARKS.md) |
| [Performance](docs/PERFORMANCE.md) | [Security](docs/SECURITY.md) | [Privacy](docs/PRIVACY.md) |
| [Development](docs/DEVELOPMENT.md) | [Contributing](docs/CONTRIBUTING.md) | [Issue tracker](https://github.com/Roy-Wanyoike/wanyrix/issues) |

## Roadmap

Phases 1–9 are demonstrated by this platform (engine v0.3 executes doctor · graph · health · synth · store · daemon · telemetry). Open work, tracked on the [issue tracker](https://github.com/Roy-Wanyoike/wanyrix/issues):

- **#53** — fixture-generator adoption across web fixtures *(generator shipped; adoption open)*
- **#49** — product-core umbrella

Roadmap features never destabilize the shipped core. Release decision: **CONDITIONAL GO** — re-derived each round against a 57-gate acceptance matrix (32 PASS · 8 PARTIAL · 0 FAIL · 12 IN-PROGRESS · 5 N/A at last audit; zero CRITICAL/HIGH product defects open).

## Commercial model

Free local core · Local / Cloud / Team / Enterprise packaging planned · billing strictly separated from the local deterministic core. Pricing remains a configurable proposal pending market validation; nothing is billed today.

## Governance & brand history

- Work lands only through reviewed PRs referencing their issue; CI and the brand gate run on every change.
- **Ferrix was renamed to Wanyrix** (2026-09). Stable finding IDs keep their historic `FER-` prefix by design — IDs are stable contracts; new registries use `WAN-`.

## License

Proprietary — © Wanyrix. All rights reserved. The engine crate (`engine/`) is declared **MIT OR Apache-2.0** in its `Cargo.toml`; extending that dual license to the rest of the tree is a documented option that takes effect only by explicit maintainer decision.

## Community & contributing

- [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) — how to file issues, what a good PR looks like, the verification bar every change must meet.
- Issues and PRs live on the [GitHub tracker](https://github.com/Roy-Wanyoike/wanyrix/issues); every closed issue carries measured evidence.
- The engine will be published to crates.io once the release checklist (versioning, MSRV, feature flags) is exercised — see the tracker.
