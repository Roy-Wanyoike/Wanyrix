# AUDIT-I3 — Navigation completeness: 9/14 required items

**Type:** MISSING_FEATURE · **Severity:** P2 · **Status:** Open
**Labels:** `feature`, `navigation`, `audit-2026-09-18`

## 1. Problem
The audit target specifies 14 navigation items for the product surface. The app ships
9 first-class views. Three more required surfaces exist only as overlays (dialogs/
sheets), and six do not exist at all.

## 2. Evidence
- `src/components/wanyrix/app-shell.tsx` NAV registry: overview, doctor, graph, diagnostics, prs, simulator, experiments, scorecard, issues (9).
- Overlays: `scan-history.tsx` (History), `explain-dialog.tsx` (AI), gates inside scorecard (Policies).
- `src/lib/wanyrix/types.ts` ViewId union has exactly 9 members.
- Browser E2E: nav renders 3 groups / 9 items; no Repositories/Findings/Architecture/Runtime/Organization/Settings destinations.

## 3. Current behavior
History = sheet reachable from Build Doctor; AI = dialog on findings; Policies = section inside Release Scorecard.

## 4. Expected behavior
14 navigable items: Overview · Repositories · Builds · Dependencies · Graph · Findings ·
Architecture · Experiments · Runtime · History · AI · Policies · Organization · Settings.

## 5. Root cause
Product grew feature-by-feature around the doctor/graph loop; the 14-item information
architecture was never implemented.

## 6. Implementation requirements
- New `ViewId` members + NAV groups: Repositories (workspace/crate registry — data exists in workspaces API), Findings (promote doctor findings list with filters), Runtime (async flow + diagnostics runtime data), History (promote scan-history sheet), AI (promote explain dialog + grounding view), Policies (promote gates), Organization (team/membership — needs fixture data), Settings (theme, storage, data export/import).
- Keep overlays (they serve contextual flows); views become the canonical home.
- Mobile nav must scale to 14 items (grouped accordion or drawer).

## 7. Acceptance criteria
- [ ] 14 items render and navigate; each view has title, empty-state, and data from the existing API surface or a new fixture route.
- [ ] No dead links; command palette covers all 14.
- [ ] Mobile (390px) usable.

## 8. Tests required
E2E nav snapshot test listing all 14; per-view smoke (renders, no console errors).

## 9. Security considerations
Settings/Organization must not expose or mutate anything beyond fixtures until real auth exists.

## 10. Performance considerations
Views are client components; lazy-load below-fold views to protect first paint.

## 11. Dependencies
AUDIT-I4 (tests), fixture data work independent.

## 12. Definition of Done
All 14 present, tested, styled, documented in README surface table.

## Ready-to-run filing
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "feat(nav): complete 14-item information architecture (6 missing views, 3 overlay promotions)" \
  -b "See docs/audits/issues/AUDIT-I3.md" -l "feature"
```
