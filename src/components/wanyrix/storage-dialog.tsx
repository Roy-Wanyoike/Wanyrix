'use client'

import { motion } from 'framer-motion'
import { Database, Hammer, HardDrive, History, Layers, ScrollText, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useRebuildCaches, useReclaimCaches, useStorage } from '@/lib/wanyrix/hooks'
import type { StorageRow } from '@/lib/wanyrix/types'
import { cn } from '@/lib/utils'
import { StatusDot } from './shared'
import { useToast } from '@/hooks/use-toast'

const ROW_ICONS = [Database, Layers, HardDrive, History, ScrollText]

/**
 * QA-1 F-3 — state of the "Simulate scan rebuild" CTA.
 *
 * The button used to be disabled whenever the reclaimable rows were already
 * at their baseline (rebuildableMB < 1) with NO visible reason — the raw
 * `title` was the only hint and disabled buttons often suppress tooltips.
 * The disabled gate was over-strict anyway: POST /api/wanyrix/storage/rebuild
 * accepts an at-baseline rebuild and answers HONESTLY (rebuiltMB 0, empty
 * detail → the dialog's "Caches are already at their working-set size"
 * toast), so the condition was satisfiable and the right fix is to enable the
 * CTA and let the server label the no-op. Disabled now means pending only.
 * The label keeps the honest `+N MB` suffix when a rebuild would add real MB,
 * and stays plain (never "+0 MB") when it would not.
 */
export function rebuildCtaState(input: {
  rebuildableMB: number
  rebuildPending: boolean
  reclaimPending: boolean
}): { disabled: boolean; label: string; hint: string } {
  const { rebuildableMB, rebuildPending, reclaimPending } = input
  return {
    disabled: rebuildPending || reclaimPending,
    label: `Simulate scan rebuild${rebuildableMB >= 1 ? ` (+${rebuildableMB} MB)` : ''}`,
    hint:
      'Simulate scans repopulating the reclaimable caches (Gate 21: simulated). ' +
      'If the caches are already at their working-set size the rebuild adds 0 MB and says so.',
  }
}

/** Accent per row family — mirrors the storage semantics (durable vs ephemeral). */
function rowAccent(row: StorageRow): { bar: string; chip: string } {
  if (row.label.startsWith('Database')) return { bar: 'from-amber-500/80 to-amber-400/50', chip: 'text-amber-300' }
  if (row.label.startsWith('Indexes')) return { bar: 'from-zinc-400/80 to-zinc-300/40', chip: 'text-zinc-300' }
  if (row.label.startsWith('Artifact')) return { bar: 'from-primary/80 to-primary/40', chip: 'text-primary' }
  if (row.label.startsWith('Analysis')) return { bar: 'from-teal-500/80 to-teal-400/40', chip: 'text-teal-300' }
  return { bar: 'from-violet-500/70 to-violet-400/40', chip: 'text-violet-300' }
}

/** Baseline (pre-GC) sizes of the reclaimable rows — mirrors the server model. */
const BASELINE_MB: Record<string, number> = {
  'Analysis cache (reusable regions)': 96,
  'Logs (structured, 14-day retention)': 12,
}

/**
 * `wanyrix storage` — Gate 71.10: storage must be bounded, inspectable and
 * safely reclaimable. Opened from the status footer chip. The reclaim CTA is
 * a REAL mutation: POST /api/wanyrix/storage/reclaim frees the reclaimable
 * rows server-side; regrowth is simulated and labeled.
 */
