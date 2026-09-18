# ENG-TCB-2 — Honesty badges (ESTIMATED / MEASURED / VERIFIED / HIGH) fail WCAG AA contrast in light theme on the label-densest views

**Type:** BUG / ACCESSIBILITY · **Severity:** P3 · **Status:** FIXED — pending verification
**Fix:** Task 2-f — single source `src/components/wanyrix/shared.tsx` (MEASUREMENT/CONFIDENCE/SEVERITY style maps + DeltaBadge): light-theme text tokens darkened to the `-800` shades (hue families unchanged, no indigo/blue), dark-theme tokens kept; badge size/weight bumped 10px/400 → 11px/500. Browser-measured ≥5.6:1 light, ≥9.4:1 dark (AA ≥4.5).
**Labels:** `bug`, `accessibility`, `contrast`, `honesty`, `persona-qa`, `audit-2026-09-18`

## 1. Problem
The product's core honesty labels — the small uppercase ESTIMATED / MEASURED /
VERIFIED / HIGH chips that carry the "ESTIMATED ≠ MEASURED ≠ VERIFIED" promise —
render at **3.6–3.8 : 1** contrast in **light theme** on the three most
honesty-label-dense views (Builds · Doctor, Impact Simulator, Experiments).
The badges are 10px / weight-400 uppercase text, so WCAG 2.1 AA requires **4.5 : 1**.
All of them pass comfortably in dark theme (11.3–13.0 : 1), so the failure is
specific to the light palette.

## 2. Evidence
Persona 3 (first-time evaluator) contrast audit. Method: computed styles of the badge
elements (fg color + full background alpha chain) → gamma-space alpha compositing →
WCAG 2.1 relative-luminance ratio; the lab()/oklab() converter was validated against
screenshot pixel sampling (predicted rgb(94,233,181) for the dark-theme "measured" fg,
screenshot showed rgb(94,232,181)).

| View | Theme | Badge | Size/Weight | Ratio | AA (4.5:1) |
| --- | --- | --- | --- | --- | --- |
| Builds · Doctor | light | MEASURED | 10px/400 | 3.64 | **FAIL** |
| Builds · Doctor | light | ESTIMATED | 10px/400 | 3.75 | **FAIL** |
| Builds · Doctor | light | HIGH | 10px/400 | 3.61 | **FAIL** |
| Impact Simulator | light | ESTIMATED | 10px/400 | 3.75 | **FAIL** |
| Experiments | light | MEASURED | 10px/400 | 3.64 | **FAIL** |
| Experiments | light | ✓ VERIFIED | 10px/400 | 4.77 | pass |
| Builds · Doctor | dark | MEASURED | 10px/400 | 12.61 | pass |
| Builds · Doctor | dark | ESTIMATED | 10px/400 | 11.33 | pass |
| Impact Simulator | dark | ESTIMATED | 10px/400 | 11.33 | pass |
| Experiments | dark | MEASURED / ✓ VERIFIED | 10px/400 | 12.61 / 12.74 | pass |

Computed fg values (light): MEASURED ≈ rgb(0,122,85) on a 10% green tint over near-white;
ESTIMATED/HIGH analogous amber/rose pairs. Captures:
`/tmp/wanyrix-qa/tcb-08-doctor-light-contrast.png` (light theme, Doctor hero),
`/tmp/wanyrix-qa/px-doctor-light*.png`, dumps `dump-{doctor,sim,exp}-{dark,light}.json`.

## 3. Current behavior
In light theme the honesty chips are the lightest elements on their cards; on low-quality
panels or in sunlight they drop below the legibility floor, and the product's single most
important labeling system (which measurement is measured vs guessed) is the one that
fails. Dark theme is unaffected.

## 4. Expected behavior
Every honesty badge ≥ 4.5 : 1 against its rendered background in **both** themes
(the badges are 10px text — the large-text 3:1 allowance does not apply).

## 5. Root cause
Light-theme token pairing for the badge variants uses mid-luminance brand hues
(green/amber/rose at ~L*44–46) on 10%-alpha tinted light cards; the pair was evidently
tuned for the dark palette where the same hues sit near L*80–90.

## 6. Implementation requirements
- Darken the light-theme badge fg tokens (or add explicit `light:` badge variants) so
  every badge ≥ 4.5 : 1; keep the hue families distinct so ESTIMATED/MEASURED/VERIFIED
  remain distinguishable at a glance and for color-blind users (the uppercase word itself
  already provides the non-color channel — keep it).
