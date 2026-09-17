# [P2][ui] Mobile: horizontal overflow on every view (1022px layout at 390px viewport)

Labels: P2, bug, responsive, ui

## Problem
At mobile widths the whole page is horizontally scrollable (~632px of hidden overflow) because the topbar action row never wraps and forces the layout wider than the viewport.

## Evidence
- agent-browser, viewport 390×844: `document.documentElement.scrollWidth = 1022` on ALL 9 views (Overview, Doctor, Graph, Simulator, Issues, Scorecard…).
- Offenders: `div.flex.min-h-screen.flex-1.flex-col.lg:pl-60 → 1022px`; `header … → 1022px`; header inner row `flex items-center gap-3 … → 1022px`; `ml-auto` cluster → 1006px; workspace combobox → 794px.

## CurrentBehavior
Topbar (search trigger + workspace select + Run scan + Pending diffs + Report + Notifications + theme) is a single non-wrapping flex row; its min-content width (~1022px) stretches the page.

## ExpectedBehavior
`scrollWidth ≤ viewport` on ≤390px: secondary topbar actions collapse into the existing mobile nav / overflow menu (or wrap), search trigger condenses to icon, workspace select shrinks with `min-w-0`.

## AffectedComponents
`src/components/wanyrix/app-shell.tsx` (topbar), possibly shared button cluster.

## RootCause
`flex` defaults to nowrap; the round-1 topbar was designed desktop-first and gained buttons over rounds 2–10 without a mobile collapse.

## ImplementationRequirements
1) `flex-wrap` or `hidden sm:flex` gating for secondary actions; 2) `min-w-0` + truncation on workspace select; 3) keep 44px touch targets; 4) add a Playwright assertion `scrollWidth <= 390` per view (needs #2).

## AcceptanceCriteria
- [ ] All 9 views `scrollWidth ≤ 390` at 390×844 and ≤ 768 at 768×1024
- [ ] No topbar function removed on mobile (accessible via collapse)
- [ ] Sticky-footer behavior unchanged

## TestsRequired
Playwright per-view overflow assertions; manual 390px screenshots.

## SecurityConsiderations
n/a

## PerformanceConsiderations
No JS added; CSS-only preferred.

## Dependencies
#2 for the automated regression test.

## DefinitionOfDone
Audit §5 mobile row flips to PASS; screenshots attached in PR.


---
_Source: Wanyrix full product audit 2026-09-17 (docs/audits/WANYRIX_FULL_AUDIT_REPORT.md · docs/audits/issues/). Labels: P2, bug, responsive, ui_