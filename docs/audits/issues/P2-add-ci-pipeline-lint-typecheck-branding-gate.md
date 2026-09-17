# [P2][ci] Add CI pipeline: lint, typecheck, branding gate, build, dependency audit

Labels: P2, ci, github-actions

## Problem
No GitHub Actions workflows exist. Quality gates (ESLint, tsc, branding gate, production build, dependency audit) are enforced only by local discipline.

## Evidence
- `.github/` absent (git ls-files).
- 25 merged PRs landed without automated checks; audit had to re-verify everything manually.

## CurrentBehavior
Nothing runs on PR/push.

## ExpectedBehavior
Workflow on PR + push to main: 1) `bun install --frozen-lockfile` 2) `bunx tsc --noEmit` 3) `bun run lint` 4) `bash scripts/check-branding.sh` 5) `bun run build` 6) secret scan (gitleaks or pattern set incl. `ghp_`, `x-access-token:`) 7) `bun audit`-equivalent dependency check (advisory, non-blocking initially)

## AffectedComponents
.github/workflows/ci.yml, package.json scripts.

## RootCause
Sandbox workflow pushed directly to main; CI was never scaffolded.

## ImplementationRequirements
Single ci.yml, bun setup action, node 24, concurrency-cancel, ~<5min runtime. Wire #2 tests into the same workflow when they land.

## AcceptanceCriteria
- [ ] ci.yml green on main
- [ ] PRs show required checks
- [ ] Branding gate blocks stale-identity PRs (demonstrate with a failing test commit on a branch)

## TestsRequired
Workflow itself; validate via a branch PR.

## SecurityConsiderations
Minimal `permissions: contents: read`; no secrets in workflow; tokenless.

## PerformanceConsiderations
Use bun cache; target <5min.

## Dependencies
None. #2 plugs into it.

## DefinitionOfDone
Required status checks enabled; audit §2 “CI pipeline” flips to ✅.


---
_Source: Wanyrix full product audit 2026-09-17 (docs/audits/WANYRIX_FULL_AUDIT_REPORT.md · docs/audits/issues/). Labels: P2, ci, github-actions_