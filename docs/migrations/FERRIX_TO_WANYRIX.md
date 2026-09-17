# Migration Baseline — Ferrix → Wanyrix

> **Status:** Baseline captured before any modification (Phase 2 of the identity migration).
> **Scope:** This repository hosts the **Wanyrix web platform** (Next.js 16 · TypeScript ·
> Tailwind 4 · shadcn/ui · TanStack Query · Prisma-ready). There is no Rust/Cargo workspace
> in this repository; the Cargo/protobuf/Helm/Terraform sections of the migration program
> therefore resolve to **N/A** for this repo and are tracked for the platform repos.
> **Canonical identity:** `Wanyrix` · CLI `wanyrix` · IR `W-EIR` (Wanyrix Engineering
> Intermediate Representation) · category *Engineering Intelligence Platform*.

## 1. Discovery summary

Discovery commands run before any change:

```bash
git status && git branch --show-current && git log --oneline -30 && git remote -v
rg -o -i "[a-z_/.-]*ferrix[a-z_/.-]*" --no-filename . | sort | uniq -c | sort -rn
rg -i --count-matches "ferrix" .
rg -n "F-EIR" src/ README.md
rg -o "FER-[0-9A-Z-]+" --no-filename . | sort | uniq -c
```

### Totals (pre-migration)

| Token | Occurrences | Notes |
| --- | ---: | --- |
| `ferrix` (lowercase) | 234 | paths, imports, CLI strings, API routes, copy |
| `Ferrix` (title case) | 63 | brand copy, comments, metadata, component name |
| `FERRIX` (upper) | 1 | `app-shell.tsx` footer badge |
| `F-EIR` | 8 | IR name in types/data/comments |
| `f-eir` / `f_eir` / `F_EIR` | 0 | — |
| `FER-<id>` stable IDs | 30+ | issues FER-101…FER-119, findings FER-BLD-001…, FER-WRK-007 |
| git remote | 1 | `https://github.com/Roy-Wanyoike/ferrix.git` (see §16 note) |

Distinct namespace inventory (from token enumeration):

| Namespace | Occurrences | Category |
| --- | ---: | --- |
| `/lib/ferrix/*` imports | 60 | MODULE |
| `/components/ferrix/*` imports | 11 | MODULE |
| `/api/ferrix/*` route references | 40 | API |
| `FerrixLogo` | 6 | UI |
| `ferrix.report/v1` | 2 | API (versioned schema) |
| `ferrix.scan-history/v1` | 3 | API (versioned export format) |
| `ferrix.release-scorecard/v1` | 3 | API (versioned export format) |
| `ferrix-g` (SVG gradient id) | 2 | UI |
| `ferrix-report-` / `ferrix-scorecard-` | 4 | STORAGE (export filenames) |
| `ferrix-proposals/` | 2 | STORAGE (proposal id prefix) |
| `ferrix/build-impact`, `ferrix/graph-diff`, `ferrix/evidence-lint` | 7 | EVENT/CI check names (mock PR data) |
| `ferrix.active-workspace`, `ferrix.scan-store`, `ferrix.diff-queue` | 3 | STORAGE (localStorage persist keys) |
| `__ferrix_storage_state__` | 1 | STORAGE (in-process server key) |
| `Roy-Wanyoike/ferrix` repo URL | 2 | URL (REPO_URL constant + README) |
| plain copy/comments | remainder | PRODUCT_BRAND / DOCUMENTATION |

Also confirmed **absent** in this repo: Cargo manifests, protobuf, Docker/K8s/Helm/Terraform,
`FERRIX_*` environment variables, Prisma schema branding, `package.json` branding
(`name` is the generic scaffold id), test snapshots/golden files beyond mock data.

## 2. Occurrence register (per file, pre-migration counts)

