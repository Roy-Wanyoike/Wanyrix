# Wanyrix Web Platform — Architecture

Scope: this repository (web platform + the `engine/` Rust crate). Engine contracts are
encoded as fixtures, versioned API flavors, and the engine's own versioned JSON output
(see "Engine boundary"; persistence/telemetry phases tracked on the issue tracker).

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind 4 · shadcn/ui · TanStack Query · zustand
(persisted) · next-themes · recharts. Dev server `bun run dev` on port 3000; tests via
`bun test`.

## Shell & views

- `src/components/wanyrix/app-shell.tsx` — topbar (workspace switcher, system status pill,
  command palette), sidebar, mobile chips.
- `src/components/wanyrix/nav-registry.ts` — **single source of truth** for navigation
  (`NAV_GROUPS`, `NAV_ITEMS`, `VIEW_TITLES`); sidebar and palette consume it so they cannot
  drift. 6 groups / 19 views over `ViewId` (19 members in `src/lib/wanyrix/types.ts`;
  counts = entries in `nav-registry.ts` / `ViewId` union members, issue #111).
- `src/components/wanyrix/views/*` — one component per view. Two views are legacy-hosted
  overlays promoted to first-class: History (scan-history panel) and Findings (doctor
  findings + detail sheet). Shared loading/error primitives in `shared.tsx`.
- Overlays: explain dialog, CLI dialog, diff-queue sheet, storage dialog, finding sheet,
  notifications — all stateless relative to stores except where noted below.

## State: stores + legacy migration

| Store | File | Persists |
| --- | --- | --- |
| workspace store | `workspace-store.ts` | active workspace id |
| scan store | `scan-store.ts` | scan run history (`wanyrix.scan-history/v1` shape) |
| diff store | `diff-store.ts` | diff queue entries |
| AI status store | `ai-status-store.ts` | last explain outcome (grounded/deterministic) |

- All persisted stores go through `legacy-migration.ts`
  (`createJSONStorage(createMigratingStorage)`): copy-before-delete from legacy `ferrix.*`
  keys, idempotent double-migration, quota-failure recovery, write-through
  canonicalization. Golden-tested in `tests/unit/legacy-migration.test.ts` (regression for
  AUDIT-I1's P0 bug: the storage *thunk* must be passed, not invoked).
- Server data is fetched with TanStack Query (`hooks.ts`); no duplicate fetch caches.

## API routes (23, under `src/app/api/wanyrix/`)

Count = `find src/app/api -name "route.ts" | wc -l` minus the `/api` root (23; 24 total incl.
the root, measured 2026-09-22, issue #111).

`diagnostics` · `doctor` · `engine/build` · `engine/doctor` · `engine/impact` · `experiments` ·
`explain` · `export` · `gates` · `git` · `graph` · `health` · `impact` · `issues` ·
`license/issue` · `pr` · `report` · `scan-runs` · `storage` · `storage/rebuild` ·
`storage/reclaim` · `what-changed` · `workspaces`

(Added since the last audit of this list: `export` — PR #91; `git`, `what-changed` — PR #75;
`engine/impact`, `license/issue` — PR #94.)

### Error semantics

| Status | When |
| --- | --- |
| `400` | by-design contract violations: `explain` without `context`+`question`, with an unknown finding ID, with an unknown `kind`, or with invalid JSON; `report` with unknown `format` or unknown `flavor`; `impact` with unknown `type` or a missing `target` |
| `404` | `impact` with an unknown target; **any workspace-scoped route with an unknown `ws`** → `{error, knownWorkspaces}` (ENG-TCA-1 — silent default-substitution is impossible) |
| `405` | wrong method on GET-only or POST-only surfaces; every 405 carries the RFC 9110 `Allow` header (ENG-TCA-6a; `explain` GET → 405 `Allow: POST` — ENG-TE-1) |
| `413` | `explain` body > 256 KB (rejected before any processing; limit named in the error) |
| `200` | everything else; JSON endpoints always answer `application/json` |

Workspace scoping: every `ws`-accepting surface resolves the param through the shared
`workspaceGuard` (`src/lib/wanyrix/api.ts`) against the same registry `/workspaces` serves
— `doctor`, `graph`, `health`, `diagnostics`, `pr`, `experiments`, `impact`, and `report`
(9 ws-scoped surfaces across 8 route directories: report counts twice for its two
`format` branches; every `flavor` is scoped too). An absent/empty `ws` falls back to the
registry default; `storage`, `gates`, `issues`, and `workspaces` are workspace-independent.
The engine-exec family (`engine/doctor`, `engine/build`, `engine/impact`, `git`,
`what-changed`, `export`) resolves `?ws=`/`?workspace=` against the REGISTERED-workspace
bridge instead (absent → the repo engine crate itself) — same never-wrong-workspace
posture, different registry.

Deterministic GET routes are byte-identical across calls minus timestamps/storage GC
fields. Graph aggregates (`fanIn`/`fanOut`/`downstream`, blast radius, `recompileCrates`)
are computed from the served edge list (`meta.aggregateSource: 'served-edges'`,
ENG-TCA-3 fix) — no hand-typed counts.

## Fixture & contract versioning

- Fixtures live in `src/lib/wanyrix/data.ts` (workspaces `helios-platform` 47 crates /
  `atlas-consortium`; findings `FER-BLD-001…FER-ASY-012`; issues `WAN-*`; experiments
  `EXP-*`; gates). `report.ts` assembles workspace reports from the same getters the
  routes serve — no duplicated data paths.
- Versioned machine flavors (all served over HTTP by `/report` — ENG-TCA-2):
  - `wanyrix.report/v1` — `?format=json`; inner JSON report with structured
    `doctor.buildTime {value, unit}` and `doctor.estimatedAfterFix
    {estimatedRange: {low, high}, status, meaning}` (ENG-TCA-5 — the estimate is a
    projection after the top fix, never a confidence interval around `buildTime`).
  - `wanyrix.markdown/v1` — `?format=markdown` (default); versioned envelope for the
    human-readable report (ENG-TCA-6d).
  - `wanyrix.release-scorecard/v1` — `?flavor=scorecard`; verdict/gates/blocking
    conditions from the shared gates fixture.
  - `wanyrix.scan-history/v1` — `?flavor=scan-history`; the server-side run log is
    **honestly empty** (`runs: []`) — scan runs are a per-browser localStorage log and
    wall-clock durations are never fabricated (Gate 21); the `note` field states this in
    every response.
  - An unknown `flavor` is a 400 naming the valid flavors; a valid `flavor` takes
    precedence over `format`. Client download exporters render the same envelopes.
- IDs are stable across surfaces (`FER-*` findings, `WAN-*` issues, `EXP-*` experiments)
  so the registry, the graph, and the traceability board cross-reference without joins.

## Honesty architecture (implementation view)

- `measurementStatus: measured | estimated | verified` and `confidenceClass` are data, not
  prose; the test suite asserts estimated/verified are never conflated.
- Simulator output is always `estimated`; only experiment records can be `verified`
  (Gate 21). Reports footer states what is simulated vs what a real engine measures.
- Patches are new-proposal diffs behind approval (Gate 19); no auto-apply path exists.
- AI explain (`explain/route.ts` + helpers in `report.ts`):
  1. Contract: `context`+`question` required → 400; GET → 405; body > 256 KB → 413
     (checked via `content-length` and actual bytes, before any model work).
  2. Grounding: stable IDs (`FER-*`/`WAN-*`, bare or in `context.findingId`) resolve
     server-side against the fixture registry; unknown → 400 `unknown finding '…'`.
     Facts are derived **server-side** only from fields actually present; each fact
     carries `derivedFrom` provenance.
  3. Model output is confined to `ai.{commentary,inference,recommendation,uncertainty}`
     (the model's "OBSERVED FACT" text is demoted to commentary — it can never write the
     fact block) plus a static `disclaimer`.
  4. Post-validation (`validateModelGrounding`): every number, status word
     (measured/verified/proven/confirmed), `ID-like` and quoted reference in model text
     must exist in the evidence corpus (derived facts + raw context + resolved registry
     record). Violations → tokens redacted (`⟨removed: not in evidence⟩`),
     `groundingViolations` listed, `grounded:false`, `ok:false`, `error` set, and
     `fallback` carries the deterministic grounded answer.
  5. Provider failure/timeout (30 s race) → same deterministic fallback with honest
     labeling (Gate 18).
  - Best-effort boundary: token-level validation catches invented numbers/statuses/
    references; *semantic* misattribution of an evidence-true number (right value, wrong
    claim) is mitigated by field confinement + rejection, not by understanding — the
    deterministic answer replaces the model text on any violation, and `grounded:true`
    only reflects post-validation success.

## Engine boundary

- The web platform never fabricates engine telemetry. Runtime view shows captured profiles
  + explicit "not instrumented in this environment" empty states (AUDIT-I8).
- Flavors above define what the real engine must emit; routes are thin over fixture
  getters so swapping fixtures for engine calls is a data-layer change, not a contract
  change.
- Roadmap surfaces (CLI, daemon, sync, billing) have no runtime stubs pretending to work —
  they are documented as roadmap (USER_GUIDE/COMMERCIAL), and Organization tier data is
  explicitly badged fixture.

## Verification

`bun run lint` · `bun run typecheck` · `bun run test` (unit + live API contracts;
suite skips API tests with a clear message if :3000 is unreachable).
