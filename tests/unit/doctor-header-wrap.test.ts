/**
 * Issue #138 — 3px horizontal overflow on the Builds · Doctor header at 375px.
 *
 * Browser-QA (wave 1, qa-ux) measured documentElement.scrollWidth 378 vs
 * innerWidth 375 on #/doctor at 375×667: the header action cluster
 * (div.flex.items-center.gap-2) laid the output-mode ToggleGroup (~128px) +
 * copy button (~38px) + Run CTA (~180px) on ONE non-wrapping row (~362px)
 * inside the ~343px content column, and the whitespace-nowrap Run button
 * (right edge measured 377.7px) pushed past the viewport edge.
 *
 * bun tests have no layout engine, so this pins the fix at the repo's
 * established contract level (cf. muted-contrast.test.ts dialog pins): the
 * component sources must carry the exact classes/labels that make the row
 * wrap instead of overflow, verified live in the browser post-fix.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const ROOT = join(import.meta.dir, '..', '..')
const sharedTsx = readFileSync(join(ROOT, 'src', 'components', 'wanyrix', 'shared.tsx'), 'utf8')
const doctorTsx = readFileSync(join(ROOT, 'src', 'components', 'wanyrix', 'views', 'doctor-view.tsx'), 'utf8')
const buttonTsx = readFileSync(join(ROOT, 'src', 'components', 'ui', 'button.tsx'), 'utf8')

describe('SectionHeading action cluster — wraps instead of overflowing (issue #138)', () => {
  test('the actions cluster is a wrapping flex row with a shrinkable min width', () => {
    // min-w-0 + flex-wrap drop the cluster's min-content width from "sum of
    // every button" to "widest single child", so the row stacks gracefully
    // on narrow viewports and never pushes past the viewport edge.
    expect(sharedTsx).toContain('"flex min-w-0 flex-wrap items-center gap-2"')
  })

  test('the heading row itself still wraps as a whole (desktop layout untouched)', () => {
    expect(sharedTsx).toContain('"flex flex-wrap items-end justify-between gap-3"')
  })
})

describe('doctor Run CTA — responsive label under the nowrap Button base (issue #138)', () => {
  test('the Button base keeps whitespace-nowrap + shrink-0 (fix is at the container, not the design system)', () => {
    expect(buttonTsx).toContain('whitespace-nowrap')
    expect(buttonTsx).toContain('shrink-0')
  })

  test('mobile gets the short label, sm+ keeps the full label (desktop unchanged)', () => {
    expect(doctorTsx).toContain('<span className="sm:hidden">Run doctor</span>')
    expect(doctorTsx).toContain('<span className="hidden sm:inline">Run wanyrix doctor</span>')
  })

  test('each label variant appears exactly once (the CTA stays findable per breakpoint)', () => {
    expect(doctorTsx.match(/Run wanyrix doctor/g)).toHaveLength(1)
    expect(doctorTsx.match(/Run doctor/g)).toHaveLength(1)
  })
})
