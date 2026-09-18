# Migration Record: Ferrix → Wanyrix (Product Identity Rename)

- **Task ID:** 2-a (Wanyrix Post-Rename Engineering Audit)
- **Baseline commit SHA:** `e06866ad013a8f755b176a4244b9ecc043728aee`
- **Baseline date:** 2026-09-18 (audit execution date; baseline commit `e06866a` "f76fd859-1dd1-40c8-85b4-7df708167376")
- **Status:** Executed for real after a previous attempt was reported complete but never landed.
- **Policy:** No `git commit`/`git push`; changes left uncommitted for review. No remote or GitHub settings touched.

---

## 1. Baseline & Discovery

Pre-migration scan (`rg -i "ferrix"`, executed 2026-09-18 at baseline SHA):

| Scope | Files | Case-insensitive `ferrix` matches |
| --- | --- | --- |
| `src/` (total) | 50 | **291** |
| `README.md` | 1 | 7 |
| `examples/` | 0 | 0 |
| Root config files (`package.json`, `tsconfig.json`, `next.config.ts`, `Caddyfile`, `eslint.config.mjs`, `postcss.config.mjs`, `components.json`) | 0 | 0 |

Note: `src/app/layout.tsx` (7 matches) is included in the `src/` totals above.

### Per-file baseline counts (`src/`)

| File | Matches |
| --- | --- |
| src/lib/ferrix/data.ts | 27 |
| src/components/ferrix/app-shell.tsx | 20 |
| src/lib/ferrix/hooks.ts | 15 |
| src/components/ferrix/views/doctor-view.tsx | 15 |
| src/lib/ferrix/types.ts | 14 |
| src/app/api/ferrix/explain/route.ts | 14 |
| src/app/page.tsx | 12 |
| src/lib/ferrix/report.ts | 11 |
| src/components/ferrix/views/scorecard-view.tsx | 11 |
| src/components/ferrix/cli-dialog.tsx | 11 |
| src/components/ferrix/views/pr-view.tsx | 9 |
| src/components/ferrix/diff-queue-sheet.tsx | 9 |
| src/lib/ferrix/patch.ts | 8 |
| src/components/ferrix/views/simulator-view.tsx | 8 |
| src/components/ferrix/scan-history.tsx | 8 |
| src/components/ferrix/views/experiments-view.tsx | 7 |
| src/components/ferrix/command-palette.tsx | 7 |
| src/app/layout.tsx | 7 |
| src/lib/ferrix/storage-state.ts | 6 |
| src/components/ferrix/storage-dialog.tsx | 6 |
| src/components/ferrix/views/issues-view.tsx | 5 |
| src/components/ferrix/explain-dialog.tsx | 5 |
| src/components/ferrix/views/overview-view.tsx | 4 |
| src/components/ferrix/views/diagnostics-view.tsx | 4 |
| src/components/ferrix/views/dependencies-view.tsx | 4 |
| src/components/ferrix/notifications-popover.tsx | 4 |
| src/components/ferrix/finding-sheet.tsx | 4 |
| src/components/ferrix/logo.tsx | 3 |
| src/app/api/ferrix/report/route.ts | 3 |
| src/lib/ferrix/workspace-store.ts | 2 |
| src/lib/ferrix/diff-store.ts | 2 |
| src/components/ferrix/shared.tsx | 2 |
| src/components/ferrix/sccache-simulator.tsx | 2 |
| src/app/globals.css | 2 |
| src/app/api/ferrix/storage/reclaim/route.ts | 2 |
| src/app/api/ferrix/storage/rebuild/route.ts | 2 |
| src/app/api/ferrix/pr/route.ts | 2 |
| src/app/api/ferrix/impact/route.ts | 2 |
| src/lib/ferrix/scan-store.ts | 1 |
| src/components/theme-provider.tsx | 1 |
| src/components/ferrix/view-types.ts | 1 |
| src/app/api/ferrix/workspaces/route.ts | 1 |
| src/app/api/ferrix/storage/route.ts | 1 |
| src/app/api/ferrix/issues/route.ts | 1 |
| src/app/api/ferrix/health/route.ts | 1 |
| src/app/api/ferrix/graph/route.ts | 1 |
| src/app/api/ferrix/gates/route.ts | 1 |
| src/app/api/ferrix/experiments/route.ts | 1 |
| src/app/api/ferrix/doctor/route.ts | 1 |
| src/app/api/ferrix/diagnostics/route.ts | 1 |

