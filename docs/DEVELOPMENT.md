# Wanyrix Web Platform — Development Guide

Everything needed to build and verify this repo locally. For architecture context read
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md) first (shell/views, stores, API error
semantics, honesty architecture); for workflow rules see
[`docs/CONTRIBUTING.md`](CONTRIBUTING.md).

## Prerequisites

- **[Bun](https://bun.sh) ≥ 1.x** — the only toolchain gate (`bun run dev`, `bun test`,
  and script execution all go through bun).
- A modern browser. No database, no Docker, no accounts.
- `bun install` once; `bun run dev` serves `http://localhost:3000` (logs tee'd to
  `dev.log`).

## Commands

| Command | What it does |
| --- | --- |
| `bun run dev` | Next.js dev server on :3000, output tee'd to `dev.log` |
| `bun run lint` | ESLint over the repo — must stay clean |
| `bun run typecheck` | `tsc --noEmit` (scopes to product code + `tests/`; `examples/`/`skills/` scaffolding excluded) |
| `bun run test` | full suite: unit + live API contract tests (currently **138 tests / 2,871 assertions**, ~2 s) |
| `bun run build` / `bun run start` | production build + standalone server (not needed for day-to-day dev) |
| `bash scripts/check-branding.sh` | brand gate — fails on unsanctioned legacy brand tokens (below) |
| `bun run db:*` | Prisma scaffold scripts — **unused by product flows**, listed for completeness |

The API contract tests talk to a **live dev server** on :3000; if it is down the API
suite skips itself with a clear message instead of failing (unit tests always run).

## Test harness layout

```text
tests/
  bun-env.d.ts                  # bun:test types
  unit/
    legacy-migration.test.ts    # AUDIT-I1 P0 regression: storage thunk + copy-before-delete protocol
    stores.test.ts              # zustand persist stores, offline behaviors
    simulator-intent.test.ts    # intent parsing + impact math invariants (monotonic, finite, always estimated)
    fixtures-and-report.test.ts # finding invariants + wanyrix.report/v1 determinism
    patch.test.ts               # Gate 19 new-proposal patch semantics
    flavors.test.ts             # scorecard/scan-history flavor builders (ENG-TCA-2)
    explain-grounding.test.ts   # grounding validator / redaction units (ENG-TCA-4)
  api/
    wanyrix-api.test.ts         # live contracts: 200 JSON shapes, 400/404/405/413, ws guard, flavors
```

Conventions: workspace ids are discovered via `/api/wanyrix/workspaces` (never
hardcoded blindly), no real browser storage in unit tests (in-memory fakes only), and
determinism is asserted byte-level where timestamps allow.

## Brand gate

`scripts/check-branding.sh` scans tracked text files for legacy brand tokens (the
exact pattern constant lives in the script; case-insensitive). A small whitelist covers
the intentional legacy mentions — `legacy-migration.ts` + its golden test, the Settings
migration-status panel, this repo's own process scripts, and the historic finding-id
prefix rule called out in docs. New code must not
add legacy tokens; run the gate before every PR.

## Contract-fix conventions

- **One issue = one PR.** Issues are filed on the GitHub tracker (14-field template —
  `docs/CONTRIBUTING.md`) and closed by a focused PR whose message references the ID
  (`Closes #N`), so merging closes the issue automatically.
- A contract fix lands **with the tests that pin it** (e.g. the ENG-TCA-1 workspace
  guard shipped with unknown-ws 404 contract tests; ENG-TCA-2 flavors with unit + live
  contract tests). A fix without a pinning test is incomplete.
- Additive API changes preferred: new params/envelopes must not break existing
  consumers (the `flavor` param was added without touching the default report).
- Error-code hygiene: missing-param → `400`, unknown resource → `404`, wrong method →
  `405` with `Allow`, oversized → `413`. If you add a route, use the shared helpers in
  `src/lib/wanyrix/api.ts` (`resolveWorkspace`, `methodNotAllowed`, the 405 factories).

## Fixture data conventions

Fixtures live in `src/lib/wanyrix/data.ts` and simulate the Rust engine. Rules that
keep the honesty guarantees intact:

1. **Derived-from-edge-list rule (ENG-TCA-3).** Every per-node/per-workspace aggregate —
   `fanIn`, `fanOut`, `downstream`, blast radius, `recompileCrates` — must be computed
   from the served `edges` array, never hand-typed. `GraphPayload.meta` states
   `aggregateSource: 'served-edges'` and `scope: 'backbone-subset'`; the served node/edge
   set is the analysis backbone subset of the full graph and `meta.note` explains the
   subset semantics. Cross-checks (`meta.workspaceCrates` agrees with `/health` and
   `/workspaces`) must hold.
2. **Honesty labels are data.** Every quantitative claim carries `measurementStatus`
   and `confidenceClass`; simulator output is always `estimated`; only experiment
   records may be `verified` (Gate 21). Never encode an estimate as a measurement.
3. **Versioned envelopes are contracts.** If a fixture feeds a flavor
   (`wanyrix.report/v1`, `wanyrix.release-scorecard/v1`, `wanyrix.scan-history/v1`,
   `wanyrix.markdown/v1`), keep the builder field-for-field in sync with its tests —
   changes require a schema-version decision, not silent drift.
4. **Never fabricate telemetry.** If a real engine value does not exist in this repo,
   render an explicit "not instrumented / simulated" state (AUDIT-I8) — an empty honest
   value beats an invented number.
5. **Per-workspace variation must be real variation.** Data differs between
   `helios-platform` and `atlas-consortium` (crates, findings, catalogs); anything
   identical across workspaces should be workspace-independent by design, not
   copy-pasted.
