'use client'

import { motion } from 'framer-motion'
import {
  AlertCircle,
  CheckCircle2,
  CloudOff,
  Database,
  Fingerprint,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import {
  useBackfillScanRuns,
  useScanRunSync,
  type RunSyncState,
  type ServerScanRun,
} from '@/lib/wanyrix/hooks'
import type { ScanRunRecord } from '@/lib/wanyrix/scan-store'
import { cn } from '@/lib/utils'
import { Panel } from './shared'

/**
 * Durable server sync panel (History view) — the visible half of the
 * scan-run sync feature. Left: this browser's local run log (the UI source
 * of truth) with a per-run sync badge. Right: the durable server log
 * (`wanyrix.scan-runs/v1`, SQLite) exactly as the server persists it — runs
 * POSTed by real browser sessions, never fabricated (Gate 21). A backfill
 * action recovers local runs whose fire-and-forget POST failed or that
 * predate sync.
 */

const TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const TRIGGER_SHORT: Record<string, string> = {
  manual: 'view',
  topbar: 'topbar',
  palette: '⌘K',
}

const MAX_ROWS = 20

function SyncBadge({ state }: { state: RunSyncState }) {
  const map: Record<
    RunSyncState,
    { icon: typeof CheckCircle2; label: string; cls: string; spin?: boolean }
  > = {
    synced: {
      icon: CheckCircle2,
      label: 'synced',
      cls: 'border-teal-400/30 bg-teal-400/10 text-teal-300',
    },
    pending: {
      icon: Loader2,
      label: 'syncing…',
      cls: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
      spin: true,
    },
    failed: {
      icon: AlertCircle,
      label: 'sync failed',
      cls: 'border-red-400/30 bg-red-400/10 text-red-300',
    },
    unsynced: {
      icon: CloudOff,
      label: 'not synced',
      cls: 'border-border bg-muted/20 text-muted-foreground',
    },
  }
  const { icon: Icon, label, cls, spin } = map[state]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide',
        cls,
      )}
    >
      <Icon className={cn('size-2.5', spin && 'animate-spin')} aria-hidden />
      {label}
    </span>
  )
}

/** R7: tiny fingerprint indicator — shown only when the run carries one. */
function FingerprintTag({ ids, truncated }: { ids?: string[]; truncated?: boolean }) {
  if (!ids) return null
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded border border-border/50 bg-card px-1 py-0.5 font-mono text-[8.5px] tabular-nums',
        truncated ? 'text-amber-300/90' : 'text-muted-foreground/80',
      )}
      title={
        truncated
          ? `findings fingerprint (partial, > ${ids.length} ids kept)`
          : `findings fingerprint — ${ids.length} finding ids`
      }
    >
      <Fingerprint className="size-2.5" aria-hidden />
      {ids.length}
      {truncated && '+'}
    </span>
  )
}

function LocalRunRow({ run, state, index }: { run: ScanRunRecord; state: RunSyncState; index: number }) {
  return (
    <motion.li
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index * 0.025, 0.12), duration: 0.18 }}
      className="flex items-center gap-x-2.5 gap-y-1 rounded-lg border border-border/60 bg-muted/10 px-2.5 py-1.5 transition-colors hover:border-border hover:bg-muted/25"
    >
      <span className="font-mono text-[10.5px] tabular-nums text-foreground/80">
        {TIME_FMT.format(run.startedAt)}
      </span>
      <span className="rounded border border-border/60 bg-card px-1 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-muted-foreground">
        {TRIGGER_SHORT[run.trigger] ?? run.trigger}
      </span>
      <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
        <span className="size-1 rounded-full bg-red-400" aria-hidden />
        {run.severityCounts.critical}
        <span className="mx-0.5 text-border">·</span>
        <span className="size-1 rounded-full bg-amber-400" aria-hidden />
        {run.severityCounts.warning}
        <span className="mx-0.5 text-border">·</span>
        <span className="size-1 rounded-full bg-teal-300" aria-hidden />
        {run.severityCounts.info}
      </span>
      <span className="ml-auto font-mono text-[9.5px] tabular-nums text-muted-foreground/70">
        {(run.durationMs / 1000).toFixed(1)}s
      </span>
      <FingerprintTag ids={run.findingIds} truncated={run.findingIdsTruncated} />
      <SyncBadge state={state} />
    </motion.li>
  )
}

function ServerRunRow({ run, index }: { run: ServerScanRun; index: number }) {
  return (
    <motion.li
      initial={{ opacity: 0, x: 6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index * 0.025, 0.12), duration: 0.18 }}
      className="flex items-center gap-x-2.5 rounded-lg border border-teal-400/15 bg-teal-400/[0.04] px-2.5 py-1.5 transition-colors hover:border-teal-400/30"
    >
      <Database className="size-3 shrink-0 text-teal-300/70" aria-hidden />
      <span className="font-mono text-[10.5px] tabular-nums text-foreground/80">
        {TIME_FMT.format(run.startedAt)}
      </span>
      <span className="rounded border border-border/60 bg-card px-1 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-muted-foreground">
        {TRIGGER_SHORT[run.trigger] ?? run.trigger}
      </span>
      <span className="font-mono text-[10px] text-muted-foreground">
        <span className="tabular-nums text-foreground/85">{run.findingCount}</span> findings
      </span>
      <span className="ml-auto font-mono text-[9.5px] tabular-nums text-muted-foreground/70">
        {(run.durationMs / 1000).toFixed(1)}s
      </span>
      <FingerprintTag ids={run.findingIds} truncated={run.findingIdsTruncated} />
    </motion.li>
  )
}

