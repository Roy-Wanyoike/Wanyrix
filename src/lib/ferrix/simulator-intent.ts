'use client'

import { create } from 'zustand'

/**
 * Cross-view deep-link intent (round 10) — lets any surface ask the Impact
 * Simulator to open a specific scenario preselected. Consumed exactly once
 * on simulator mount ("no stale selections" semantics, same as the workspace
 * switch remount); the chip that confirms the routing then dismisses itself.
 *
 * Current producers:
 *  - Engineering Graph duplicates panel: "Simulate resolution" on a
 *    duplicate group whose upgrade closes it (full or partial).
 */
export interface SimulatorIntent {
  mode: 'add-dep' | 'upgrade-dep' | 'edit-file' | 'split-crate'
  /** crate name for add-dep/upgrade-dep */
  target?: string
  /** file path for edit-file */
  file?: string
  /** human-readable origin shown in the confirmation chip */
  source: string
}

interface SimulatorIntentState {
  intent: SimulatorIntent | null
  setIntent: (intent: SimulatorIntent) => void
  consumeIntent: () => SimulatorIntent | null
}

export const useSimulatorIntentStore = create<SimulatorIntentState>()((set, get) => ({
  intent: null,
  setIntent: (intent) => set({ intent }),
  consumeIntent: () => {
    const intent = get().intent
    if (intent) set({ intent: null })
    return intent
  },
}))
