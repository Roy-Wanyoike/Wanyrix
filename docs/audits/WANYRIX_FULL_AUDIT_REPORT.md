# WANYRIX FULL PRODUCT AUDIT — 2026-09-17

> **Repository:** `Roy-Wanyoike/wanyrix` (renamed from `Ferrix` during this audit)
> **Commit audited:** `4733c3692a0e78c0ff9649567a98542922ca1812` (main)
> **Method:** DISCOVER → BASELINE → UNDERSTAND → AUDIT (browser-evidenced) → VERIFY →
> IDENTIFY GAPS → CLASSIFY → CREATE ISSUES. Every conclusion below is backed by
> runtime evidence (agent-browser session, API probes, git/API metadata, rg scans)
> — not by file existence or README claims.
> Baseline environment: see `docs/audits/WANYRIX_BASELINE.md`.

---

## 1. Scope honesty (read first)

This repository hosts the **Wanyrix web platform** — a Next.js 16 demonstrator of the
product loop over a **fixture workspace** (`helios-platform`, 47 crates, simulated
telemetry honestly labeled `MEASURED/ESTIMATED` in-payload and described as a
"demonstrator … over a fixture workspace" in the README). The Rust product core
(CLI, daemon, engine, collectors, W-EIR persistence, experiment runner) **does not
exist in any repository yet**. The audit therefore reports two planes:

- **Web platform (this repo)** — audited as code, runtime-verified.
- **Product core (future platform repos)** — audited as *status*: not implemented;
  captured as the umbrella roadmap issue.

## 2. Component matrix (evidence per cell)

| Component | Exists | Integrated | Tested | Production-ready | Evidence |
| --- | --- | --- | --- | --- | --- |
| Web app shell (9 views) | ✅ | ✅ | ⚠️ manual only | ✅ for demo | all 9 views render + interact, 0 console errors (agent-browser) |
| API surface (12 routes) | ✅ | ✅ | ⚠️ manual only | ✅ for demo | 12/12 GET 200; validation 400/404 contracts verified |
| AI reasoning layer | ✅ | ✅ | ❌ no automated harness | ⚠️ | explain POST streams OBSERVED FACT/INFERENCE/RECOMMENDATION/UNCERTAINTY, "grounded: evidence context ✓"; deterministic fallback verified |
| Persisted client state | ✅ | ✅ | ✅ E2E-verified | ✅ | legacy `ferrix.*` → `wanyrix.*` controlled migration verified in browser |
| Export contracts | ✅ | ✅ | partial | ✅ | `wanyrix.report/v1`, scan-history & scorecard /v1 formats; JSON report downloaded + schema-validated, 0 stale brand refs |
| Brand identity + gate | ✅ | ✅ | ✅ | ✅ | `scripts/check-branding.sh` PASS; browser title/OG/exports clean |
| Automated test suite | ❌ | — | — | ❌ | no unit/component/E2E tests in repo (only lint + branding gate) |
| CI pipeline | ❌ | — | — | ❌ | no GitHub Actions workflows; quality gates not enforced on PRs |
| CLI (`wanyrix` binary) | ❌ product-level | — | — | ❌ | UI/CLI contract dialog *documents* the contract; no binary exists |
| Daemon / Engine / collectors | ❌ product-level | — | — | ❌ | not in this repo; no other repo |
| W-EIR (persistent IR) | ⚠️ design-only | — | — | ❌ | TypeScript payload types + fixture snapshots; no durable W-EIR store, no schema validator |
| Engineering Graph (real) | ⚠️ fixture | fixture-only | ❌ | ❌ | interactive UI over hand-authored nodes/edges (212 edges); no real Cargo metadata ingestion |
| Build Intelligence (real) | ⚠️ fixture | fixture-only | ❌ | ❌ | doctor findings/critical path are authored fixture evidence; no cargo --timings ingestion |
| Experiments runner | ⚠️ fixture | fixture-only | ❌ | ❌ | Gate 10/20/21 semantics *modeled* in UI; no real baseline/candidate execution |
| Safe patches | ⚠️ modeled | fixture-only | ❌ | ❌ | diff-queue enforces "proposal only" (Gate 19) honestly; no sandbox/cargo check |
| Runtime intelligence | ❌ | — | — | ❌ | Phase 11 scope; not started |
| Historical intelligence | ⚠️ fixture | fixture-only | ❌ | ❌ | trends from fixture arrays; no snapshot history |
| Cloud | ❌ | — | — | ❌ | Phase 13 scope; not started (correctly decoupled) |

