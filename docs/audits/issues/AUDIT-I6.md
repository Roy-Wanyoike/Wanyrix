# AUDIT-I6 — No product documentation tree

**Type:** DOCUMENTATION · **Severity:** P3 · **Status:** Open (scaffolding created by audit)
**Labels:** `docs`, `audit-2026-09-18`

## 1. Problem
Before this audit the repository had **no `docs/` directory at all**: no architecture
notes, no API contract reference, no CLI contract page, no data-dictionary for the
fixture corpora. Product knowledge lived only in code and commit messages. (README's
surface table is good but shallow.)

## 2. Evidence
- Baseline `ls docs/` → absent; first `docs/` files are audit/migration records from this audit.

## 3. Current behavior / 4. Expected
Current: `docs/audits/`, `docs/migrations/` exist (audit outputs). Expected: product docs
alongside them.

## 5. Root cause
Docs were never part of any round's definition-of-done.

## 6. Implementation requirements
- `docs/ARCHITECTURE.md` — view/store/API map (can be generated largely from this audit's baseline §4).
- `docs/CLI_CONTRACT.md` — the 8 `wanyrix …` commands as rendered by cli-dialog, kept in sync via a unit test that greps the dialog source (see AUDIT-I4).
- `docs/API_ROUTES.md` — 13 routes with status-code contracts (impact 404/400, explain 400/405 documented).

## 7. Acceptance criteria
- [ ] Three docs exist, reviewed against code; API doc lists every route with its verified contract table.

## 8. Tests required
Contract tests from AUDIT-I4 double as doc validation.

## 9. Security considerations
Do not document internal-only fixtures as if they were production guarantees; label demonstrator scope.

## 10. Performance considerations
N/A.

## 11. Dependencies
None.

## 12. Definition of Done
Docs merged and linked from README.

## Ready-to-run filing
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "docs: add ARCHITECTURE / CLI_CONTRACT / API_ROUTES docs" \
  -b "See docs/audits/issues/AUDIT-I6.md" -l "docs"
```
