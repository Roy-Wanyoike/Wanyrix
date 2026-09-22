/**
 * Issue #128 — doctor replay disclosure (unit suite).
 *
 * Pins the honesty contract at the point of storage: every doctor run
 * recorded through the doctor-view / topbar / ⌘K recorders REPLAYS the stored
 * report (no engine binary invoked), so BOTH persisted records — the History
 * entry and the structured scan-run that syncs to the durable server log —
 * carry `replay: true`. The REAL engine-exec path (the "Real engine binary"
 * panel) records via `recordScanRun` with trigger `'engine-exec'` and never
 * sets the flag: pure flag-plumbing tests below pin both sides.
 *
 * The fixture figures are asserted to flow through UNCHANGED — this fix adds
 * labeling only, never data (Gate 21).
 */
import { beforeEach, describe, expect, test } from 'bun:test'

import { DOCTOR, DOCTOR_ATLAS } from '../../src/lib/wanyrix/fixtures/doctor'
import { buildDoctorRunRecords } from '../../src/lib/wanyrix/hooks'
import { toScanHistoryRunFlavor } from '../../src/lib/wanyrix/flavors'
import { useScanStore, type ScanRunRecord } from '../../src/lib/wanyrix/scan-store'

/* ---------------------------------------------------------------- helpers -- */

const NOW = Date.parse('2026-09-22T12:00:00.000Z')
const STARTED_AT = NOW - 4_300 // wall-clock replay duration measured by the caller

function severityTally(report: typeof DOCTOR) {
  return {
    critical: report.findings.filter((f) => f.severity === 'critical').length,
    warning: report.findings.filter((f) => f.severity === 'warning').length,
    info: report.findings.filter((f) => f.severity === 'info').length,
  }
}

/** Full state reset — the store under test is a module singleton. */
beforeEach(() => {
  useScanStore.setState({
    history: {},
    runs: {},
    runSeq: {},
    scanTick: 0,
    lastTrigger: 'manual',
    runInFlight: false,
    lastRecordedTick: -1,
  })
})

/* ---------------------------------------------- doctor-run record builder -- */

describe('buildDoctorRunRecords — engine-absent doctor runs are marked replay', () => {
  test('BOTH records carry replay: true (history entry + scan-run)', () => {
    const { entry, run } = buildDoctorRunRecords({
      report: DOCTOR,
      trigger: 'manual',
      startedAt: STARTED_AT,
      durationMs: 4_300,
      now: NOW,
      workspaceId: 'helios-platform',
    })
    expect(entry.replay).toBe(true)
    expect(run.replay).toBe(true)
  })

  test('replay marking is trigger-independent (view button, topbar, ⌘K all replay)', () => {
    for (const trigger of ['manual', 'topbar', 'palette'] as const) {
      const { entry, run } = buildDoctorRunRecords({
        report: DOCTOR,
        trigger,
        startedAt: STARTED_AT,
        durationMs: 4_300,
        now: NOW,
        workspaceId: 'helios-platform',
      })
      expect(entry.trigger).toBe(trigger)
      expect(entry.replay).toBe(true)
      expect(run.trigger).toBe(trigger)
      expect(run.replay).toBe(true)
    }
  })

  test('fixture figures flow through UNCHANGED — labeling only, no invented data', () => {
    const { entry, run } = buildDoctorRunRecords({
      report: DOCTOR,
      trigger: 'manual',
      startedAt: STARTED_AT,
      durationMs: 4_300,
      now: NOW,
      workspaceId: 'helios-platform',
    })
    const tally = severityTally(DOCTOR)
    expect(entry.findings).toBe(DOCTOR.findings.length)
    expect(entry.critical).toBe(tally.critical)
    expect(entry.warning).toBe(tally.warning)
    expect(entry.info).toBe(tally.info)
    expect(entry.buildTime).toBe(DOCTOR.buildTime)
    expect(entry.estimatedFrom).toBe(DOCTOR.estimatedRange[0])
    expect(entry.estimatedTo).toBe(DOCTOR.estimatedRange[1])
    expect(entry.durationMs).toBe(4_300)
    expect(run.findingCount).toBe(DOCTOR.findings.length)
    expect(run.severityCounts).toEqual(tally)
  })

  test('ids and stamps are deterministic from the injected clock', () => {
    const { entry, run } = buildDoctorRunRecords({
      report: DOCTOR_ATLAS,
      trigger: 'topbar',
      startedAt: STARTED_AT,
      durationMs: 1_234,
      now: NOW,
      workspaceId: 'atlas-consortium',
    })
    expect(entry.id).toBe(`scan-${NOW}`)
    expect(entry.at).toBe(NOW)
    expect(entry.workspace).toBe('atlas-consortium')
    expect(run.startedAt).toBe(STARTED_AT)
    expect(run.finishedAt).toBe(NOW)
    expect(run.durationMs).toBe(1_234)
  })

  test('the findings fingerprint still rides along (R7 contract intact)', () => {
    const { entry, run } = buildDoctorRunRecords({
      report: DOCTOR,
      trigger: 'manual',
      startedAt: STARTED_AT,
      durationMs: 4_300,
      now: NOW,
      workspaceId: 'helios-platform',
    })
    expect(Array.isArray(entry.findingIds)).toBe(true)
    expect(entry.findingIds?.length).toBe(DOCTOR.findings.length)
    expect(run.findingIds).toEqual(entry.findingIds)
  })
})

