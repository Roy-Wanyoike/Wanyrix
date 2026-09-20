<div align="center">

# Wanyrix — Engineering Intelligence Platform

**Rust made software safer. Wanyrix makes Rust development easier to understand and operate.**

[![CI](https://github.com/Roy-Wanyoike/wanyrix/actions/workflows/ci.yml/badge.svg)](https://github.com/Roy-Wanyoike/wanyrix/actions/workflows/ci.yml)
![Rust](https://img.shields.io/badge/Rust-1.98-DEA584?logo=rust&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Engine](https://img.shields.io/badge/engine-v0.6.0-DEA584)
![Tests](https://img.shields.io/badge/tests-390_passing-2EA043)
![License](https://img.shields.io/badge/license-MIT_OR_Apache--2.0-2EA043)

<img src="public/brand/banner.png" alt="Wanyrix — engineering intelligence. The Beacon-W brand mark over a dark amber energy burst." width="100%" />

</div>

---

## Why Wanyrix exists

Rust teams lose days to incremental-build pathologies, duplicate dependency trees, and hotspots nobody can quantify. The tooling answers *what compiled* — never *why it was slow, what a change will cost, or whether a fix actually worked*. Decisions run on folklore; "improvements" ship unmeasured.

**Wanyrix is the evidence layer for Rust development.** It continuously understands a workspace and explains why development is slow, fragile, complicated, or difficult — with stable-ID findings, calibrated confidence, and a verification path for every claim. Its defining rule, enforced in code and pinned by tests:

> **Estimated ≠ Measured ≠ Verified.** Nothing upgrades its own status. Only a recorded experiment with two real measured builds can make a claim *verified*.

That honesty rule is the product. Dashboards that make numbers look good are commodities; a system that **refuses to let a number lie** — in the engine, the API, the AI layer, and the UI — is a moat.

| | |
| --- | --- |
| 🧪 **390 automated tests** | 262 web (bun) + 128 engine (cargo) — unit, live-API contract, conformance, WAL crash-recovery, fault-injection chaos, instrumented-build IPC |
| 🔍 **18 versioned API routes** | `wanyrix.*​/v1` JSON contracts; unknown workspace ⇒ 404, never wrong-workspace data |
| 🦀 **Real Rust engine** | `wanyrix-engine` v0.6.0, 14 command surfaces: doctor · graph · health · analyze · dependencies · build (instrumented cargo) · experiment ledger · **event log** · store (SQLite WAL + crash recovery) · daemon · telemetry · synth · init · status |
| 🖥️ **18-surface dashboard** | Next.js 16 + Tailwind 4 + shadcn/ui — dark & light themes, mobile-clean (0 px overflow @ 390 px) |
| 🤖 **Grounded AI, non-authoritative** | facts server-rendered; model output validated against evidence, violations redacted |
| 🔒 **Local-first, zero telemetry** | state in your browser; nothing transmits unless you explicitly configure it |

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
- **Experiments** — the only road from *estimated* to *measured* to *verified*. Every transition lands in a durable, append-only **event log** — the receipt trail.

---

## How to use it

### 1. Run the dashboard (2 minutes)

```bash
bun install
bun run dev            # → http://localhost:3000
```

Pick a workspace in the sidebar, toggle **dark/light** from the topbar (or press **⌘K** → theme), and take the tour:

1. **Overview** — KPI grid, build-time trend, slowest crates.
2. **Builds · Doctor** — run a scan; every finding lists evidence, sources, recommendation, and verification path. Human ⇄ `--json` modes.
3. **Findings** — severity/section filters; drill into any `FER-*` for its evidence table.
4. **Experiments** — baseline → candidate → measured delta. This is how *estimated* becomes *verified*.
5. **AI** — ask *why does this finding matter?* — grounded in the same evidence.

Full task-oriented guide: [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md).

### 2. Build the engine

```bash
cd engine
cargo build --release
```

### 3. The offline CLI journey (the product contract)

Every command works with zero network. Deterministic output for identical input, versioned JSON (`--json`), timestamps last, exit `0`/`2`.

```bash
cd /path/to/your/rust/workspace

# Onboard — records a measured identity (.wanyrix/state.json), idempotent
wanyrix init

# Diagnose — findings, graph, KPIs, each a versioned envelope
wanyrix doctor --json        # wanyrix.doctor/v1   — evidence-cited findings
wanyrix graph --json         # wanyrix.graph/v1    — measured edge list + SCC cycles
wanyrix health --json        # wanyrix.health/v1   — KPI summary
wanyrix analyze --json       # wanyrix.analyze/v1  — doctor + graph + health in one pass
wanyrix dependencies --json  # wanyrix.dependencies/v1 — fan-in/out, duplicates, cycles

# Measure — a REAL instrumented cargo build (wall clock + cache-hit rate)
wanyrix build --json         # wanyrix.build/v1    — a failed build is data, not an error

# Verify — the honesty centerpiece
wanyrix experiment record  --name "inline-deps" --claim "fewer crates recompile"
wanyrix experiment measure --name "inline-deps" --role baseline   # real build #1
wanyrix experiment measure --name "inline-deps" --role candidate  # real build #2
wanyrix experiment verify  --name "inline-deps"   # granted ONLY on a measured improvement
wanyrix events                                                # the durable receipt trail

# Persist & serve
wanyrix store init --db scans.db
wanyrix doctor --json | wanyrix store save --db scans.db --scan -
wanyrix store list --db scans.db && wanyrix store fsck --db scans.db
wanyrix daemon start          # cached measured scans over a local Unix socket
```

No Rust workspace handy? Generate one deterministically:

```bash
wanyrix synth --crates 500 --seed 42 --out /tmp/synth500
```

**Want "verified" without a real improvement? The engine refuses — by design.** An unmeasured verify is a named error (`estimated ≠ measured ≠ verified: nothing can be verified from a hypothesis alone`); a slower candidate is a named error; refusals mint no events. That's the difference between a dashboard and an evidence system.

Measured 500-crate timings: [`engine/BENCHMARKS.md`](engine/BENCHMARKS.md) · full command contract: [`docs/CLI.md`](docs/CLI.md).

---

## Honesty architecture (non-negotiable)

1. **Estimated ≠ Measured ≠ Verified** — every number carries its status; badge contrast is WCAG-AA tested in both themes.
2. **Evidence first** — every finding carries a stable ID, evidence items with source attribution (`cargo build --timings`, `git log`, `cargo metadata`…), and a recommendation.
3. **Calibrated confidence** — `deterministic / high / medium / estimated`, machine-checked.
4. **AI is optional and grounded** — the FACT block is rendered server-side from evidence; the model may only fill `commentary / inference / recommendation / uncertainty`, and anything it asserts beyond the evidence is **stripped and reported**.
5. **No silent modification** — patches are reviewable diffs behind explicit approval; the event log mirrors real transitions only.

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

## API surface (18 routes, `/api/wanyrix/*`)

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
│   ├── app/api/wanyrix/     #   18 versioned API routes
│   ├── components/wanyrix/  #   18-surface information architecture
│   └── lib/wanyrix/         #   stores, contracts, fixtures (17 domain modules), exporters
├── engine/                  # wanyrix-engine v0.6.0 (Rust 2021, zero-dep core + rusqlite)
│   └── tests/               #   conformance, WAL crash-recovery, chaos fault-injection
├── tests/                   # bun test suite (unit + live API contracts)
├── scripts/                 # brand gate, fixture generator, soak + flake-budget harnesses
├── docs/                    # guides, contracts, and design directions (map below)
└── .github/workflows/       # ci.yml · release.yml (SBOM) · perf.yml
```

---

## Engineering practice

This repository is built the way it asks you to build software — with verifiable claims:

- **390 tests, zero failures** — including live API-contract suites, graph-math invariants (aggregates must equal edge-list closure), honesty-badge WCAG-AA contrast (computed, not asserted), storage-migration goldens, engine conformance + WAL crash-recovery + **9 chaos fault-injection tests** (truncated payloads, garbage DBs, dead sockets, corrupted ledgers).
- **CI on every push/PR** — ESLint, `tsc --noEmit`, full test suite, legacy-token brand gate, `cargo build --locked` + `clippy -D warnings` + `cargo test --locked`. Release workflow ships binaries + CycloneDX SBOM + cargo-audit; perf workflow scales the soak/flake harnesses.
- **Contract-first** — all machine payloads are versioned (`wanyrix.*​/v1`); determinism is pinned by tests (same input ⇒ byte-identical output, timestamp last). The web pins the engine version in one constant, tested against `engine/Cargo.toml`.
- **Honesty is load-bearing** — the `estimated/verified` separation, workspace guards, grounding redaction, and the event log's *refusals-mint-no-events* rule are **tested behaviors**, not documentation.
- **Auditable process** — every release decision is re-derived against a 57-gate acceptance matrix; issues close with evidence comments.

**Reviewing this repo? Start here:** `engine/src/product.rs` (the honesty gates as code) · `engine/tests/chaos.rs` (failure injection) · `src/lib/wanyrix/api.ts` (the 404-not-wrong-workspace guard) · `tests/unit/legacy-migration.test.ts` (migration goldens) · `docs/ARCHITECTURE.md` (the 20-minute tour).

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
| [Development](docs/DEVELOPMENT.md) | [Contributing](docs/CONTRIBUTING.md) | [Commercial model](docs/COMMERCIAL.md) |
| [Cloud design (issue #61)](docs/CLOUD_DESIGN.md) | [Plugins & events (issue #63)](docs/PLUGIN_AND_EVENTS.md) | [Issue tracker](https://github.com/Roy-Wanyoike/wanyrix/issues) |

## Roadmap

Shipped: the full offline product contract (14 command surfaces), the durable event log, chaos-tested resilience, release engineering with SBOM, and the design directions for cloud and plugins. Next, in order:

- **crates.io publish** of `wanyrix-engine` once the release checklist (MSRV, feature flags, signing secrets) is exercised on a real tag.
- **Plugin API v1** — the event log is the first shipped extension surface; the out-of-process plugin contract follows the decision points in [`docs/PLUGIN_AND_EVENTS.md`](docs/PLUGIN_AND_EVENTS.md).
- **Cloud milestone** — sync layer design is documented (`wanyrix.sync/v1`); implementation starts when the hosted offering is greenlit ([`docs/CLOUD_DESIGN.md`](docs/CLOUD_DESIGN.md)).

Roadmap features never destabilize the shipped core. Release decision: **CONDITIONAL GO** — re-derived each round against a 57-gate acceptance matrix; zero CRITICAL/HIGH product defects open.

## Commercial model

**Local-first, cloud-enhanced — never a crippled trial.** The local deterministic product is genuinely excellent and permanently free (`docs/COMMERCIAL.md` is the ratified strategy): unlimited local repositories, the full CLI, the dashboard, experiments, verification, local history, offline operation. Accounts never gate the local product — when the cloud ships, accounts exist only for sync, teams, and governance (90-day Team trial; expiry and cancellation never touch local functionality or data).

Paid tiers (Cloud / Team / Enterprise / API-CI) monetize **collaboration, persistence, scale, governance, and hosted intelligence** — never the analysis of your own source on your own machine. Price points are deliberately unpublished pending customer discovery; the tier structure and value splits are the commitment.

## Governance & brand history

- Work lands only through reviewed PRs referencing their issue; CI and the brand gate run on every change.
- **Ferrix was renamed to Wanyrix** (2026-09). Stable finding IDs keep their historic `FER-` prefix by design — IDs are stable contracts; new registries use `WAN-`.

## License

Dual-licensed under **MIT OR Apache-2.0** — see [`LICENSE`](LICENSE), [`LICENSE-MIT`](LICENSE-MIT), and [`LICENSE-APACHE`](LICENSE-APACHE). You may use, modify, and distribute either way, at your option. The planned Wanyrix Cloud offering may ship under separate proprietary terms; no trademark rights in "Wanyrix" or the Beacon-W mark are granted by these licenses.

## Community & contributing

- [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) — how to file issues, what a good PR looks like, the verification bar every change must meet.
- Issues and PRs live on the [GitHub tracker](https://github.com/Roy-Wanyoike/wanyrix/issues); every closed issue carries measured evidence.
- Good first contributions: a new doctor finding (with evidence tests), a plugin prototype reading `wanyrix events --json`, or benchmarking `synth --crates 1000`.
