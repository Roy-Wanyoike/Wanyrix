'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { useTheme } from 'next-themes'
import {
  Braces,
  Check,
  Database,
  ExternalLink,
  FileDiff,
  FileSearch,
  FileText,
  FlaskConical,
  GitPullRequest,
  HardDrive,
  History,
  ListChecks,
  Moon,
  Package,
  RefreshCw,
  Sun,
  TerminalSquare,
  type LucideIcon,
} from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { REPO_URL } from '@/lib/wanyrix/data'
import { paletteFilter } from '@/lib/wanyrix/palette-filter'
import {
  buildPaletteEntries,
  type PaletteDataEntry,
  type PaletteDataKind,
} from '@/lib/wanyrix/palette-search'
import { useWorkspaces } from '@/lib/wanyrix/hooks'
import { useWorkspaceStore } from '@/lib/wanyrix/workspace-store'
import { mergeWorkspaceRegistry } from '@/lib/wanyrix/registered-workspace'
import { NAV_ITEMS } from './nav-registry'
import { WorkspaceProvenanceBadge } from './shared'
import type { ViewId } from '@/lib/wanyrix/types'

/* Navigation comes from ./nav-registry (AUDIT-I3) — same source as the
   sidebar, so the palette always covers every view, 19/19.

   Workspace DATA search (issue #127): typing a crate, finding id/title,
   issue/PR id or experiment also matches — the entries come from
   palette-search (the same fixture selectors the /api/wanyrix/* routes
   serve the views) and are scoped to the ACTIVE workspace, so the palette
   only ever offers records the current views can actually show. Data
   groups render once something is typed; an empty query shows views only.
   Selecting a record navigates to its owning view. */

/** Data-result groups in palette order + the icon per record kind. */
const DATA_GROUPS: { heading: string; kinds: PaletteDataKind[] }[] = [
  { heading: 'Crates', kinds: ['crate'] },
  { heading: 'Findings', kinds: ['finding'] },
  { heading: 'Issues & PRs', kinds: ['issue', 'pr'] },
  { heading: 'Experiments', kinds: ['experiment'] },
]

const DATA_KIND_ICON: Record<PaletteDataKind, LucideIcon> = {
  crate: Package,
  finding: FileSearch,
  issue: ListChecks,
  pr: GitPullRequest,
  experiment: FlaskConical,
}

