# Wanyrix Post-Rename Engineering Audit — Phase 0 Baseline

**Audit ID:** AUDIT-2026-09-18
**Recorded (UTC):** 2026-09-18T07:45:12Z
**Method:** Evidence-based audit. A capability counts as implemented **only** when CODE + INTEGRATION + TEST + RUNTIME VERIFICATION + DOCUMENTATION all agree. `HTTP 200`, rendered components, or file existence alone are **not** proof.

---

## 1. Repository facts

| Field | Value |
| --- | --- |
| Local path | `/home/z/my-project` |
| Branch | `main` |
| Commit SHA | `e06866ad013a8f755b176a4244b9ecc043728aee` |
| Remote (fetch/push) | `https://github.com/Roy-Wanyoike/ferrix.git` |
| Ahead of origin | **9 commits** (`3911cec` = last pushed, round-6 merge #48) |
| Push capability | **BLOCKED** — no stored credentials (`could not read Username for 'https://github.com'`) |
| Working tree | Clean, except runtime artifact `.zscripts/dev.pid` |
| `gh` CLI | Not installed |
| GitHub API (anon) | `Roy-Wanyoike/ferrix` → **404** · `Roy-Wanyoike/wanyrix` → **404** (repo private, renamed, or removed — unverifiable without auth) |

**Consequence:** "update github repo" cannot be executed from this sandbox. Required GitHub-side actions are documented in `docs/audits/issues/` (issue registry) and the final report.

## 2. Critical pre-audit finding

**The Ferrix → Wanyrix identity migration was previously reported complete (commit `4733c36`) but that commit does not exist in this repository's history, and no migration artifact exists on disk.** Evidence:

- `git log --all` contains no `4733c36` and no wanyrix-related commit.
- `src/app/api/ferrix/`, `src/components/ferrix/`, `src/lib/ferrix/` all retain the old name.
- `docs/` directory does not exist. `scripts/check-branding.sh` does not exist. `worklog.md` does not exist.
- Identity census: **291** case-insensitive `ferrix` matches across **50** files in `src/`; **0** `wanyrix` matches; `F-EIR` in 3 files (`lib/ferrix/data.ts` ×6, `types.ts`, `storage-state.ts`); fixture issue IDs `FER-110…FER-119`.
- README title: “Ferrix — Rust Engineering Intelligence Platform”.
- Browser storage keys: `ferrix.active-workspace`, `ferrix.scan-store`, `ferrix.diff-queue` (zustand persist).

**Audit consequence:** the “post-rename” audit begins from a **pre-rename** state. The identity migration is itself the top P0 gap and is re-executed inside this audit.

## 3. Environment

| Component | Version / state |
| --- | --- |
| bun | 1.3.14 |
| Next.js | 16 (App Router), dev server on :3000 — **running, healthy** |
| TypeScript | 5, strict |
| Styling | Tailwind 4 + shadcn/ui (New York), next-themes |
| Server state | TanStack Query |
| Client state | zustand (3 persisted stores) |
| Database | Prisma + SQLite configured; **unused by product code** (fixtures only) |
| Tests | **0 test files** (no vitest/jest/spec found) |
| Lint | `bun run lint` — **clean** at baseline |
| Rust/Cargo/CLI binary | **Not present in this repository** (web platform demonstrator only) |

## 4. Product surface inventory (verified at runtime + code)

### 4.1 Navigation (9 items, 3 groups — `app-shell.tsx`)

| # | ViewId | Label | Component | Notes |
| --- | --- | --- | --- | --- |
| 1 | `overview` | Overview | `overview-view.tsx` | KPI grid, trends, activity |
| 2 | `doctor` | Build Doctor | `doctor-view.tsx` | `ferrix doctor` scan, findings, history |
| 3 | `graph` | Engineering Graph | `dependencies-view.tsx` (**shared with 4**) | backbone + blast radius |
| 4 | `diagnostics` | Diagnostics | `diagnostics-view.tsx` | borrow-checker E0502, async flow |
| 5 | `prs` | PR Analysis | `pr-view.tsx` | regression triage, bot comment |
| 6 | `simulator` | Impact Simulator | `simulator-view.tsx` | add-dep / edit-file / split-crate, estimated |
| 7 | `experiments` | Experiments | `experiments-view.tsx` | baseline→candidate→verified |
| 8 | `scorecard` | Release Scorecard | `scorecard-view.tsx` | gates, GO/NO-GO, export |
| 9 | `issues` | Issues & PRs | `issues-view.tsx` | traceability board |

Overlays (not nav): `command-palette`, `cli-dialog` (CLI contract, 8 commands), `diff-queue-sheet`, `storage-dialog`, `notifications-popover`, `explain-dialog` (AI), `finding-sheet`, `scan-history`, `sccache-simulator`.

### 4.2 Required-vs-present navigation (audit target: 14 items)

Required: Overview · Repositories · Builds · Dependencies · Graph · Findings · Architecture · Experiments · Runtime · History · AI · Policies · Organization · Settings.

**Present as first-class views (5/14):** Overview, Builds≈Build Doctor (partial), Dependencies+Graph (shared view), Experiments.
**Present as overlays, not views (3):** History (scan-history sheet), AI (explain dialog), Policies (gates inside scorecard).
**Absent (6):** Repositories, Findings (dedicated), Architecture, Runtime, Organization, Settings.

### 4.3 API routes (`/api/ferrix/*` — 13, all returned 200 at baseline)

`diagnostics · doctor · experiments · explain · gates · graph · health · issues · pr · report · storage · workspaces` + root. Contracts verified during audit:
- `impact` on unknown target → **404 by design** (catalog contract)
- `explain` without `context`+`question` → **400 by design**; deterministic fallback when AI unavailable

### 4.4 Fixture workspace

`atlas-consortium` — 47 crates (`atlas-*`), 12 doctor findings (`FER-110…FER-119`), issues board mirrors GitHub PRs #21–#48 (round-6 rows `FER-117..119`).

## 5. Audit constraints & honesty notes

1. **GitHub write access unavailable** (no auth, API 404): issues cannot be created remotely; the registry is maintained in `docs/audits/issues/` with ready-to-run `gh issue create` payloads.
2. **No Rust code in this repository**: audit phases belonging to the Rust engine (CLI binary, daemon, SQLite, telemetry collectors) are marked **N/A (platform repo)** — tracked, not failed.
3. **No test framework exists**: TEST evidence is substituted by lint + runtime probes + browser E2E until a test harness lands (registry gap, TEST_GAP).
4. Fixtures are intentional (demonstrator); they are audited for **contract fidelity**, not for being “real” data.

## 6. Baseline verdict summary

| Dimension | Baseline state |
| --- | --- |
| Product identity | **FAIL — pre-rename** (migration missing) |
| Core loop (OBSERVE→…→LEARN) | Present in product surface; AI/estimation honesty rules present |
| Deterministic/AI separation | Present by design (explain route fallback) |
| Navigation completeness | **PARTIAL — 9/14** |
| Test coverage | **FAIL — zero tests** |
| Documentation | **FAIL — no docs/ tree** |
| CI gates (branding) | **FAIL — absent** |
| GitHub sync | **BLOCKED — 9 unpushed commits, no credentials** |

*Detailed per-phase results: `docs/audits/WANYRIX_AUDIT_REPORT.md`.*
