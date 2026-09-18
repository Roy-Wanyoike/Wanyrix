# Wanyrix — Engineering Intelligence Platform

> Rust made software safer. Wanyrix makes Rust development easier to understand and operate.

Wanyrix continuously understands a Rust workspace and explains **why development is slow,
fragile, complicated, or difficult** — with evidence, calibrated confidence, and a
verification path for every claim. It never presents an estimate as a measurement: only a
run experiment can upgrade a claim to **verified**.

## What Wanyrix is

An engineering-intelligence layer that sits next to your Rust repositories. It observes
builds, dependencies, diagnostics, and history, builds an **Engineering Graph** of the
workspace, and turns that graph into evidence-backed **findings**, **recommendations**,
and **experiments** — the OBSERVE → LEARN loop:

```text
Engine → Collectors → W-EIR → Engineering Graph → Analyzers
      → Findings → Recommendations → Experiments → Measurements → Verification
```

- **W-EIR** (Wanyrix Engineering Intermediate Representation) is the normalized evidence
  snapshot every other surface derives from — one source of truth, versioned contracts.
- The **Engineering Graph** is the dependency backbone used for blast radius, duplicate
  versions, hotspots, and impact estimation.
- **Findings** are stable-ID, evidence-cited diagnoses (e.g. `FER-BLD-001`), never silent
  fixes.
- **Experiments** are the only path from `estimated` to `measured` to `verified`.

### Why it exists

Rust teams lose days to incremental-build pathologies, duplicate dependency trees, and
borrow-checker bottlenecks that no one can quantify. Wanyrix answers the questions
engineers actually ask — *what will this change cost? why is CI slow? what is safe to
touch?* — with numbers that carry their own epistemic status.

### Who it is for

Rust engineers, platform/build teams, and engineering managers who need honest,
evidence-backed answers about workspace health instead of folklore.

## Honesty architecture (non-negotiable)

1. **Estimated ≠ Measured ≠ Verified** — every number carries its status; nothing upgrades
   itself. Verified requires a recorded experiment.
2. **Evidence first** — every finding carries a stable ID, evidence items with source
   attribution (`cargo build --timings`, `git log`, `cargo metadata graph`, …), and a
   recommendation.