### Variant counts at baseline (inside `src/`)

| Pattern | Occurrences | Location(s) |
| --- | --- | --- |
| `FER-[0-9]+` (fixture issue IDs) | 22 | src/lib/ferrix/data.ts |
| `F-EIR` / `f-eir` | 8 | types.ts, storage-state.ts, data.ts |
| `f_eir` / `F_EIR` | 0 | — |
| `FERRIX` (all caps) | 1 | app-shell.tsx (`FERRIX ENGINE v0.4.2` → `WANYRIX ENGINE v0.4.2`) |
| `ferrix.report/v1` | 2 | report.ts, scorecard-view.tsx |
| `ferrix.release-scorecard/v1` | 3 | report.ts, scorecard-view.tsx, data.ts |
| `ferrix.scan-history/v1` | 3 | report.ts, scan-history.tsx, data.ts |
| `ferrix.active-workspace` (persist key) | 1 | workspace-store.ts |
| `ferrix.scan-store` (persist key) | 1 | scan-store.ts |
| `ferrix.diff-queue` (persist key) | 1 | diff-store.ts |

---

## 2. Directory renames (via `git mv`, rename tracking preserved)

| From | To |
| --- | --- |
| `src/app/api/ferrix` | `src/app/api/wanyrix` |
| `src/components/ferrix` | `src/components/wanyrix` |
| `src/lib/ferrix` | `src/lib/wanyrix` |

## 3. Ordered replacement mapping (most-specific-first)

Applied in exactly this order with case-sensitive patterns across all of `src/` + `README.md` (`examples/` had zero occurrences):

| Order | From (regex) | To | Notes |
| --- | --- | --- | --- |
| 1 | `FER-([0-9]+)` | `WAN-$1` | Fixture issue IDs; numbers preserved (`FER-114` → `WAN-114`) |
| 2a | `f_eir` | `w_eir` | 0 occurrences |
| 2b | `F_EIR` | `W_EIR` | 0 occurrences |
| 3a | `F-EIR` | `W-EIR` | IR model name |
| 3b | `f-eir` | `w-eir` | 0 occurrences |
| 4 | `ferrix doctor` / `Ferrix Doctor` | `wanyrix doctor` / `Wanyrix Doctor` | CLI subcommand strings (also covers report/graph/`--json` hints) |
| 5 | `ferrix.<format>` (report/v1, scan-history/v1, release-scorecard/v1) | `wanyrix.<format>` | Versioned format strings |
| 6 | `ferrix.active-workspace`, `ferrix.scan-store`, `ferrix.diff-queue` | `wanyrix.*` | Zustand persist keys — see §4 |
| 7 | `Ferrix` / `ferrix` / `FERRIX` | `Wanyrix` / `wanyrix` / `WANYRIX` | Generic brand tokens (also rewrites import paths `@/lib/ferrix` → `@/lib/wanyrix`, `@/components/ferrix` → `@/components/wanyrix`) |
| 8 | `FerrixLogo` | `WanyrixLogo` | Component name in `src/components/wanyrix/logo.tsx` + importer `app-shell.tsx` (subsumed by rule 7, verified after) |

Total files with content modified: **51** (50 under `src/` + `README.md`).

## 4. Persist-key migration protocol (user data safety)

New file: `src/lib/wanyrix/legacy-migration.ts` exporting
`createMigratingStorage(): StateStorage` (zustand `createJSONStorage`-compatible) and
`LEGACY_PERSIST_KEYS`:

| New key | Legacy key |
| --- | --- |
| `wanyrix.active-workspace` | `ferrix.active-workspace` |
| `wanyrix.scan-store` | `ferrix.scan-store` |
| `wanyrix.diff-queue` | `ferrix.diff-queue` |

Semantics (deterministic, idempotent, SSR-safe):

- `getItem(name)`: returns the new-key value when present. If absent and a legacy source
  exists, reads the old `ferrix.*` value, writes it through to the new key, then removes
  the legacy key **only after** the copy is verified — read-only toward legacy until the
  copy succeeds. Returns `null` when `typeof window === 'undefined'`.
- `setItem(name, value)`: canonicalizes the key (any `ferrix.*` input is mapped/stripped to
  `wanyrix.*`) and writes **only** the new key; legacy keys are never (re-)written.
- `removeItem(name)`: removes both the new and the legacy variant so a reset cannot
  resurrect stale data.

