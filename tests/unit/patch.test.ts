/**
 * Task 2-a (AUDIT-I4) — patch.ts: unified-diff proposal generator.
 *
 * Pins the Gate-19 "approval flag" contract as text: a proposal is a review
 * document that says "apply manually — no silent modification". The generator
 * must never fabricate removed lines (new-proposal semantics only), must be
 * deterministic for the same entry, and must emit `git apply`-parseable
 * new-file diffs with correct hunk counts.
 */
import { describe, expect, test } from 'bun:test'

import {
  buildPatchBundle,
  buildUnifiedDiff,
  patchFilename,
} from '../../src/lib/wanyrix/patch'
import type { DiffEntry } from '../../src/lib/wanyrix/diff-store'

/* ---------------------------------------------------------------- helpers -- */

function entry(overrides: Partial<DiffEntry> = {}): DiffEntry {
  return {
    id: 'diff-42',
    workspace: 'helios-platform',
    at: Date.parse('2026-09-18T10:30:00Z'), // fixed → deterministic output
    source: 'finding',
    kind: 'patch',
    title: 'Split common runtime',
    target: 'common-runtime',
    suggestion: 'Extract telemetry module into common-telemetry',
    status: 'pending',
    ...overrides,
  }
}

function lines(diff: string): string[] {
  return diff.split('\n')
}

/* ------------------------------------------------------------------ diffs -- */

describe('buildUnifiedDiff — structure (git-apply parseable new-file diff)', () => {
  const diff = buildUnifiedDiff(entry())
  const ls = lines(diff)

  test('has the Index/---/+++ header of a new-file proposal', () => {
    expect(ls[0]).toMatch(/^Index: wanyrix-proposals\/.+/)
    expect(ls[1]).toBe('===================================================================')
    expect(ls[2]).toBe('--- /dev/null') // proposal semantics: nothing is removed
    expect(ls[3]).toMatch(/^\+\+\+ wanyrix-proposals\/.+\.patch\.txt$/)
    expect(diff.endsWith('\n')).toBe(true)
  })

  test('hunk header line count matches the emitted additions exactly', () => {
    const hunkIndex = ls.findIndex((l) => l.startsWith('@@'))
    expect(ls[hunkIndex]).toMatch(/^@@ -0,0 \+1,(\d+) @@$/)
    const declared = Number(/@@ -0,0 \+1,(\d+) @@/.exec(ls[hunkIndex])?.[1])
    const additions = ls.slice(hunkIndex + 1).filter((l) => l.length > 0 && l.startsWith('+'))
    expect(declared).toBe(additions.length)
  })

  test('never fabricates removals — every content line is an addition', () => {
    const hunkIndex = ls.findIndex((l) => l.startsWith('@@'))
    const hunkLines = ls.slice(hunkIndex + 1)
    const removals = hunkLines.filter((l) => l.startsWith('-'))
    expect(removals).toEqual([]) // Gate 19: no invented context, no removed lines
    for (const l of hunkLines) {
      expect(l === '' || l.startsWith('+')).toBe(true)
    }
  })

  test('is deterministic for the same entry', () => {
    expect(buildUnifiedDiff(entry())).toBe(buildUnifiedDiff(entry()))
  })
})

describe('buildUnifiedDiff — Gate 19 approval semantics', () => {
  test('requires human approval: proposal says apply manually, never silent modification', () => {
    const diff = buildUnifiedDiff(entry())
    expect(diff).toContain('apply manually')
    expect(diff).toContain('no silent modification')
    expect(diff).toContain('Gate 19')
  })

  test('carries entry metadata (workspace, source, target, kind, finding ref, queued-at)', () => {
    const e = entry({ findingId: 'FER-BLD-001' })
    const diff = buildUnifiedDiff(e)

    expect(diff).toContain('# workspace: helios-platform')
    expect(diff).toContain('# source:   finding')
    expect(diff).toContain('# target:   common-runtime')
    expect(diff).toContain('# kind:     patch')
    expect(diff).toContain('# finding:  FER-BLD-001')
    expect(diff).toContain('# queued:   2026-09-18T10:30:00.000Z') // from e.at, not Date.now()
    expect(diff).toContain('# end of proposal')
  })

  test('suggestion text becomes the + body verbatim (multi-line safe)', () => {
    const e = entry({ suggestion: 'line one\nline two\n\nline four' })
    const diff = buildUnifiedDiff(e)

    expect(diff).toContain('+line one')
    expect(diff).toContain('+line two')
    expect(diff).toContain('+') // blank lines stay bare additions
    expect(diff).toContain('+line four')
  })

  test('estimates are labeled as estimates (Gate 21), and omitted when absent', () => {
    const withEstimate = buildUnifiedDiff(entry({ estimate: '−8.4s per clean build' }))
    expect(withEstimate).toContain('# estimated impact: −8.4s per clean build (estimated — verify via wanyrix experiment, Gate 21)')

    const withoutEstimate = buildUnifiedDiff(entry())
    expect(withoutEstimate).not.toContain('# estimated impact:')
  })
})

