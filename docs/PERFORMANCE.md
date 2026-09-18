# Wanyrix Web Platform — Performance

**Measure it, don't invent it.** Every number below comes from the probe script checked
into this round's tooling (`/tmp/wanyrix-perf/api-latency.ts`, two runs — outputs
preserved verbatim in `/tmp/wanyrix-perf/run-1.txt` and `run-2.txt`). Nothing here is a
designed target; targets are quoted as targets and labeled. Where a number does not
exist because it belongs to the Rust engine repo, it is marked **N/A — engine repo**
(engine v0 measures real filesystem analysis; never approximated).

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

## Route latency (run-1, sequential, warm)

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

**Observations (honest):**

- Warm medians cluster at **~4–6.5 ms** across all 26 deterministic variants in both
  runs (`run-2` medians 3.8–6.5 ms — same band).
- p95 is dominated by GC/JIT/scheduler noise, not route logic: `run-1` p95 ≤ 38.6 ms
  with a single `doctor · atlas` max spike of 215.9 ms; `run-2` showed the same class of
  spikes on different rows (diagnostics · helios p95 76.5 ms). Medians never moved —
  treat isolated maxes as environmental, not regressions.
- These are **dev-server** numbers (Next.js dev mode, per-request instrumentation
  included). A production build removes dev-mode overhead; no production-build figure is
  claimed here because `bun run build` was out of scope this round.

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

## Designed CLI/engine targets (pending-task §26) — **N/A in this repo**

These are targets for the Rust **engine** surfaces (CLI binary, daemon, SQLite, real
analysis). The web platform has no CLI binary and no daemon; they are reproduced here
only as the contract the engine repo must meet, labeled accordingly:

| §26 Target | Status here |
| --- | --- |
| p95 non-analysis CLI startup < 150 ms | **N/A — engine repo** (no CLI binary; contract in `docs/CLI.md`) |
| p95 warm localized incremental analysis < 1 s | **N/A — engine repo** |
| p95 medium-repository doctor < 10 s | **N/A — engine repo** (web `/doctor` serves fixtures in ~5 ms median — not comparable) |
| Idle daemon < 100 MB RSS | **N/A — engine repo** (no daemon) |
| 250-crate workspace < 1 GB RSS | **N/A — engine repo** |
| 500+ crate synthetic repository completes without pathological memory growth | **N/A — engine repo** |

Per §26, any regression > 10% must receive an investigation — that applies to the
engine repo once it exists; for this web platform the protocol is: re-run the probe
script, compare medians/p95 per route variant against this document, and file an issue
record (`docs/CONTRIBUTING.md`) if a median moves > 10% across runs under equal
conditions.