/* ------------------------------------------- real engine path: no replay --- */

describe('engine-present path unchanged — engine-exec runs never gain the flag', () => {
  test("a real engine-exec run recorded via recordScanRun carries NO replay key", () => {
    const record = useScanStore.getState().recordScanRun({
      workspaceId: 'helios-platform',
      startedAt: STARTED_AT,
      finishedAt: NOW,
      durationMs: 9_877, // measured by the route, not the terminal replay
      findingCount: 2,
      severityCounts: { critical: 1, warning: 1, info: 0 },
      trigger: 'engine-exec',
      findingIds: ['FER-ENG-001', 'FER-ENG-002'],
    })
    expect(record.trigger).toBe('engine-exec')
    expect(record).not.toHaveProperty('replay')
    // the pinned legacy shape (8 keys + fingerprint) is untouched
    expect(Object.keys(record).sort()).toEqual(
      [
        'durationMs', 'findingCount', 'finishedAt', 'id', 'severityCounts',
        'startedAt', 'trigger', 'workspaceId', 'findingIds',
      ].sort(),
    )
  })

  test('replay: false (or absent) never marks a record — only === true does', () => {
    const base = {
      workspaceId: 'helios-platform',
      startedAt: STARTED_AT,
      finishedAt: NOW,
      findingCount: 1,
      severityCounts: { critical: 0, warning: 1, info: 0 },
    }
    const absent = useScanStore.getState().recordScanRun(base)
    expect(absent).not.toHaveProperty('replay')
    const explicitFalse = useScanStore.getState().recordScanRun({ ...base, replay: false })
    expect(explicitFalse).not.toHaveProperty('replay')
  })
})

/* ------------------------------------------------------- store plumbing --- */

describe('store plumbing — the replay marker persists in both logs', () => {
  test('recordScanRun keeps replay: true alongside the fingerprint keys', () => {
    const record = useScanStore.getState().recordScanRun({
      workspaceId: 'helios-platform',
      startedAt: STARTED_AT,
      finishedAt: NOW,
      durationMs: 4_300,
      findingCount: 3,
      severityCounts: { critical: 0, warning: 2, info: 1 },
      trigger: 'manual',
      findingIds: ['WAN-BLD-001'],
      replay: true,
    })
    expect(record.replay).toBe(true)
    expect(Object.keys(record).sort()).toEqual(
      [
        'durationMs', 'findingCount', 'finishedAt', 'id', 'severityCounts',
        'startedAt', 'trigger', 'workspaceId', 'findingIds', 'replay',
      ].sort(),
    )
  })

  test('the History entry lands in the persisted history log with replay: true', () => {
    const { entry, run } = buildDoctorRunRecords({
      report: DOCTOR,
      trigger: 'manual',
      startedAt: STARTED_AT,
      durationMs: 4_300,
      now: NOW,
      workspaceId: 'helios-platform',
    })
    useScanStore.getState().addEntry('helios-platform', entry)
    const stored = useScanStore.getState().recordScanRun(run)

    const history = useScanStore.getState().history['helios-platform']
    expect(history).toHaveLength(1)
    expect(history[0].replay).toBe(true)
    expect(history[0].id).toBe(entry.id)
    expect(useScanStore.getState().runs['helios-platform'][0].replay).toBe(true)
    expect(stored.replay).toBe(true)
  })

  test('the persisted (zustand persist) envelope carries the marker on the run', () => {
    // simulate the exact flow: builder → recordScanRun → read back from state
    const { run } = buildDoctorRunRecords({
      report: DOCTOR,
      trigger: 'manual',
      startedAt: STARTED_AT,
      durationMs: 4_300,
      now: NOW,
      workspaceId: 'helios-platform',
    })
    const record: ScanRunRecord = useScanStore.getState().recordScanRun(run)
    // postScanRun JSON-serializes the record verbatim — the marker must be on the wire
    const wire = JSON.parse(JSON.stringify(record)) as ScanRunRecord
    expect(wire.replay).toBe(true)
  })
})

/* ------------------------------------------------------- export flavor ---- */

describe('exports carry the disclosure — toScanHistoryRunFlavor passthrough', () => {
  test('a replay entry exports replay: true; a legacy entry omits the key', () => {
    const { entry } = buildDoctorRunRecords({
      report: DOCTOR,
      trigger: 'manual',
      startedAt: STARTED_AT,
      durationMs: 4_300,
      now: NOW,
      workspaceId: 'helios-platform',
    })
    const flavor = toScanHistoryRunFlavor(entry)
    expect(flavor.replay).toBe(true)

    const legacy = toScanHistoryRunFlavor({ ...entry, replay: undefined })
    expect(legacy).not.toHaveProperty('replay')
  })

  test('the marker composes with the existing additive keys (R7 fingerprint + R8 not-measured)', () => {
    const { entry } = buildDoctorRunRecords({
      report: DOCTOR,
      trigger: 'manual',
      startedAt: STARTED_AT,
      durationMs: 4_300,
      now: NOW,
      workspaceId: 'helios-platform',
    })
    const composed = toScanHistoryRunFlavor({
      ...entry,
      buildTimeStatus: 'not-measured',
      findingIdsTruncated: true,
    })
    expect(composed.replay).toBe(true)
    expect(composed.buildTimeStatus).toBe('not-measured')
    expect(composed.findingIdsTruncated).toBe(true)
  })
})
