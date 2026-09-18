# AUDIT-I10 — WAN-* ↔ GitHub issue/PR linkage is by-convention only

**Type:** MISSING_FEATURE · **Severity:** P4 · **Status:** PARTIAL (final-audit round — audit-traceability chain mapped; one missing link found, typed-ref feature remains open)
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

## Final-audit round (Task 5-c): audit-traceability mapping — PARTIAL

Every finding-ID prefix now maps → source record → landing commit (verified against `git log` this round):

| ID prefix | Source record (docs/audits/issues/) | Fix landed in commit | Registry indexed |
| --- | --- | --- | --- |
| AUDIT-I1 / I2 (P0 migration + persistence) | `AUDIT-I1.md`, `AUDIT-I2.md` | `02f276e` (real migration; supersedes false `4733c36`) + storage-fix commit | ✔ |
| AUDIT-I3 (navigation) / I4 (test harness) | `AUDIT-I3.md`, `AUDIT-I4.md` | `5d8f35f` (round-11: 18-item IA, harness) | ✔ |
| AUDIT-I5 (GitHub ops) | `AUDIT-I5.md` | n/a — human step (status note appended 5-c) | ✔ |
| AUDIT-I6 (docs tree) / I7 (explain grounding) | `AUDIT-I6.md`, `AUDIT-I7.md` | `64ff952` (round-12) | ✔ |
| AUDIT-I8 (engine scope) / I9 (Turbopack) / I10 (this record) | respective files | n/a / 5-c close / 5-c note | ✔ |
| ENG-TCA-1…7 + ENG-TE-1 (REST/JSON personas) | `ENG-TCA-1.md`…`ENG-TCA-7.md`, `ENG-TE-1.md` | `1f47254` (+ close-out `cb9316f`) | ✔ |
| ENG-TCB-1…2 (UI personas) | `ENG-TCB-1.md`, `ENG-TCB-2.md` | `1f47254` | ✔ |
| ENG-T3A-1 (telemetry/docs conflict) | `ENG-T3A-1.md` | `90e5ec4` (round-13) | **✘ MISSING — not indexed in `ISSUE_REGISTRY.md`** (grep count = 0) |

**Why PARTIAL, not CLOSED:** the chain is complete for every prefix except one exact missing link — **`ENG-T3A-1` exists on disk (filed + FIXED + verified, commit `90e5ec4`) but has no row in `ISSUE_REGISTRY.md`** (neither Index nor Production-validation table; verified by grep this round). Registry edits are append-only and the Index/Production tables are outside this round's edit rights (I5/I9/I10 status columns + new Final-audit section only), so the link is recorded here and in the registry's Final-audit section for the next registry owner to add. The product-side half of this issue (typed `TraceabilityRef` in `types.ts` + validation unit test for the WAN-* board linkage) remains open as originally scoped — that is the PARTIAL residual, dependencies AUDIT-I4 (done) and AUDIT-I5 (pending human) unchanged.
