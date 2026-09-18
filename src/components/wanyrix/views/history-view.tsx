'use client'

import { History, Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useDoctor } from '@/lib/wanyrix/hooks'
import { useScanStore } from '@/lib/wanyrix/scan-store'
import { DataErrorPanel, Panel, SectionHeading, ViewSkeleton } from '../shared'
import { ScanHistoryPanel } from '../scan-history'
import type { ViewProps } from '../view-types'

/**
 * History (AUDIT-I3 required surface) — the per-workspace doctor scan run log
 * promoted from the Build Doctor panel into a first-class view. The SAME
 * ScanHistoryPanel component is still rendered inside Build Doctor, so both
 * surfaces read one state source (the persisted scan store) and the overlay
 * entry points keep working.
 */
export default function HistoryView(_: ViewProps) {
  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Run Log"
        title="History"
        description="Per-workspace `wanyrix doctor` run log — persisted locally in your browser, capped at 20 runs per workspace, exportable as JSON or Markdown."
      />
      <HistoryBody />
    </div>
  )
}

function HistoryBody() {
  const doctor = useDoctor()
  const totalRuns = useTotalRuns()

  if (doctor.isLoading) return <ViewSkeleton kpiCount={0} />
  if (doctor.isError || !doctor.data)
    return (
      <DataErrorPanel
        title="History context unavailable"
        message={doctor.isError ? (doctor.error as Error).message : 'empty payload'}
        onRetry={() => doctor.refetch()}
      />
    )

  return (
    <>
      {totalRuns > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="gap-1.5 font-mono text-[10px] text-muted-foreground">
            <History className="size-3" />
            {totalRuns} run{totalRuns === 1 ? '' : 's'} recorded across workspaces
          </Badge>
          <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
            client-side · localStorage
          </Badge>
        </div>
      )}

      <ScanHistoryPanel currentBuildTime={doctor.data.buildTime} />

      <Panel title="How entries are recorded" subtitle="the same event feeds the topbar, the palette and Build Doctor">
        <ul className="space-y-2 text-[12.5px] leading-relaxed text-muted-foreground">
          <li className="flex items-start gap-2">
            <Info className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
            Every completed doctor run appends an entry — triggered from this view&apos;s doctor button, the topbar
            <span className="font-mono text-foreground/85"> Run scan </span> button, or the ⌘K palette.
          </li>
          <li className="flex items-start gap-2">
            <Info className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
            Findings counts and build figures come from the doctor payload at scan completion (measured vs estimated
            labeled per run, Gate 21); the wall-clock duration is measured in your browser.
          </li>
          <li className="flex items-start gap-2">
            <Info className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
            The engine replays the same telemetry each run in this demo environment — history tracks what the CLI
            would report across runs, honestly labeled as such in every export.
          </li>
        </ul>
      </Panel>
    </>
  )
}

function useTotalRuns(): number {
  return useScanStore((s) => Object.values(s.history).reduce((acc, list) => acc + list.length, 0))
}
