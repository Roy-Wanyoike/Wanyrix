# AUDIT-I10 — WAN-* ↔ GitHub issue/PR linkage is by-convention only

**Type:** MISSING_FEATURE · **Severity:** P4 · **Status:** Open
**Labels:** `traceability`, `audit-2026-09-18`

## 1. Problem
The Issues & PRs board and doctor findings carry stable IDs (`WAN-101…119`) that
*mirror* GitHub issues/PRs by naming convention and hand-written notes (e.g., board rows
for round-6 issues #42–44). Nothing enforces the linkage; a renamed/deleted GitHub
issue, or a typo'd note, silently breaks traceability — the product's own
"every claim has evidence" promise applied to itself.

## 2. Evidence
- `src/lib/wanyrix/data.ts`: board rows embed GitHub URLs and numbers as literals; findings IDs are string constants.
- No validation that referenced issue numbers exist (unverifiable offline by design today).

## 3. Current behavior / 4. Expected
Current: convention + manual notes. Expected: a fixture-level schema with explicit
`source: {repo, number, url}` fields and a unit test validating shape/uniqueness
(and, post-AUDIT-I5, optionally a CI job verifying GitHub reachability).

## 5. Root cause
Fixtures grew organically per round.

## 6. Implementation requirements
- Type the linkage (`TraceabilityRef`) in `types.ts`; migrate board rows; add validation unit test.

## 7. Acceptance criteria
- [ ] All board rows + findings carry typed refs; validation test green.

## 8. Tests required
Unit validation of ref integrity (shape, uniqueness, URL format).

## 9. Security considerations
URLs must point to the canonical repo post-rename (AUDIT-I5).

## 10. Performance considerations
Negligible.

## 11. Dependencies
AUDIT-I4 (test harness), AUDIT-I5 (canonical repo URL).

## 12. Definition of Done
Typed refs + tests merged.

## Ready-to-run filing
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "traceability: type and validate WAN-* ↔ GitHub issue/PR linkage" \
  -b "See docs/audits/issues/AUDIT-I10.md" -l "traceability"
```
