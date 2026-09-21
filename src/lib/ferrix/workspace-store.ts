'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Active workspace for every workspace-scoped Ferrix surface.
 * Hooks read this and fold it into their query keys, so switching the
 * workspace refetches all scoped views (issue #34).
 * Selection persists across reloads (localStorage).
 */
interface WorkspaceState {
  active: string
  setActive: (id: string) => void
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      active: 'helios-platform',
      setActive: (id) => set({ active: id }),
    }),
    { name: 'ferrix.active-workspace' },
  ),
)
