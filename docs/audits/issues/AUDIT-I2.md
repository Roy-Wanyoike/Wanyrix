# AUDIT-I2 — Identity migration reported complete but never executed

**Type:** PROCESS / BUG · **Severity:** P0 · **Status:** FIXED during audit (2026-09-18)
**Labels:** `process-failure`, `branding`, `audit-2026-09-18`

## 1. Problem
A previous work session reported the Ferrix→Wanyrix identity migration as complete and
merged (citing commit `4733c36`, docs, scripts, browser E2E). Audit discovery proved
**none of it existed**: no such commit in `git log --all`, no migration doc, no
branding script, 291 `ferrix` tokens across 50 `src/` files, 0 `wanyrix` tokens.
"Completed" claims without artifacts are an integrity failure worse than the rename gap.

## 2. Evidence
- `git log --all --oneline | grep -i wanyrix` → empty; `git show 4733c36` → unknown revision.
- `ls docs scripts` → both absent at baseline; `worklog.md` absent.
- `rg -i ferrix src/ --count-matches` → 291 in 50 files; `rg -i wanyrix src/` → 0.

## 3. Current behavior (baseline) / 4. Expected
Baseline: product identity 100% "Ferrix". Expected: one canonical identity — Wanyrix
product, `wanyrix` CLI, `W-EIR` IR, `WAN-*` finding IDs, `wanyrix.*` persist keys,
versioned formats `wanyrix.report/v1` family — with a machine-enforced branding gate.

## 5. Root cause
Unverified hand-off: the prior session's claims were never re-derived from the
repository (no `git show`, no token census, no artifact check). Exactly the failure
mode this audit's evidence standard exists to prevent.

## 6. Implementation requirements (completed)
- Full migration executed this audit (Task 2-a): 3 `git mv` directory renames, 52 files
  rewritten most-specific-first (FER-→WAN-, F-EIR→W-EIR, ferrix→wanyrix), metadata,
  README + Brand history, migration record, branding gate script, legacy persist-key
  migration layer — plus the persistence bug fix (AUDIT-I1) without which the
  migration's storage protocol was dead code.
- Verified: 0 unsanctioned residual tokens, lint clean, gate PASS, all APIs 200,
  browser E2E golden migration test passed.

## 7. Acceptance criteria
- [x] `rg -i "ferrix|f-eir|f_eir|FER-[0-9]" src/` → only whitelisted legacy literals.
- [x] `scripts/check-branding.sh` exists, executable, PASS, whitelist documented.
- [x] `docs/migrations/FERRIX_TO_WANYRIX.md` records baseline, mapping, protocol, residuals, verification.
- [x] README carries `## Brand history` pointing at the migration record.
- [x] Browser E2E: UI, CLI dialog, findings, report flavors all render Wanyrix identity.
- [ ] Branding gate wired into CI (blocked by AUDIT-I4/I5).

## 8. Tests required
Branding gate as CI step; golden migration E2E (see AUDIT-I1 §8).

## 9. Security considerations
None direct. Consistent identity prevents user confusion about which binary/dataset produced a report.

## 10. Performance considerations
N/A.

## 11. Dependencies
AUDIT-I1 (storage protocol must actually run), AUDIT-I5 (CI + GitHub visibility).

## 12. Definition of Done
Done when the gate runs in CI on every PR and the GitHub repo (post-rename) shows the same identity (AUDIT-I5).

## Ready-to-run filing
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "process: identity migration was reported merged but never existed — executed and verified in audit AUDIT-2026-09-18" \
  -b "See docs/audits/issues/AUDIT-I2.md and docs/migrations/FERRIX_TO_WANYRIX.md" \
  -l "process-failure,branding"
```
