# ENG-REGISTRY-t3c — perf + regression QA fragment (Task 3-c)

**Agent:** QA/SRE engineer · **Date:** 2026-09-18 · **Task ID:** 3-c (pending-task §26 performance validation applied to the web platform + §48 parallel QA)
**Method:** `bun run test` / `bun run lint` / `bunx tsc --noEmit`; agent-browser sweep in a dedicated session (`t3c-qa`, closed after); bun perf harness under `/tmp/wanyrix-perf/` (server-observed render times parsed from `dev.log`); curl + in-browser localStorage measurement.
**Duplicate check:** ISSUE_REGISTRY (AUDIT-I1…I10, ENG-TCA-1…7, ENG-TCB-1…2, ENG-TE-1) reviewed before filing. GitHub unreachable → local records only.

## Issues filed

**None.** Nothing in this round's scope was genuinely broken or over budget. All
regression gates green, all 24 measured route/workspace variants within the §26
dev-render budget by two orders of magnitude, both fast-fail error paths fast and
honest, storage bounded on both surfaces measured. Per the severity policy, no
record was invented to justify the round.

## Regression sweep results (§48)

| Step | Verdict | Evidence |
| --- | --- | --- |
| `bun run test` | **PASS** | 138 pass / 0 fail / 0 skip · 2,871 expect() · 8 files · 1.61 s |
| `bun run lint` | **PASS** | exit 0, no output |
| `bunx tsc --noEmit` | **PASS** | exit 0, no output |
| agent-browser: `/` opens, 18-item nav (6 groups) | **PASS** | Overview rendered as `helios-platform` dashboard; all 18 sidebar buttons present |
| View walk (18/18 ≥ required 10, incl. Repositories/Architecture/Runtime/AI/History/Organization/Settings) | **PASS** | every view: correct `h1`, `DataErrorPanel` absent, non-trivial content (1,677–6,902 chars of `innerText`) |
| Theme toggle both ways (topbar "Switch to light appearance") | **PASS** | `html.className` dark→light→dark; Repositories re-rendered in light with no error panel |
| Workspace switch helios-platform → atlas-consortium (combobox) | **PASS** | `wanyrix.active-workspace` = `{"state":{"active":"atlas-consortium"},"version":0}`; Repositories re-rendered for atlas |
| Doctor scan run ("Run doctor on active workspace", atlas) | **PASS** | scan completed; History recorded "1 run recorded across workspaces" · 13:18:28 · findings 7 · 4.3 s wall clock (localStorage run log works) |
| Simulator what-if (atlas, "Add a dependency" → redb 2.2.0) | **PASS** | card updated to "Dependency impact — redb 2.2.0", ESTIMATED labeling present; guarded in-tree crates (datafusion) correctly absent from radios (ENG-TCB-1 fix holds) |
| Console messages across the whole sweep | **PASS** | zero errors/warnings — only React-DevTools hint, `[HMR] connected`, Vercel-analytics dev-mode info, Fast-Refresh lines from parallel agents' edits; `agent-browser errors` empty |
| Mobile 390×844 spot-check (Overview, Builds·Doctor, Runtime) | **PASS** | `scrollWidth == innerWidth == 390` on all 3; no error panels |

## p95 route performance (§26 for web) — 0 flags

Budget: render p95 ≤ 250 ms (dev-server). Method: ≥30 sequential fetches per route
per workspace (1 warmup pass excluded); per-request server-observed render times
parsed from `dev.log` lines `GET <path> <status> in Xms (compile: Yms, render: Zms)`;
client wall time recorded as a secondary metric. Raw data + scripts:
`/tmp/wanyrix-perf/{perf.ts,specials.ts,raw-samples.json,specials-clean.json,unknown-ws-clean.json,summary.md}`.

