# Wanyrix User Guide

Task-oriented guide for the Wanyrix web platform. Everything here matches the shipped UI
(19-item navigation — entries in `src/components/wanyrix/nav-registry.ts`, issue #111).
Engine-only or future capabilities are labeled **Roadmap**.

## Install & run

```bash
bun install
bun run dev      # http://localhost:3000
```

Requirements: [Bun](https://bun.sh) ≥ 1.x, a modern browser. No database, no accounts, no
network required for the deterministic core.

## Layout

Six navigation groups / 19 views (⌘K opens the command palette; group names as shipped in
`nav-registry.ts`):

| Group | Views |
| --- | --- |
| Intelligence | Overview · Repositories · Builds·Doctor · Findings |
| Structure | Dependencies · Engineering Graph · Architecture · Impact Simulator |
| Verification | Diagnostics · PR Analysis · Experiments |
| Observability | Runtime · History |
| Reasoning & Governance | AI · Policies·Gates · Issues & PRs |
| Workspace | Organization · Plans · Settings |

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
2. Baseline → candidate → measured delta is recorded (the dashboard board is
   fixture-backed; the shipped in-repo engine v0.9.0 measures REAL builds via
   `wanyrix experiment measure` — see [`docs/CLI.md`](CLI.md)).
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
- **Synchronization**: scan runs also sync to the optional durable server log
  (below). Everything else stays local-first.

## History & runtime

- **History**: scan run log persisted locally (`wanyrix.scan-history/v1` exports — in-app
  download, and `GET /api/wanyrix/report?flavor=scan-history&ws=…` over HTTP; the
  report-flavor server log there is honestly empty because runs live in *your* browser's
  localStorage, and durations are never fabricated).
- **Durable server sync**: every completed run is also fire-and-forget POSTed to
  `POST /api/wanyrix/scan-runs` (`wanyrix.scan-runs/v1`) — an idempotent, durable
  SQLite log that survives browser wipes. The History view's *Durable server sync*
  panel shows both sides (browser log with per-run `synced / syncing / failed /
  not synced` badges ↔ server log verbatim) and offers a **Sync unsynced** backfill
  action. The server stores exactly what your browser measured and POSTed — it never
  fabricates runs (Gate 21), and a sync failure never blocks or loses a local run.
  Runs newer than R7 also carry their **findings fingerprint** (the sorted unique
  finding ids the payload contained, capped at 400 with an explicit truncated flag),
  so finding-level diffs survive browser wipes too.
- **Compare two runs**: toggle **Compare** in the Scan history panel, then pick any
  two runs (A then B — a third click slides the window, clicking a selected run
  removes it). You get measured A→B deltas (findings, severities, build, wall clock,
  with direction coloring and % vs A), plus — when both runs carry a fingerprint — a
  **finding-id granularity diff**: `N stable · +M new in B · −K resolved`. Every new
  or resolved finding id is listed; clicking a chip opens its detail drawer **only
  if that finding exists in the current payload** — otherwise an honest toast says
  so. Trigger filter chips (all / doctor view / topbar / ⌘K) narrow both the run list
  and the trend bars; hovering a row reveals a copy-run-id button.
- **Exports**: the Export dropdown offers the machine envelope
  (`wanyrix.scan-history/v1` JSON), a Markdown run table, and a CSV run table
  (includes `fingerprint_count` / `fingerprint_truncated` columns) — all built
  client-side, nothing leaves the browser (Gate 28).
- **Runtime**: captured async request profile + local engine signals. If a signal is not
  instrumented, the view says so honestly (tracked AUDIT-I8) — no fabricated telemetry.

## Policies·Gates & issues

- **Policies·Gates**: release scorecard (`GO / CONDITIONAL GO / NO-GO`) with per-gate
  evidence; exports `wanyrix.release-scorecard/v1` JSON (in-app download, and the same
  envelope is served over HTTP: `GET /api/wanyrix/report?flavor=scorecard&ws=…`).
- **Issues & PRs**: traceability board — every issue fixed by a PR.

## Organization, Plans & settings

- **Organization** (fixture data, badged): plan overview incl. the 90-day trial model and
  a live policy summary from the gates API.
- **Plans**: tiers & licensing — the permanently free local core plus the paid
  Team/Enterprise structure; sandbox license issuance returns the REAL ed25519-signed
  token verbatim, honestly labeled `estimated` (no payment method — never a simulated
  purchase), with an honest 503 when no signing key is configured; includes the offline
  `wanyrix activate` hint for issued tokens (engine v0.9.0, PR #94).
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
the project audit history).

**Can Wanyrix fix my code?** It proposes reviewable patches only (Gate 19). Auto-fix is
**Roadmap** (Phase 9) and would still be approval-gated.

**Does AI upgrade estimates to verified?** Never. Only a recorded experiment does
(Gate 21), and the AI layer is post-validated against exactly that rule.

**Where does the engine live?** In this repo — `engine/` carries `wanyrix-engine` v0.9.0:
the real Rust binary with 23 command surfaces (`doctor · graph · health · analyze ·
dependencies · build · experiment · events · ai · git · impact · what-changed · export ·
sync · activate · entitlement · license · store · daemon · telemetry · synth · init ·
status`), documented command-by-command in [`docs/CLI.md`](CLI.md) and buildable with
`cd engine && cargo build --release`. The web platform mirrors the same versioned payloads
over HTTP, and the in-app **CLI contract** dialog pins the command set, the flags, and the
exit codes.

**Is it free?** The local deterministic core is free/local-first. The Plans view shows the
tier structure (Team, Enterprise); nothing is billed today.

**Counts methodology:** views (19) = entries in `src/components/wanyrix/nav-registry.ts`;
engine command surfaces (23) = the `Command` enum in `engine/src/cli.rs`; both measured
2026-09-22 for issue #111.
