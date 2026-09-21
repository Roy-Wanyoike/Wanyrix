'use client'

import { useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import {
  CheckCircle2,
  Database,
  HardDrive,
  Lock,
  Moon,
  Sparkles,
  Sun,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useStorage, useWorkspaces } from '@/lib/wanyrix/hooks'
import { LEGACY_PERSIST_KEYS } from '@/lib/wanyrix/legacy-migration'
import { useWorkspaceStore } from '@/lib/wanyrix/workspace-store'
import { useScanStore } from '@/lib/wanyrix/scan-store'
import { useDiffQueueStore } from '@/lib/wanyrix/diff-store'
import { useAiStatusStore, useOnlineStatus, type AiStatus } from '../ai-status-store'
import { Panel, SectionHeading } from '../shared'

/**
 * Settings (AUDIT-I3 required surface) — local-first preferences:
 *  - appearance (next-themes, same toggle the topbar uses);
 *  - workspace preference (the persisted active-workspace store);
 *  - persistence & migration status: the ferrix.* → wanyrix.* migration layer
 *    state, read live from localStorage and reported exactly as found;
 *  - data & privacy pointers (local-first, nothing transmits silently);
 *  - AI availability (read-only mirror of the system status pill).
 */

const AI_LABEL: Record<AiStatus, string> = {
  untested: 'Not exercised this session — requests go out only when you trigger “Explain”.',
  grounded: 'Last reasoning request was grounded in the evidence context.',
  deterministic: 'Last reasoning request used the deterministic fallback (provider unavailable or ungrounded).',
}

type MigrationState = 'migrated' | 'fresh' | 'pending' | 'leftover'

interface KeyRow {
  store: string
  newKey: string
  legacyKey: string
  state: MigrationState
}

function readKey(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== null
  } catch {
    return false
  }
}

const subscribeNoop = () => () => {}

/* localStorage is browser-only — read through useSyncExternalStore so the
   component stays SSR-safe without setState-in-effect cascades. */
const EMPTY_ROWS: KeyRow[] = []
let cachedRows: KeyRow[] = EMPTY_ROWS

function computeRows(): KeyRow[] {
  return Object.entries(LEGACY_PERSIST_KEYS).map(([newKey, legacyKey]) => {
    const hasNew = readKey(newKey)
    const hasLegacy = readKey(legacyKey)
    const state: MigrationState = hasNew
      ? hasLegacy
        ? 'leftover'
        : 'migrated'
      : hasLegacy
        ? 'pending'
        : 'fresh'
    return { store: newKey.replace('wanyrix.', ''), newKey, legacyKey, state }
  })
}

function getMigrationRows(): KeyRow[] {
  const next = computeRows()
  const unchanged =
    cachedRows.length === next.length && cachedRows.every((r, i) => r.state === next[i].state)
  if (unchanged) return cachedRows
  cachedRows = next
  return next
}