- Add a theme-matrix contrast check to the test suite (see §8) so new badge variants
  cannot regress.

## 7. Acceptance criteria
- [ ] All honesty badges ≥ 4.5:1 in light AND dark themes (automated check).
- [ ] No badge relies on color alone (already true — keep).
- [ ] Visual QA on the three densest views in both themes.

## 8. Tests required
Unit test over the badge token pairs computing WCAG ratios from the theme CSS variables
(both themes, fail under 4.5); the computation script used for this record is
reproducible from `dump-*.json` in `/tmp/wanyrix-qa/` (re-home into `tests/`).

## 9. Security considerations
None.

## 10. Performance considerations
None (token change only).

## 11. Dependencies
None.

## 12. Definition of Done
Both themes pass the automated 4.5:1 gate for all badge variants; documented in the
design tokens file.

## Ready-to-run filing
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "a11y: honesty badges (ESTIMATED/MEASURED/VERIFIED/HIGH) fail WCAG AA contrast in light theme (3.6–3.8:1, 10px text)" \
  -b "See docs/audits/issues/ENG-TCB-2.md" -l "bug,accessibility"
```

## Evidence addendum (fix — Task 2-f, frontend fix engineer)
- Fix location: the honesty badges have a SINGLE source — `shared.tsx` (`MeasurementBadge`/`ConfidenceBadge`/`SeverityBadge` consumed by doctor/simulator/experiments/findings/ai/etc.). Light-theme fg tokens darkened (`-300/-400` → `-800`: emerald/orange/teal/amber/red), dark-theme fg tokens unchanged; `MeasurementBadge`+`ConfidenceBadge` bumped `text-[10px]` → `text-[11px] font-medium` (AA small-text 4.5:1 still applies at 11px — ratios below clear it with margin). Hue language preserved (green/orange/teal/amber/red); no indigo/blue introduced.
- Offline token math (`tool-results/badge-contrast/contrast.mjs`; oklch→sRGB, gamma-space alpha compositing over theme surfaces, WCAG 2.1): light card `oklch(0.995 0.003 85)` + 10% tint — MEASURED/deterministic emerald-800 #006045 = 6.84:1 · VERIFIED emerald-800 on 20% tint = 6.20:1 · ESTIMATED orange-800 #9f2d00 = 6.51:1 · HIGH/info teal-800 #005f5a = 6.75:1 · warning/medium amber-800 #973c00 = 6.46:1 · critical red-800 = ~7.3:1; same tokens on the page background `oklch(0.977 0.005 85)` (SectionHeading badges sit there): 5.92–6.80:1. Dark card `oklch(0.18 0.006 60)` (unchanged tokens): 6.00–11.17:1.
- Browser-verified (agent-browser, computed styles → canvas sRGB conversion → full ancestor alpha compositing → WCAG ratio): LIGHT — Doctor: measured 6.61, estimated 6.36, high 6.64, deterministic 6.61, medium 6.26 · Simulator: estimated 6.05, "already in tree" 5.63 · Experiments: measured 6.43, ✓ verified 5.60, estimated 6.19. DARK — Doctor: measured 10.88, estimated 9.83, high 11.26, deterministic 10.88, medium 9.42 · Simulator: estimated 10.61 · Experiments: measured 10.51, ✓ verified 9.91. All 11px/500, all ≥4.5:1. Note: the original record's light-theme table (3.6–3.8:1) under-stated the failure — recomputation of the served tokens gives 1.0–1.6:1 (e.g. MEASURED emerald-300 rgb(94,233,181) on rgb(229,247,238)); verdict direction identical (light FAIL, dark pass).
- Screenshots: `tool-results/task-2f-screens/{doctor-light,doctor-dark}-badges.png`, `{sim-helios-guarded-light,sim-helios-guarded-dark}.png`, `experiments-light-badges.png`.
- §8 theme-matrix test: `tests/**` is outside this task's ownership boundary — the reproducible computation script is re-homed at `tool-results/badge-contrast/contrast.mjs` for the test-harness owner to absorb as a unit test (next action).
- Checks: `bun run lint` clean · `bunx tsc --noEmit` clean · `bun run test` 138 pass / 0 fail.
