/**
 * Issue #127 — the command palette promises "Search crates, findings, PRs…"
 * but only view names matched; data queries (`tokio`, `WAN-DEP-006`, a PR id,
 * `regression`) fell through to "No results found."
 *
 * This suite pins the DATA half of the palette index
 * (src/lib/wanyrix/palette-search.ts): the entries are built from the same
 * fixture selectors the /api/wanyrix/* routes serve to the views, scoped to
 * the active workspace, matched with the palette's own word-boundary matcher
 * (paletteFilter, issue #99), and every entry navigates to a real nav view.
 *
 * The view half (nav-registry) keeps its own contract — "view names still
 * match" is pinned here against the same value strings the palette renders.
 */
import { describe, expect, test } from 'bun:test'

import {
  buildPaletteEntries,
  searchPaletteEntries,
  type PaletteDataEntry,
} from '../../src/lib/wanyrix/palette-search'
import { paletteFilter } from '../../src/lib/wanyrix/palette-filter'
import { NAV_ITEMS } from '../../src/components/wanyrix/nav-registry'
import { getDoctor, getGraphPayload } from '../../src/lib/wanyrix/fixtures/selectors'
import { ISSUES } from '../../src/lib/wanyrix/fixtures/issues'
import { EXPERIMENTS } from '../../src/lib/wanyrix/fixtures/experiments'

const HELIOS = 'helios-platform'
const ATLAS = 'atlas-consortium'

const ids = (kind: PaletteDataEntry['kind'], ws = HELIOS) =>
  buildPaletteEntries(ws)
    .filter((e) => e.kind === kind)
    .map((e) => e.id)

describe('palette data index — built from the fixture selectors the views load (issue #127)', () => {
  test('covers every graph node exactly once (crates)', () => {
    expect(ids('crate')).toEqual(getGraphPayload(HELIOS).nodes.map((n) => n.id))
    expect(ids('crate', ATLAS)).toEqual(getGraphPayload(ATLAS).nodes.map((n) => n.id))
  })

  test('covers every doctor finding exactly once', () => {
    expect(ids('finding')).toEqual(getDoctor(HELIOS).findings.map((f) => f.id))
    expect(ids('finding', ATLAS)).toEqual(getDoctor(ATLAS).findings.map((f) => f.id))
  })

  test('covers every traceability row + the workspace PR-regression analysis', () => {
    expect(ids('issue')).toEqual(ISSUES.map((i) => i.id))
    expect(ids('pr')).toEqual(['PR-184'])
    expect(ids('pr', ATLAS)).toEqual(['PR-97'])
  })

  test('covers every experiment — workspace-scoped: atlas has none recorded', () => {
    expect(ids('experiment')).toEqual(EXPERIMENTS.map((e) => e.id))
    expect(ids('experiment', ATLAS)).toEqual([])
  })

  test('every entry navigates to a real view from the nav registry', () => {
    const viewIds = NAV_ITEMS.map((i) => i.id)
    for (const entry of buildPaletteEntries(HELIOS)) {
      expect(viewIds).toContain(entry.view)
    }
  })

  test('match values are unique — cmdk keys selection by value', () => {
    const values = buildPaletteEntries(HELIOS).map((e) => e.value)
    expect(new Set(values).size).toBe(values.length)
  })

  test('deterministic: same workspace, same list', () => {
    expect(JSON.stringify(buildPaletteEntries(HELIOS))).toBe(
      JSON.stringify(buildPaletteEntries(HELIOS)),
    )
  })
})

