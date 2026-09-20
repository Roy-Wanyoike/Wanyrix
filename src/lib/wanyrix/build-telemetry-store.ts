'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { createMigratingStorage } from './legacy-migration'

/**
 * Latest MEASURED build telemetry (R9) — the feed between the real engine
 * binary and the sccache simulator.
 *
 * Every successful `wanyrix build` exec (Build Doctor → Real engine binary →
 * build mode) records its measured cache-hit rate here. The simulator uses
 * it as the "current" rate instead of the demo fixture's CI-telemetry
 * percentage — so the ONE number that came from a real instrumented build
 * is never confused with the demo figure (Gate 21: sources stay labeled).
 *
 * Persisted (additive, own `wanyrix.build-telemetry` key): a measurement is
 * machine data, and the simulator should still cite it after a reload —
 * with the time it was taken, so a stale rate is never presented as fresh.
 */

/** One measured instrumented-build result (subset of wanyrix.build/v1). */
export interface MeasuredBuildTelemetry {
  /** 0–100, measured from cargo fresh-flag counts (engine's own figure). */
  cacheHitRate: number
  artifactsFresh: number
  artifactsTotal: number
  /** measured wall clock of the build exec, ms (null when the run omitted it). */
  wallClockMs: number | null
  /** false = the build failed; a failed build's rate still feeds nothing. */
  buildSuccess: boolean
  /** epoch ms — when the measurement was taken. */
  measuredAt: number
  /** wanyrix binary version string, e.g. `wanyrix 0.4.0`. */
  binaryVersion: string
  /** workspace the build ran against (engine crate in this demo). */
  workspace: string | null
}

interface BuildTelemetryState {
  latest: MeasuredBuildTelemetry | null
  /** record (overwrite) the latest measured build. */
  recordBuild: (t: MeasuredBuildTelemetry) => void
  /** drop the measurement (used by tests; the UI never fabricates one). */
  clear: () => void
}

export const useBuildTelemetryStore = create<BuildTelemetryState>()(
  persist(
    (set) => ({
      latest: null,
      recordBuild: (t) => set({ latest: t }),
      clear: () => set({ latest: null }),
    }),
    {
      name: 'wanyrix.build-telemetry',
      // only the measurement is durable — actions are transitive
      partialize: (s) => ({ latest: s.latest }),
      storage: createJSONStorage(createMigratingStorage),
    },
  ),
)
