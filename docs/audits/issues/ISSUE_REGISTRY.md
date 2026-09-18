# Wanyrix Audit — Issue Registry

**Audit:** AUDIT-2026-09-18 · **Baseline:** `e06866a` · **Working tree at filing:** post-migration + storage fix (uncommitted)

## Why issues are filed here and not on GitHub

The sandbox has **no GitHub write access**: no `gh` CLI, no stored credentials
(`git push` → `could not read Username`), and the GitHub API returns **404** for both
`Roy-Wanyoike/ferrix` and `Roy-Wanyoike/wanyrix` anonymously (repo is private, renamed,
or removed). Per audit rules, no duplicate issue may be created — but the existing
issue set is equally unverifiable from here (requires auth). Therefore:

1. Every gap is filed as a full issue record in this directory (`AUDIT-I1.md` … `AUDIT-I10.md`).
2. Each record carries the complete 14-field template and a **ready-to-run**
   `gh issue create` payload for the moment authenticated access exists.
3. `docs/audits/GITHUB_ACTIONS_REQUIRED.md` lists the manual GitHub-side steps
   (rename, push, then bulk-file these issues).

## Duplicate-check record (Rule 4)

| Check | Result |
| --- | --- |
| Open/closed issues on GitHub | **UNVERIFIABLE** (API 404, no auth) — re-check before filing |
| Open/merged PRs on GitHub | **UNVERIFIABLE** — re-check before filing |
| Local git history (`git log --all`) | Searched: no prior issue/PR covers identity migration or persistence fix. Round-1…10 commits touched features, not these gaps |
| In-app issues board (issues-view, `WAN-101…119`) | Product fixture — mirrors demo PRs, not audit issues |

## Index

| ID | Title | Type | Severity | Status |
| --- | --- | --- | --- | --- |
| [AUDIT-I1](AUDIT-I1.md) | Persisted stores silently non-persistent + legacy migration dead (zustand storage thunk bug) | BUG | **P0** | **FIXED in audit** (regression test still required) |
| [AUDIT-I2](AUDIT-I2.md) | Identity migration reported complete but never executed — process/integrity failure | PROCESS / BUG | **P0** | **FIXED in audit** |
| [AUDIT-I3](AUDIT-I3.md) | Navigation 9/14 — Repositories, Findings, Architecture, Runtime, Organization, Settings missing | MISSING_FEATURE | P2 | **CLOSED** (Task 2-b: 18-item grouped IA, browser-verified) |
| [AUDIT-I4](AUDIT-I4.md) | Zero automated tests (no framework installed) | TEST_GAP | **P1** | **CLOSED** (Task 2-a: `bun test` harness, 138 tests / 2,871 assertions green) |
| [AUDIT-I5](AUDIT-I5.md) | GitHub unreachable from sandbox — rename + push + issue filing blocked | INTEGRATION_FAILURE | **P1** | Open (needs human — re-verified Task 5-c: auth wall stands, api.github.com reachable; `scripts/github/` kit in flight) |
| [AUDIT-I6](AUDIT-I6.md) | No product documentation tree (architecture, CLI reference, data contracts) | DOCUMENTATION | P3 | **CLOSED** (Task 2-d: README rebuild + USER_GUIDE/ARCHITECTURE/PRIVACY/COMMERCIAL) |
| [AUDIT-I7](AUDIT-I7.md) | `explain` AI route: shallow grounding with id-only context; GET contract undocumented | PARTIAL_IMPLEMENTATION | P3 | **CLOSED** (Tasks 2-d+2-e: server-rendered facts, grounding validation, 413 cap, Allow header) |
| [AUDIT-I8](AUDIT-I8.md) | Rust engine surfaces absent from repo (CLI binary, daemon, telemetry) — N/A or tracked | SCOPE NOTE | P3 | Open (platform repo) |
| [AUDIT-I9](AUDIT-I9.md) | Stale Turbopack chunks after mass rename can serve pre-rename modules in dev | INFRASTRUCTURE | P4 | **CLOSED** (Task 5-c: documentation-only; 0 stale ferrix vs 66 wanyrix chunks in `.next/dev`, recovery documented) |
| [AUDIT-I10](AUDIT-I10.md) | WAN-* ↔ GitHub issue/PR linkage is by-convention only (no automated traceability) | MISSING_FEATURE | P4 | **PARTIAL** (Task 5-c: audit-ID→record→commit chain mapped; FINAL-2 fix indexed ENG-T3A-1 → chain half **CLOSED**; typed-ref feature open) |
| [ENG-T3A-1](ENG-T3A-1.md) | @vercel/analytics contradicted no-telemetry claim | CODE_VS_DOC | P3 | **FIXED + verified** (removed from layout.tsx, commit 90e5ec4; indexed in registry by FINAL-2 fix) |

