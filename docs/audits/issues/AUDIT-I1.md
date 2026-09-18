# AUDIT-I1 — Persisted stores silently non-persistent + legacy migration dead

**Type:** BUG · **Severity:** P0 · **Status:** FIXED during audit (2026-09-18) — regression test still required
**Labels:** `bug`, `persistence`, `zustand`, `state-loss`, `audit-2026-09-18`

## 1. Problem
All three persisted zustand stores (`wanyrix.active-workspace`, `wanyrix.scan-store`,
`wanyrix.diff-queue`) were wired so that persistence was **silently disabled**: state
survived only in memory, nothing was written to localStorage, and the Ferrix→Wanyrix
legacy-key migration could never run. Users would lose workspace selection, scan
history and the reviewable diff queue on every reload — violating the product's own
"local-first, reviewable state" promise.

## 2. Evidence
- Browser console: `[zustand persist middleware] Unable to update item 'wanyrix.active-workspace', the given storage is currently unavailable.`
- Browser E2E: after workspace switch, `localStorage.getItem('wanyrix.active-workspace')` stayed `null`; seeded legacy keys never migrated across reload.
- Code (pre-fix): `storage: createJSONStorage(createMigratingStorage())` in all three stores.
- zustand 5.0.10 `createJSONStorage`: `try { storage = getStorage() } catch { return undefined }` — errors are swallowed.

## 3. Current behavior (pre-fix)
`createJSONStorage` received a `StateStorage` **object** (result of calling
`createMigratingStorage()`), invoked it as a function, caught the `TypeError`, and
returned `undefined`. persist then took its no-storage branch: reads skipped hydration,
writes logged a warning and mutated memory only.

## 4. Expected behavior
`createJSONStorage(createMigratingStorage)` — the **thunk** is passed; persist hydrates
from localStorage; every state change is written to the `wanyrix.*` key; on first read
with only a legacy `ferrix.*` key present, value is copied to the new key and the legacy
key is removed only after the copy is verified.

## 5. Root cause
API misuse: `createJSONStorage` signature is `(getStorage: () => StateStorage)`. The
bug is invisible to lint/compile (types: `StateStorage` object vs `() => StateStorage`
was accepted because the argument's type was checked against the overload loosely at
call site) and invisible to HTTP probes — only real browser storage inspection caught it.

## 6. Implementation requirements (completed)
- `src/lib/wanyrix/workspace-store.ts` / `scan-store.ts` / `diff-store.ts`:
  `storage: createJSONStorage(createMigratingStorage)` with an explanatory comment.
- Corrective record: `docs/migrations/FERRIX_TO_WANYRIX.md` §8.

## 7. Acceptance criteria
- [x] Switching workspace persists across reload (verified in browser).
- [x] Doctor scan history entry survives reload (verified).
- [x] Diff queue entry survives reload (verified).
- [x] Seeding all three legacy `ferrix.*` keys and reloading migrates all three and removes the legacy keys (verified — copy-before-delete held).
- [x] No zustand persist warnings in console (verified).
- [ ] **Automated regression test asserting the thunk contract** (see Tests) — still open.

## 8. Tests required
- Unit: `createMigratingStorage()` returns an object; `createJSONStorage(createMigratingStorage)` returns a defined `PersistStorage` (would have caught this bug).
- Unit: migration protocol — copy-before-delete, idempotency, legacy never re-written, SSR-safe reads.
- E2E: golden localStorage migration flow (the exact steps performed manually in the audit).

## 9. Security considerations
Legacy keys are deleted only after verified copy — no data loss window. No sensitive
data involved (fixture workspace state).

## 10. Performance considerations
One-time copy per key; negligible. Subsequent reads hit the new key directly.

## 11. Dependencies
None. Independent of all other issues.

## 12. Definition of Done
Fix merged (this audit), migration record §8 present, regression test in CI (depends on AUDIT-I4 harness), no persist warnings in E2E console log.

## Ready-to-run filing
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "bug(persistence): stores silently non-persistent — createJSONStorage must receive a thunk" \
  -b "See docs/audits/issues/AUDIT-I1.md (audit AUDIT-2026-09-18). Fixed in working tree; regression test tracked here until CI exists." \
  -l "bug,persistence"
```