export function CommandPalette({
  open,
  setOpen,
  onNavigate,
  onRunScan,
  onOpenDiffs,
  onExportReport,
  onExportJson,
  onOpenCli,
  pendingDiffs,
}: {
  open: boolean
  setOpen: (o: boolean) => void
  onNavigate: (v: ViewId) => void
  onRunScan: (trigger?: 'topbar' | 'palette') => void
  onOpenDiffs: () => void
  onExportReport: () => void
  onExportJson: () => void
  onOpenCli: () => void
  pendingDiffs: number
}) {
  /* issue #127: the palette query gates the workspace-data groups — empty
     query = views only (the pre-#127 behavior), non-empty = views + matching
     workspace records. `close` resets it on every close path — selection,
     Ctrl+K toggle, and the Escape/overlay path Radix reports through
     onOpenChange — so reopening the palette never resurrects a stale query
     (no effect needed). Declared before the keydown effect that resets it. */
  const [search, setSearch] = useState('')
  const searching = search.trim() !== ''

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setSearch('') // stale query must never survive a toggle (issue #127)
        setOpen(!open)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [open, setOpen])

  const { data: wsData } = useWorkspaces()
  const activeWs = useWorkspaceStore((s) => s.active)
  const setActiveWs = useWorkspaceStore((s) => s.setActive)

  /* issue #127: the workspace-scoped data index (crates, findings,
     issues/PRs, experiments) — rebuilt only when the workspace changes. */
  const dataEntries = useMemo(() => buildPaletteEntries(activeWs), [activeWs])

  const close = () => {
    setSearch('')
    setOpen(false)
  }

  const go = (v: ViewId) => {
    close()
    onNavigate(v)
  }

  return (
    /* paletteFilter (issue #99): word-boundary matching — "dep" matches
       Dependencies, not "Runtime captured profiles"; issue #127 applies the
       same matcher to workspace data via value + keywords */
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setSearch('') // Escape / overlay close (issue #127)
        setOpen(o)
      }}
      filter={paletteFilter}
    >
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder="Search views, crates, findings, PRs…"
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigate">
          {NAV_ITEMS.map((item) => (
            <CommandItem
              key={item.id}
              value={`${item.label} ${item.hint}`}
              onSelect={() => go(item.id)}
              className="gap-2.5"
            >
              <item.icon className="size-4 text-primary" />
              <span>{item.label}</span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">{item.hint}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        {searching &&
          DATA_GROUPS.map((group) => {
            const items = dataEntries.filter((e) => group.kinds.includes(e.kind))
            if (items.length === 0) return null
            return (
              <Fragment key={group.heading}>
                <CommandSeparator />
                <CommandGroup heading={group.heading}>
                  {items.map((entry: PaletteDataEntry) => {
                    const Icon = DATA_KIND_ICON[entry.kind]
                    return (
                      <CommandItem
                        key={entry.id}
                        value={entry.value}
                        keywords={entry.keywords}
                        onSelect={() => go(entry.view)}
                        className="gap-2.5"
                      >
                        <Icon className="size-4 text-primary" />
                        <span className="truncate">{entry.label}</span>
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                          {entry.detail}
                        </span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              </Fragment>
            )
          })}
        <CommandSeparator />
        <CommandGroup heading="Switch workspace">
          {/* QA-5-B-1: registered LOCAL projects first, fixtures after — the
              same merged registry the topbar selector renders. */}
          {mergeWorkspaceRegistry(wsData).map((w) => (
            <CommandItem
              key={w.id}
              value={`workspace ${w.name}`}
              disabled={w.id === activeWs}
              onSelect={() => {
                close()
                setActiveWs(w.id)
              }}
              className="gap-2.5"
            >
              <Database className={`size-4 ${w.accent === 'emerald' ? 'text-emerald-400' : 'text-primary'}`} />
              <span>{w.name}</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {w.crates} crates · {w.findings} findings
              </span>
              {/* QA-5-B-4: provenance travels with the option — fixtures are
                  demo data, never LIVE (title carries the explanation). */}
              <WorkspaceProvenanceBadge fixtureOnly={w.fixtureOnly} />
              {w.id === activeWs && (
                <Check className="ml-auto size-3.5 text-emerald-400" aria-label="active" />
              )}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Engine actions">
          <CommandItem
            onSelect={() => {
              close()
              onRunScan('palette')
            }}
            className="gap-2.5"
          >
            <RefreshCw className="size-4 text-amber-400" />
            <span>Run full scan</span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">cargo + git telemetry</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              close()
              onOpenDiffs()
            }}
            className="gap-2.5"
          >
            <FileDiff className="size-4 text-amber-400" />
            <span>Open pending diffs</span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              {pendingDiffs > 0 ? `${pendingDiffs} awaiting review` : 'review queue'}
            </span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              close()
              onExportReport()
            }}
            className="gap-2.5"
          >
            <FileText className="size-4 text-teal-300" />
            <span>Export workspace report</span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">markdown · findings + gates</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              close()
              onExportJson()
            }}
            className="gap-2.5"
          >
            <Braces className="size-4 text-amber-400" />
            <span>Export JSON snapshot</span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">wanyrix report --json</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              close()
              onOpenCli()
            }}
            className="gap-2.5"
          >
            <TerminalSquare className="size-4 text-violet-300" />
            <span>View CLI contract</span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">commands · exit codes</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              close()
              onNavigate('doctor')
            }}
            className="gap-2.5"
          >
            <History className="size-4 text-teal-300" />
            <span>View scan history</span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">History view</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              close()
              window.open(`${REPO_URL}/actions`, '_blank', 'noopener')
            }}
            className="gap-2.5"
          >
            <ExternalLink className="size-4 text-teal-300" />
            <span>Open GitHub repository</span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">Roy-Wanyoike/wanyrix</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              close()
              onNavigate('history')
            }}
            className="gap-2.5"
          >
            <History className="size-4 text-teal-300" />
            <span>Open History view</span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">scan run log</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              close()
              onNavigate('scorecard')
            }}
            className="gap-2.5"
          >
            <HardDrive className="size-4 text-violet-300" />
            <span>Storage report</span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">also in the footer</span>
          </CommandItem>
          <ThemeAction />
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}

/**
 * Appearance toggle inside the palette (issue #43) — kept as its own component
 * so useTheme only runs when the palette is rendered.
 */
function ThemeAction() {
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme !== 'light'
  return (
    <CommandItem
      onSelect={() => setTheme(isDark ? 'light' : 'dark')}
      className="gap-2.5"
    >
      {isDark ? <Sun className="size-4 text-amber-400" /> : <Moon className="size-4 text-teal-300" />}
      <span>{isDark ? 'Switch to light appearance' : 'Switch to dark appearance'}</span>
      <span className="ml-auto font-mono text-[10px] text-muted-foreground">
        {isDark ? 'daylight edition' : 'terminal edition'}
      </span>
    </CommandItem>
  )
}
