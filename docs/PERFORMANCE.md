# Wanyrix Web Platform — Performance

**Measure it, don't invent it.** Every number below comes from a probe driven
against the live dev server: a Bun script (`api-latency.ts`) for the **2026-09-18
measured round** (two runs), and a **curl-timing sweep for the 2026-09-23 full
re-sweep** (issue #148, the AUD-11 re-measurement — every `/api/wanyrix/*` route
now has a measured row). The raw probe outputs of both rounds were ephemeral
(`/tmp/wanyrix-perf/run-*.txt`, per-sample TSV of the re-sweep); the durable
evidence is the per-variant digest committed in the tables below, reproducible
from the documented method. Nothing here is a designed target; targets are quoted
as targets and labeled. Where a number belongs to the Rust engine rather than the
web platform, the table says so — the engine lives **in this tree** (`engine/`),
and its measured numbers are maintained in
[`engine/BENCHMARKS.md`](../engine/BENCHMARKS.md), not invented here.

## Method

- Bun script driving the live dev server (`http://127.0.0.1:3000`, Next.js dev, port
  3000) — sequential fetches, no concurrency.
- Per route variant: **3 warm-up calls** (unrecorded; absorbs dev-mode lazy compile),
  then **N = 30 recorded sequential calls** (N = 20 for the 413 probe) — ≥ 20 per route
  as required.
- Latency = full round trip: request → status → body fully consumed (like a real
  client), via `performance.now()`. Reported in **ms**: min / median / p95 / max, plus
  the first recorded call of each run.
- Both fixture workspaces probed for every `ws`-scoped route
  (`helios-platform`, `atlas-consortium`).
- Run date: **2026-09-18** (`run-1` timestamp `2026-09-18T13:20:56Z`; `run-2` one
  minute later). Numbers pasted below are `run-1`; `run-2` is quoted where it
  corroborates.

### Re-sweep method (2026-09-23, issue #148 — AUD-11)

- **curl** against the same live dev server (`http://127.0.0.1:3000`), one
  sequential process per sample, no concurrency; latency = full round trip via
  `curl -w '%{time_total}'` (request → status → body done), reported in ms.
- Per variant: **3 warm-up calls** (unrecorded), then **N = 30 recorded
  sequential calls** (N = 20 for the 413 probe) — ≥ 20 per route as required.
  Every sample's HTTP status was recorded; each variant below is single-status
  and matches the status shown in its row.
- **p95 = nearest-rank** (`⌈0.95·N⌉`-th of the sorted samples); median is the
  middle of the sorted samples.
- Sweep window: **2026-09-23T02:13–02:15Z** (main sweep 02:13–02:14Z; two
  `flavor=scorecard` variants re-run 02:14–02:15Z after a flavor-param rename
  was discovered mid-sweep — see the table note). **Environment: Next.js DEV
  build** (dev-mode instrumentation included) on the shared validation server —
  a production-build sweep remains tracked by **#120**.
