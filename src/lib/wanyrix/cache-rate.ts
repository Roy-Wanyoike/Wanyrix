/**
 * Cache-hit rate resolution (R9) — pure helper deciding WHERE the sccache
 * simulator's "current" rate comes from.
 *
 * Preference order (each step labeled, never blended):
 * 1. `engine-build-exec` — the latest MEASURED rate from a SUCCESSFUL real
 *    `wanyrix build` run (build-telemetry store). The one figure that came
 *    from an actual instrumented build on this machine.
 * 2. `ci-telemetry` — the doctor payload's phase detail ("N% cache miss"),
 *    the demo figure the simulator used before R9.
 *
 * A FAILED build never feeds the economics model (its rate belongs to a
 * broken compile, not a clean-build steady state) — the caller is told so
 * via `rejected` and can explain the fallback honestly.
 */

import type { MeasuredBuildTelemetry } from './build-telemetry-store'
import type { DoctorReport } from './types'

export type CacheRateSource = 'engine-build-exec' | 'ci-telemetry'

export interface ResolvedCacheRate {
  rate: number
  source: CacheRateSource
  /** epoch ms of the engine measurement (exec source only). */
  measuredAt?: number
  /** short human source label for the UI. */
  detail: string
  /** set when a stored measurement existed but was NOT usable. */
  rejected?: 'failed-build' | 'out-of-range'
}

const EXEC_DETAIL = 'measured · wanyrix build exec'
const CI_DETAIL = 'measured · CI telemetry phase (demo fixture)'

/**
 * The pre-R9 derivation: parse the doctor payload's CI phase detail
 * ("… 68% cache miss" → 32) with the documented 32 default.
 */
export function cacheRateFromReport(report: DoctorReport): number {
  const phase = report.phases.find((p) => /cache miss/i.test(p.detail))
  if (!phase) return 32
  const m = phase.detail.match(/(\d+)% cache miss/i)
  return m ? 100 - Number(m[1]) : 32
}

/**
 * Resolve the simulator's "current" cache-hit rate from the doctor payload
 * plus (optionally) the latest measured build telemetry.
 */
export function resolveCacheHit(
  report: DoctorReport,
  telemetry: MeasuredBuildTelemetry | null | undefined,
): ResolvedCacheRate {
  const usable =
    telemetry !== null &&
    telemetry !== undefined &&
    Number.isFinite(telemetry.cacheHitRate) &&
    telemetry.cacheHitRate >= 0 &&
    telemetry.cacheHitRate <= 100

  if (telemetry && usable) {
    if (telemetry.buildSuccess) {
      return {
        rate: Math.round(telemetry.cacheHitRate),
        source: 'engine-build-exec',
        measuredAt: telemetry.measuredAt,
        detail: EXEC_DETAIL,
      }
    }
    return {
      rate: cacheRateFromReport(report),
      source: 'ci-telemetry',
      detail: CI_DETAIL,
      rejected: 'failed-build',
    }
  }

  if (telemetry && !usable) {
    // a stored figure outside 0–100 is corrupt data — say so, don't guess
    return {
      rate: cacheRateFromReport(report),
      source: 'ci-telemetry',
      detail: CI_DETAIL,
      rejected: 'out-of-range',
    }
  }

  return { rate: cacheRateFromReport(report), source: 'ci-telemetry', detail: CI_DETAIL }
}