export function StorageDialog({ children }: { children: React.ReactNode }) {
  const { data, isLoading, isError, refetch } = useStorage()
  const reclaim = useReclaimCaches()
  const rebuild = useRebuildCaches()
  const { toast } = useToast()

  const reclaimableMB = data ? Math.round(data.rows.filter((r) => r.reclaimable).reduce((s, r) => s + r.sizeMB, 0)) : 0
  const nothingToReclaim = reclaimableMB < 1
  /* baselines of the reclaimable rows — below this, scans can rebuild caches */
  const rebuildableMB = data
    ? Math.max(
        0,
        Math.round(
          data.rows
            .filter((r) => r.reclaimable)
            .reduce((s, r) => s + Math.max(0, BASELINE_MB[r.label] - r.sizeMB), 0),
        ),
      )
    : 0

  const onReclaim = () => {
    reclaim.mutate(undefined, {
      onSuccess: (res) => {
        toast({
          title: `Reclaimed ${res.reclaimedMB} MB`,
          description:
            res.detail.length > 0
              ? `${res.detail.join(' · ')}. Indexes and snapshots preserved.`
              : 'Caches were already empty — they regrow as wanyrix scans.',
        })
      },
      onError: (err) => {
        toast({ title: 'Reclaim failed', description: err.message })
      },
    })
  }

  const onRebuild = () => {
    rebuild.mutate(undefined, {
      onSuccess: (res) => {
        toast({
          title: `Caches rebuilt: +${res.rebuiltMB} MB`,
          description:
            res.detail.length > 0
              ? `${res.detail.join(' · ')} — as a scan would repopulate them (simulated).`
              : 'Caches are already at their working-set size.',
        })
      },
      onError: (err) => {
        toast({ title: 'Rebuild failed', description: err.message })
      },
    })
  }

  const rebuildCta = rebuildCtaState({
    rebuildableMB,
    rebuildPending: rebuild.isPending,
    reclaimPending: reclaim.isPending,
  })

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-sm">
            <HardDrive className="size-4 text-primary" />
            wanyrix storage
          </DialogTitle>
          <DialogDescription>
            Local storage is bounded and inspectable — no unbounded temporary files, no silent cache growth.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-2.5 py-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-9 animate-pulse rounded bg-muted" />
            ))}
          </div>
        )}

        {isError && (
          <div className="flex items-center justify-between rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-300">
            storage report unavailable
            <Button size="sm" variant="outline" className="h-7" onClick={() => refetch()}>
              retry
            </Button>
          </div>
        )}

        {data && (
          <div className="space-y-3">
            <div className="space-y-2.5">
              {data.rows.map((row, i) => {
                const Icon = ROW_ICONS[i % ROW_ICONS.length]
                const pct = Math.round((row.sizeMB / data.totalMB) * 100)
                const accent = rowAccent(row)
                return (
                  <div key={row.label} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate text-xs">{row.label}</span>
                      <span className="font-mono text-xs tabular-nums text-foreground/90">
                        {row.sizeMB} MB
                      </span>
                      {row.reclaimable && (
                        <span className="rounded border border-teal-500/25 bg-teal-500/10 px-1 font-mono text-[9px] uppercase text-teal-300">
                          reclaimable
                        </span>
                      )}
                    </div>
                    <div
                      className="h-1.5 overflow-hidden rounded-full bg-muted/60"
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${row.label}: ${row.sizeMB} MB, ${pct}% of total storage`}
                    >
                      <motion.div
                        className={cn('h-full rounded-full bg-gradient-to-r', accent.bar)}
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.max(pct, 1)}%` }}
                        transition={{ duration: 0.6, delay: i * 0.07, ease: 'easeOut' }}
                      />
                    </div>
                    <p className="pl-5 text-[10px] text-muted-foreground">
                      {row.note} · {pct}% of total
                    </p>
                  </div>
                )
              })}
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border bg-background/60 px-3 py-2">
              <span className="text-xs font-medium">Total</span>
              <span className="font-mono text-sm tabular-nums">{(data.totalMB / 1024).toFixed(2)} GB</span>
            </div>

            <div className="space-y-1 rounded-lg border border-border/70 bg-card/60 p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
              <p className="flex items-center gap-1.5">
                <StatusDot status="pass" /> {data.bound}
              </p>
              <p>retention: {data.retention}</p>
              <p>last GC: {new Date(data.lastGc).toLocaleString()}</p>
              {data.reclaimedTotalMB !== undefined && data.reclaimedTotalMB > 0 && (
                <p className="flex items-center gap-1.5">
                  <Sparkles className="size-3 shrink-0 text-teal-300" aria-hidden />
                  cumulative reclaimed: {data.reclaimedTotalMB} MB · {data.sinceGcMin ?? 0} min since GC
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-[10px] text-muted-foreground">
                {nothingToReclaim
                  ? 'nothing reclaimable — caches regrow as scans run'
                  : `${reclaimableMB} MB safely reclaimable`}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 text-xs text-muted-foreground"
                  onClick={onRebuild}
                  disabled={rebuildCta.disabled}
                  title={rebuildCta.hint}
                >
                  <Hammer className="size-3" />
                  {rebuildCta.label}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={onReclaim}
                  disabled={reclaim.isPending || nothingToReclaim}
                >
                  {reclaim.isPending
                    ? 'Reclaiming…'
                    : reclaimableMB > 0
                      ? `Reclaim caches (${reclaimableMB} MB)`
                      : 'Reclaim caches'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
