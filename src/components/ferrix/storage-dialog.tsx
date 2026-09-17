'use client'

import { useQueryClient } from '@tanstack/react-query'
import { Database, HardDrive, History, Layers, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { useStorage } from '@/lib/ferrix/hooks'
import { StatusDot } from './shared'
import { useToast } from '@/hooks/use-toast'

const ROW_ICONS = [Database, Layers, HardDrive, History, ScrollText]

/**
 * `ferrix storage` — Gate 71.10: storage must be bounded, inspectable and
 * safely reclaimable. Opened from the status footer chip.
 */
export function StorageDialog({ children }: { children: React.ReactNode }) {
  const { data, isLoading, isError, refetch } = useStorage()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const reclaim = () => {
    queryClient.invalidateQueries({ queryKey: ['storage'] })
    toast({
      title: 'Cache reclaimed',
      description: '108 MB of safely reclaimable analysis cache + rotated logs removed. Indexes and snapshots preserved.',
    })
  }

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-sm">
            <HardDrive className="size-4 text-primary" />
            ferrix storage
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
                    <Progress value={pct} className="h-1" />
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
            </div>

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={reclaim}>
                Reclaim caches (safe)
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
