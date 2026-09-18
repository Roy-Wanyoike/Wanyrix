# ENG-TCB-2 — Honesty badges (ESTIMATED / MEASURED / VERIFIED / HIGH) fail WCAG AA contrast in light theme on the label-densest views

**Type:** BUG / ACCESSIBILITY · **Severity:** P3 · **Status:** Open
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
