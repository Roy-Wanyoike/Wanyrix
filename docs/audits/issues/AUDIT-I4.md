# AUDIT-I4 — Zero automated tests (no framework installed)

**Type:** TEST_GAP · **Severity:** P1 · **Status:** Open
**Labels:** `testing`, `ci`, `audit-2026-09-18`

## 1. Problem
The repository contains **no test files and no test runner**. Every "verified" claim in
the product's history rests on manual browser checks and HTTP probes. AUDIT-I1 proves
the cost: a P0 persistence bug passed lint + all API probes and was only caught by
manual storage instrumentation.

## 2. Evidence
- `rg -l "\.test\.|\.spec\.|vitest|jest" src/ tests/` → no results; no test deps in package.json.
- No CI workflow directory exists (`.github/` absent) — branding gate has no runner either.

## 3. Current behavior / 4. Expected
Current: manual QA only. Expected: `bun run test` runs vitest unit tests; Playwright
(or agent-browser) E2E smoke covers the golden flows; CI runs lint + brand gate + tests
on every PR.

## 5. Root cause
Project bootstrapped as a demonstrator; testing was never added as rounds piled up.

## 6. Implementation requirements
- Add `vitest` (+ `@testing-library/react` for component smoke) and a `bun run test` script.
- Priority unit targets, in order: `legacy-migration.ts` (protocol + thunk contract — AUDIT-I1), `patch.ts`/`report.ts` (deterministic builders), `data.ts` gates logic, API route handlers (contract table incl. impact 404/400, explain 400/405 contracts).
- One Playwright E2E: golden migration + doctor scan + scorecard export.
- `.github/workflows/ci.yml`: lint → brand gate → unit → E2E (needs AUDIT-I5 for GitHub Actions visibility).

## 7. Acceptance criteria
- [ ] `bun run test` green locally with ≥ the priority unit targets above.
- [ ] E2E smoke green on a clean build.
- [ ] CI workflow file present and running post AUDIT-I5.

## 8. Tests required
This issue *is* the test infrastructure.

## 9. Security considerations
Tests must not require network or secrets; fixtures only.

## 10. Performance considerations
Keep unit suite < 30s; E2E < 5min in CI.

## 11. Dependencies
None for local; AUDIT-I5 for CI execution.

## 12. Definition of Done
Test harness merged; AUDIT-I1 regression test included; CI green.

## Ready-to-run filing
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "test: introduce vitest + E2E harness; add AUDIT-I1 regression test" \
  -b "See docs/audits/issues/AUDIT-I4.md" -l "testing,ci"
```