| File | `ferrix` (any case) | `F-EIR` | `FER-*` IDs | Category |
| --- | ---: | ---: | ---: | --- |
| `src/lib/ferrix/data.ts` | 27 | 6 | yes | FIXTURE / FIXTURE-IDs |
| `src/components/ferrix/app-shell.tsx` | 20 | 0 | no | UI / PRODUCT_BRAND |
| `src/lib/ferrix/hooks.ts` | 15 | 0 | no | API |
| `src/components/ferrix/views/doctor-view.tsx` | 15 | 0 | no | UI |
| `src/lib/ferrix/types.ts` | 14 | 1 | no | MODULE / API docs |
| `src/app/api/ferrix/explain/route.ts` | 14 | 0 | no | API |
| `src/app/page.tsx` | 12 | 0 | no | MODULE imports |
| `src/lib/ferrix/report.ts` | 11 | 0 | no | API / STORAGE |
| `src/components/ferrix/views/scorecard-view.tsx` | 11 | 0 | no | UI / API format |
| `src/components/ferrix/cli-dialog.tsx` | 11 | 0 | no | CLI / API |
| `src/components/ferrix/views/pr-view.tsx` | 9 | 0 | no | UI / EVENT |
| `src/components/ferrix/diff-queue-sheet.tsx` | 9 | 0 | no | UI / STORAGE |
| `src/lib/ferrix/patch.ts` | 8 | 0 | no | MODULE |
| `src/components/ferrix/views/simulator-view.tsx` | 8 | 0 | no | UI |
| `src/components/ferrix/scan-history.tsx` | 8 | 0 | no | UI / API format |
| `src/components/ferrix/views/experiments-view.tsx` | 7 | 0 | no | UI / CLI |
| `src/components/ferrix/command-palette.tsx` | 7 | 0 | no | UI |
| `src/app/layout.tsx` | 7 | 0 | no | PRODUCT_BRAND (metadata/OG) |
| `README.md` | 7 | 0 | no | DOCUMENTATION |
| `src/lib/ferrix/storage-state.ts` | 6 | 1 | no | STORAGE |
| `src/components/ferrix/storage-dialog.tsx` | 6 | 0 | no | UI |
| `src/components/ferrix/views/issues-view.tsx` | 5 | 0 | yes | UI / FIXTURE-IDs |
| `src/components/ferrix/explain-dialog.tsx` | 5 | 0 | no | UI |
| other components/views (≤4 each) | 4×… | 0 | no | UI |
| API routes (13 files, 1–3 each) | ~20 | 0 | no | API |
| `src/app/globals.css` | 2 | 0 | no | DOCUMENTATION (comments) |
| `src/components/theme-provider.tsx` | 1 | 0 | no | DOCUMENTATION (comment) |

Full file-level counts were captured with
`rg -i --count-matches "ferrix" .` during discovery (see §1).

## 3. Canonical replacement map (ordered, most-specific first)

| # | From | To | Rationale |
| --- | --- | --- | --- |
| 1 | `F-EIR` | `W-EIR` | §5 IR rename |
| 2 | `ferrix.report/v1` | `wanyrix.report/v1` | versioned format, producer+consumer ship together |
| 3 | `ferrix.scan-history/v1` | `wanyrix.scan-history/v1` | versioned export format |
| 4 | `ferrix.release-scorecard/v1` | `wanyrix.release-scorecard/v1` | versioned export format |
| 5 | `ferrix-g` | `wanyrix-g` | SVG gradient id |
| 6 | `FerrixLogo` | `WanyrixLogo` | component identifier |
| 7 | `ferrix-report-` / `ferrix-scorecard-` / `ferrix-proposals/` | `wanyrix-…` | export filename / id prefixes |
| 8 | `FER-` (IDs: `FER-101…FER-119`, `FER-BLD-*`, `FER-WRK-*`) | `WAN-` | stable mock IDs, single-source-of-truth fixture |
| 9 | `ferrix[bot]`, `ferrix/build-impact`, `ferrix/graph-diff`, `ferrix/evidence-lint` | `wanyrix[bot]`, `wanyrix/…` | CI check + bot identities in PR fixture |
| 10 | `/api/ferrix/` | `/api/wanyrix/` | API routes move with directory rename |
| 11 | `@/lib/ferrix`, `@/components/ferrix` | `@/lib/wanyrix`, `@/components/wanyrix` | module paths |
| 12 | `Roy-Wanyoike/ferrix` | `Roy-Wanyoike/wanyrix` | repo URL constant + README (GitHub-side rename documented, not invented) |
| 13 | `__ferrix_storage_state__` | `__wanyrix_storage_state__` | in-process server key (no persistence) |
| 14 | `ferrix` | `wanyrix` | all remaining lowercase (CLI strings, copy, config) |
| 15 | `Ferrix` | `Wanyrix` | brand copy, metadata, comments |
| 16 | `FERRIX` | `WANYRIX` | footer badge |

## 4. Compatibility & persistence (§8/§9 of the program)

Persisted browser state uses three zustand `persist` keys:

| Old key | New key | Store shape |
| --- | --- | --- |
| `ferrix.active-workspace` | `wanyrix.active-workspace` | `{ active: string }` |
| `ferrix.diff-queue` | `wanyrix.diff-queue` | `{ state: { entries }, version }` |
| `ferrix.scan-store` | `wanyrix.scan-store` | `{ state: { history }, version }` |

Migration: **controlled, deterministic, idempotent, safe** — implemented in
`src/lib/wanyrix/legacy-migration.ts` as a custom zustand `StateStorage`:

```text
getItem(newKey) → hit  ? return it
              → miss  ? read legacy key
                      ? copy value to newKey (write-through), return it
                      : return null
setItem(newKey, value) → write newKey only
removeItem(newKey)     → remove newKey AND legacy key (migration completion marker)
```

* legacy keys are **read-only compatibility surfaces**; they are never written
* migration completes lazily on first write after hydration (deterministic, idempotent)
* no data is destroyed before it has been copied (safe, reversible by re-seeding)
* the database (`db/custom.db`, Prisma) contains no branded identifiers → **no DB migration**
* `ferrix_state.db`-style on-disk artifacts do not exist in the web repo → **N/A**

