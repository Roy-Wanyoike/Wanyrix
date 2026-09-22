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
| `bun run test` | full suite: unit + live API contract tests — **524 tests across 30 files** (523 pass / 1 skip with the dev server up; measured 2026-09-22 via `cd tests && WANYRIX_TEST_BASE_URL=http://localhost:3000 bun test`) |
| `WANYRIX_REQUIRE_LIVE=1 bun test tests/api` | **gate mode for the live API suite (AUD-4)** — an unreachable dev server FAILS with a named error (`tests/api/server-present.test.ts`) instead of skipping. Used by CI's live step and local gate runs. Without the flag, ad-hoc runs stay ergonomic: each live file prints a counted `SKIPPED (n) — server absent` banner |
| `bun run build` / `bun run start` | production build + standalone server (not needed for day-to-day dev) |
| `bash scripts/check-branding.sh` | brand gate — fails on unsanctioned legacy brand tokens (below) |
| `bun run brand:assets` | regenerate raster brand assets (OG card, banner, icons) from `scripts/generate-brand-assets.mjs` |
| `bun run db:push` | apply `prisma/schema.prisma` to the SQLite file — **required once** for the optional durable scan-run sync (see Environment below) |

The API contract tests talk to a **live dev server** on :3000. If it is down, each live
file prints a counted `SKIPPED (n) — server absent` banner and the suite stays green —
EXCEPT in gate mode (`WANYRIX_REQUIRE_LIVE=1`, exported by CI's live API step): then
`tests/api/server-present.test.ts` FAILS with a named error, so a gate run can never go
vacuously green with zero route coverage (AUD-4). Unit tests always run.

## Environment variables

Copy `.env.example` to `.env` (git-ignored) and adjust. All of them are optional
for the deterministic core — the dashboard serves its workspace intelligence
without any configuration.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | for durable sync | SQLite file backing the **optional** server-side scan-run log (`POST /api/wanyrix/scan-runs`). Example: `file:../db/custom.db` (relative paths resolve against `prisma/schema.prisma`; absolute paths also work). Run `bun run db:push` after changing it. Without it configured, scan history still works fully in per-browser localStorage. |
| `NEXT_PUBLIC_SITE_URL` | no | Canonical base URL used to resolve absolute OpenGraph/Twitter image URLs in metadata. Defaults to `https://wanyrix.dev` for local previews. |

The Rust engine (`engine/`) needs a stable Rust toolchain (≥ 1.98) only when you
want to build/run it locally: `cd engine && cargo build && cargo test`. CI builds
and tests it on every push.

## Test harness layout

Tree below is the complete file list (`ls tests/unit tests/api engine/tests/*.rs`, measured
2026-09-22 for issue #111) — keep it exhaustive when adding suites.

```text
tests/
  bun-env.d.ts                  # bun:test types
  unit/                         # 27 files — `bun test unit`
    badge-contrast.test.ts      # honesty-badge WCAG-AA contrast (computed, both themes)
    build-telemetry.test.ts     # build-telemetry store + estimated-range semantics
    cli-dialog-command-set.test.ts # CLI-contract dialog pins the docs/CLI.md command set (issue #109)
    client-export.test.ts       # in-app download exporters (markdown/CSV envelopes)
    doctor-replay.test.ts       # doctor view honest REPLAY degraded state (issue #128)
    engine-meta.test.ts         # engine version pin agrees with engine/Cargo.toml
    explain-grounding.test.ts   # grounding validator / redaction units (ENG-TCA-4)
    finding-diff.test.ts        # A→B run comparison math (compare mode)
    finding-history.test.ts     # per-finding history derivation
    fixtures-and-report.test.ts # finding invariants + wanyrix.report/v1 determinism
    fixtures-barrel.test.ts     # fixture registry barrel exports
    flavors.test.ts             # scorecard/scan-history flavor builders (ENG-TCA-2)
    legacy-migration.test.ts    # AUDIT-I1 P0 regression: storage thunk + copy-before-delete
    license-issue.test.tsx      # license-issue dialog semantics
    muted-contrast.test.ts      # muted-text WCAG-AA contrast (computed, both themes, issue #131)
    palette-filter.test.ts      # command-palette filtering
    palette-search.test.ts      # command-palette data search (crates/findings/PRs, issue #127)
    patch.test.ts               # Gate 19 new-proposal patch semantics
    register.test.ts            # workspace registration bridge behaviors
    registered-workspaces.test.ts # merged workspace registry: registered rows first, fixtures after (QA-5-B-1)
    scan-runs.test.ts           # durable scan-run sync client (idempotent POST)
    simulator-intent.test.ts    # intent parsing + impact math invariants (monotonic, finite, always estimated)
    stores.test.ts              # zustand persist stores, offline behaviors
    wanyrix-workspace-param.test.ts # unified ?workspace= / ?ws= param contract, handler-level (issue #129)
    workspace-count-consistency.test.ts # ONE count selector across surfaces (QA-5-B-3)
    workspace-provenance.test.tsx # fixture/registered provenance badge honesty (QA-5-B-1/B-4)
    workspace-selector.test.ts  # workspace switcher behaviors
  api/                          # 7 files — live contracts against :3000 (counted skip when down; REQUIRE_LIVE=1 fails instead — AUD-4)
    harness.ts                  # shared server probe + counted test registration (AUD-4)
    server-present.test.ts      # vacuous-green gate: REQUIRE_LIVE=1 + server absent → red (AUD-4)
    wanyrix-api.test.ts         # 200 JSON shapes, 400/404/405/413, ws guard, flavors
    wanyrix-export.test.ts      # POST /api/wanyrix/export contract (PR #91)
    wanyrix-license.test.ts     # POST /api/wanyrix/license/issue contract (PR #94)
    wanyrix-scan-runs.test.ts   # POST/GET /api/wanyrix/scan-runs route contracts (AUD-2)
    wanyrix-storage-mutations.test.ts # POST /api/wanyrix/storage/{rebuild,reclaim} contracts (AUD-3)
engine/tests/                   # 22 Rust suites — `cargo test --workspace --offline`
                                # (302 tests / 0 fail / 2 opt-in probes ignored, measured 2026-09-22)
  adversarial.rs                # hostile-input hardening: unicode paths, symlinks, huge/deep trees (issue #71, PR #74)
  ai_cli.rs                     # wanyrix ai — digest-only grounding, https refusal, named errors
  binary_matrix.rs              # release-binary matrix checks (PR #89)
  build_cli.rs                  # instrumented build surface end-to-end
  chaos.rs                      # 9 fault-injection tests: truncated payloads, garbage DBs, dead sockets
  conformance.rs                # engine envelopes vs web contracts (documented divergences 1–4)
  daemon_ipc.rs                 # daemon over the local Unix socket
  doctor_rules.rs               # deterministic finding rules
  entitlement_cli.rs            # activate / entitlement / tier gating (PR #94)
  entitlement_gate_cli.rs       # dispatch-time entitlement gate + CI/dev hatch (AUD-1)
  entitlement_offline_pin.rs    # zero-network activation pinned at source level (PR #94)
  exclude_cli.rs                # --exclude on every scan surface (issue #76, PR #86)
  export_cli.rs                 # export artifacts + sha256 index (issue #91, PR #91)
  human_format.rs               # human-readable output formatting
  perf_probe.rs                 # 2 opt-in perf probes (cargo test --release --test perf_probe -- --ignored)
  pretty_cli.rs                 # --pretty output contract (PR #89)
  stdin_shorthand_cli.rs        # positional `-` stdin sugar for store save / telemetry ingest (QA-4-B-3)
  store_recovery.rs             # SQLite WAL crash-recovery
  sync_cli.rs                   # sync push/pull roundtrip, conflicts, tier downgrade (issue #92, PR #92)
  synth.rs                      # deterministic synth (same seed+count ⇒ byte-identical)
  synth50_fixture.rs            # synth-50 fixture workspace invariants
  telemetry_cli.rs              # redacted telemetry ingest
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
