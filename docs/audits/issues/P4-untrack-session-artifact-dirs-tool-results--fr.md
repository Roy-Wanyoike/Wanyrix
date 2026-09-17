# [P4][hygiene] Untrack session-artifact dirs (tool-results/) from git

Labels: P4, hygiene, security

## Problem
`tool-results/` (session notes, pasted command output) is tracked in git. It is production noise, triggers false positives in secret scans (literal `x-access-token:$TOKEN` placeholders), and shipped during the recent push.

## Evidence
- git grep for secret patterns hits tool-results/read_*.txt (verified placeholders, not real secrets — audit §4).
- Files have no build/runtime role (not imported anywhere).

## CurrentBehavior
17+ artifact files tracked; bloat history and scan results.

## ExpectedBehavior
`git rm -r --cached tool-results`, add to .gitignore; optionally `docs/` retains any content of value. Do NOT rewrite history (program rule).

## AffectedComponents
.gitignore, git index.

## RootCause
Sandbox tooling wrote artifacts inside the repo root and were committed by catch-all `git add -A`.

## ImplementationRequirements
Untrack + ignore; consider `.gitignore` guard for `tool-results/`, `upload/`, `*.local`.

## AcceptanceCriteria
- [ ] `git ls-files | rg tool-results` empty
- [ ] Secret scan false-positive surface reduced

## TestsRequired
CI secret scan (#3) green with fewer suppressions.

## SecurityConsiderations
Reduces accidental-leak surface for future sessions.

## PerformanceConsiderations
Slightly smaller clone.

## Dependencies
None.

## DefinitionOfDone
Audit §4 hygiene note closed.


---
_Source: Wanyrix full product audit 2026-09-17 (docs/audits/WANYRIX_FULL_AUDIT_REPORT.md · docs/audits/issues/). Labels: P4, hygiene, security_