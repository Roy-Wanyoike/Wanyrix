'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { createMigratingStorage } from './legacy-migration'

/**
 * Active workspace for every workspace-scoped Wanyrix surface.
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
    {
      name: 'wanyrix.active-workspace',
      // NOTE: pass the thunk itself — createJSONStorage expects
      // `() => StateStorage`. Calling createMigratingStorage() here would hand
      // zustand the StateStorage object, whose invocation throws inside
      // createJSONStorage's silent try/catch and disables persistence.
      storage: createJSONStorage(createMigratingStorage),
    },
  ),
)
