'use client'

import { useEffect } from 'react'
import {
  Calculator,
  ExternalLink,
  FlaskConical,
  GitPullRequest,
  HardDrive,
  LayoutDashboard,
  ListChecks,
  Microscope,
  Network,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
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
import { REPO_URL } from '@/lib/ferrix/data'
import type { ViewId } from '@/lib/ferrix/types'

const NAV_ITEMS: { id: ViewId; label: string; icon: React.ElementType; hint: string }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, hint: 'Engineering health' },
  { id: 'doctor', label: 'Build Doctor', icon: Stethoscope, hint: 'ferrix doctor' },
  { id: 'graph', label: 'Engineering Graph', icon: Network, hint: 'blast radius' },
  { id: 'diagnostics', label: 'Diagnostics', icon: Microscope, hint: 'borrow · async' },
  { id: 'prs', label: 'PR Analysis', icon: GitPullRequest, hint: 'regression guard' },
  { id: 'simulator', label: 'Impact Simulator', icon: Calculator, hint: 'change cost' },
  { id: 'experiments', label: 'Experiments', icon: FlaskConical, hint: 'verify claims' },
  { id: 'scorecard', label: 'Release Scorecard', icon: ShieldCheck, hint: 'GO / NO-GO' },
  { id: 'issues', label: 'Issues & PRs', icon: ListChecks, hint: 'traceability' },
]

export function CommandPalette({
  open,
  setOpen,
  onNavigate,
  onRunScan,
}: {
  open: boolean
  setOpen: (o: boolean) => void
  onNavigate: (v: ViewId) => void
  onRunScan: () => void
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

  const go = (v: ViewId) => {
    setOpen(false)
    onNavigate(v)
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
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
        <CommandGroup heading="Engine actions">
          <CommandItem
            onSelect={() => {
              setOpen(false)
              onRunScan()
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
              window.open(`${REPO_URL}/actions`, '_blank', 'noopener')
            }}
            className="gap-2.5"
          >
            <ExternalLink className="size-4 text-teal-300" />
            <span>Open GitHub repository</span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">Roy-Wanyoike/ferrix</span>
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
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
