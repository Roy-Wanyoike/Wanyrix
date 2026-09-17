'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { createMigratingStorage } from './legacy-migration'

/**
 * Reviewable-diff queue (issue #38) — the UI surface for the Gate-19 contract:
 * Wanyrix never modifies a repository silently; proposed changes are queued as
 * reviewable diffs. Entries accumulate per workspace from the Impact Simulator
 * suggestions and finding remediations. "Applied" is a demo state — an entry
 * never claims the repository was touched.
 */

export type DiffSource =
  | 'simulator:add-dep'
  | 'simulator:upgrade-dep'
  | 'simulator:edit-file'
  | 'simulator:split-crate'
  | 'finding'

export type DiffStatus = 'pending' | 'dismissed' | 'applied'

export interface DiffEntry {
  id: string
  workspace: string
  at: number // epoch ms
  source: DiffSource
  kind: string // patch | config | command | architecture (payload remediation kind)
  title: string
  target: string // crate / file / proposal the change concerns
  suggestion: string // the exact recommended-change text from the payload
  estimate?: string // e.g. "−8.4s per clean build" — always an estimate
  status: DiffStatus
  /** doctor finding id when the entry was queued from a finding remediation */
  findingId?: string
}

const CAP = 50

interface DiffQueueState {
  entries: Record<string, DiffEntry[]>
  enqueue: (entry: DiffEntry) => void
  setStatus: (ws: string, id: string, status: DiffStatus) => void
  clearResolved: (ws: string) => void
}

export const useDiffQueueStore = create<DiffQueueState>()(
  persist(
    (set) => ({
      entries: {},
      enqueue: (entry) =>
        set((s) => {
          const list = [entry, ...(s.entries[entry.workspace] ?? [])].slice(0, CAP)
          return { entries: { ...s.entries, [entry.workspace]: list } }
        }),
      setStatus: (ws, id, status) =>
        set((s) => ({
          entries: {
            ...s.entries,
            [ws]: (s.entries[ws] ?? []).map((e) => (e.id === id ? { ...e, status } : e)),
          },
        })),
      clearResolved: (ws) =>
        set((s) => ({
          entries: {
            ...s.entries,
            [ws]: (s.entries[ws] ?? []).filter((e) => e.status === 'pending'),
          },
        })),
    }),
    {
      name: 'wanyrix.diff-queue',
      storage: createJSONStorage(createMigratingStorage),
    },
  ),
)

/** Count of pending diffs for a workspace (badge in the topbar). */
export function countPending(entries: Record<string, DiffEntry[]>, ws: string): number {
  return (entries[ws] ?? []).filter((e) => e.status === 'pending').length
}
