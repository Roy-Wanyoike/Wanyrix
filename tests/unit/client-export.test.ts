/**
 * Task 3-b (ENG-TCA-2 follow-up) — client-exporter consolidation.
 *
 * The client-side download builders (`buildClientScorecardExport`,
 * `buildClientScanHistoryExport`) and the HTTP flavor builders now live in
 * the SAME module (src/lib/wanyrix/flavors.ts) and share the same envelope
 * constructor, so a browser download and its HTTP counterpart are
 * field-for-field identical by construction. These tests pin that invariant:
 * envelope keys, version strings, the run-entry mapping, and — for the
 * server flavor — the honesty divergence (server log stays empty; the note
 * says so), byte-for-byte.
 */
import { describe, expect, test } from 'bun:test'

import type { ScanHistoryEntry } from '../../src/lib/wanyrix/scan-store'
import {
  CLIENT_SCAN_HISTORY_NOTE,
  SERVER_SCAN_HISTORY_NOTE,
  WANYRIX_RELEASE,
  buildClientScorecardExport,
  buildClientScanHistoryExport,
  buildReleaseScorecardFlavor,
  buildScanHistoryBundle,
  buildScanHistoryFlavor,
  buildScorecardBundle,
  clientScanHistoryFilename,
  clientScorecardFilename,
  toScanHistoryRunFlavor,
} from '../../src/lib/wanyrix/flavors'

const FROZEN_NOW = new Date('2026-09-18T12:00:00.000Z')
const WS = 'helios-platform'

/** The exact envelope keys the browser exporters have always emitted. */
const SCORECARD_KEYS = ['blockingConditions', 'gates', 'generatedAt', 'rationale', 'release', 'schema', 'verdict']
const SCAN_HISTORY_KEYS = ['exportedAt', 'note', 'runs', 'schema', 'workspace']
const RUN_KEYS = [
  'id', 'at', 'trigger', 'findings', 'critical', 'warning', 'info',
  'buildTimeSeconds', 'estimatedFromSeconds', 'estimatedToSeconds', 'wallClockMs',
]

function logEntry(overrides: Partial<ScanHistoryEntry> = {}): ScanHistoryEntry {
  return {
    id: 'entry-1',
    workspace: WS,
    at: Date.parse('2026-09-18T11:59:30.000Z'),
    durationMs: 4123,
    findings: 17,
    critical: 2,
    warning: 5,
    info: 10,
    buildTime: 47.8,
    estimatedFrom: 41,
    estimatedTo: 44,
    trigger: 'manual',
    ...overrides,
  }
}

/* ------------------------------------------------------------- scorecard -- */

describe('client scorecard export — single source with the HTTP flavor (Task 3-b)', () => {
  test('client export deep-equals the HTTP flavor for the same clock', () => {
    const client = buildClientScorecardExport(FROZEN_NOW)
    const http = buildReleaseScorecardFlavor(FROZEN_NOW)
    expect(client).toEqual(http)
    expect(JSON.stringify(client)).toBe(JSON.stringify(http))
  })

  test('envelope keys are pinned to the exporter contract', () => {
    expect(Object.keys(buildClientScorecardExport(FROZEN_NOW)).sort()).toEqual(SCORECARD_KEYS)
  })

  test('version string + release line unchanged (wanyrix.release-scorecard/v1)', () => {
    const client = buildClientScorecardExport(FROZEN_NOW)
    expect(client.schema).toBe('wanyrix.release-scorecard/v1')
    expect(client.release).toBe(WANYRIX_RELEASE)
    expect(client.generatedAt).toBe(FROZEN_NOW.toISOString())
  })

  test('download filename is byte-identical on both surfaces', () => {
    expect(clientScorecardFilename()).toBe(buildScorecardBundle(FROZEN_NOW).filename)
    expect(clientScorecardFilename()).toBe(`wanyrix-scorecard-${WANYRIX_RELEASE}.json`)
  })

  test('export is deterministic modulo the clock', () => {
    expect(JSON.stringify(buildClientScorecardExport(FROZEN_NOW))).toBe(
      JSON.stringify(buildClientScorecardExport(FROZEN_NOW)),
    )
  })
})

/* ----------------------------------------------------------- scan-history -- */