function ColumnHeader({
  icon,
  title,
  count,
}: {
  icon: React.ReactNode
  title: string
  count: number | null
}) {
  return (
    <div className="mb-2 flex items-center gap-1.5">
      {icon}
      <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
        {title}
      </p>
      {count !== null && (
        <span className="ml-auto rounded border border-border/60 bg-card px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
    </div>
  )
}

export function ServerSyncPanel() {
  const { runs, stateOf, syncedCount, server } = useScanRunSync()
  const backfill = useBackfillScanRuns()
  const { toast } = useToast()

  const unsyncedCount = runs.length - syncedCount
  const serverRuns = server.data?.runs ?? []
  const localRows = runs.slice(0, MAX_ROWS)

  const doBackfill = () => {
    backfill.mutate(undefined, {
      onSuccess: ({ synced, failed }) => {
        if (failed > 0) {
          toast({
            title: `Backfill partial — ${synced} synced, ${failed} failed`,
            description: 'The server store rejected some runs; they remain safe in your browser log.',
          })
        } else {
          toast({
            title: `Backfill complete — ${synced} run${synced === 1 ? '' : 's'} synced`,
            description: `Now durable in the server log (wanyrix.scan-runs/v1) for this workspace.`,
          })
        }
      },
      onError: (err) => {
        toast({ title: 'Backfill failed', description: err.message })
      },
    })
  }

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <UploadCloud className="size-3.5 text-primary" aria-hidden />
          Durable server sync
        </span>
      }
      subtitle="browser run log ↔ SQLite server log · wanyrix.scan-runs/v1"
      actions={
        <div className="flex items-center gap-1">
          {unsyncedCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-[10.5px] text-muted-foreground"
              onClick={doBackfill}
              disabled={backfill.isPending}
              aria-label={`Sync ${unsyncedCount} unsynced runs to the server log`}
            >
              {backfill.isPending ? (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              ) : (
                <UploadCloud className="size-3" aria-hidden />
              )}
              {backfill.isPending ? 'Syncing…' : `Sync ${unsyncedCount} unsynced`}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-[10.5px] text-muted-foreground"
            onClick={() => server.refetch()}
            aria-label="Refresh the server log"
          >
            <RefreshCw className={cn('size-3', server.isFetching && 'animate-spin')} aria-hidden />
            Refresh
          </Button>
        </div>
      }
    >
      <div className="grid gap-5 lg:grid-cols-2">
        {/* left — this browser's local run log with sync badges */}
        <div className="min-w-0">
          <ColumnHeader
            icon={<HardDrive className="size-3 text-muted-foreground" aria-hidden />}
            title="this browser · localStorage"
            count={runs.length}
          />
          {runs.length > 0 && (
            <p className="mb-2 font-mono text-[9.5px] text-muted-foreground/70">
              {syncedCount}/{runs.length} confirmed on server
            </p>
          )}
          {localRows.length === 0 ? (
            <div className="flex h-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-center">
              <p className="text-xs text-muted-foreground">No local runs yet.</p>
              <p className="font-mono text-[9.5px] text-muted-foreground/70">
                run wanyrix doctor to populate the log
              </p>
            </div>
          ) : (
            <ul className="max-h-[264px] space-y-1.5 overflow-y-auto pr-1">
              {localRows.map((run, i) => (
                <LocalRunRow key={run.id} run={run} state={stateOf(run.id)} index={i} />
              ))}
            </ul>
          )}
        </div>

        {/* right — the durable server log, verbatim */}
        <div className="min-w-0">
          <ColumnHeader
            icon={<Database className="size-3 text-teal-300/80" aria-hidden />}
            title="server log · SQLite"
            count={server.isLoading ? null : serverRuns.length}
          />
          {serverRuns.length > 0 && (
            <p className="mb-2 font-mono text-[9.5px] text-muted-foreground/70">
              survives browser wipes · POSTed by real sessions only
            </p>
          )}
          {server.isLoading ? (
            <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border">
              <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
              <span className="sr-only">Loading server log</span>
            </div>
          ) : server.isError ? (
            <div className="flex h-24 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-red-400/30 bg-red-400/5 text-center">
              <p className="text-xs text-red-300">Server log unavailable.</p>
              <p className="font-mono text-[9.5px] text-muted-foreground/70">
                {(server.error as Error).message}
              </p>
            </div>
          ) : serverRuns.length === 0 ? (
            <div className="flex h-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-center">
              <p className="text-xs text-muted-foreground">Nothing synced yet.</p>
              <p className="font-mono text-[9.5px] text-muted-foreground/70">
                runs POST here automatically at scan completion
              </p>
            </div>
          ) : (
            <ul className="max-h-[264px] space-y-1.5 overflow-y-auto pr-1">
              {serverRuns.slice(0, MAX_ROWS).map((run, i) => (
                <ServerRunRow key={run.id} run={run} index={i} />
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <ShieldCheck className="size-3 shrink-0 text-primary" aria-hidden />
        the server stores exactly what your browser measured and POSTed — it never fabricates runs
        or figures (Gate 21); sync failure never blocks or loses a local run
      </p>
    </Panel>
  )
}