Legend: ✅ verified · ⚠️ partial/design-only · ❌ absent

## 3. Product loop audit (OBSERVE→…→LEARN)

| Stage | Web demonstrator | Real product | Gap |
| --- | --- | --- | --- |
| OBSERVE | ✅ simulated telemetry + scan events | ❌ no collectors | product core |
| UNDERSTAND | ✅ graph + blast radius (fixture) | ❌ | product core |
| DIAGNOSE | ✅ doctor findings + evidence (fixture) | ❌ | product core |
| EXPLAIN | ✅ deterministic + AI grounded (live AI verified) | ⚠️ AI layer real, evidence fixture | harness + core |
| RECOMMEND | ✅ remediation + verification paths (fixture) | ❌ | product core |
| CHANGE | ✅ diff-queue proposal-only (Gate 19 honored) | ❌ | product core |
| VERIFY | ✅ experiment semantics (fixture) | ❌ | product core |
| MEASURE | ✅ verified/measured labels enforced (fixture) | ❌ | product core |
| LEARN | ⚠️ scan history + trends (localStorage fixture) | ❌ | product core |

**Measurement-integrity spot checks (Phase 14 targets) — PASS in UI:**
- EXP-015 running state displays *"Estimated −34% is NOT claimed here"* (Gate 21).
- EXP-014 verification quote carries measurement provenance (5-run median, ×2 reproduction).
- Doctor payloads separate `MEASURED` (87.4s cargo build --timings) vs `ESTIMATED` (49–61s).

