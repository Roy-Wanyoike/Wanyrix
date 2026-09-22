/**
 * QA-1 F-1 — hash-based view routing.
 *
 * The SPA used to hold the active view in bare useState: the URL never left
 * `/`, so refresh dropped the user back to Overview and Back/Forward/bookmark/
 * copy-link could not carry a view. Views are now encoded in the location hash
 * (`#/graph`, …); the window/history wiring lives in src/app/page.tsx and is
 * DOM-bound (this suite is jsdom-free — effects can't run here), so the pin
 * covers the pure routing decisions the page consumes:
 *
 *   1. initial hash → restored view (resolveInitialView / viewFromHash);
 *   2. setView → hash updated (hashForView, round-trip over every view);
 *   3. routing registry completeness — a ViewId added to the union but not
 *      made routable (or a nav item without a route) fails loudly.
 */
import { describe, expect, test } from 'bun:test'

import { NAV_ITEMS } from '../../src/components/wanyrix/nav-registry'
import { VIEW_IDS, hashForView, resolveInitialView, viewFromHash } from '../../src/lib/wanyrix/view-hash'

describe('viewFromHash — initial hash restores the view (F-1)', () => {
  test('a deep-linked hash restores that view', () => {
    expect(resolveInitialView('#/graph')).toBe('graph')
    expect(resolveInitialView('#/findings')).toBe('findings')
    expect(resolveInitialView('#/plans')).toBe('plans')
  })

  test('round-trip: every routable view survives encode → parse', () => {
    for (const view of VIEW_IDS) {
      expect(viewFromHash(hashForView(view))).toBe(view)
    }
  })

  test('anything that does not name a known view falls back to Overview', () => {
    // cold load with no hash, a bare `#`, an unknown id, wrong prefix, garbage
    expect(resolveInitialView(null)).toBe('overview')
    expect(resolveInitialView(undefined)).toBe('overview')
    expect(resolveInitialView('')).toBe('overview')
    expect(resolveInitialView('#')).toBe('overview')
    expect(resolveInitialView('#/does-not-exist')).toBe('overview')
    expect(resolveInitialView('#graph')).toBe('overview') // missing slash prefix
    expect(resolveInitialView('#/GRAPH')).toBe('overview') // case-sensitive ids
    expect(resolveInitialView('view=graph')).toBe('overview') // not the hash scheme
  })
})

describe('hashForView — setView updates the URL fragment (F-1)', () => {
  test('every view maps to a canonical `#/id` fragment', () => {
    expect(hashForView('overview')).toBe('#/overview')
    expect(hashForView('graph')).toBe('#/graph')
    expect(hashForView('settings')).toBe('#/settings')
  })

  test('fragments are always non-empty and start with the shared prefix', () => {
    for (const view of VIEW_IDS) {
      const hash = hashForView(view)
      expect(hash.startsWith('#/')).toBeTrue()
      expect(hash.slice(2)).toBe(view)
    }
  })
})

describe('routing registry completeness (F-1 drift guard)', () => {
  test('every sidebar/palette nav item is routable via its ViewId', () => {
    const navIds = NAV_ITEMS.map((item) => item.id)
    expect(new Set(VIEW_IDS)).toEqual(new Set(navIds))
    expect(VIEW_IDS.length).toBe(19)
  })

  test('VIEW_IDS holds every id exactly once', () => {
    expect(new Set(VIEW_IDS).size).toBe(VIEW_IDS.length)
  })
})
