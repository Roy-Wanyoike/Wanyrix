/**
 * R9 — build telemetry feed + cache-rate resolution (unit suite).
 *
 * Pins:
 * - the persisted envelope of `wanyrix.build-telemetry` (own key, only the
 *   measurement is durable — real persist middleware, in-memory storage);
 * - `resolveCacheHit` preference order: a SUCCESSFUL measured build wins,
 *   a failed build never feeds the economics model, out-of-range data is
 *   rejected loudly, and the demo's CI-telemetry derivation stays the
 *   documented fallback (32 default included).
 */
import { beforeEach, describe, expect, test, afterAll } from 'bun:test'
import type { StateStorage } from 'zustand/middleware'

import {
  useBuildTelemetryStore,
  type MeasuredBuildTelemetry,
} from '../../src/lib/wanyrix/build-telemetry-store'
import {
  cacheRateFromReport,
  resolveCacheHit,
} from '../../src/lib/wanyrix/cache-rate'
import { createJSONStorage } from 'zustand/middleware'
import { createMigratingStorage } from '../../src/lib/wanyrix/legacy-migration'
import type { DoctorReport } from '../../src/lib/wanyrix/types'

/* ------------------------------------------------------------- fixtures */

const T0 = 1_760_000_000_000

function telemetry(overrides: Partial<MeasuredBuildTelemetry> = {}): MeasuredBuildTelemetry {
  return {
    cacheHitRate: 100,
    artifactsFresh: 60,
    artifactsTotal: 60,
    wallClockMs: 57,
    buildSuccess: true,
    measuredAt: T0,
    binaryVersion: 'wanyrix 0.4.0',
    workspace: 'engine',
    ...overrides,
  }
}

function report(cacheMissDetail = 'CI warm — 68% cache miss across 50 jobs/day'): DoctorReport {
  return {
    workspace: 'helios-platform',
    profile: 'dev',
    toolchain: 'stable',
    buildTime: 87.4,
    estimatedRange: [52, 61],
    confidence: 91,
    criticalPath: [],
    findings: [],
    scannedAt: new Date(T0).toISOString(),
    phases: [{ label: 'CI telemetry', detail: cacheMissDetail }],
    summary: { developerBuild: '87.4s', ciBuild: '3m 10s', diskUsage: '4.2 GB' },
  }
}

/* ------------------------------------------------- cache-rate resolution */

describe('resolveCacheHit — preference order, labeled honestly', () => {
  test('a SUCCESSFUL measured build wins and is labeled as the exec source', () => {
    const r = resolveCacheHit(report(), telemetry({ cacheHitRate: 100 }))
    expect(r.source).toBe('engine-build-exec')
    expect(r.rate).toBe(100)
    expect(r.detail).toContain('wanyrix build exec')
    expect(r.measuredAt).toBe(T0)
    expect(r.rejected).toBeUndefined()
  })

  test('the rate is rounded and clamped inputs at the 0/100 edges are accepted', () => {
    expect(resolveCacheHit(report(), telemetry({ cacheHitRate: 96.4 })).rate).toBe(96)
    expect(resolveCacheHit(report(), telemetry({ cacheHitRate: 0 })).source).toBe('engine-build-exec')
    expect(resolveCacheHit(report(), telemetry({ cacheHitRate: 100 })).source).toBe('engine-build-exec')
  })

  test('a FAILED build never feeds the model — fallback + rejected reason', () => {
    const r = resolveCacheHit(report(), telemetry({ buildSuccess: false, cacheHitRate: 100 }))
    expect(r.source).toBe('ci-telemetry')
    expect(r.rate).toBe(32) // 100 − 68% cache miss
    expect(r.rejected).toBe('failed-build')
  })

  test('out-of-range stored figures are rejected as corrupt, not guessed', () => {
    expect(resolveCacheHit(report(), telemetry({ cacheHitRate: 140 })).rejected).toBe('out-of-range')
    expect(resolveCacheHit(report(), telemetry({ cacheHitRate: -3 })).rejected).toBe('out-of-range')
    expect(resolveCacheHit(report(), telemetry({ cacheHitRate: Number.NaN })).rejected).toBe(
      'out-of-range',
    )
  })

  test('no telemetry → the demo derivation, labeled as the fixture source', () => {
    const r = resolveCacheHit(report(), null)
    expect(r.source).toBe('ci-telemetry')
    expect(r.rate).toBe(32)
    expect(r.detail).toContain('demo fixture')
    expect(resolveCacheHit(report(), undefined).rate).toBe(32)
  })

  test('a doctor payload without the cache-miss phase defaults to 32 (pre-R9 contract)', () => {
    expect(cacheRateFromReport(report('linking — 12.1s'))).toBe(32)
    expect(cacheRateFromReport(report('CI warm — 75% cache miss across 50 jobs/day'))).toBe(25)
  })
})

/* ---------------------------------------------------------- persistence */

describe('wanyrix.build-telemetry — persisted envelope (real persist middleware)', () => {
  let map: Map<string, string>

  beforeEach(() => {
    map = new Map()
    const storage: StateStorage = {
      getItem: (name) => map.get(name) ?? null,
      setItem: (name, value) => void map.set(name, value),
      removeItem: (name) => void map.delete(name),
    }
    useBuildTelemetryStore.persist.setOptions({ storage: createJSONStorage(() => storage) })
    useBuildTelemetryStore.getState().clear()
  })

  afterAll(() => {
    // restore the exact production wiring (migrating storage thunk)
    useBuildTelemetryStore.persist.setOptions({ storage: createJSONStorage(createMigratingStorage) })
  })

  test('recordBuild persists ONLY { latest } under wanyrix.build-telemetry (version 0)', () => {
    useBuildTelemetryStore.getState().recordBuild(telemetry())

    const raw = map.get('wanyrix.build-telemetry')
    expect(typeof raw).toBe('string')
    const envelope = JSON.parse(raw as string) as {
      state: Record<string, unknown>
      version: number
    }
    expect(envelope.version).toBe(0)
    expect(Object.keys(envelope.state).sort()).toEqual(['latest'])
    expect((envelope.state.latest as MeasuredBuildTelemetry).cacheHitRate).toBe(100)
    expect((envelope.state.latest as MeasuredBuildTelemetry).binaryVersion).toBe('wanyrix 0.4.0')
  })

  test('the latest measurement overwrites the previous one', () => {
    useBuildTelemetryStore.getState().recordBuild(telemetry({ cacheHitRate: 88 }))
    useBuildTelemetryStore.getState().recordBuild(telemetry({ cacheHitRate: 100, measuredAt: T0 + 5 }))
    expect(useBuildTelemetryStore.getState().latest?.cacheHitRate).toBe(100)
    expect(useBuildTelemetryStore.getState().latest?.measuredAt).toBe(T0 + 5)
  })

  test('clear drops the measurement (transient test reset)', () => {
    useBuildTelemetryStore.getState().recordBuild(telemetry())
    useBuildTelemetryStore.getState().clear()
    expect(useBuildTelemetryStore.getState().latest).toBeNull()
  })
})