Severity policy: P0 = breaks a shipped promise / data loss; P1 = blocks credible development; P2 = material product gap; P3 = quality/completeness; P4 = future/hygiene. Severities were assigned against evidence, not aspiration.

## Production-validation round (2026-09-18) — engineer-persona findings

Filed by simulated engineers driving the product via different SDK surfaces
(`ENG-REGISTRY-tca.md` = REST/JSON personas · `ENG-REGISTRY-tcb.md` = UI personas).
All defects found were fixed and browser/API-verified in the same round:

| ID | Title | Type | Severity | Status |
| --- | --- | --- | --- | --- |
| [ENG-TCA-1](ENG-TCA-1.md) | Unknown `ws` silently returned default workspace data | BUG / API contract | **P2** | **FIXED + verified** (404 `{error, knownWorkspaces}` on 9/9 ws routes) |
| [ENG-TCA-2](ENG-TCA-2.md) | scorecard/scan-history flavors client-only | SDK gap | P3 | **FIXED + verified** (`?flavor=scorecard\|scan-history` on `/report`) |
| [ENG-TCA-3](ENG-TCA-3.md) | Blast-radius math self-contradictions in `/graph` payload | BUG (honest-math) | **P2** | **FIXED + verified** (all aggregates derived from edge list; helios 47/47, atlas 32/32 checks) |
| [ENG-TCA-4](ENG-TCA-4.md) | Adversarial prompts could corrupt OBSERVED FACT lines | BUG (AI grounding) | **P2** | **FIXED + verified** (server-rendered facts, grounding validation + redaction, live demo stripped invented delta) |
| [ENG-TCA-5](ENG-TCA-5.md) | `estimatedRange` semantics lost in machine flavors | BUG (schema) | P3 | **FIXED + verified** (structured `value/unit/estimatedRange/status`) |
| [ENG-TCA-6](ENG-TCA-6.md) | REST hygiene (Allow, 400-vs-404, kind coercion, markdown envelope) | CONTRACT_HYGIENE | P4 | **FIXED + verified** (residual explain-405 → ENG-TE-1, also fixed) |
| [ENG-TCA-7](ENG-TCA-7.md) | `/explain` unbounded payload stalled caller 30 s | PERF / ROBUSTNESS | P3 | **FIXED + verified** (256 KB cap → 413 in <10 ms) |
| [ENG-TCB-1](ENG-TCB-1.md) | Simulator catalog offered already-present crates | BUG / UX-honesty | P3 | **FIXED + verified** (guarded cards + upgrade hand-off, both workspaces) |
| [ENG-TCB-2](ENG-TCB-2.md) | Honesty badges failed WCAG AA in light theme | BUG / a11y | P3 | **FIXED + verified** (light 5.60–6.64:1, dark 9.42–11.26:1, both ≥4.5) |
| [ENG-TE-1](ENG-TE-1.md) | explain framework 405 lacked `Allow` | CONTRACT_HYGIENE | P4 | **FIXED + verified** (explicit GET → 405 JSON + `Allow: POST`) |

**Product integrity results from the persona sweep:** zero false Verified claims across
doctor/experiments/simulator; doctor finding schema 19/19 clean; report flavor
deterministic (byte-identical ×3); no console errors across all 18 views; mobile 390px
clean; dark+light both AA on honesty badges.

## Final-audit round (Task 5-c) — 57-gate acceptance audit findings

Auditor: QA/Final Auditor (Task 5-c). Full matrix: `docs/audits/ACCEPTANCE_GATES.md`
(tally: **29 PASS / 7 PARTIAL / 2 FAIL / 12 IN PROGRESS / 7 N/A-OUT-OF-SCOPE** = 57).
Registry status columns updated this round for **I5 (note appended, still Open-needs-human),
I9 (CLOSED, documentation-only), I10 (PARTIAL, chain mapped)** only — per edit-rights contract.

