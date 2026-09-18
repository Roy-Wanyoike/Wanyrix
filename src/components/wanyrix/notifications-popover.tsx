'use client'

import { useMemo } from 'react'
import { Bell, CheckCircle2, FlaskConical, GitPullRequest, HardDrive, Network, Stethoscope } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import {
  useDoctor,
  useExperiments,
  useGraph,
  usePRAnalysis,
  useStorage,
} from '@/lib/wanyrix/hooks'
import { useWorkspaceStore } from '@/lib/wanyrix/workspace-store'
import { useWorkspaces } from '@/lib/wanyrix/hooks'
import type { ViewId } from '@/lib/wanyrix/types'
import { cn } from '@/lib/utils'

/**
 * Payload-derived signal center (round 10) — replaces the old hardcoded bell
 * toast. Every signal is computed from the SAME live query cache the views
 * use, so the list is honest per workspace: atlas has no running experiment,
 * helios has no merged-PR story, and the badge count moves when the engine
 * state moves. Nothing here is fabricated.
 */
interface Signal {
  id: string
  tone: 'red' | 'amber' | 'teal' | 'emerald'
  icon: React.ComponentType<{ className?: string }>
  title: string
  detail: string
  view: ViewId
}

const TONE_DOT: Record<Signal['tone'], string> = {
  red: 'bg-red-400',
  amber: 'bg-amber-400',
  teal: 'bg-teal-300',
  emerald: 'bg-emerald-400',
}

const TONE_TEXT: Record<Signal['tone'], string> = {
  red: 'text-red-300',
  amber: 'text-amber-300',
  teal: 'text-teal-300',
  emerald: 'text-emerald-300',
}

export function NotificationsPopover({ onNavigate }: { onNavigate: (v: ViewId) => void }) {
  const activeWs = useWorkspaceStore((s) => s.active)
  const { data: wsData } = useWorkspaces()
  const wsName = wsData?.workspaces.find((w) => w.id === activeWs)?.name ?? activeWs

  const doctor = useDoctor()
  const graph = useGraph()
  const pr = usePRAnalysis()
  const experiments = useExperiments()
  const storage = useStorage()

  const signals = useMemo<Signal[]>(() => {
    const out: Signal[] = []

    /* PR regression (both workspaces ship a featured PR case) */
    const prData = pr.data
    if (prData && prData.regressionPct > 0) {
      out.push({
        id: `pr-${prData.number}`,
        tone: 'red',
        icon: GitPullRequest,
        title: `PR #${prData.number} added +${prData.regressionPct}% build impact`,
        detail: `${prData.affectedCrates} crates affected · ${prData.confidence}% confidence · open PR Analysis`,
        view: 'prs',
      })
    }

    /* duplicate versions (measured, Gate 13) */
    const dups = graph.data?.duplicates ?? []
    if (dups.length > 0) {
      const wasted = dups.reduce((acc, d) => acc + d.wastedSeconds, 0)
      out.push({
        id: 'duplicates',
        tone: 'amber',
        icon: Network,
        title: `${dups.length} duplicate version group${dups.length > 1 ? 's' : ''} in the tree`,
        detail: `${wasted.toFixed(1)}s wasted per clean build · ${dups.map((d) => d.name).join(', ')} · open Engineering Graph`,
        view: 'graph',
      })
    }

    /* critical / high findings */
    const critical = (doctor.data?.findings ?? []).filter(
      (f) => f.severity === 'critical' || f.severity === 'warning',
    )
    if (critical.length > 0) {
      const top = critical[0]
      out.push({
        id: `finding-${top.id}`,
        tone: top.severity === 'critical' ? 'red' : 'amber',
        icon: Stethoscope,
        title: `${critical.length} finding${critical.length > 1 ? 's' : ''} need attention — top: ${top.id}`,
        detail: `${top.title} · open Build Doctor`,
        view: 'doctor',
      })
    }

    /* running experiment (helios only — honest per workspace) */
    const running = experiments.data?.experiments.find((e) => e.status === 'running')
    if (running) {
      const done = running.stages.filter((st) => st.state === 'done').length
      out.push({
        id: `exp-${running.id}`,
        tone: 'teal',
        icon: FlaskConical,
        title: `${running.id} running — ${running.title}`,
        detail: `${done}/${running.stages.length} stages done · baseline ${running.baseline?.seconds.toFixed(1) ?? '—'}s · open Experiments`,
        view: 'experiments',
      })
    }

    /* reclaimable storage (live simulated state) */
    const reclaimable = (storage.data?.rows ?? []).filter((r) => r.reclaimable)
    const reclaimMB = reclaimable.reduce((acc, r) => acc + r.sizeMB, 0)
    if (storage.data && reclaimMB >= 1) {
      out.push({
        id: 'storage',
        tone: 'teal',
        icon: HardDrive,
        title: `${reclaimMB.toFixed(1)} MB reclaimable on disk`,
        detail: `${reclaimable.length} row${reclaimable.length > 1 ? 's' : ''} eligible for GC · open the storage report from the footer`,
        view: 'overview',
      })
    }

    return out
  }, [doctor.data, graph.data, pr.data, experiments.data, storage.data])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="relative size-8"
          aria-label={
            signals.length > 0
              ? `Notifications — ${signals.length} active engine signal${signals.length > 1 ? 's' : ''}`
              : 'Notifications — no active signals'
          }
        >
          {signals.length > 0 && (
            <span
              className={cn(
                'absolute -right-0.5 -top-0.5 z-10 flex size-4 items-center justify-center rounded-full font-mono text-[9px] font-bold text-primary-foreground',
                signals.some((s) => s.tone === 'red') ? 'bg-red-500' : 'bg-primary',
              )}
            >
              {signals.length}
            </span>
          )}
          <Bell className="size-4" aria-hidden />
          {signals.length > 0 && (
            <span
              className="absolute -inset-0.5 -z-10 rounded-full bg-primary/20 blur-[3px]"
              aria-hidden
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-86 max-w-[calc(100vw-2rem)] p-0" role="dialog" aria-label="Engine signals">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
          <div>
            <p className="text-sm font-semibold">Engine signals</p>
            <p className="font-mono text-[10px] text-muted-foreground">
              derived from live payloads · {wsName}
            </p>
          </div>
          <span className="font-mono text-[10px] text-muted-foreground">
            {signals.length} active
          </span>
        </div>

        {signals.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <CheckCircle2 className="size-6 text-emerald-400" aria-hidden />
            <p className="text-[13px] font-medium">All quiet</p>
            <p className="max-w-[26ch] text-[11px] leading-snug text-muted-foreground">
              No regressions, duplicates, or unverified estimates in {wsName} right now.
            </p>
          </div>
        ) : (
          <div className="max-h-[320px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            <ul className="py-1">
              {signals.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate(s.view)}
                    className="group flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none"
                    style={{ animationDelay: `${i * 40}ms` }}
                  >
                    <span className="relative mt-0.5 shrink-0">
                      <s.icon className={cn('size-4', TONE_TEXT[s.tone])} aria-hidden />
                      <span
                        className={cn(
                          'absolute -right-0.5 -top-0.5 size-1.5 rounded-full',
                          TONE_DOT[s.tone],
                        )}
                        aria-hidden
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-[12.5px] font-medium leading-snug', TONE_TEXT[s.tone])}>
                        {s.title}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                        {s.detail}
                      </span>
                    </span>
                  </button>
                  {i < signals.length - 1 && <Separator className="opacity-40" />}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="border-t border-border/60 px-4 py-2">
          <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
            signals recompute on every engine scan · nothing is auto-applied (Gate 19)
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
