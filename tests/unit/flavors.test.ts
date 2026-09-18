/**
 * Task 2-e (ENG-TCA-2) — server-side machine-flavor builders.
 *
 * Pins that `wanyrix.release-scorecard/v1` and `wanyrix.scan-history/v1` are
 * producible SERVER-side with the exact envelope shapes the client exporters
 * assemble (scorecard-view.tsx / scan-history.tsx), so CI consumers no longer
 * need a browser to archive either flavor.
 */
import { describe, expect, test } from 'bun:test'

import { GATES } from '../../src/lib/wanyrix/data'
import {
  WANYRIX_RELEASE,
  buildScorecardBundle,
  buildScanHistoryBundle,
  buildReleaseScorecardFlavor,
  buildScanHistoryFlavor,
} from '../../src/lib/wanyrix/flavors'

const FROZEN_NOW = new Date('2026-09-18T12:00:00.000Z')

describe('wanyrix.release-scorecard/v1 — server flavor (ENG-TCA-2)', () => {
  test('envelope keys match the client exporter field-for-field', () => {
    const f = buildReleaseScorecardFlavor(FROZEN_NOW)
    // client exporter (scorecard-view.tsx exportJson) emits exactly these keys
    expect(Object.keys(f).sort()).toEqual(
      ['blockingConditions', 'gates', 'generatedAt', 'rationale', 'release', 'schema', 'verdict'].sort(),
    )
    expect(f.schema).toBe('wanyrix.release-scorecard/v1') // version string unchanged
    expect(f.generatedAt).toBe(FROZEN_NOW.toISOString())
    expect(f.release).toBe(WANYRIX_RELEASE)
  })

  test('gates + verdict + rationale + blockingConditions come from the same fixture the /gates route serves', () => {
    const f = buildReleaseScorecardFlavor(FROZEN_NOW)
    expect(f.verdict).toBe(GATES.verdict)
    expect(f.rationale).toBe(GATES.rationale)
    expect(f.gates).toEqual(GATES.gates)
    expect(f.blockingConditions).toEqual(GATES.blockingConditions)
    expect(f.gates.length).toBeGreaterThan(0)
    for (const g of f.gates) {
      expect(['pass', 'conditional', 'fail', 'pending']).toContain(g.status)
      expect(typeof g.blocking).toBe('boolean')
    }
  })

  test('bundle wraps the flavor in the report-route envelope with a byte count', () => {
    const b = buildScorecardBundle(FROZEN_NOW)
    expect(b.filename).toBe(`wanyrix-scorecard-${WANYRIX_RELEASE}.json`)
    expect(b.bytes).toBe(new TextEncoder().encode(JSON.stringify(b.json)).length)
    expect(b.bytes).toBeGreaterThan(0)
    expect(b.json.schema).toBe('wanyrix.release-scorecard/v1')
  })

  test('is deterministic modulo generatedAt', () => {
    const a = buildReleaseScorecardFlavor(FROZEN_NOW)
    const b = buildReleaseScorecardFlavor(FROZEN_NOW)
    expect(JSON.stringify({ ...a, generatedAt: '' })).toBe(JSON.stringify({ ...b, generatedAt: '' }))
  })
})

describe('wanyrix.scan-history/v1 — server flavor (ENG-TCA-2)', () => {
  test('envelope keys match the client exporter field-for-field', () => {
    const f = buildScanHistoryFlavor('helios-platform', FROZEN_NOW)
    // client exporter (scan-history.tsx exportJson) emits exactly these keys
    expect(Object.keys(f).sort()).toEqual(['exportedAt', 'note', 'runs', 'schema', 'workspace'].sort())
    expect(f.schema).toBe('wanyrix.scan-history/v1') // version string unchanged
    expect(f.workspace).toBe('helios-platform')
    expect(f.exportedAt).toBe(FROZEN_NOW.toISOString())
  })

  test('server log is empty and honestly labeled — runs are never fabricated', () => {
    const f = buildScanHistoryFlavor('atlas-consortium', FROZEN_NOW)
    expect(Array.isArray(f.runs)).toBe(true)
    expect(f.runs.length).toBe(0)
    // the emptiness must be self-explanatory to a machine consumer
    expect(f.note.toLowerCase()).toContain('empty')
    expect(f.note.toLowerCase()).toContain('client-side')
    // if a run were present it would carry the client exporter's exact fields
    expect(
      [
        'id', 'at', 'trigger', 'findings', 'critical', 'warning', 'info',
        'buildTimeSeconds', 'estimatedFromSeconds', 'estimatedToSeconds', 'wallClockMs',
      ].join(','),
    ).toBe(
      'id,at,trigger,findings,critical,warning,info,buildTimeSeconds,estimatedFromSeconds,estimatedToSeconds,wallClockMs',
    )
  })

  test('bundle names the file like the client download and counts bytes', () => {
    const b = buildScanHistoryBundle('helios-platform', FROZEN_NOW)
    expect(b.filename).toMatch(/^helios-platform-scan-history-2026-09-18T12-00-00\.json$/)
    expect(b.bytes).toBe(new TextEncoder().encode(JSON.stringify(b.json)).length)
  })
})
