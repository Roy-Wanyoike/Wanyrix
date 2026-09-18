# AUDIT-I9 — Stale Turbopack chunks after mass rename can serve pre-rename modules in dev

**Type:** INFRASTRUCTURE · **Severity:** P4 · **Status:** Open
**Labels:** `dev-infra`, `turbopack`, `audit-2026-09-18`

## 1. Problem
During the audit, after the directory renames `src/lib/ferrix → wanyrix` etc., the dev
server served **stale pre-rename modules** from `.next/dev` (both client and SSR chunk
graphs referenced `src_lib_ferrix_*` files). A cache-busted navigation was not enough;
only a full `rm -rf .next` + restart produced a coherent graph. Risk: future mass
refactors silently mix old and new modules during development, producing confusing,
non-reproducible behavior.

## 2. Evidence
- `.next/dev/static/chunks/src_lib_ferrix_e9e2db40._.js` and `.next/dev/server/chunks/ssr/src_lib_ferrix_ece2aade._.js` existed alongside wanyrix chunks mid-audit; the ferrix client chunk returned **HTTP 200** from the running dev server.
- Golden migration test: failed on the possibly-mixed graph; passed after clean rebuild (root cause of the failure was AUDIT-I1, but the stale-graph state materially confused diagnosis).

## 3. Current behavior / 4. Expected
Current: Turbopack persistent cache survives mass renames; no guard exists.
Expected: documented recovery step + (optionally) a check script that warns when served
chunks reference paths that no longer exist in `src/`.

## 5. Root cause
Turbopack cache invalidation does not track git-level renames perfectly.

## 6. Implementation requirements
- Add "after mass file moves: stop dev server, `rm -rf .next`, restart" to `docs/migrations/FERRIX_TO_WANYRIX.md` process notes and CONTRIBUTING-style docs.
- Optional: `scripts/dev-doctor.sh` that greps served chunk names for nonexistent `src/` paths.

## 7. Acceptance criteria
- [ ] Recovery documented; optional script exists if implemented.

## 8. Tests required
N/A (dev infra).

## 9. Security considerations
None.

## 10. Performance considerations
N/A (dev-only).

## 11. Dependencies
AUDIT-I6 (docs home).

## 12. Definition of Done
Documented; team awareness recorded.

## Ready-to-run filing
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "dev-infra: document rm -rf .next recovery after mass renames (stale Turbopack chunks)" \
  -b "See docs/audits/issues/AUDIT-I9.md" -l "dev-infra"
```
