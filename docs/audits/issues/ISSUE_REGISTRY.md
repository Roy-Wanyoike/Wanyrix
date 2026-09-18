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
| [AUDIT-I5](AUDIT-I5.md) | GitHub unreachable from sandbox — rename + push + issue filing blocked | INTEGRATION_FAILURE | **P1** | Open (needs human) |
| [AUDIT-I6](AUDIT-I6.md) | No product documentation tree (architecture, CLI reference, data contracts) | DOCUMENTATION | P3 | **CLOSED** (Task 2-d: README rebuild + USER_GUIDE/ARCHITECTURE/PRIVACY/COMMERCIAL) |
| [AUDIT-I7](AUDIT-I7.md) | `explain` AI route: shallow grounding with id-only context; GET contract undocumented | PARTIAL_IMPLEMENTATION | P3 | **CLOSED** (Tasks 2-d+2-e: server-rendered facts, grounding validation, 413 cap, Allow header) |
| [AUDIT-I8](AUDIT-I8.md) | Rust engine surfaces absent from repo (CLI binary, daemon, telemetry) — N/A or tracked | SCOPE NOTE | P3 | Open (platform repo) |
| [AUDIT-I9](AUDIT-I9.md) | Stale Turbopack chunks after mass rename can serve pre-rename modules in dev | INFRASTRUCTURE | P4 | Open |
| [AUDIT-I10](AUDIT-I10.md) | WAN-* ↔ GitHub issue/PR linkage is by-convention only (no automated traceability) | MISSING_FEATURE | P4 | Open |

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