Wired into all three persisted stores (`workspace-store.ts`, `scan-store.ts`,
`diff-store.ts`) via `storage: createJSONStorage(createMigratingStorage())`; every other
persist option left identical.

## 5. N/A items

The following rename surfaces do not exist in this repository and were marked N/A:
Cargo.toml / Rust crate code, Kubernetes manifests/Helm charts, Go modules, Python
packages, iOS/Android strings, native installers. This repo is a Next.js 16 web platform
only.

## 6. Residual whitelist (intentional `Ferrix`/`ferrix` mentions)

1. `docs/migrations/*` — this record and future migration docs (self-referential).
2. `docs/audits/*` — audit records owned by other agents (read-only for this task).
3. `README.md` — only inside the trailing `## Brand history` section.
4. `src/lib/wanyrix/legacy-migration.ts` — legacy key literals required by the migration protocol.
5. `worklog.md` — append-only agent worklog.
6. `scripts/check-branding.sh` — gate script containing the detection pattern itself.

## 7. Final verification report

Measured 2026-09-18 after execution (Step 9 of the task spec):

| Check | Command | Result |
| --- | --- | --- |
| Residual tokens in `src/` | `rg -i "ferrix\|f-eir\|f_eir\|FER-[0-9]" src/ --count-matches` | **ZERO unsanctioned results.** Raw command output: `src/lib/wanyrix/legacy-migration.ts:9` — the single hit file is the spec-whitelisted migration layer whose 9 matches are the mandated legacy-key literals (`ferrix.active-workspace`, `ferrix.scan-store`, `ferrix.diff-queue`, prefix constant, protocol comments). Every other file under `src/` is clean. The whitelist-enforcing gate (next row) is the authoritative policy check. |
| Lint | `bun run lint` | **exit 0, no errors** |
| Branding gate | `bash scripts/check-branding.sh` | **PASS** |
| Home page | `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` | **200** |
| `/api/wanyrix/health?ws=atlas-consortium` | curl | **200** |
| `/api/wanyrix/doctor?ws=atlas-consortium` | curl | **200** |
| `/api/wanyrix/report?ws=atlas-consortium` | curl | **200** |
| `/api/wanyrix/graph?ws=atlas-consortium` | curl | **200** |
| `/api/wanyrix/workspaces` | curl | **200** |
| Leftover `ferrix` in `layout.tsx` | rg | **none** |
| Leftover `ferrix` in `README.md` | rg | only inside `## Brand history` section (intentional) |

## 8. Correction addendum (audit finding AUDIT-2026-09-18 #1)

**Section 7 above was incomplete.** The independent audit's browser E2E (not covered by
the checks in §7) discovered that persistence was **silently broken** in the migrated
stores:

- **Symptom:** every persisted store degraded to in-memory-only state. zustand logged
  `[zustand persist middleware] Unable to update item 'wanyrix.active-workspace', the
  given storage is currently unavailable.` Legacy `ferrix.*` keys were never migrated.

- **Root cause:** the stores were wired as
  `storage: createJSONStorage(createMigratingStorage())`. zustand's
  `createJSONStorage` expects a **thunk** (`() => StateStorage`); passing the
  already-created `StateStorage` object made zustand invoke the object as a function.
  The resulting `TypeError` is swallowed by `createJSONStorage`'s internal
  `try/catch`, which returns `undefined` — so persist silently degraded all three
  stores. Lint, route probes (HTTP 200) and the branding gate **could not catch this**.

- **Fix (applied):** all three stores now pass the function reference:
  `storage: createJSONStorage(createMigratingStorage)`.
  Files: `src/lib/wanyrix/workspace-store.ts`, `scan-store.ts`, `diff-store.ts`.

- **Re-verification (browser E2E, clean Turbopack build):**
  1. Seeded all three legacy keys (`ferrix.active-workspace`, `ferrix.scan-store`,
     `ferrix.diff-queue`) with known values → reload → all three copied to
     `wanyrix.*` **and all three legacy keys removed** (copy-before-delete protocol held).
  2. Restored state observed in the UI (active workspace `atlas-consortium`, scan
     history entry `legacy-1`, diff queue entry `d1`).
  3. UI write-through: switching workspace in the selector immediately persisted the
     new value under `wanyrix.active-workspace`.
  4. Browser console: zero errors, zero zustand warnings.

- **Process lesson recorded for the audit:** "HTTP 200 / component renders / lint clean"
  are **not** runtime proof. Persistence could only be proven by instrumenting real
  browser storage across a reload — exactly the evidence standard the audit mandates.