describe('palette data search — the issue #127 regressions', () => {
  test("`tokio` returns the crate (owning view: graph) — plus findings/experiments that reference it", () => {
    const results = searchPaletteEntries(HELIOS, 'tokio')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]!.kind).toBe('crate')
    expect(results[0]!.id).toBe('tokio')
    expect(results[0]!.view).toBe('graph')
    // the duplicate-version finding and its experiment reference tokio too
    expect(results.some((r) => r.kind === 'finding' && r.id === 'WAN-BLD-002')).toBe(true)
    expect(results.some((r) => r.kind === 'experiment' && r.id === 'EXP-015')).toBe(true)
  })

  test('`WAN-DEP-006` returns exactly that finding (owning view: findings), case-insensitively', () => {
    const results = searchPaletteEntries(HELIOS, 'WAN-DEP-006')
    expect(results).toHaveLength(1)
    expect(results[0]!.kind).toBe('finding')
    expect(results[0]!.id).toBe('WAN-DEP-006')
    expect(results[0]!.view).toBe('findings')
    const lower = searchPaletteEntries(HELIOS, 'wan-dep-006')
    expect(lower).toHaveLength(1)
    expect(lower[0]!.id).toBe('WAN-DEP-006')
  })

  test('a PR id from the traceability table returns its row (owning view: issues)', () => {
    // WAN-110's PR is #20 — the PR number is an alias of the row
    const results = searchPaletteEntries(HELIOS, '20')
    expect(results[0]!.kind).toBe('issue')
    expect(results[0]!.id).toBe('WAN-110')
    expect(results[0]!.view).toBe('issues')
    // the PR-regression analysis answers to its PR number too (owning view: prs)
    const regression = searchPaletteEntries(HELIOS, '184')
    expect(regression[0]!.kind).toBe('pr')
    expect(regression[0]!.id).toBe('PR-184')
    expect(regression[0]!.view).toBe('prs')
  })

  test('`regression` finds the PR guard + the traceability rows that mention it', () => {
    const results = searchPaletteEntries(HELIOS, 'regression')
    expect(results[0]!.kind).toBe('pr')
    expect(results[0]!.view).toBe('prs')
    expect(results.some((r) => r.kind === 'issue' && r.id === 'WAN-107')).toBe(true)
  })

  test('crate and finding titles/aliases match: `gateway`, `payments`, `cache miss`', () => {
    expect(searchPaletteEntries(HELIOS, 'gateway')[0]!.id).toBe('gateway')
    expect(searchPaletteEntries(HELIOS, 'payments')[0]!.id).toBe('payments-core')
    const cache = searchPaletteEntries(HELIOS, 'cache miss')
    expect(cache[0]!.kind).toBe('finding')
    expect(cache[0]!.id).toBe('WAN-DEP-006')
  })
})

describe('palette view search — unchanged (issue #99 contract holds next to data search)', () => {
  test('every view matches its own label under the rendered value string', () => {
    for (const item of NAV_ITEMS) {
      expect(paletteFilter(`${item.label} ${item.hint}`, item.label.split(' ')[0]!.toLowerCase())).toBeGreaterThan(0)
    }
  })

  test('"dep" matches Dependencies and never the Runtime view', () => {
    expect(paletteFilter('Dependencies versions · duplicates', 'dep')).toBeGreaterThan(0)
    expect(paletteFilter('Runtime captured profiles', 'dep')).toBe(-1)
  })
})

describe('palette no-results — honest by construction (issue #127)', () => {
  test('a query nothing matches returns exactly zero results', () => {
    expect(searchPaletteEntries(HELIOS, 'zzz-no-such-record')).toEqual([])
    expect(searchPaletteEntries(HELIOS, 'q).gvn')).toEqual([])
  })

  test('an empty query searches nothing — the palette shows views only', () => {
    expect(searchPaletteEntries(HELIOS, '')).toEqual([])
    expect(searchPaletteEntries(HELIOS, '   ')).toEqual([])
  })
})

describe('palette data search — workspace scoping mirrors the views (issue #34 contract)', () => {
  test('atlas findings/experiments do not leak into helios results, and vice versa', () => {
    expect(searchPaletteEntries(HELIOS, 'ATL-BLD-001')).toEqual([])
    expect(searchPaletteEntries(ATLAS, 'ATL-BLD-001')[0]!.view).toBe('findings')
    expect(searchPaletteEntries(ATLAS, 'EXP-014')).toEqual([])
    expect(searchPaletteEntries(HELIOS, 'arrow')).toEqual([])
    expect(searchPaletteEntries(ATLAS, 'arrow')[0]!.kind).toBe('crate')
    // `tokio` exists in both workspaces' graphs
    expect(searchPaletteEntries(ATLAS, 'tokio')[0]!.kind).toBe('crate')
  })
})
