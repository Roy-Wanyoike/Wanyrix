/**
 * QA-5-B-4 — fixture workspace provenance (honesty blocker fix).
 *
 * The two shipped workspaces (helios-platform, atlas-consortium) are fixture
 * data — `GET /api/wanyrix/workspaces` marks them `fixtureOnly: true` — yet
 * the shell used to badge them "LIVE" and the Overview carried zero
 * demo-data wording. These tests pin the honest provenance layer:
 *
 *   1. the pure mapping (`workspaceProvenance`) — ONLY an explicit
 *      `fixtureOnly: true` is demo data; everything else is engine-measured;
 *   2. the badge component — fixture ⇒ "demo" chip with the
 *      "synthetic demo data" title, and NEVER the word "live";
 *      measured ⇒ "live" chip and never "demo";
 *   3. the Overview banner — states "synthetic demo data" and offers the
 *      path to register a real workspace;
 *   4. source pins — the selector, ⌘K palette, Repositories rows and the
 *      Overview all consume the shared provenance components (one source,
 *      so no surface can drift back to a bare LIVE label).
 *
 * Render tests use react-dom/server (the repo's established SSR pattern,
 * see tests/unit/license-issue.test.tsx).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  FixtureDataBanner,
  PROVENANCE_STYLES,
  WorkspaceProvenanceBadge,
  workspaceProvenance,
} from '../../src/components/wanyrix/shared'

const ROOT = join(import.meta.dir, '..', '..')

/* ------------------------------------------------------- 1. the mapping --- */

describe('workspaceProvenance — fixtureOnly drives the label (QA-5-B-4)', () => {
  test('fixtureOnly: true ⇒ fixture (demo data)', () => {
    expect(workspaceProvenance({ fixtureOnly: true })).toBe('fixture')
  })

  test('registered rows (fixtureOnly: false) ⇒ measured', () => {
    expect(workspaceProvenance({ fixtureOnly: false })).toBe('measured')
  })

  test('absent flag (pre-#129 payloads) ⇒ measured — only an explicit true is a fixture', () => {
    expect(workspaceProvenance({})).toBe('measured')
  })
})

/* --------------------------------------------------------- 2. the badge --- */

describe('WorkspaceProvenanceBadge — fixtures are never LIVE', () => {
  test('fixture workspace renders the DEMO chip + "synthetic demo data" title, never "live"', () => {
    const html = renderToStaticMarkup(<WorkspaceProvenanceBadge fixtureOnly={true} />)
    expect(html).toContain('demo')
    expect(html.toLowerCase()).not.toContain('live')
    expect(html).toContain('synthetic demo data')
  })

  test('engine-measured workspace renders the LIVE chip, never "demo"', () => {
    const html = renderToStaticMarkup(<WorkspaceProvenanceBadge fixtureOnly={false} />)
    expect(html).toContain('live')
    expect(html.toLowerCase()).not.toContain('demo')
    expect(html).toContain('engine-measured workspace')
  })

  test('the badge styles are the AA-checked provenance map (both themes)', () => {
    expect(PROVENANCE_STYLES.fixture).toContain('text-amber-800')
    expect(PROVENANCE_STYLES.fixture).toContain('dark:text-amber-300')
    expect(PROVENANCE_STYLES.measured).toContain('text-emerald-800')
    expect(PROVENANCE_STYLES.measured).toContain('dark:text-emerald-300')
  })
})

/* -------------------------------------------------------- 3. the banner --- */

describe('FixtureDataBanner — Overview states the data is synthetic', () => {
  const html = renderToStaticMarkup(<FixtureDataBanner />)

  test('names the data as synthetic demo data', () => {
    expect(html).toContain('synthetic demo data')
  })

  test('offers the path to real data (register a real workspace)', () => {
    expect(html).toContain('Register a real workspace')
  })

  test('is exposed as a note (assistive tech reads it on first paint)', () => {
    expect(html).toContain('role="note"')
  })

  test('CTA renders when a navigation target is provided', () => {
    const withCta = renderToStaticMarkup(<FixtureDataBanner onNavigateRepositories={() => {}} />)
    expect(withCta).toContain('Connect a local project')
  })
})

/* ------------------------------------------------------ 4. source pins ---- */

describe('provenance components are consumed by every workspace surface', () => {
  const shell = readFileSync(join(ROOT, 'src/components/wanyrix/app-shell.tsx'), 'utf8')
  const palette = readFileSync(join(ROOT, 'src/components/wanyrix/command-palette.tsx'), 'utf8')
  const repositories = readFileSync(
    join(ROOT, 'src/components/wanyrix/views/repositories-view.tsx'),
    'utf8',
  )
  const overview = readFileSync(
    join(ROOT, 'src/components/wanyrix/views/overview-view.tsx'),
    'utf8',
  )

  test('workspace selector renders the provenance badge (not a bare LIVE label)', () => {
    expect(shell).toContain('WorkspaceProvenanceBadge')
    // the old selector chip — a pulsing LIVE label — must be gone
    expect(shell).not.toContain("w.status === 'live'")
  })

  test('⌘K palette workspace rows carry the provenance badge', () => {
    expect(palette).toContain('WorkspaceProvenanceBadge')
  })

  test('Repositories rows carry the provenance badge', () => {
    expect(repositories).toContain('WorkspaceProvenanceBadge')
  })

  test('Overview renders the fixture banner + conditional header badge driven by fixtureOnly', () => {
    expect(overview).toContain('FixtureDataBanner')
    expect(overview).toContain('fixtureOnly === true')
    expect(overview).toContain('synthetic demo data')
  })
})
