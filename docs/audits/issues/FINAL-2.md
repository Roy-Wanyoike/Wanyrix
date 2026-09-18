# FINAL-2 — ENG-T3A-1 unindexed in the issue registry (AUDIT-I10 chain break)

## 1. Problem
The issue record `ENG-T3A-1.md` (filed Task 3-a, FIXED + verified in commit
`90e5ec4`) had no row in `ISSUE_REGISTRY.md` — the one broken link in the
otherwise-complete finding-ID → record → commit traceability chain.

## 2. Evidence
`grep -c "ENG-T3A-1" docs/audits/issues/ISSUE_REGISTRY.md` → 0 at filing time
(Task 5-c); record file exists; fix commit message names it.

## 3. Current behavior
Registry readers could not discover the telemetry-conflict issue or its verified fix.

## 4. Expected behavior
Every issue record on disk has exactly one registry row.

## 5. Root cause
Task 3-a lacked registry edit rights; no later round added the row.

## 6. Implementation requirements
Append the ENG-T3A-1 row to the registry Index.

## 7. Acceptance criteria
- [x] ENG-T3A-1 row present.
- [x] AUDIT-I10 chain half verifiable by grep (now 9 hits).

## 8. Tests required
None (registry hygiene); grep check is the verification.

## 9. Security considerations
None. 10. **Performance considerations:** None.

## 11. Dependencies
Closes the chain half of AUDIT-I10.

## 12. Definition of Done
Row added; grep ≥ 1. **Severity:** P4 (hygiene).

## Status — RESOLVED (orchestrator, same round as filing)
Row appended; AUDIT-I10 index status updated. Closes on merge of PR branch
`pr/final-2-registry-index`.

## Ready-to-run filing
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "registry: index ENG-T3A-1 row (traceability chain break, AUDIT-I10 residual)" \
  -b "See docs/audits/issues/FINAL-2.md — RESOLVED in repo; closes on PR merge" -l "traceability"
```