3. **Calibrated confidence** — `deterministic / high / medium / estimated`.
4. **AI is optional and grounded** — see [AI stance](#ai-stance).
5. **No silent modification** — patches are reviewable diffs behind explicit approval.

## What this repository contains

This repo hosts the **Wanyrix web platform** — a working demonstrator of the product loop
(Next.js 16 · TypeScript · Tailwind 4 · shadcn/ui · TanStack Query · zustand) over
fixture workspaces (`helios-platform`, 47 crates · `atlas-consortium`). The Rust engine is
**not** in this repo; engine contracts are encoded here as versioned fixtures and API
flavors (`wanyrix.report/v1`, `wanyrix.scan-history/v1`, `wanyrix.release-scorecard/v1`),
so the web platform is the integration surface the engine will plug into (tracked in
`docs/audits/issues/AUDIT-I8.md`).

The UI exposes an 18-item information architecture: Overview · Repositories · Builds·Doctor ·
Dependencies · Graph · Findings · Architecture · Impact Simulator · Diagnostics · PR Analysis ·
Experiments · Runtime · History · AI · Policies·Gates · Issues & PRs · Organization · Settings.

## Offline-first, online-enhanced

- **Offline**: the deterministic core (doctor, graph, findings, simulator, gates) is fully
  usable with zero network and zero AI. State persists locally (localStorage).
- **Online**: the AI reasoning layer adds grounded explanations on top of the same
  evidence. If the provider is unreachable, slow, or ungrounded, the product falls back to
  a deterministic, evidence-rendered answer — it never blocks the workflow.

## Run locally

```bash
bun install
bun run dev          # http://localhost:3000
bun run lint         # eslint
bun run test         # bun test — 105 tests, incl. live API contract tests
```

## First analysis (5-minute walkthrough)

1. **Overview** — KPI grid, build-time trend, slowest crates for the active workspace.
2. **Builds · Doctor** — run the scan; each finding lists evidence with sources, a
   recommendation, and a verification path. Switch Human ⇄ `--json` modes.
3. **Findings** — all findings with severity/section filters; open one for the evidence
   table and its `FER-*` ID.
4. **Experiments** — pick a finding, see baseline → candidate → measured delta; this is
   how `estimated` becomes `verified`.
5. **AI** — ask *why does this finding matter?* Answers are grounded in the same evidence
   (see example below).

Full task-oriented guide: [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md).

## Example output (real API response)

`POST /api/wanyrix/explain` with
`{"context":{"findingId":"FER-BLD-001"},"question":"Why does this matter for a Rust team?"}`
(abridged — facts list truncated from 18 to 3; everything else verbatim from a live call):

```json
{
  "ok": true,
  "grounded": true,
  "explanation": "OBSERVED FACT — common-runtime takes 18.3s to compile and blocks 41 downstream crates. … INFERENCE — … RECOMMENDATION — … UNCERTAINTY — …",
  "grounding": {
    "status": "registry",
    "resolved": { "id": "FER-BLD-001", "registry": "findings" },
    "facts": [
      { "statement": "id: FER-BLD-001", "derivedFrom": "registry:findings.id" },
      { "statement": "title: common-runtime sits on the critical path", "derivedFrom": "registry:findings.title" },
      { "statement": "section: Build", "derivedFrom": "registry:findings.section" }
    ]
  },
  "ai": {
    "commentary": "common-runtime takes 18.3s to compile and blocks 41 downstream crates. …",
    "inference": "This creates a significant productivity bottleneck for the Rust team, …",
    "recommendation": "Implement the architecture split into runtime-core and runtime-telemetry …",
    "uncertainty": "While the estimated improvement is 12.4s, the actual measurement may vary. …"
  },
  "disclaimer": "FACT statements above are rendered server-side from the evidence context and cannot be altered by the model. …",
  "provenance": { "generatedBy": "ai-provider", "contextFields": ["registry:findings.id", "…"], "resolution": "context reference resolved against the findings registry → FER-BLD-001" }
}
```

`grounding.facts` is rendered **server-side** from context/registry fields — the model
cannot write it. Model output is confined to `ai.*`, post-validated against the evidence
(numbers, statuses, references), and redacted + reported in `groundingViolations` if it
asserts anything the evidence does not contain.

## API surface (13 routes, `/api/wanyrix/*`)

| Route | Purpose |
| --- | --- |
| `health`, `workspaces`, `storage` | platform status, workspace registry, local storage state |
| `doctor`, `graph`, `diagnostics` | findings, dependency graph, borrow/async explainers |
| `impact` | blast-radius / change-cost calculator (`estimated` by definition) |
| `experiments`, `gates`, `issues`, `pr` | verification loop, release scorecard, traceability, PR regression guard |
| `report` | `wanyrix.report/v1` JSON / Markdown workspace report |
| `explain` | grounded AI reasoning — `context`+`question` required → `400`; GET → `405`; >256 KB body → `413`; unknown finding ID → `400` |

Error semantics and response shapes: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## AI stance

- AI is **additive**: it explains deterministic evidence, never replaces it.
- The FACT block is server-rendered; the model may only fill `ai.commentary`,
  `ai.inference`, `ai.recommendation`, `ai.uncertainty`.
- Every number/status/reference in model output is validated against the evidence context;
  violations are redacted and the answer degrades to the deterministic one
  (`grounded: false`, `groundingViolations` listed).
- Provider down → deterministic fallback (Gate 18). No AI feature is load-bearing.

## Security & privacy

- **Local-first**: workspaces, scan history, diff queue, and preferences live in your
  browser's localStorage. No telemetry, no analytics, no background sync.
- **AI explain** sends only what you explicitly submit (the `context` payload + question)
  to the model provider, capped at 256 KB. Nothing else leaves the page.
- **Cloud features are roadmap** (disabled today) — see [`docs/PRIVACY.md`](docs/PRIVACY.md)
  and [`docs/COMMERCIAL.md`](docs/COMMERCIAL.md).

## Development

```bash
bun run dev         # dev server on :3000 (logs in dev.log)
bun run test        # unit + live API contract tests (bun test)
bun run typecheck   # tsc --noEmit
bun run lint        # eslint
```

- Tests pin the honesty contracts (400/405/413, report schema, estimate-vs-measured
  separation, migration goldens). The suite skips API tests with a clear message if the
  dev server is down.
- Docs map: [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) ·
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/PRIVACY.md`](docs/PRIVACY.md) ·
  [`docs/COMMERCIAL.md`](docs/COMMERCIAL.md) · audit trail under `docs/audits/`.

## Roadmap (condensed, phases 1–15)

1. Core runtime · 2. Rust repository intelligence · 3. Engineering graph ·
4. Build intelligence · 5. Findings & diagnosis · 6. Incremental intelligence ·
7. Engineering experiments · 8. AI engineering intelligence · 9. Safe AI patches ·
10. Architecture intelligence · 11. Runtime intelligence · 12. Historical & team
intelligence · 13. Wanyrix Cloud · 14. Fleet & enterprise intelligence ·
15. Product validation & commercialization.

Phases 1–9 are demonstrated by this platform (engine-side execution pending — AUDIT-I8);
phases 10–15 are design/roadmap. Roadmap features never destabilize the shipped core.

## Commercial model

Free 90-day trial · Local / Cloud / Team / Enterprise packaging · billing is strictly
separated from the local deterministic core. Pricing is a configurable proposal pending
market validation — see [`docs/COMMERCIAL.md`](docs/COMMERCIAL.md).

## Governance & brand history

- Work lands only through reviewed PRs referencing their issue (see **Issues & PRs**).
  Release status: **CONDITIONAL GO** (scorecard fixture, 2026-09-17).
- **Ferrix was renamed to Wanyrix** in 2026-09 — see
  `docs/migrations/FERRIX_TO_WANYRIX.md`. Stable finding IDs retain their historic
  `FER-` prefix; new registries use `WAN-`.

## License

Proprietary — © Wanyrix. All rights reserved. No license is granted with this repository.