## 5. Git / repository metadata (§16)

* `git remote` is `https://github.com/Roy-Wanyoike/ferrix.git` — **left untouched**
  (program rule: do not modify the remote unless the GitHub-side rename actually happened).
* `REPO_URL` constant + README links point at `Roy-Wanyoike/wanyrix` — the required
  GitHub-side action is: **rename the GitHub repository `ferrix` → `wanyrix`**
  (GitHub auto-redirects the old URL). Until then links 404-by-design and are tracked
  in the migration report as a documented follow-up, not a code defect.

## 6. Out of scope for this repository (tracked, not forgotten)

* Rust/Cargo workspace, crates, `cargo check/test` — no Rust code in this repo
* protobuf/event subjects (`wanyrix.repository.discovered.v1` …) — no event bus in this repo;
  the web platform's mock event names (CI checks, bot comments) are migrated as fixtures
* Docker/K8s/Helm/Terraform/OpenTofu — absent from this repo
* telemetry namespaces (`wanyrix_analysis_duration_seconds`) — no OTel in this repo;
  browser analytics provider (`@vercel/analytics`) is brand-neutral

## 7. Allowed residual references (post-migration whitelist)

1. `docs/migrations/FERRIX_TO_WANYRIX.md` — this historical migration document
2. `worklog.md` — engineering handover history
3. `src/lib/wanyrix/legacy-migration.ts` — explicit backward-compatibility layer (legacy key names)
4. `scripts/check-branding.sh` — the branding gate itself (pattern definitions)

Everything else must be zero. Enforced by `scripts/check-branding.sh` (CI gate).

---

## 8. Final migration report (post-implementation)

```text
WANYRIX MIGRATION REPORT

Previous Name:            Ferrix
New Name:                 Wanyrix
CLI:                      wanyrix
Engineering IR:           W-EIR

Files Modified:           51 (content) + 3 directory renames + 2 new files
Ferrix References Before: 298 (234 ferrix · 63 Ferrix · 1 FERRIX) + 8 F-EIR + 30+ FER-*
Ferrix References Remaining: 85 total, ALL intentional:
                          - docs/migrations/FERRIX_TO_WANYRIX.md (this document)
                          - README.md Brand history section
                          - src/lib/wanyrix/legacy-migration.ts (compat layer)
                          - scripts/check-branding.sh (gate definitions)
Unexpected References:    0

Lint (bun run lint):            PASS (0 errors)
Runtime (dev server):           PASS (GET / 200, all 12 GET routes 200, explain POST 200)
API Compatibility:              PASS (versioned formats renamed in lockstep:
                                wanyrix.report/v1, wanyrix.scan-history/v1,
                                wanyrix.release-scorecard/v1; producer+consumer ship together)
Configuration Migration:        PASS (localStorage: ferrix.* → wanyrix.* controlled
                                migration verified E2E in browser — legacy keys detected,
                                copied, removed, state restored, idempotent)
Storage Migration:              PASS / N/A (db/custom.db contains no branded identifiers)
Infrastructure:                 N/A (no Docker/K8s/Helm/Terraform in this repo)
Documentation:                  PASS (README + migration doc)
Branding Validation:            PASS (scripts/check-branding.sh)
E2E (agent-browser):            PASS (Overview, Build Doctor scan + WAN-BLD-* findings,
                                Engineering Graph + inspector, Impact Simulator live
                                estimates, CLI contract dialog, Issues board WAN-101…,
                                Scorecard W-EIR gate, light/dark themes, mobile 390px,
                                sticky footer behavior, 0 console errors)
Cargo Check / Tests:            N/A (no Rust code in this repository)
Security Review:                PASS (no secrets/credentials/env vars touched;
                                AI provider config unchanged; telemetry brand-neutral)
Performance Review:             PASS (no runtime characteristics changed — text and
                                identifier substitutions only; API latencies unchanged)

GitHub-side follow-up (documented, not invented):
- Rename the GitHub repository ferrix → wanyrix (git remote left untouched by design)

Final Status:             READY FOR MERGE
```

### Verification evidence (agent-browser session)

1. `document.title` → `Wanyrix — Engineering Intelligence`
2. Legacy migration: seeded `ferrix.active-workspace` + `ferrix.diff-queue` → reload →
   keys migrated to `wanyrix.*`, workspace selector restored to `atlas-consortium`,
   diff queue badge "1 awaiting review", legacy keys removed from localStorage
3. Doctor scan replay → 12 findings with `WAN-BLD-001…004` IDs, MEASURED/ESTIMATED labels
4. Explain POST (AI layer) → grounded answer citing `WAN-BLD-001`
5. Impact simulation: aws-sdk-s3 → 31 crates, +6.9s clean build, +38s CI (ESTIMATED)
6. Scorecard: "W-EIR snapshot integrity" gate + "Clean install, wanyrix --version"
7. Zero console errors across all views; branding gate PASS