| Route | ws | n | render min | median | p95 | max | wall p95 | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/wanyrix/workspaces` | — | 29 | 1.98 | 2 | 3 | 4 | 6.82 | 200 |
| `/api/wanyrix/health` | helios | 29 | 1.96 | 2 | 3 | 4 | 6.50 | 200 |
| `/api/wanyrix/doctor` | helios | 29 | 2.00 | 2 | 4 | 4 | 8.34 | 200 |
| `/api/wanyrix/graph` | helios | 29 | 2.00 | 2 | 7 | 27 | 9.06 | 200 |
| `/api/wanyrix/diagnostics` | helios | 29 | 1.94 | 2 | 3 | 5 | 8.20 | 200 |
| `/api/wanyrix/experiments` | helios | 29 | 1.88 | 2 | 3 | 9 | 10.88 | 200 |
| `/api/wanyrix/impact?type=add-dep&target=aws-sdk-s3` | helios | 29 | 1.82 | 2 | 4 | 13 | 14.80 | 200 |
| `/api/wanyrix/pr` | helios | 29 | 1.84 | 2 | 4 | 6 | 8.37 | 200 |
| `/api/wanyrix/report?format=json` | helios | 29 | 2.00 | 2 | 5 | 5 | 7.99 | 200 |
| `/api/wanyrix/report?format=markdown` | helios | 29 | 2.00 | 2 | 4 | 5 | 9.39 | 200 |
| `/api/wanyrix/report?flavor=scorecard` | helios | 29 | 1.95 | 2 | 4 | 6 | 12.85 | 200 |
| `/api/wanyrix/health` | atlas | 30 | 1.91 | 2 | 5 | 13 | 12.95 | 200 |
| `/api/wanyrix/doctor` | atlas | 30 | 1.90 | 2 | 6 | 18 | 20.37 | 200 |
| `/api/wanyrix/graph` | atlas | 30 | 1.96 | 2 | 4 | 4 | 10.80 | 200 |
| `/api/wanyrix/diagnostics` | atlas | 30 | 1.90 | 2 | 3 | 3 | 6.52 | 200 |
| `/api/wanyrix/experiments` | atlas | 30 | 1.81 | 2 | 2 | 3 | 4.94 | 200 |
| `/api/wanyrix/impact?type=add-dep&target=axum` | atlas | 31 | 1.81 | 2 | 3 | 6 | 9.88 | 200 |
| `/api/wanyrix/pr` | atlas | 30 | 1.86 | 2 | 4 | 5 | 6.78 | 200 |
| `/api/wanyrix/report?format=json` | atlas | 30 | 2.00 | 2 | 4 | 4 | 7.31 | 200 |
| `/api/wanyrix/report?format=markdown` | atlas | 30 | 2.00 | 2 | 4 | 20 | 8.23 | 200 |
| `/api/wanyrix/report?flavor=scorecard` | atlas | 30 | 1.97 | 2 | 7 | 14 | 18.48 | 200 |
| `/api/wanyrix/gates` | — | 30 | 1.85 | 2 | 4 | 9 | 12.54 | 200 |
| `/api/wanyrix/issues` | — | 30 | 1.88 | 2 | 3 | 6 | 4.93 | 200 |
| `/api/wanyrix/storage` | — | 31 | 1.88 | 2 | 4 | 4 | 11.03 | 200 |
| `/api/wanyrix/report?flavor=scan-history` | helios | 30 | 1.89 | 2 | 4 | 5 | 7.54 | 200 |
| `POST /api/wanyrix/explain` (300 KB body → 413 fast-fail) | — | 16 | 1.97 | 2 | 4 | 4 | 6.20 | 413 |
| `GET /api/wanyrix/doctor?ws=does-not-exist` (404) | — | 16 | 2 | 3 | 11 | 11 | 50.95 | 404 |
| `GET /api/wanyrix/graph?ws=does-not-exist` (404) | — | 16 | 2 | 3 | 27 | 27 | 47.17 | 404 |

**Verdict:** worst render p95 across all routes = 7 ms; worst single sample = 27 ms.
The 413 fast-fail (256 KB cap enforced pre-parse) holds at render p95 4 ms / wall
p95 6.2 ms ×15/15 (compare ENG-TCA-7's pre-fix 30 s stall). Unknown-workspace 404s
render p95 ≤ 27 ms — no default-data work on error paths (ENG-TCA-1 contract holds
under load).

### Invalidated samples (documented per round rules — not product bugs)

1. First harness run's explain/unknown-ws rows were **discarded**: a char-vs-byte
   offset bug in my log parser (string `.slice()` on a byte offset over a UTF-8 log
   containing multi-byte chars) pulled in pre-run log lines, producing a phantom
   explain-200/1544 ms row and n=0 rows. Re-measured cleanly with byte-safe Buffer
   parsing (`specials-clean.json`, `unknown-ws-clean.json`). The phantom 200 row was
   a Task 2-c-a/2-d-era live-AI explain response in the over-read window, not a
   failed cap: the clean run went 15/15 client-side 413 and 16/16 log lines 413.
2. `impact?target=aws-sdk-s3&ws=atlas-consortium` → 404 ×30 was a **harness target
   mistake**: aws-sdk-s3 is not in atlas-consortium's addable catalog (axum, redb,
   tracing-appender are); 404-on-unknown-target is the by-design ENG-TCA-6b contract.
   Re-measured with `target=axum` → 200, render p95 3 ms.
3. Environmental: parallel agents (docs/lib/UI) were editing `src/**` throughout;
   Fast-Refresh rebuilds are visible in the console capture. No transient 500/compile
   pause invalidated any recorded sample (all sweeps and all measured requests
   returned expected statuses on first try; nothing needed the retry-once rule).

## Storage boundedness (§29) — PASS on both surfaces

1. **`/api/wanyrix/storage` report** (engine-side, fixture-simulated per repo scope):

   ```json
   {"rows":[5 bounded categories …],"totalMB":1248,
    "retention":"snapshots 90d · logs 14d · artifacts LRU 2 GB cap",
    "bound":"no unbounded temporary storage · no silent cache growth"}
   ```

   Every category carries an explicit bound: Database 412 MB (90-day snapshot
   retention) · Indexes 88 MB (incrementally maintained) · Artifact cache 640 MB
   ("LRU-bounded, hard cap 2 GB") · Analysis cache 96 MB (reclaimable, rebuilt) ·
   Logs 12 MB (14-day retention). No unbounded-growth claim anywhere; 2 of 5
   categories marked reclaimable with honest rebuild notes.

2. **Browser localStorage (directly observable surface)** — measured in the live
   session before and after a doctor scan + full 18-view walk + theme toggles +
   workspace switch:

   | When | Keys | Total bytes |
   | --- | --- | --- |
   | Before (fresh session) | `{}` | 2 |
   | After scan + walk | `theme` (4) · `wanyrix.scan-store` (285) · `wanyrix.active-workspace` (51) | **452** |

   Growth: ~450 bytes; 1 MB flag threshold exceeded by ~2300×. `wanyrix.scan-store`
   is capped by design (History view: "capped at 20 runs per workspace"). No
   explain-payload or AI-response blobs are persisted. **Bounded — PASS.**

## Observations (not filed — no product defect, recorded for owners)

- **dev.log unbounded growth (dev-infra, ~P4):** `package.json` dev script pipes
  through `tee dev.log` with no rotation; the file passed ~4,300 lines during this
  session (every API request logs a line, plus tests). Dev-only, zero product
  impact; if a future task cares, add rotation or drop `tee` in CI. Adjacent in
  spirit to AUDIT-I9 (dev-infra hygiene).
- **Shared temp-dir collision:** `/tmp/wanyrix-perf/` also contained files from a
  parallel writer mid-session (`api-latency.ts`, `run-1.txt`, `run-2.txt` — not
  mine). My artifacts are namespaced (`perf.ts`, `specials.ts`, `*-clean.json`,
  `raw-samples.json`, `summary.md`, `big.json`, `big-resp.json`). Future perf tasks
  should use per-agent subdirectories.

## Verified-clean areas carried forward (with evidence owner)

- 138-test suite + lint + tsc green (this round's gates, above).
- All 13 GET API routes + 2 flavors: fast and deterministic-class (p95 table).
- ENG-TCA-1 404 contract and ENG-TCA-7 413 cap hold under repeated load.
- ENG-TCB-1 simulator guard holds in the UI (guarded crates not selectable).
- AUDIT-I1 persistence layer healthy: workspace switch + doctor run-log persisted
  correctly and stayed tiny (452 B).