**New gaps discovered by the gate audit: 2** (everything else that failed or is partial
maps to an existing record — #38/#43/#44/#57 root cause = AUDIT-I5; engine gates #2/6–8/10–13/15/16/19/30 = AUDIT-I8 scope + Task 5-a; no duplication per Rule 4).

### FINAL-1 — Investor overview artifact does not exist (Gate 56 FAIL)

1. **Problem:** §70 Gate 56 "Investor overview is complete" has no artifact anywhere in the repo — no investor-facing document was ever produced (repo-wide grep: zero hits for investor overview material outside `docs/COMMERCIAL.md`'s internal architecture).
2. **Evidence:** `docs/` listing (11 files, none investor-facing); `grep -rn "investor" docs/ README.md` → 0 hits; ACCEPTANCE_GATES.md #56 = FAIL.
3. **Current behavior:** commercial architecture + 90-day trial model exist in `docs/COMMERCIAL.md` (Gates 54/55 PASS), but nothing distills them for investors.
4. **Expected behavior:** an investor overview (product thesis, deterministic-core moat, trial→subscription model, roadmap phases) derived from COMMERCIAL.md + WANYRIX_BASELINE.md.
5. **Root cause:** the doc-completion round (3-a) scoped engineering docs only; investor artifact was never assigned.
6. **Implementation requirements:** author `docs/INVESTOR_OVERVIEW.md` from existing material (no new claims — every number must trace to COMMERCIAL.md/PERFORMANCE.md).
7. **Acceptance criteria:** [ ] doc exists; [ ] every claim cites a source doc; [ ] linked from README docs map.
8. **Tests required:** none (docs).
9. **Security considerations:** must not disclose anything beyond what COMMERCIAL.md already discloses.
10. **Performance considerations:** N/A.
11. **Dependencies:** none blocking (COMMERCIAL.md complete).
12. **Definition of Done:** document merged + indexed. **Severity:** LOW (business artifact; does not block web-platform engineering GO, listed in gates-blocking-GO for completeness).

Ready-to-run filing:
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "docs: investor overview artifact missing (acceptance Gate 56)" \
  -b "See docs/audits/issues/ISSUE_REGISTRY.md §Final-audit round FINAL-1; source material docs/COMMERCIAL.md" -l "documentation"
```

### FINAL-2 — ENG-T3A-1 is unindexed in this registry (traceability chain break, AUDIT-I10 residual)

1. **Problem:** the issue record `ENG-T3A-1.md` (filed Task 3-a, FIXED + verified in commit `90e5ec4`) has **no row** in this registry's Index or Production-validation table — the one broken link in the otherwise-complete finding-ID → source record → commit chain (AUDIT-I10 mapping, Task 5-c).
2. **Evidence:** `grep -c "ENG-T3A-1" docs/audits/issues/ISSUE_REGISTRY.md` → 0 (this round); file exists at `docs/audits/issues/ENG-T3A-1.md`; fix commit `90e5ec4` message names it.
3. **Current behavior:** registry readers cannot discover the telemetry-conflict issue or its verified fix from the index.
4. **Expected behavior:** every issue record on disk has exactly one registry row.
5. **Root cause:** Task 3-a filed the record but registry-table edits were outside that agent's edit rights; no later round added the row.
6. **Implementation requirements:** append one row to the Index (and/or Production-validation table): `ENG-T3A-1 | @vercel/analytics contradicted no-telemetry claim | CODE_VS_DOC | P3 | FIXED + verified (removed from layout.tsx, commit 90e5ec4)`.
7. **Acceptance criteria:** [ ] ENG-T3A-1 row present; [ ] AUDIT-I10 re-checks grep ≥ 1 and can flip PARTIAL→CLOSED for the chain half.
8. **Tests required:** none (registry hygiene); AUDIT-I10's grep check is the verification.
9. **Security considerations:** none.
10. **Performance considerations:** none.
11. **Dependencies:** closes the last missing link named in AUDIT-I10's Task 5-c note.
12. **Definition of Done:** row added; AUDIT-I10 chain half verifiable by grep. **Severity:** P4 (hygiene).

Ready-to-run filing:
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "registry: index ENG-T3A-1 row (traceability chain break, AUDIT-I10 residual)" \
  -b "See docs/audits/issues/ISSUE_REGISTRY.md §Final-audit round FINAL-2 and docs/audits/issues/AUDIT-I10.md" -l "traceability"
```

**Verdict carried forward:** web platform = CONDITIONAL GO (unchanged). Blocking conditions: AUDIT-I5 human GitHub step (also unblocks Gates 38/43/44/57), engine repo Task 5-a (12 IN-PROGRESS gates), FINAL-1 investor artifact.

### FINAL-2 — RESOLVED (orchestrator, same round)

- ENG-T3A-1 row appended to the Index (see above); `grep -c "ENG-T3A-1" ISSUE_REGISTRY.md` now ≥ 1 — the acceptance criterion of FINAL-2 is met, closing the chain half of AUDIT-I10 (typed-ref feature half remains open under I10).
- AUDIT-I10 index-table status updated accordingly: chain-mapping half **CLOSED**, typed-ref half open.

### FINAL-3 — Engine phase-2 surfaces not yet built (daemon, SQLite store, rustc telemetry, large-repo perf)

1. **Problem:** `wanyrix-engine` v0.1.0 (landed this round under `engine/`, 25 tests green) covers measured filesystem manifest analysis only. The master contract's engine surface set also requires: long-lived daemon, SQLite persistence, rustc/telemetry collection, and 500-crate-scale performance characterization.
2. **Evidence:** `engine/README.md` roadmap table lists daemon/SQLite/telemetry as NOT built; ACCEPTANCE_GATES #2, 6–8, 10–13, 15, 16, 19, 30 = IN PROGRESS pending these surfaces.
3. **Current behavior:** `wanyrix doctor|graph|health` work per-invocation against a directory; no persistence between runs.
4. **Expected behavior:** daemon with idle memory <100MB (gate 14), SQLite store surviving forced interruption (gate 31), telemetry pipeline excluding sensitive source by default (gate 41), 500-crate synthetic workspace analyzed within budget (gate 16).
5. **Root cause:** phased build order — v0 proves the contract-conformance approach first; persistence/telemetry are the next phase.
6. **Implementation requirements:** (a) SQLite store via rusqlite (bundled; gcc present in toolchain image) with WAL + interruption-recovery test; (b) daemon process with IPC matching `wanyrix.daemon/v1` schema (to be defined additively); (c) rustc JSON diagnostics capture with secret/source redaction default-on; (d) 500-crate synthetic fixture + timing characterization committed as evidence.
7. **Acceptance criteria:** gates #10–14, 16, 19, 30, 31 flip IN PROGRESS→PASS with committed evidence; no regression in the 25 existing engine tests.
8. **Tests required:** cargo test expansion incl. crash-recovery and redaction unit tests; soak evidence recorded in `docs/PERFORMANCE.md`.
9. **Security considerations:** telemetry must exclude sensitive source by default (gate 41); store must not leak workspace paths across users.
10. **Performance considerations:** incremental analysis ≥95% reduction where graph permits (gate 10); idle daemon <100MB (gate 14).
11. **Documentation requirements:** engine/README roadmap table update per merged phase; W-EIR doc stays authoritative for schema versioning.
12. **Definition of Done:** all listed engine gates PASS with evidence; issue closes via PR linkage. **Severity:** HIGH (product core), phased.

Ready-to-run filing:
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "engine: phase-2 surfaces — daemon, SQLite store, rustc telemetry, 500-crate perf (FINAL-3)" \
  -b "See docs/audits/issues/ISSUE_REGISTRY.md §Final-audit round FINAL-3 and engine/README.md roadmap" -l "engine"
```

### FINAL-1 — RESOLVED (orchestrator, same round as filing)

- `docs/INVESTOR_OVERVIEW.md` produced (problem, measured component table, planned-not-built, market wedge, model, risks, ask placeholder) — gate #56 flipped FAIL→PASS in `docs/audits/ACCEPTANCE_GATES.md`. Closes on merge of the linked PR (`pr/final-1-investor-overview` branch prepared locally).

### FINAL-2 — RESOLVED (orchestrator, same round as filing)

- ENG-T3A-1 indexed in the registry table (grep acceptance criterion met); closes on merge of the linked PR (`pr/final-2-registry-index` branch prepared locally).