export default function SettingsView() {
  const { resolvedTheme, setTheme } = useTheme()
  // hydration pattern from ThemeToggle: server render reports "not mounted"
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  )
  const rows = useSyncExternalStore(subscribeNoop, getMigrationRows, () => EMPTY_ROWS)

  const workspacesQuery = useWorkspaces()
  const storage = useStorage()
  const activeWs = useWorkspaceStore((s) => s.active)
  const setActiveWs = useWorkspaceStore((s) => s.setActive)
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const aiStatus = useAiStatusStore((s) => s.status)
  const { online } = useOnlineStatus()

  const clearScanHistory = useScanStore((s) => s.clearHistory)
  const scanHistory = useScanStore((s) => s.history)

  const switchWorkspace = (id: string) => {
    if (id === activeWs) return
    setActiveWs(id)
    queryClient.invalidateQueries()
    /* issue #78: error-shaped registry payloads carry no `workspaces` array —
       guard the lookup so a 503 can never crash the settings view. */
    const ws = (workspacesQuery.data?.workspaces ?? []).find((w) => w.id === id)
    toast({ title: `Workspace → ${ws?.name ?? id}`, description: 're-querying scoped surfaces' })
  }

  const wipeLocalData = () => {
    clearScanHistory(activeWs)
    toast({
      title: 'Scan history cleared',
      description: `Removed the local run log for ${activeWs}. Nothing was transmitted.`,
    })
  }

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Local-first Preferences"
        title="Settings"
        description="Everything on this page lives on your machine. Wanyrix is local-first: no silent transmission, ever."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---------------------------------------- appearance */}
        <Panel title="Appearance" subtitle="terminal-dark by default · daylight edition optional (issue #43)">
          <div className="flex flex-col gap-2">
            {(
              [
                { value: 'dark', label: 'Terminal edition', hint: 'dark · rust-on-charcoal', icon: Moon },
                { value: 'light', label: 'Daylight edition', hint: 'light · warm paper', icon: Sun },
              ] as const
            ).map((opt) => {
              const active = mounted && resolvedTheme === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTheme(opt.value)}
                  aria-pressed={active}
                  className={`flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    active
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-border/70 text-muted-foreground hover:border-primary/25 hover:text-foreground'
                  }`}
                >
                  <opt.icon className="size-4 shrink-0" aria-hidden />
                  <span className="flex-1">
                    <span className="block text-[13px] font-medium">{opt.label}</span>
                    <span className="block font-mono text-[10.5px] text-muted-foreground">{opt.hint}</span>
                  </span>
                  {active && <CheckCircle2 className="size-4 shrink-0 text-primary" aria-label="active theme" />}
                </button>
              )
            })}
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              same toggle as the topbar / ⌘K palette — one theme state (next-themes)
            </p>
          </div>
        </Panel>

        {/* ---------------------------------------- workspace preference */}
        <Panel title="Workspace preference" subtitle="persisted across reloads (wanyrix.active-workspace)">
          <Select value={activeWs} onValueChange={switchWorkspace} disabled={(workspacesQuery.data?.workspaces ?? []).length === 0}>
            <SelectTrigger className="h-9 w-full text-xs" aria-label="Active workspace">
              <SelectValue placeholder="choose a workspace" />
            </SelectTrigger>
            <SelectContent>
              {(workspacesQuery.data?.workspaces ?? []).map((w) => (
                <SelectItem key={w.id} value={w.id} className="text-xs">
                  {w.name} · {w.crates} crates
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
            The active workspace scopes every API-backed surface (doctor, graph, health, experiments…). Changing it
            re-queries the scoped views immediately.
          </p>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
            <p className="text-[12px] text-muted-foreground">
              Scan history for this workspace:{' '}
              <span className="font-mono text-foreground/85">{(scanHistory[activeWs] ?? []).length} runs</span>
            </p>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[11px]" onClick={wipeLocalData}>
              <Trash2 className="size-3" />
              Clear local history
            </Button>
          </div>
        </Panel>

        {/* ---------------------------------------- persistence & migration */}
        <Panel
          title="Persistence & migration"
          subtitle="legacy ferrix.* → wanyrix.* storage migration (AUDIT-I1 fix) — live localStorage state"
          className="lg:col-span-2"
        >
          {!mounted ? (
            <p className="font-mono text-[11px] text-muted-foreground">reading localStorage…</p>
          ) : (
            <ul className="space-y-2.5">
              {rows.map((row) => (
                <li
                  key={row.newKey}
                  className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[12px] font-medium">{row.newKey}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">legacy: {row.legacyKey}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      row.state === 'migrated'
                        ? 'w-fit border-emerald-500/30 bg-emerald-500/10 font-mono text-[10px] text-emerald-300'
                        : row.state === 'pending' || row.state === 'leftover'
                          ? 'w-fit border-amber-500/30 bg-amber-500/10 font-mono text-[10px] text-amber-300'
                          : 'w-fit border-border font-mono text-[10px] text-muted-foreground'
                    }
                  >
                    {row.state === 'migrated' && 'migrated ✓ legacy key removed after verified copy'}
                    {row.state === 'fresh' && 'fresh — no stored state yet'}
                    {row.state === 'pending' && 'legacy key present — migrates on first read'}
                    {row.state === 'leftover' && 'migrated · legacy key leftover (read-only toward legacy)'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
            The migration layer reads the new key first; if only the legacy <span className="font-mono">ferrix.*</span>{' '}
            key exists it copies it write-through and removes the legacy key only after the copy is verified.
            Persistence is never silently disabled — if storage is unavailable (quota / privacy mode) the layer leaves
            legacy data intact.
          </p>
        </Panel>

        {/* ---------------------------------------- data & privacy */}
        <Panel title="Data & privacy" subtitle="local-first · bounded · inspectable">
          <ul className="space-y-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
            <li className="flex items-start gap-2">
              <Lock className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
              All analysis runs against the engine on this machine — nothing leaves the browser except explicit
              exports (report downloads) and the reasoning requests you trigger.
            </li>
            <li className="flex items-start gap-2">
              <Database className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
              Scan history, the diff queue and your workspace selection are stored in this browser&apos;s localStorage
              only — clear them any time, no server copy exists.
            </li>
            <li className="flex items-start gap-2">
              <HardDrive className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
              Local artifact storage is bounded and inspectable:{' '}
              <span className="font-mono text-foreground/85">
                {storage.data ? `${(storage.data.totalMB / 1024).toFixed(2)} GB` : '…'}
              </span>{' '}
              · {storage.data?.retention ?? 'retention policy from the storage report'} · footer storage link opens
              the full report.
            </li>
            <li className="flex items-start gap-2">
              {online ? (
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-300" aria-hidden />
              ) : (
                <XCircle className="mt-0.5 size-3.5 shrink-0 text-amber-400" aria-hidden />
              )}
              Browser network status: <span className="font-mono text-foreground/85">{online ? 'online' : 'offline'}</span> —
              in local-first mode the dashboard keeps working against the local engine regardless.
            </li>
          </ul>
          <p className="mt-3 border-t border-border/60 pt-3 font-mono text-[10px] text-muted-foreground">
            full privacy documentation: docs/PRIVACY.md
          </p>
        </Panel>

        {/* ---------------------------------------- AI (read-only) */}
        <Panel title="AI & reasoning" subtitle="read-only status — toggles live at the point of use">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
              <Sparkles className="size-4 text-primary" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-medium">Cloud reasoning: optional, off until you ask</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{AI_LABEL[aiStatus]}</p>
              <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
                Every deterministic surface (doctor, graph, findings, gates, experiments) works fully without AI. When
                a request runs, it is grounded in structured evidence and stamped grounded / deterministic — see the AI
                view for the labeling contract.
              </p>
            </div>
          </div>
          <p className="mt-3 border-t border-border/60 pt-3 font-mono text-[10px] text-muted-foreground">
            mirrors the topbar status pill · no probe requests are made from this page
          </p>
        </Panel>
      </div>
    </div>
  )
}
