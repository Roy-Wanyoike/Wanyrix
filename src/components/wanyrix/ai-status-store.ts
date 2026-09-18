'use client'

import { useSyncExternalStore } from 'react'
import { create } from 'zustand'

/**
 * AI availability state for the system status pill (AUDIT-I3).
 *
 * This is honest local state only: it records the outcome of the last
 * reasoning request this session. No probes or network calls are made —
 * until the user triggers an Explain action, the status stays 'untested'
 * and the UI says exactly that.
 */
export type AiStatus = 'untested' | 'grounded' | 'deterministic'

interface AiStatusState {
  status: AiStatus
  lastCheckedAt: number | null
  setStatus: (status: AiStatus) => void
}

export const useAiStatusStore = create<AiStatusState>()((set) => ({
  status: 'untested',
  lastCheckedAt: null,
  setStatus: (status) => set({ status, lastCheckedAt: Date.now() }),
}))

/** Map an ExplainResponse to the honest pill status. */
export function aiStatusFromExplain(data: { ok?: boolean; grounded?: boolean }): AiStatus {
  return data.ok && data.grounded ? 'grounded' : 'deterministic'
}

const subscribeNoop = () => () => {}

function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  )
}

/**
 * navigator.onLine via useSyncExternalStore — subscribes to the browser's
 * online/offline events. Server snapshot is `true`; the pill renders a
 * neutral state until mounted (same hydration pattern as ThemeToggle).
 */
export function useOnlineStatus(): { mounted: boolean; online: boolean } {
  const mounted = useMounted()
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  )
  return { mounted, online }
}

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}
