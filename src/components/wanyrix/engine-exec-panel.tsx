'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Cpu,
  Loader2,
  PackageOpen,
  ShieldCheck,
  TerminalSquare,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { EngineExecError, useEngineDoctor, type EngineExecPayload } from '@/lib/wanyrix/hooks'
import { cn } from '@/lib/utils'
import { Panel } from './shared'

/**
 * "Real engine binary" panel (Build Doctor view) — the one surface backed by
 * actual execution: GET /api/wanyrix/engine/doctor spawns the wanyrix binary
 * built from engine/ on the host and returns its verbatim wanyrix.doctor/v1
 * stdout. The scan target is the engine crate itself (dogfood). When the
 * binary isn't built on this machine the panel says so honestly (503) with
 * the build hint — nothing is ever fabricated (Gate 21).
 */

const SEV_DOT: Record<string, string> = {
  critical: 'bg-red-400',
  warning: 'bg-amber-400',
  info: 'bg-teal-300',
}

function tallyFindings(report: EngineExecPayload['report']) {
  const counts = { critical: 0, warning: 0, info: 0, other: 0 }
  for (const f of report.findings ?? []) {
    const s = f.severity
    if (s === 'critical' || s === 'warning' || s === 'info') counts[s] += 1
    else counts.other += 1
  }
  return counts
}

export function EngineExecPanel() {
  const exec = useEngineDoctor()
  const { toast } = useToast()
  const [showRaw, setShowRaw] = useState(false)
  const data = exec.data
  const tally = useMemo(() => (data ? tallyFindings(data.report) : null), [data])

  const run = () =>
    exec.mutate(undefined, {
      onSuccess: (d) =>
        toast({
          title: `Real engine run — ${d.binary.version}`,
          description: `${d.report.findings?.length ?? 0} findings · ${d.durationMs}ms · scanned ${d.scanTarget}`,
        }),
      // errors surface inside the panel (honest per-status copy) — no toast spam
    })

  const copyJson = () => {
    if (!data || !navigator.clipboard) return
    navigator.clipboard
      .writeText(JSON.stringify(data.report, null, 2))
      .then(() =>
        toast({
          title: 'Copied — real engine stdout',
          description: 'The verbatim wanyrix.doctor/v1 report is on your clipboard.',
        }),
      )
      .catch(() => toast({ title: 'Copy failed', description: 'Clipboard permission denied.' }))
  }

  const err = exec.error as EngineExecError | null

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Cpu className="size-3.5 text-primary" aria-hidden />
          Real engine binary
        </span>
      }
      subtitle="executes wanyrix doctor --path engine --json on this machine · verbatim stdout · not a fixture"
      actions={
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2 font-mono text-[10.5px]"
          onClick={run}
          disabled={exec.isPending}
          aria-label="Execute the real wanyrix binary"
        >
          {exec.isPending ? (
            <Loader2 className="size-3 animate-spin" aria-hidden />
          ) : (
            <TerminalSquare className="size-3" aria-hidden />
          )}
          {exec.isPending ? 'executing…' : 'Execute'}
        </Button>
      }
    >
      {exec.isIdle && (
        <div className="flex h-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-center">
          <p className="text-xs text-muted-foreground">
            The web demo mirrors the CLI — this button runs the real thing.
          </p>
          <p className="font-mono text-[9.5px] text-muted-foreground/70">
            spawn · measure · return stdout verbatim (wanyrix.engine-exec/v1)
          </p>
        </div>
      )}

      {exec.isPending && (
        <div className="flex h-20 items-center justify-center gap-2 rounded-lg border border-dashed border-border">
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
          <p className="font-mono text-[11px] text-muted-foreground">
            wanyrix doctor --path engine --json — measuring real crates…
          </p>
          <span className="sr-only">Executing engine</span>
        </div>
      )}

      {err && !exec.isPending && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] p-3">
          <p className="flex items-center gap-1.5 text-xs text-amber-300">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
            {err.status === 503
              ? 'Binary not built on this machine'
              : err.status === 504
                ? 'Engine timed out'
                : 'Engine execution failed'}
            <span className="font-mono text-[9.5px] text-muted-foreground/70">HTTP {err.status}</span>
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{err.message}</p>
          {err.detail && (
            <p className="max-h-16 overflow-y-auto rounded border border-border/50 bg-card p-2 font-mono text-[9.5px] leading-relaxed text-muted-foreground/80">
              {err.detail}
            </p>
          )}
          {err.hint && (
            <p className="font-mono text-[10px] text-muted-foreground/80">hint: {err.hint}</p>
          )}
        </div>
      )}

      {data && !exec.isPending && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-3"
        >
          {/* execution facts */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-teal-400/25 bg-teal-400/[0.06] px-2.5 py-2">
              <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                version
              </p>
              <p className="mt-1 truncate font-mono text-[12px] font-semibold text-teal-300">
                {data.binary.version.replace(/^wanyrix\s*/, 'v')}
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/10 px-2.5 py-2">
              <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                exec time
              </p>
              <p className="mt-1 font-mono text-[12px] font-semibold tabular-nums text-foreground/90">
                {data.durationMs}ms
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/10 px-2.5 py-2">
              <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                crates scanned
              </p>
              <p className="mt-1 flex items-center gap-1 font-mono text-[12px] font-semibold tabular-nums text-foreground/90">
                <PackageOpen className="size-3 text-muted-foreground" aria-hidden />
                {data.report.crates?.length ?? '—'}
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/10 px-2.5 py-2">
              <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                findings
              </p>
              <p className="mt-1 flex items-center gap-1.5 font-mono text-[12px] font-semibold tabular-nums text-foreground/90">
                {data.report.findings?.length ?? 0}
                {tally && (
                  <span className="flex items-center gap-1" aria-hidden>
                    <span className={cn('size-1.5 rounded-full', SEV_DOT.critical)} />
                    {tally.critical}
                    <span className={cn('size-1.5 rounded-full', SEV_DOT.warning)} />
                    {tally.warning}
                    <span className={cn('size-1.5 rounded-full', SEV_DOT.info)} />
                    {tally.info}
                  </span>
                )}
              </p>
            </div>
          </div>

          <p className="font-mono text-[9.5px] text-muted-foreground/75">
            workspace “{data.report.workspace ?? '—'}” · profile {data.binary.profile} · scanned{' '}
            {data.scanTarget} · {new Date(data.executedAt).toLocaleTimeString()}
          </p>

          {/* raw stdout */}
          <div className="rounded-lg border border-border/60">
            <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
              <button
                type="button"
                onClick={() => setShowRaw((v) => !v)}
                className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
                aria-expanded={showRaw}
              >
                {showRaw ? (
                  <ChevronUp className="size-3" aria-hidden />
                ) : (
                  <ChevronDown className="size-3" aria-hidden />
                )}
                verbatim stdout · wanyrix.doctor/v1
              </button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 gap-1 px-1.5 font-mono text-[9.5px] text-muted-foreground"
                onClick={copyJson}
              >
                <Copy className="size-3" aria-hidden />
                copy
              </Button>
            </div>
            {showRaw && (
              <pre className="max-h-72 overflow-auto px-3 py-2 font-mono text-[10px] leading-relaxed text-foreground/85">
                {JSON.stringify(data.report, null, 2)}
              </pre>
            )}
          </div>

          <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3 shrink-0 text-primary" aria-hidden />
            the engine emits wanyrix.doctor/v1 — build-time telemetry is deliberately absent from
            real output (measured or nothing, Gate 21); this report is the binary&apos;s exact
            stdout, validated only for envelope schema
          </p>
        </motion.div>
      )}
    </Panel>
  )
}
