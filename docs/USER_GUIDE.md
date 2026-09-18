# Wanyrix User Guide

Task-oriented guide for the Wanyrix web platform. Everything here matches the shipped UI
(18-item navigation). Engine-only or future capabilities are labeled **Roadmap**.

## Install & run

```bash
bun install
bun run dev      # http://localhost:3000
```

Requirements: [Bun](https://bun.sh) ≥ 1.x, a modern browser. No database, no accounts, no
network required for the deterministic core.

## Layout

Six navigation groups / 18 views (⌘K opens the command palette):

| Group | Views |
| --- | --- |
| Analyze | Overview · Repositories · Builds·Doctor · Findings |
| Map | Dependencies · Engineering Graph · Architecture · Impact Simulator |
| Debug | Diagnostics · PR Analysis · Experiments |
| Observe | Runtime · History |
| Assist | AI · Policies·Gates · Issues & PRs |
| Manage | Organization · Settings |

## Your first analysis

1. Top bar: pick a workspace (`helios-platform` or `atlas-consortium`).
2. **Overview**: KPI grid, build-time trend, slowest crates. Every KPI shows its
   measurement status — `estimated` figures come from build telemetry × graph simulation.
3. **Builds·Doctor**: press *Run scan*. Each finding shows ID (`FER-*`), severity,
   evidence table with sources, recommendation, verification path. Human ⇄ `--json` modes
   produce identical content.
4. **Findings**: filter all findings by severity/section; open the detail sheet for the
   full evidence bundle.

## Doctor & findings

- Findings are stable-ID diagnoses — never auto-applied changes.
- Evidence items cite sources (`cargo build --timings`, `git log`, `cargo metadata graph`).
- `measurementStatus` on every claim: `measured`, `estimated`, or `verified`.
- Recommended actions feed the **Experiments** loop.

## Dependencies

Duplicate version groups, resolution paths, and an external-dependency inventory with a
dep-risk KPI. Topology lives in **Engineering Graph**.

## Engineering graph & architecture

- **Graph**: interactive dependency backbone; select a crate to see blast radius
  (fan-in / fan-out / downstream). Duplicates appear here too.
- **Architecture**: fan-in/fan-out table, band-direction counts, DFS cycle check. Client
  heuristics are badged **INFERRED**; measured values are not re-labeled.

## Impact simulator

Choose `add-dep`, `edit-file`, or `split-crate`, pick a target, and get the estimated cost
delta. **All simulator output is `estimated`** — planning input, not measurement.

## Experiments & verification

The honesty loop: `estimated → (run experiment) → measured → verified`.

1. **Experiments**: pick a finding marked experiment-eligible (e.g. `FER-BLD-001`).
2. Baseline → candidate → measured delta is recorded (fixture demonstrates the flow;
   real measurement is **Roadmap** with the Rust engine — AUDIT-I8).
3. Verified claims appear with `verified` status across surfaces.

## Safe patches (diff queue)

Recommendations never modify anything. Proposed patches land in the reviewable diff queue
with explicit approval semantics (Gate 19: new-proposal, no fabricated removals).

## AI (grounded reasoning)

- **AI view** and **Explain** dialogs ground every answer in the evidence payload you send.
- The response separates **FACT** (server-rendered from evidence — the model cannot edit
  it) from model **commentary / inference / recommendation / uncertainty**.
- If the model invents a number/status/reference not in the evidence, it is redacted,
  listed under `groundingViolations`, and the answer degrades to the deterministic one.
- Status pill in the top bar shows AI availability (`grounded` / `deterministic`) after
  each explain — no background probing.
- Offline or provider-down → deterministic fallback, clearly labeled. Nothing breaks.

## Offline & online mode

- Offline: the entire deterministic core works; status pill shows *offline* (browser
  connectivity only). AI explain falls back to deterministic answers.
- Online: AI explanations become available; nothing else changes.
- **Synchronization / Cloud history: Roadmap** (disabled today).

## History & runtime

- **History**: scan run log persisted locally (`wanyrix.scan-history/v1` exports).
- **Runtime**: captured async request profile + local engine signals. If a signal is not
  instrumented, the view says so honestly (tracked AUDIT-I8) — no fabricated telemetry.

## Policies·Gates & issues

- **Policies·Gates**: release scorecard (`GO / CONDITIONAL GO / NO-GO`) with per-gate
  evidence; exports `wanyrix.release-scorecard/v1` JSON.
- **Issues & PRs**: traceability board — every issue fixed by a PR.

## Organization & settings

- **Organization** (fixture data, badged): plan overview incl. the 90-day trial model and
  a live policy summary from the gates API.
- **Settings**: theme (light/dark), workspace preference, live legacy
  `ferrix.* → wanyrix.*` migration status, data & privacy pointers, read-only AI status.

## Storage & reset

All persisted state is browser-local: workspace preference, scan history, diff queue,
theme, and store state (migrated from legacy `ferrix.*` keys where present). To reset:
**Settings → data & privacy**, or clear site data in your browser. See
[`docs/PRIVACY.md`](PRIVACY.md).

## Troubleshooting

| Symptom | Meaning / fix |
| --- | --- |
| API tests skip with "unreachable" | dev server not running — `bun run dev` first |
| Explain returns `fallback` + `grounded:false` | AI provider unavailable/timeout → deterministic answer; retry later |
| Explain returns `groundingViolations` | model asserted something not in evidence → answer auto-sanitized; facts remain authoritative |
| Explain `400 unknown finding '…'` | the ID is not in the registry — check spelling (`FER-*`, `WAN-*`) |
| Explain `413 payload too large` | context exceeded 256 KB — send only the evidence fields that matter |
| Views empty after old data present | legacy store migration issue — Settings shows migration status; reset storage |
| Stale chunk error after upgrade | hard-refresh the browser (dev chunk cache) |

## FAQ

**Is my code sent anywhere?** No. Fixtures simulate the engine locally; AI explain sends
only the explicit context payload you submit. No telemetry exists.

**Why do numbers disagree between views?** They shouldn't — if you see contradictions
(e.g. graph vs blast-radius counts), that's a bug class we track (see
`docs/audits/issues/ENG-REGISTRY-tca.md`).

**Can Wanyrix fix my code?** It proposes reviewable patches only (Gate 19). Auto-fix is
**Roadmap** (Phase 9) and would still be approval-gated.

**Does AI upgrade estimates to verified?** Never. Only a recorded experiment does
(Gate 21), and the AI layer is post-validated against exactly that rule.

**Where does the engine live?** Not in this repo — the web platform encodes engine
contracts via fixtures/versioned flavors (AUDIT-I8). CLI/daemon surfaces: **Roadmap**.

**Is it free?** The local deterministic core is free/local-first. Commercial tiers
(90-day trial, Team, Enterprise) are described in [`docs/COMMERCIAL.md`](COMMERCIAL.md)
and are **Roadmap** — nothing is billed today.
