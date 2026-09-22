/**
 * Issue #99 P4 — the command palette's tight matcher (palette-filter.ts).
 *
 * Pins the contract that replaced cmdk's loose subsequence scorer: every
 * query token must match a WORD of the item value — exactly, as that word's
 * prefix, or as a word-boundary-anchored span across adjacent words. The
 * regression that motivated this: typing "dep" surfaced "Runtime captured
 * profiles" (d→e→p subsequence across words) above the actual Dependencies
 * entry.
 */
import { describe, expect, test } from 'bun:test'

import { paletteFilter } from '../../src/lib/wanyrix/palette-filter'

/* the real palette strings (nav-registry.ts), as cmdk would see them */
const RUNTIME = 'Runtime captured profiles'
const DEPENDENCIES = 'Dependencies versions · duplicates'
const DOCTOR = 'Builds · Doctor wanyrix doctor'
const HISTORY = 'History scan run log'
const RUN_SCAN = 'Run full scan cargo + git telemetry'

describe('paletteFilter — the "dep" regression (issue #99)', () => {
  test('dep matches Dependencies (word prefix)', () => {
    expect(paletteFilter(DEPENDENCIES, 'dep')).toBeGreaterThan(0)
  })

  test('dep no longer matches Runtime captured profiles (loose subsequence rejected)', () => {
    expect(paletteFilter(RUNTIME, 'dep')).toBe(-1)
  })

  test('mid-word fragments are rejected too (not just subsequences)', () => {
    // "ime" lives inside the word "Runtime" — a substring, but never at a
    // word boundary, so it must not match
    expect(paletteFilter(RUNTIME, 'ime')).toBe(-1)
  })

  test('unrelated queries stay unmatched', () => {
    expect(paletteFilter(HISTORY, 'dep')).toBe(-1)
    expect(paletteFilter(RUN_SCAN, 'dep')).toBe(-1)
  })
})

describe('paletteFilter — scoring ranks exact > prefix > span', () => {
  test('exact word hits outrank word-prefix hits', () => {
    const exact = paletteFilter('Run full scan', 'run')
    const prefix = paletteFilter(RUNTIME, 'run') // "Runtime" starts with "run"
    expect(exact).toBeGreaterThan(prefix)
    expect(exact).toBeGreaterThan(0)
    expect(prefix).toBeGreaterThan(0)
  })

  test('earlier words outrank later words for the same hit kind', () => {
    const first = paletteFilter('captured profiles x', 'cap') // word 1 → 80
    const later = paletteFilter('profiles captured x', 'cap') // word 2 → 79
    expect(later).toBeLessThan(first)
    expect(later).toBeGreaterThan(0)
  })

  test('multi-word queries require every token', () => {
    expect(paletteFilter('scan run log', 'scan log')).toBeGreaterThan(0)
    expect(paletteFilter('scan run log', 'scan missing')).toBe(-1)
  })

  test('a separator-anchored span matches (token with hyphen crossing a boundary)', () => {
    expect(paletteFilter('release verdict GO / NO-GO', 'no-go')).toBeGreaterThan(0)
    // …but a fragment that starts mid-word does not
    expect(paletteFilter('release verdict GO / NO-GO', 'o-go')).toBe(-1)
  })
})

describe('paletteFilter — cmdk integration contract', () => {
  test('empty search keeps every entry (cmdk convention: score ≥ 1)', () => {
    expect(paletteFilter(DEPENDENCIES, '')).toBe(1)
    expect(paletteFilter(DEPENDENCIES, '   ')).toBe(1)
  })

  test('matching is case-insensitive', () => {
    expect(paletteFilter(DEPENDENCIES, 'DEP')).toBeGreaterThan(0)
    expect(paletteFilter(RUNTIME, 'DEP')).toBe(-1)
  })

  test('keywords are honored as alternate match sources (workspace entries)', () => {
    expect(paletteFilter('workspace helios', 'helios')).toBeGreaterThan(0)
    expect(paletteFilter('workspace helios', 'atlas', ['atlas-consortium'])).toBeGreaterThan(0)
  })

  test('doctor entries match their view labels', () => {
    expect(paletteFilter(DOCTOR, 'doctor')).toBeGreaterThan(0)
    expect(paletteFilter(DOCTOR, 'builds')).toBeGreaterThan(0)
    expect(paletteFilter(DOCTOR, 'graph')).toBe(-1)
  })
})
