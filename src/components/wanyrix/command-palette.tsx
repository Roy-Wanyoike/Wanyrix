'use client'

import { useEffect } from 'react'
import { useTheme } from 'next-themes'
import {
  Braces,
  Check,
  Database,
  ExternalLink,
  FileDiff,
  FileText,
  HardDrive,
  History,
  Moon,
  RefreshCw,
  Sun,
  TerminalSquare,
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
import { useWorkspaces } from '@/lib/wanyrix/hooks'
import { useWorkspaceStore } from '@/lib/wanyrix/workspace-store'
import { NAV_ITEMS } from './nav-registry'
import type { ViewId } from '@/lib/wanyrix/types'

/* Navigation comes from ./nav-registry (AUDIT-I3) — same source as the
   sidebar, so the palette always covers every view, 18/18. */

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
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(!open)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [open, setOpen])

  const { data: wsData } = useWorkspaces()
  const activeWs = useWorkspaceStore((s) => s.active)
  const setActiveWs = useWorkspaceStore((s) => s.setActive)

  const go = (v: ViewId) => {
    setOpen(false)
    onNavigate(v)
  }

  return (
    /* paletteFilter (issue #99): word-boundary matching — "dep" matches
       Dependencies, not "Runtime captured profiles" */
    <CommandDialog open={open} onOpenChange={setOpen} filter={paletteFilter}>
      <CommandInput placeholder="Type a command or search views…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigate">
          {NAV_ITEMS.map((item) => (
            <CommandItem key={item.id} onSelect={() => go(item.id)} className="gap-2.5">
              <item.icon className="size-4 text-primary" />
              <span>{item.label}</span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">{item.hint}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Switch workspace">
          {(wsData?.workspaces ?? []).map((w) => (
            <CommandItem
              key={w.id}
              value={`workspace ${w.name}`}
              disabled={w.id === activeWs}
              onSelect={() => {
                setOpen(false)
                setActiveWs(w.id)
              }}
              className="gap-2.5"
            >
              <Database className={`size-4 ${w.accent === 'emerald' ? 'text-emerald-400' : 'text-primary'}`} />
              <span>{w.name}</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {w.crates} crates · {w.findings} findings
              </span>
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
              setOpen(false)
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
              setOpen(false)
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
              setOpen(false)
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
              setOpen(false)
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
              setOpen(false)
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
              setOpen(false)
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
              setOpen(false)
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
              setOpen(false)
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
              setOpen(false)
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
