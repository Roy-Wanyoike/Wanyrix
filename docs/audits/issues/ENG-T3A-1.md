# ENG-T3A-1 — Telemetry-free claim contradicted by wired-in `@vercel/analytics` snippet

**Type:** BUG / PRIVACY_ACCURACY · **Severity:** P3 · **Status:** FIXED — verified (orchestrator)
**Verification addendum (2026-09-18):** `@vercel/analytics` removed from `src/app/layout.tsx` (import + `<Analytics />` mount replaced with an explanatory comment anchoring the zero-telemetry posture; future telemetry must be strictly opt-in behind a user setting). Gates re-run: lint ✓ · tsc ✓ · 192/192 tests ✓ · brand gate PASS. Browser: fresh reload console clean; Policies·Gates and History exports still work post-change (toasts verified).
**Labels:** `privacy`, `honesty`, `production-validation`, `docs-reconciliation`

## 1. Problem
`docs/PRIVACY.md` and `README.md` claim the product ships **no telemetry/analytics**.
The Next.js scaffold, however, renders Vercel's anonymous page-view snippet in the app
shell — so on any Vercel deployment the product *does* transmit page-view analytics,
contradicting the documented privacy posture (local-first, nothing leaves the machine).
The claim is true for localhost but not for deployments.

## 2. Evidence
- `src/app/layout.tsx` line 7: `import { Analytics } from "@vercel/analytics/next";`
  and line 47: `<Analytics />` (rendered unconditionally inside `<body>`).
- `package.json`: `"@vercel/analytics": "^2.0.1"` in dependencies.
- Privacy claim: `docs/PRIVACY.md` "What we do NOT do" (pre-reconciliation wording:
  "No telemetry, analytics, or crash reporting"); `README.md` § Security & privacy.
- Behavior of `@vercel/analytics`: script not injected in development (localhost), but
  active on Vercel-hosted production deployments, reporting anonymous, cookieless page
  views to Vercel.

## 3. Current behavior
Docs-reconciliation round (Task 3-a) corrected the docs to disclose the snippet
honestly; the snippet itself is still wired in.

## 4. Expected behavior
A local-first, no-telemetry product should not ship a third-party analytics snippet at
all: `@vercel/analytics` removed from `src/app/layout.tsx` and `package.json` (or,
only if a deliberate product decision to keep Vercel deployment analytics is recorded,
PRIVACY.md upgraded to a full disclosure section with an opt-out).

## 5. Root cause
Scaffold default carried through the identity migration; the privacy docs were written
from product intent, not from a layout.tsx read.

## 6. Implementation requirements
- Remove the `import { Analytics }` line and the `<Analytics />` render from
  `src/app/layout.tsx`.
- Remove `"@vercel/analytics"` from `package.json` dependencies + lockfile refresh.
- Re-run `bun run lint` / `bun run typecheck` / `bun run test` (layout change can affect
  the render smoke tests).
- Revert the disclosure caveat in `docs/PRIVACY.md` / `README.md` back to an
  unconditional no-telemetry statement once removal lands.

## 7. Acceptance criteria
- [ ] `grep -r "vercel/analytics" src/ package.json` → no matches.
- [ ] Full gates green (`lint`, `typecheck`, `test`, brand gate).
- [ ] `docs/PRIVACY.md` and `README.md` restored to unconditional no-telemetry claims.

## 8. Tests required
No dedicated test required (render-level removal); existing suite must stay green.

## 9. Security considerations
Removes a third-party script dependency (supply-chain surface shrinkage); no auth
implications (no auth surface exists — `docs/SECURITY.md` §1).

## 10. Performance considerations
One fewer external script on production pages; negligible but strictly positive.

## 11. Dependencies
None. Independent of all open issues; pairs naturally with AUDIT-I8/AUDIT-I9 dev-infra
hygiene.

## 12. Definition of Done
Snippet removed, dependency dropped, gates green, privacy docs restored to the
unconditional claim, this record closed with RUNTIME evidence (page HTML no longer
references the analytics script).

## Ready-to-run filing
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "privacy: remove scaffold @vercel/analytics snippet (contradicts no-telemetry posture)" \
  -b "See docs/audits/issues/ENG-T3A-1.md" -l "privacy"
```
