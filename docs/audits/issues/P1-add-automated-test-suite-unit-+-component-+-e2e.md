# [P1][web] Add automated test suite (unit + component + E2E) for the web platform

Labels: P1, testing, web

## Problem
The platform's core value — evidence discipline and measurement integrity (estimated/measured/verified, Gate 21) — is enforced only by hand-authored fixture data and manual QA. There are zero automated tests; any refactor (e.g. #5) can silently break semantics.

## Evidence
- Audit §2: “Automated test suite: ❌ — no unit/component/E2E tests in repo (only lint + branding gate)”.
- package.json scripts: only dev/build/start/lint/db:*.

## CurrentBehavior
`bun run lint` and `scripts/check-branding.sh` are the entire verification surface.

## ExpectedBehavior
- Unit tests: data getters (getImpact validation, getDiagnostics workspace routing, report builders produce schema-valid `wanyrix.report/v1`), storage-state mutations (reclaim idempotency), legacy-migration storage (ferrix.*→wanyrix.* incl. idempotency + no-destroy invariant)
- Component/E2E: Playwright — every view renders data, doctor scan completes with 12 findings, simulator estimates update, explain dialog shows structured labels or deterministic fallback, scorecard filters, exports download
- A11y: axe smoke on each view

## AffectedComponents
package.json, new tests/ dir, Playwright config, vitest config.

## RootCause
Rounds 1–10 prioritized feature velocity; verification was agent-browser manual QA each round.

## ImplementationRequirements
vitest (or bun test) + Playwright; run in CI (issue #3); keep runtime deps unchanged.

## AcceptanceCriteria
- [ ] `bun run test` and `bun run test:e2e` green
- [ ] Coverage of all 12 API routes incl. 400/404 validation contracts
- [ ] E2E: golden path scan→finding→explain→experiment→report
- [ ] legacy-migration tests cover detect→copy→remove→idempotent→restore

## TestsRequired
This issue IS the tests.

## SecurityConsiderations
Test fixtures must not embed real credentials; e2e run against local dev only.

## PerformanceConsiderations
E2E budget: full suite <3min; add doctor-replay timing assertion (regression tripwire).

## Dependencies
#3 (CI) to enforce; #5 (data split) easier after tests land — land tests first.

## DefinitionOfDone
CI runs the suite on every PR; audit report §2 row flips to ✅.


---
_Source: Wanyrix full product audit 2026-09-17 (docs/audits/WANYRIX_FULL_AUDIT_REPORT.md · docs/audits/issues/). Labels: P1, testing, web_