**AI adversarial status (Phase 15):** live explain call grounded correctly
(PR #184 numbers 31.2s→44.8s traced to fixture evidence; footer "grounded:
evidence context ✓"). No automated adversarial suite exists → issue.

## 4. Security audit (Phase 22)

| Check | Result | Evidence |
| --- | --- | --- |
| Committed secrets | **0** | git grep for PAT/AKIA/private-key patterns → only literal `x-access-token:$TOKEN` doc placeholders in `tool-results/` session notes |
| Tracked env files | 0 | `git ls-files` — none; `.gitignore` covers `.env*` |
| External data flows | minimal | app calls only `/api/wanyrix/*`; AI route sends **finding context text only** (no repo source, no env); Vercel Analytics pageviews only (debug, no data in dev) |
| Auth/authz | N/A demo | local demonstrator, no auth surface by design; product core must add |
| Dependency vulnerabilities | not scanned in CI | no lockfile audit automation → covered by CI issue |
| Local-only mode | ✅ honored | all deterministic features work without network; AI optional (fallback verified) |

## 5. Performance audit (Phase 23 — web subset, measured)

| Metric | Measured (p, n≥3) | Assessment |
| --- | --- | --- |
| Server page render GET / | 50–180ms | ✅ good (dev mode!) |
| API warm latency | 4–7ms per route | ✅ excellent |
| Doctor scan replay | ~4.3s client-measured for terminal replay (12 findings) | ✅ acceptable UX |
| Mobile overflow | **FAIL** — `document.scrollWidth=1022` at 390px on **all views** | ❌ AUD-UI-01 |

Product budgets (CLI p95 <150ms, doctor <10s, 500-crate scale) — **not measurable
here**; belong to the product-core issue.

## 6. Documentation audit (Phase 29)

| Document | Status |
| --- | --- |
| README | ✅ accurate — every claim in the surfaces table was runtime-verified this audit; "Run locally" steps verified |
| docs/migrations/FERRIX_TO_WANYRIX.md | ✅ complete (baseline + final report) |
| docs/audits/* | ✅ added by this audit |
| ARCHITECTURE / DEVELOPMENT / CONTRIBUTING / SECURITY / THREAT_MODEL / CLI / PERFORMANCE / W-EIR spec / PLUGIN_API | ❌ all missing → issue |

## 7. Cross-check: in-app traceability vs GitHub (Rule 4/5)

Live repo (API): **25 PRs (#10–#48, all merged, 0 open), 0 real issues**.
In-app Issues & PRs board: "19 issues · 19 PRs · issues #1–#44 · PRs #10–#47
mirror the live repo", rows `WAN-101…WAN-119` → GitHub numbers that do not exist.
→ **AUD-DOC-01 (P3)**: the board overstates mirror fidelity; must relabel as a
curated fixture or sync to real metadata.

## 8. Final audit report (§43 format)

```text
WANYRIX FULL PRODUCT AUDIT — 2026-09-17
Repository: Roy-Wanyoike/wanyrix
Commit:     4733c3692a0e78c0ff9649567a98542922ca1812

Core Runtime (product):        FAIL (not implemented — umbrella issue)
Repository Intelligence:       FAIL (product-level; fixture in web)
W-EIR:                         PARTIAL (types + fixtures only; no durable IR)
Engineering Graph:             PARTIAL (fixture graph; traversal UI correct)
Build Intelligence:            PARTIAL (fixture evidence; semantics correct)
Findings:                      PARTIAL (model complete in TS; fixture-sourced)
Incremental Intelligence:      FAIL (product-level)
Experiments:                   PARTIAL (Gate 10/20/21 modeled; no runner)
AI:                            PASS  (grounded, structured, fallback, optional)
Safe Patches:                  PARTIAL (proposal-only enforced; no sandbox)
Architecture Intelligence:     PARTIAL (boundaries rules shown as fixture)
Runtime Intelligence:          FAIL (not started — correctly out of MVP scope)
Historical Intelligence:       PARTIAL (scan history + trends, local only)
Cloud:                         FAIL (not started — correctly decoupled)
Security (this repo):          PASS  (0 secrets, minimal flows, local-only)
Reliability (this repo):       PARTIAL (graceful AI fallback; no test suite)
Performance (web subset):      PARTIAL (fast; mobile overflow defect)
Frontend:                      PARTIAL (9/9 views work; AUD-UI-01 overflow; no tests)
Documentation:                 PARTIAL (README accurate; 9 standard docs missing)

Total Issues Discovered: 9 new + 3 pre-existing triaged
P0: 0
P1: 2   (product-core umbrella #49; test suite #50)
P2: 3   (CI pipeline #51; mobile overflow #52; fixture generator/data split #53)
P3: 3   (board traceability #54; docs set #55; AI adversarial harness #56)
P4: 1   (repo hygiene #57)
Pre-existing reused/triaged: 3 (#22 workspace datasets — partial; #23 signals
 center — largely done, read-state remains; #24 styling/a11y — largely done,
 focus-ring sweep folded into #50)
New Issues Created: 9 (#49–#57)
Existing Issues Reused: 3 triaged with audit evidence (#22, #23, #24)
Completed:   identity migration, branding gate, persisted-state migration,
             versioned exports, AI grounding, 9-view demonstrator
Partial:     W-EIR, graph, build intelligence, findings, experiments, patches,
             historical, docs
Missing:     product core (CLI/daemon/engine/collectors), tests, CI, runtime,
             cloud
Broken:      mobile layout on all views (AUD-UI-01)
Critical Blockers: none for the demonstrator; product MVP blocked by P1 core
```

## 9. Final product question (§44) — answered honestly

> *Can a real Rust developer point Wanyrix at a real repository and use it to
> discover, understand, diagnose, explain, improve, verify, and measure a real
> engineering problem using trustworthy evidence?*

**Not yet.** Today Wanyrix is a **fully-working design demonstrator**: the complete
product loop, evidence discipline (IDs + provenance + confidence), measurement
integrity (estimated/measured/verified), AI grounding, and governance surfaces are
implemented and verified — but over **fixture evidence**. The deterministic Rust
core that produces that evidence from real repositories does not exist yet. The
9 issues filed from this audit constitute the implementation roadmap; the P1
umbrella issue defines the product-core phases required to answer the question
with "yes".

## 10. Implementation roadmap (from filed issues)

```text
P1  #49 Product core umbrella (CLI → daemon → engine → W-EIR → graph → doctor → experiments)
P1  #50 Web platform test suite (unit/component/E2E + a11y + branding in CI)
P2  #51 CI pipeline (lint, typecheck, branding gate, build, audit)
P2  #52 Mobile topbar overflow fix
P2  #53 Fixture generator + data.ts decomposition
P3  #54 Traceability board honesty (relabel or live-sync)
P3  #55 Standard documentation set
P3  #56 AI adversarial prompt harness
P4  #57 Repo hygiene (tool-results untracked)
pre #22 kestrel-edge + iron-mq datasets (fold into #53 generator)
pre #23 signals read-state (small follow-up; core verified done)
pre #24 focus-ring sweep (fold into #50 a11y assertions)
```

Dependency order: #51 → #50 → (#52, #53, #54) · #49 is independent (new workspace) ·
#55/#56 after #50 (tests give docs verifiable examples) · #57 anytime.