describe('proposal naming (slug + extension mapping)', () => {
  test('maps remediation kinds to the documented proposal extensions', () => {
    expect(buildUnifiedDiff(entry({ kind: 'patch' }))).toContain('+++ wanyrix-proposals/split-common-runtime.rs.patch.txt')
    expect(buildUnifiedDiff(entry({ kind: 'config' }))).toContain('+++ wanyrix-proposals/split-common-runtime.toml.patch.txt')
    expect(buildUnifiedDiff(entry({ kind: 'command' }))).toContain('+++ wanyrix-proposals/split-common-runtime.sh.patch.txt')
    expect(buildUnifiedDiff(entry({ kind: 'architecture' }))).toContain('+++ wanyrix-proposals/split-common-runtime.md.patch.txt')
    expect(buildUnifiedDiff(entry({ kind: 'mystery' }))).toContain('+++ wanyrix-proposals/split-common-runtime.patch.txt')
  })

  test('slugs are lowercase, punctuation-collapsed and capped at 48 chars', () => {
    expect(patchFilename(entry({ title: 'Split common runtime! (v2)' }))).toBe(
      'helios-platform-split-common-runtime-v2.patch',
    )
    const long = buildUnifiedDiff(entry({ title: 'x'.repeat(120) }))
    const m = /Index: wanyrix-proposals\/(.+)\.rs\.patch\.txt/.exec(long)
    expect(m?.[1]?.length).toBeLessThanOrEqual(48)
  })

  test('falls back to target when the title is empty, and to "change" when both are', () => {
    expect(patchFilename(entry({ title: '' }))).toBe('helios-platform-common-runtime.patch')
    const bare = buildUnifiedDiff(entry({ title: '', target: '' }))
    expect(bare).toContain('Index: wanyrix-proposals/change.rs.patch.txt')
  })
})

describe('buildPatchBundle — download-all path', () => {
  test('single entry reads "1 diff" and cross-references the finding', () => {
    const bundle = buildPatchBundle([entry({ findingId: 'FER-BLD-001' })])
    expect(bundle).toContain('# wanyrix proposed-change bundle — 1 diff')
    expect(bundle).toContain('# 1. wanyrix-proposals/split-common-runtime.rs.patch.txt — finding FER-BLD-001 — target: common-runtime')
    expect(bundle).toContain('review every')
  })

  test('multiple entries read "diffs" and keep one Index block per entry', () => {
    const bundle = buildPatchBundle([
      entry({ title: 'First', source: 'simulator:add-dep' }),
      entry({ title: 'Second', source: 'simulator:add-dep' }),
    ])
    expect(bundle).toContain('# wanyrix proposed-change bundle — 2 diffs')
    expect(bundle).toContain('# 1. wanyrix-proposals/first.rs.patch.txt — source simulator:add-dep — target: common-runtime')
    expect(bundle).toContain('# 2. wanyrix-proposals/second.rs.patch.txt — source simulator:add-dep — target: common-runtime')
    expect(bundle.match(/^Index: /gm)?.length).toBe(2)
  })

  test('bundle preamble repeats the Gate-19 approval notice and Gate-21 estimate disclaimer', () => {
    const bundle = buildPatchBundle([entry()])
    expect(bundle).toContain('Wanyrix never modifies a repository silently (Gate 19)')
    expect(bundle).toContain('Estimates are estimates: verify via wanyrix experiment (Gate 21).')
  })
})
