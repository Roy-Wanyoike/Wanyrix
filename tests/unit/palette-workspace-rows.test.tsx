/**
 * QA-1 F-2 — palette "Switch workspace" rows are actionable, never a silent
 * disabled dead-end.
 *
 * The palette used to render the CURRENT workspace as a disabled cmdk item:
 * typing "helios" (the default active workspace) showed one [disabled] row and
 * Enter did nothing — no switch, no close, no hint. Fixed honestly: every row
 * is selectable (the current one re-applies the active id — an idempotent
 * write to the SAME store the topbar selector uses — and closes the palette,
 * so Enter acknowledges), and the current row carries a visible "current"
 * label. Pins:
 *   1. render — no row ever renders aria-disabled; the current row is
 *      visibly labeled + titled, a non-current row is switch-titled;
 *   2. wiring — selecting ANY row goes through setActiveWs (same store as the
 *      topbar selector) + closes the palette;
 *   3. regression — the old `disabled={…}` row gate is gone from source.
 *
 * Render tests use react-dom/server (the repo's established SSR pattern,
 * see tests/unit/license-issue.test.tsx).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'

import { Command } from '../../src/components/ui/command'
import { WorkspacePaletteRow } from '../../src/components/wanyrix/command-palette'
import type { WorkspaceSummary } from '../../src/lib/wanyrix/types'

const ROOT = join(import.meta.dir, '..', '..')

const FIXTURE: WorkspaceSummary = {
  id: 'helios-platform',
  name: 'helios-platform',
  description: 'demo fixture',
  crates: 47,
  edges: 72,
  toolchain: 'stable 1.98',
  accent: 'primary',
  status: 'live',
  findings: 12,
  lastScan: '2026-09-22T00:00:00Z',
  fixtureOnly: true,
}

const row = (isCurrent: boolean) =>
  renderToStaticMarkup(
    <Command>
      <WorkspacePaletteRow workspace={FIXTURE} isCurrent={isCurrent} onSelect={() => {}} />
    </Command>,
  )

describe('WorkspacePaletteRow — every row is actionable (F-2)', () => {
  test('the current workspace renders WITHOUT aria-disabled and IS visibly labeled', () => {
    const html = row(true)
    expect(html).not.toContain('aria-disabled="true"')
    expect(html).toContain('>current<')
    expect(html).toContain('is the current workspace')
  })

  test('a non-current workspace renders WITHOUT aria-disabled and is switch-titled', () => {
    const html = row(false)
    expect(html).not.toContain('aria-disabled="true"')
    expect(html).toContain(`Switch to ${FIXTURE.name}`)
    expect(html).not.toContain('>current<')
    expect(html).not.toContain('is the current workspace')
  })

  test('row identity + counts stay pinned (the "helios 47 crates · 12 findings" row)', () => {
    const html = row(true)
    expect(html).toContain(FIXTURE.name)
    expect(html).toContain('47 crates · 12 findings')
  })
})

describe('palette wiring — selecting a workspace switches via the shared store', () => {
  const source = readFileSync(join(ROOT, 'src/components/wanyrix/command-palette.tsx'), 'utf8')

  test('every row routes selection into setActiveWs (same store the selector uses)', () => {
    expect(source).toContain('setActiveWs(w.id)')
  })

  test('the old silent disabled gate is gone from the source', () => {
    expect(source).not.toContain('disabled={w.id === activeWs}')
    expect(source).toContain('WorkspacePaletteRow')
  })
})