describe('client scan-history export — single source with the HTTP flavor (Task 3-b)', () => {
  test('envelope keys identical to the HTTP flavor (pinned)', () => {
    const client = buildClientScanHistoryExport(WS, [], FROZEN_NOW)
    const http = buildScanHistoryFlavor(WS, FROZEN_NOW)
    expect(Object.keys(client).sort()).toEqual(SCAN_HISTORY_KEYS)
    expect(Object.keys(client).sort()).toEqual(Object.keys(http).sort())
  })

  test('empty local log → identical to the HTTP flavor except the honesty note', () => {
    const client = buildClientScanHistoryExport(WS, [], FROZEN_NOW)
    const http = buildScanHistoryFlavor(WS, FROZEN_NOW)
    // every shared field is byte-identical…
    expect(client.schema).toBe(http.schema)
    expect(client.workspace).toBe(http.workspace)
    expect(client.exportedAt).toBe(http.exportedAt)
    expect(client.runs).toEqual(http.runs)
    expect(client.runs).toEqual([])
    // …and the ONLY divergence is the documented honesty note: the client
    // log is real per-browser activity, the server log stays honestly empty
    // (Gate 21) — never reconcile one into the other.
    expect(client.note).not.toBe(http.note)
  })

  test('server honesty note is byte-for-byte unchanged by the consolidation', () => {
    // Golden string — proves the envelope-helper refactor did not touch the
    // served flavor (the API contract test also asserts its "empty" wording).
    // Updated when the durable server log (wanyrix.scan-runs/v1) shipped: the
    // export log stays empty by contract, and the note now says where synced
    // runs actually live instead of claiming no server log exists at all.
    expect(SERVER_SCAN_HISTORY_NOTE).toBe(
      'Server-side scan log. Run entries mirror the client exporter exactly (id, at, trigger, findings, critical, warning, info, buildTimeSeconds, estimatedFromSeconds, estimatedToSeconds, wallClockMs, plus the optional R7 findings fingerprint findingIds/findingIdsTruncated when the run carried one). Scan runs are recorded client-side per browser (localStorage) in this demo, so THIS export log stays empty — runs synced to the durable server log are served by GET /api/wanyrix/scan-runs (wanyrix.scan-runs/v1) and are never merged or fabricated here (Gate 21: measured vs estimated labeled per run).',
    )
    expect(buildScanHistoryFlavor(WS, FROZEN_NOW).note).toBe(SERVER_SCAN_HISTORY_NOTE)
  })

  test('client honesty note is byte-for-byte the string the exporter always emitted', () => {
    expect(CLIENT_SCAN_HISTORY_NOTE).toBe(
      'client-side scan log for the web dashboard demo — durations are terminal wall clock; figures mirror the doctor payload (Gate 21: measured vs estimated labeled per run)',
    )
  })

  test('run mapping is field-for-field the exporter contract (pinned keys)', () => {
    const run = toScanHistoryRunFlavor(logEntry())
    expect(Object.keys(run)).toEqual(RUN_KEYS)
    expect(run).toEqual({
      id: 'entry-1',
      at: '2026-09-18T11:59:30.000Z', // epoch ms → ISO, like the exporter
      trigger: 'manual',
      findings: 17,
      critical: 2,
      warning: 5,
      info: 10,
      buildTimeSeconds: 47.8, // entry.buildTime → buildTimeSeconds
      estimatedFromSeconds: 41, // entry.estimatedFrom → estimatedFromSeconds
      estimatedToSeconds: 44, // entry.estimatedTo → estimatedToSeconds
      wallClockMs: 4123, // entry.durationMs → wallClockMs
    })
  })

  test('R7: an entry WITH a fingerprint gains exactly the fingerprint keys (additive)', () => {
    const run = toScanHistoryRunFlavor(
      logEntry({ findingIds: ['WAN-BLD-001', 'WAN-DEP-006'] }),
    )
    expect(Object.keys(run).sort()).toEqual([...RUN_KEYS, 'findingIds'].sort())
    expect(run.findingIds).toEqual(['WAN-BLD-001', 'WAN-DEP-006'])
    expect(run).not.toHaveProperty('findingIdsTruncated')

    const truncated = toScanHistoryRunFlavor(
      logEntry({ findingIds: ['WAN-BLD-001'], findingIdsTruncated: true }),
    )
    expect(Object.keys(truncated).sort()).toEqual(
      [...RUN_KEYS, 'findingIds', 'findingIdsTruncated'].sort(),
    )
    expect(truncated.findingIdsTruncated).toBe(true)
  })

  test('runs are exported in log order (newest first) through the same mapper', () => {
    const entries = [
      logEntry({ id: 'newest', at: Date.parse('2026-09-18T12:00:10.000Z') }),
      logEntry({ id: 'older', at: Date.parse('2026-09-18T11:00:00.000Z') }),
    ]
    const client = buildClientScanHistoryExport(WS, entries, FROZEN_NOW)
    expect(client.runs.map((r) => r.id)).toEqual(['newest', 'older'])
    const http = buildScanHistoryFlavor(WS, FROZEN_NOW)
    for (const run of client.runs) {
      expect(Object.keys(run)).toEqual(RUN_KEYS)
    }
    // both envelopes carry the same schema + workspace + exportedAt for the same ws/clock
    expect(client.schema).toBe(http.schema)
    expect(client.workspace).toBe(http.workspace)
    expect(client.exportedAt).toBe(http.exportedAt)
  })

  test('download filename matches the HTTP bundle name for the same clock', () => {
    const now = new Date('2026-09-18T12:00:00.000Z')
    expect(clientScanHistoryFilename(WS, now)).toBe(buildScanHistoryBundle(WS, now).filename)
    expect(clientScanHistoryFilename(WS, now)).toMatch(
      /^helios-platform-scan-history-2026-09-18T12-00-00\.json$/,
    )
  })
})