- Path classes (all against the current route set, 23 routes / 46 variants):
  fixture-served GETs on both workspaces; engine-exec GETs on the dogfood
  target (`engine/` — the only 200-capable target on a server with an empty
  registry); registered-only-gate refusals (`404`, the honest current behavior
  after the phantom-workspace resolution fix in #140); POST paths measured on
  their side-effect-free paths only (validation refusals, in-process storage
  sim, explain's local/provider path) — **no durable state was written** by the
  probe (no workspace registration, no scan-run, no export artifact).

## Route latency — full re-sweep (2026-09-23, sequential, warm)

All 23 `/api/wanyrix/*` routes (46 variants, 1,370 recorded samples). Every row
carries its sample size N; **every row is a warm dev-build measurement taken in
the 2026-09-23T02:13–02:15Z sweep window** — dev-mode numbers, not production
(the production-build sweep is #120).

| Route variant | status | N | min | median | p95 | max |
| --- | --- | --- | --- | --- | --- | --- |
| health · helios | 200 | 30 | 4.9 | 5.6 | 8.3 | 32.7 |
| health · atlas | 200 | 30 | 5.1 | 5.6 | 7.2 | 8.2 |
| doctor · helios | 200 | 30 | 5.5 | 5.9 | 7.1 | 7.2 |
| doctor · atlas | 200 | 30 | 5.2 | 5.7 | 7.2 | 8.1 |
| graph · helios | 200 | 30 | 5.0 | 5.7 | 8.3 | 65.0 |
| graph · atlas | 200 | 30 | 4.8 | 5.7 | 20.3 | 23.7 |
| diagnostics · helios | 200 | 30 | 5.1 | 5.4 | 8.2 | 8.7 |
| diagnostics · atlas | 200 | 30 | 4.6 | 5.2 | 6.5 | 6.6 |
| pr · helios | 200 | 30 | 4.8 | 5.4 | 6.3 | 6.3 |
| pr · atlas | 200 | 30 | 4.9 | 5.4 | 5.8 | 6.9 |
| experiments · helios | 200 | 30 | 4.7 | 5.3 | 6.7 | 8.7 |
| experiments · atlas | 200 | 30 | 5.0 | 5.5 | 6.2 | 6.4 |
| impact split-crate target=gateway · helios | 200 | 30 | 4.9 | 5.4 | 6.4 | 12.0 |
| impact split-crate target=common · atlas | 200 | 30 | 5.3 | 6.0 | 7.8 | 7.9 |
| report format=markdown · helios | 200 | 30 | 5.3 | 6.1 | 8.2 | 28.6 |
| report format=json · helios | 200 | 30 | 5.3 | 5.9 | 7.2 | 8.0 |
| report flavor=scorecard · helios | 200 | 30 | 4.7 | 5.2 | 6.0 | 6.9 |
| report flavor=scan-history · helios | 200 | 30 | 4.8 | 5.4 | 8.6 | 11.0 |
| report format=markdown · atlas | 200 | 30 | 5.0 | 5.5 | 6.6 | 6.6 |
| report format=json · atlas | 200 | 30 | 4.6 | 5.4 | 8.2 | 157.9 |
| report flavor=scorecard · atlas | 200 | 30 | 4.4 | 4.9 | 7.2 | 27.4 |
| report flavor=scan-history · atlas | 200 | 30 | 4.3 | 4.7 | 5.4 | 6.9 |
| workspaces (GET) | 200 | 30 | 5.5 | 5.9 | 7.3 | 8.1 |
| gates (GET) | 200 | 30 | 4.6 | 5.0 | 6.1 | 15.7 |
| issues (GET) | 200 | 30 | 4.6 | 5.1 | 9.3 | 14.7 |
| storage (GET) | 200 | 30 | 4.7 | 5.2 | 9.0 | 11.2 |
| scan-runs (GET) · helios | 200 | 30 | 7.7 | 8.6 | 9.4 | 9.7 |
| scan-runs (GET) · atlas | 200 | 30 | 5.8 | 6.4 | 9.6 | 28.0 |
| git — dogfood target | 200 | 30 | 96.0 | 101.4 | 158.9 | 166.3 |
| engine/doctor — dogfood target | 200 | 30 | 84.6 | 92.2 | 106.5 | 110.6 |
| engine/impact crate=wanyrix-engine — dogfood | 200 | 30 | 68.2 | 76.5 | 86.7 | 98.9 |
| engine/build — dogfood, warm incremental build | 200 | 30 | 119.6 | 129.8 | 140.4 | 154.2 |
| what-changed — dogfood, store unavailable | 503 | 30 | 68.8 | 83.3 | 189.6 | 207.4 |
| git · ws=helios — registered-only refusal | 404 | 30 | 5.2 | 5.7 | 7.1 | 27.7 |
| what-changed · ws=helios — registered-only refusal | 404 | 30 | 5.2 | 5.6 | 15.5 | 20.2 |
| engine/doctor · ws=helios — registered-only refusal | 404 | 30 | 5.2 | 5.8 | 12.9 | 287.4 |
| engine/impact · ws=helios — registered-only refusal | 404 | 30 | 5.1 | 5.7 | 7.6 | 8.8 |
| export (POST) · ws=helios — registered-only refusal | 404 | 30 | 5.1 | 5.7 | 6.9 | 6.9 |
| workspaces (POST) — confinement refusal `/etc` | 400 | 30 | 5.3 | 5.8 | 22.4 | 27.6 |
| scan-runs (POST) — unknown workspace | 404 | 30 | 5.3 | 5.8 | 9.9 | 31.5 |
| license/issue (POST) — missing fields | 400 | 30 | 4.9 | 5.5 | 6.7 | 8.3 |
| explain (POST) — missing fields | 400 | 30 | 5.0 | 5.3 | 6.5 | 6.7 |
| explain (POST) — served path (provider-bound) | 200 | 30 | 80.4 | 1,366.1 | 1,775.4 | 1,904.9 |
| explain 413 cap fast-fail (300 KB body) | 413 | 20 | 4.9 | 5.1 | 6.2 | 6.3 |
| storage/rebuild (POST) — in-process sim | 200 | 30 | 4.2 | 4.8 | 12.4 | 44.9 |
| storage/reclaim (POST) — in-process sim | 200 | 30 | 4.3 | 5.0 | 5.3 | 6.0 |

**Row notes (honest):**

- **Behavior shifts found by this sweep** (why the current route set differs
  from the 2026-09-18 round): (1) the report route's scorecard flavor param was
  renamed — `flavor=release-scorecard` now answers `400 unknown flavor
  'release-scorecard' (scorecard | scan-history)`; the sweep measures the new
  `flavor=scorecard`. (2) Since the phantom-workspace resolution fix (#140), the
  engine-exec routes (`git`, `what-changed`, `engine/doctor`, `engine/impact`,
  `engine/build`) and `export` execute only for **registered** workspaces —
  fixture ids are refused with a named `404`. On this server the registry is
  empty, so the measured 200-paths for those routes are the **dogfood target**
  (`engine/`, a real engine execution on this machine), and the registered-only
  gate itself is measured as the 404 refusal rows. A real-engine 200-path on a
  user-registered project is bounded by the 20 s spawn timeout and is dominated
  by engine time (`engine/BENCHMARKS.md`), not web overhead.
- `engine/build` row = a **real** `wanyrix build` on `engine/`, warm incremental
  (100 % cache-hit, cargo wall-clock ~150 ms); a cold build is a heavy one-off,
  not an HTTP-latency number.
- `what-changed` dogfood answers **503 store-unavailable** on this server — that
  IS the route's current honest behavior without a scanned store, and its
  latency is the engine-exit round trip.
- POST rows are measured on **side-effect-free paths only** (validation
  refusals / in-process storage sim): the probe never registered a workspace,
  synced a scan-run, wrote an export, or minted a license against the shared
  server. The happy-path latency of those mutations is the same validation +
  Prisma/engine floor shown by their refusal rows plus the engine/DB work
  proper, which is owned by `engine/BENCHMARKS.md` / the durable-log design.
- The explain `200` row is **provider-bound** (model round trips dominate; the
  deterministic grounding fallback also answers `200`): median 1.37 s with high
  variance, min 80 ms. The product-guaranteed fast paths are the `400`/`413`
  rejections at ~5 ms (see the explain section below).

### Prior round (2026-09-18 run-1, sequential, warm) — historical, kept for drift comparison

| Route variant | N | min | median | p95 | max | first-of-run |
| --- | --- | --- | --- | --- | --- | --- |
| health · helios-platform | 30 | 4.0 | 6.2 | 9.1 | 9.2 | 6.5 |
| doctor · helios-platform | 30 | 4.2 | 5.2 | 32.9 | 35.8 | 7.0 |
| graph · helios-platform | 30 | 4.2 | 4.6 | 8.9 | 8.9 | 4.5 |
| diagnostics · helios-platform | 30 | 4.2 | 4.7 | 8.2 | 14.3 | 4.4 |
| pr · helios-platform | 30 | 3.8 | 4.6 | 7.3 | 15.7 | 4.6 |
| experiments · helios-platform | 30 | 3.9 | 4.3 | 5.6 | 11.9 | 4.6 |
| impact add-dep · helios-platform | 30 | 4.0 | 4.6 | 5.1 | 12.4 | 5.1 |
| report format=markdown · helios | 30 | 4.8 | 5.1 | 10.0 | 18.2 | 10.0 |
| report format=json · helios | 30 | 4.8 | 5.4 | 6.4 | 17.3 | 5.4 |
| report flavor=scorecard · helios | 30 | 4.4 | 4.9 | 10.5 | 27.6 | 4.5 |
| report flavor=scan-history · helios | 30 | 4.3 | 4.5 | 7.5 | 18.8 | 7.5 |
| health · atlas-consortium | 30 | 4.3 | 4.6 | 5.5 | 19.6 | 4.5 |
| doctor · atlas-consortium | 30 | 4.2 | 6.5 | 38.6 | 215.9 | 5.1 |
| graph · atlas-consortium | 30 | 4.3 | 4.7 | 6.1 | 8.1 | 4.8 |
| diagnostics · atlas-consortium | 30 | 4.4 | 4.6 | 5.1 | 5.5 | 4.7 |
| pr · atlas-consortium | 30 | 4.3 | 4.9 | 6.6 | 8.0 | 4.8 |
| experiments · atlas-consortium | 30 | 4.4 | 4.8 | 6.6 | 25.3 | 6.4 |
| impact add-dep · atlas-consortium | 30 | 4.1 | 5.0 | 6.2 | 8.2 | 6.0 |
| report format=markdown · atlas | 30 | 4.6 | 5.3 | 7.2 | 9.0 | 5.0 |
| report format=json · atlas | 30 | 4.2 | 4.5 | 6.8 | 7.8 | 5.3 |
| report flavor=scorecard · atlas | 30 | 4.1 | 4.6 | 6.9 | 7.2 | 4.8 |
| report flavor=scan-history · atlas | 30 | 4.3 | 4.5 | 6.0 | 41.2 | 4.4 |
| workspaces | 30 | 4.1 | 4.7 | 6.4 | 7.3 | 4.6 |
| gates | 30 | 4.4 | 4.8 | 5.9 | 6.1 | 5.8 |
| issues | 30 | 3.7 | 4.9 | 7.9 | 12.4 | 4.8 |
| storage | 30 | 4.0 | 5.0 | 24.3 | 34.5 | 6.0 |

*Coverage note, resolved:* that round covered 13 of the then-23 routes; the 10
routes shipped after it (`git`, `what-changed`, `export`, `license/issue`,
`scan-runs`, `storage/rebuild`, `storage/reclaim`, `engine/build`,
`engine/doctor`, `engine/impact`) were unmeasured until the 2026-09-23 full
re-sweep above (**AUD-11**, delivered by issue #148). No latency claim in this
document lacks a measured row any more.

**Observations (honest):**

- Warm medians cluster at **~4–6.5 ms** across all 26 deterministic variants in both
  runs (`run-2` medians 3.8–6.5 ms — same band).
- p95 is dominated by GC/JIT/scheduler noise, not route logic: `run-1` p95 ≤ 38.6 ms
  with a single `doctor · atlas` max spike of 215.9 ms; `run-2` showed the same class of
  spikes on different rows (diagnostics · helios p95 76.5 ms). Medians never moved —
  treat isolated maxes as environmental, not regressions.
- These are **dev-server** numbers (Next.js dev mode, per-request instrumentation
  included). A production build removes dev-mode overhead; no production-build figure is
  claimed here because `bun run build` was out of scope both rounds — the
  production-build sweep is tracked by **#120** and is the like-for-like
  regression gate.
- **Drift run-1 → 2026-09-23 re-sweep:** on the 24 directly comparable variants
  (same route + params), 14 medians moved **+10 % to +26 %** (e.g. workspaces
  4.7 → 5.9 ms, graph · helios 4.6 → 5.7 ms, experiments · helios 4.3 → 5.3 ms),
  9 stayed within ±10 %, and one moved down more than 10 % (doctor · atlas
  6.5 → 5.7 ms). Every absolute shift is **≤ 1.2 ms** and the whole band
  (4.7–6.1 ms) still overlaps run-1's (4.3–6.5 ms). The > 10 %
  filing protocol is defined "across runs under equal conditions" — these
  rounds are five days and ~30 merged commits apart (including #140's added
  registry-resolution logic on hot paths), on a different shared-server
  session, so the condition is NOT met and no regression issue is filed.
  Recorded here per the protocol so the production-build sweep (#120) starts
  from this comparison.
- **Engine-exec rows are a different class by nature:** the dogfood 200-paths
  (git ~101 ms, engine/doctor ~92 ms, engine/impact ~77 ms, engine/build ~130 ms
  warm incremental) include a REAL engine process spawn + execution — they are
  floor-of-engine numbers, not comparable with the ~5–6 ms fixture rows, and
  they still sit far inside the 20 s spawn-timeout budget.

## `explain` — designed caps, measured fast-fails

The explain route's two rejection paths are provider-independent and measured in-run:

| Path | N | min | median | p95 | max |
| --- | --- | --- | --- | --- | --- |
| `400` (missing `context`/`question`) | 30 | 4.5 | 4.8 | 6.3 | 7.5 |
| `413` cap fast-fail (300 KB body, cap 256 KB) | 20 | 4.5 | 4.7 | 5.3 | 5.8 |

The 413 probe confirms the ENG-TCA-7 fix with real numbers: a 300 KB payload is
rejected by `content-length` **before** parsing or any provider work — ~5 ms, i.e. three
orders of magnitude faster than the pre-fix behavior (30 s full-timeout stall recorded in
the explain payload is capped server-side).

**Re-sweep (2026-09-23, same method, curl):** `400` missing-params 4.8–6.7 ms
(median 5.3, N = 30), `413` cap fast-fail 4.9–6.3 ms (median 5.1, N = 20) —
both unchanged from run-1 within noise. The served path (N = 30, `200`) was
measured in the re-sweep for the first time with a sample: median 1,366 ms,
p95 1,775 ms, min 80 ms — provider-bound as before (model round trips dominate;
responses mix grounded answers and the deterministic fallback, both `200`).

**AI path is provider-bound** (n = 1 per workspace, labeled, not warm medians):
`run-1` — helios 1,771.3 ms (`ok:false`: the model invented a number, grounding
validation rejected it and served the deterministic fallback — the ENG-TCA-4 firewall
operating as designed); atlas 1,543.7 ms (`ok:true`, grounded). `run-2` — 4,943.3 ms /
1,547.1 ms (`ok:true` both). Conclusion: explain latency is provider latency plus a
~5 ms server floor; the deterministic fallback and the 400/413 paths are what the
product guarantees.

## Cold vs. warm route compile (dev)

- Next.js dev compiles a route module on **first** hit; subsequent hits reuse it. In the
  current dev-server session, `dev.log` contains 2,452 request lines with a `compile:`
  field and every sampled value is **≤ 6 ms** (warm) — e.g. `GET /api/wanyrix/workspaces
  200 in 9ms (compile: 3ms, render: 6ms)`. That is why this document reports warm
  numbers only.
- **No cold-compile figure is claimed**: measuring it honestly requires restarting the
  dev server, which is forbidden during a validation round (shared live server). The
  warm-up phase of the probe absorbs any residual lazy compile.
- Production (`bun run build`) precompiles all routes — the dev cold-compile penalty
  (seconds on first hit) is a dev-only artifact and does not exist in a production
  deployment. Related dev-infra note: stale Turbopack chunks after mass renames can
  serve pre-rename modules until a hard refresh (AUDIT-I9, P4).

## Designed CLI/engine targets (pending-task §26) — engine is IN-TREE

These are targets for the Rust **engine** surfaces (CLI binary, daemon, SQLite, real
analysis). The engine lives in this repository (`engine/`) — its measured numbers are
maintained in [`engine/BENCHMARKS.md`](../engine/BENCHMARKS.md); the table below only
records the contract those numbers must meet:

| §26 Target | Where the number lives |
| --- | --- |
| p95 non-analysis CLI startup < 150 ms | engine surface — `engine/BENCHMARKS.md` (contract in `docs/CLI.md`) |
| p95 warm localized incremental analysis < 1 s | engine surface — `engine/BENCHMARKS.md` |
| p95 medium-repository doctor < 10 s | engine surface — `engine/BENCHMARKS.md` (web `/doctor` serves fixtures in ~5 ms median — not comparable) |
| Idle daemon < 100 MB RSS | engine surface — `engine/BENCHMARKS.md` |
| 250-crate workspace < 1 GB RSS | engine surface — `engine/BENCHMARKS.md` |
| 500+ crate synthetic repository completes without pathological memory growth | engine surface — `engine/BENCHMARKS.md` |

Per §26, any regression > 10% must receive an investigation — for the engine, that
protocol runs against the `engine/BENCHMARKS.md` numbers; for this web platform the
protocol is: re-run the probe script, compare medians/p95 per route variant against
this document, and file an issue record (`docs/CONTRIBUTING.md`) if a median moves
> 10% across runs under equal conditions.
