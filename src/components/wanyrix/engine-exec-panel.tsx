'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Cpu,
  Gauge,
  Hammer,
  Loader2,
  PackageOpen,
  ShieldCheck,
  TerminalSquare,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import {
  EngineExecError,
  useEngineBuild,
  useEngineDoctor,
  useRecordScanRun,
  type EngineBuildPayload,
  type EngineExecPayload,
} from '@/lib/wanyrix/hooks'
import { capFindingIds } from '@/lib/wanyrix/finding-diff'
import { useScanStore } from '@/lib/wanyrix/scan-store'
import { useWorkspaceStore } from '@/lib/wanyrix/workspace-store'
import { cn } from '@/lib/utils'
import { Panel } from './shared'

/**
 * "Real engine binary" panel (Build Doctor view) — the one surface backed by
 * actual execution. Two modes, both spawning the wanyrix binary built from
 * engine/ on the host and returning its verbatim stdout:
 *
 * - doctor — `wanyrix doctor --path engine --json` (wanyrix.doctor/v1).
 *   Every successful run is RECORDED into the scan history (trigger
 *   `engine-exec`, R8) with the binary's real `FER-ENG-*` finding ids as the
 *   findings fingerprint — so Compare, CSV export and the durable server
 *   sync all work on real engine data, not just the demo replay.
 * - build (R8) — `wanyrix build --path engine --json` (wanyrix.build/v1):
 *   an INSTRUMENTED build. wallClockMs and cacheHitRate are MEASURED here —
 *   the one surface where the demo's not-measured zeros gain real numbers.
 *
 * When the binary isn't built on this machine the panel says so honestly
 * (503) with the build hint — nothing is ever fabricated (Gate 21).
 */

const SEV_DOT: Record<string, string> = {
  critical: 'bg-red-400',
  warning: 'bg-amber-400',
  info: 'bg-teal-300',
}

type ExecMode = 'doctor' | 'build'

function tallyFindings(report: EngineExecPayload['report']) {
  const counts = { critical: 0, warning: 0, info: 0, other: 0 }
  for (const f of report.findings ?? []) {
    const s = f.severity
    if (s === 'critical' || s === 'warning' || s === 'info') counts[s] += 1
    else counts.other += 1
  }
  return counts
}

/** Measured KPI cell (build mode). */
function BuildKpi({
  label,
  value,
  accent,
  sub,
}: {
  label: string
  value: string
  accent?: boolean
  sub?: string
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-2.5 py-2',
        accent
          ? 'border-teal-400/25 bg-teal-400/[0.06]'
          : 'border-border/60 bg-muted/10',
      )}
    >
      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          'mt-1 truncate font-mono text-[12px] font-semibold tabular-nums',
          accent ? 'text-teal-300' : 'text-foreground/90',
        )}
      >
        {value}
      </p>
      {sub && <p className="truncate font-mono text-[8.5px] text-muted-foreground/70">{sub}</p>}
    </div>
  )
}

function BuildModeView({ data }: { data: EngineBuildPayload }) {
  const [showRaw, setShowRaw] = useState(false)
  const [showArtifacts, setShowArtifacts] = useState(true)
  const r = data.report
  const s = r.summary
  const total = s?.artifactsTotal ?? 0
  const fresh = s?.artifactsFresh ?? 0
  const measuredRate = s?.cacheHitRateStatus?.startsWith('measured') ?? false

  const copyJson = () => {
    if (!navigator.clipboard) return
    navigator.clipboard
      .writeText(JSON.stringify(r, null, 2))
      .then(() => {})
      .catch(() => {})
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-3"
    >
      {/* success / failure headline — a failed build is data, never hidden */}
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border px-3 py-2',
          r.buildSuccess
            ? 'border-teal-400/25 bg-teal-400/[0.06]'
            : 'border-amber-400/30 bg-amber-400/[0.06]',
        )}
      >
        <Hammer className={cn('size-3.5 shrink-0', r.buildSuccess ? 'text-teal-300' : 'text-amber-300')} aria-hidden />
        <p className="text-xs text-foreground/90">
          {r.buildSuccess ? 'Build succeeded' : 'Build FAILED'}{' '}
          <span className="font-mono text-[10px] text-muted-foreground">
            · exit {r.exitCode ?? 'signal'} · workspace “{r.workspace ?? '—'}”
          </span>
        </p>
        <span className="ml-auto font-mono text-[9.5px] text-muted-foreground/70">
          wanyrix.build/v1
        </span>
      </div>

      {/* measured KPIs */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <BuildKpi
          label="wall clock"
          value={`${r.wallClockMs ?? '—'}ms`}
          sub={r.durationStatus ? 'measured' : undefined}
          accent
        />
        <BuildKpi
          label="cache hit rate"
          value={measuredRate ? `${s?.cacheHitRate ?? 0}/100` : 'n/a'}
          sub={
            total === 0
              ? 'no artifacts'
              : `${fresh}/${total} artifacts fresh (measured)`
          }
          accent={measuredRate}
        />
        <BuildKpi
          label="artifacts"
          value={String(total)}
          sub={`${s?.artifactsRebuilt ?? 0} rebuilt`}
        />
        <BuildKpi
          label="diagnostics"
          value={`${s?.warnings ?? 0}w · ${s?.errors ?? 0}e`}
          sub={`${s?.ice ?? 0} ICE · ${s?.notes ?? 0} notes`}
        />
      </div>

      {/* per-artifact stream activity */}
      {(r.artifacts?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-border/60">
          <button
            type="button"
            onClick={() => setShowArtifacts((v) => !v)}
            className="flex w-full items-center justify-between gap-2 border-b border-border/50 px-3 py-2"
            aria-expanded={showArtifacts}
          >
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <Gauge className="size-3" aria-hidden />
              per-artifact stream activity · {r.artifacts?.length}
            </span>
            {showArtifacts ? (
              <ChevronUp className="size-3 text-muted-foreground" aria-hidden />
            ) : (
              <ChevronDown className="size-3 text-muted-foreground" aria-hidden />
            )}
          </button>
          {showArtifacts && (
            <ul className="max-h-40 space-y-1 overflow-y-auto px-3 py-2" aria-label="Artifact activity">
              {r.artifacts?.map((a, i) => (
                <li
                  key={`${a.package ?? 'pkg'}-${i}`}
                  className="flex items-center gap-2 font-mono text-[10px]"
                >
                  <span
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      a.fresh ? 'bg-teal-300' : 'bg-orange-300',
                    )}
                    aria-hidden
                  />
                  <span className="truncate text-foreground/85" title={a.package}>
                    {a.package ?? '—'}
                  </span>
                  <span className="shrink-0 text-muted-foreground/60">
                    {a.targetKinds?.join(',') ?? ''}
                  </span>
                  <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                    +{a.arrivalDeltaMs ?? 0}ms
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded px-1 py-px text-[8.5px] uppercase',
                      a.fresh
                        ? 'bg-teal-400/10 text-teal-300'
                        : 'bg-orange-400/10 text-orange-300',
                    )}
                  >
                    {a.fresh ? 'fresh' : 'rebuilt'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-border/50 px-3 py-1.5 text-[9.5px] leading-relaxed text-muted-foreground/75">
            arrivalDeltaMs = measured delta between consecutive cargo messages — cargo runs
            parallel jobs, so these overlap and are NOT per-crate build times. wall clock is the
            only exact duration.
          </p>
        </div>
      )}

      {/* failed-build stderr tail (data, scrubbed) */}
      {!r.buildSuccess && r.cargoStderrTail && (
        <pre className="max-h-24 overflow-auto rounded-lg border border-amber-400/30 bg-amber-400/[0.05] px-3 py-2 font-mono text-[9.5px] leading-relaxed text-amber-200/90">
          {r.cargoStderrTail}
        </pre>
      )}

      {/* raw stdout */}
      <div className="rounded-lg border border-border/60">
        <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={showRaw}
          >
            {showRaw ? <ChevronUp className="size-3" aria-hidden /> : <ChevronDown className="size-3" aria-hidden />}
            verbatim stdout · wanyrix.build/v1
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
            {JSON.stringify(r, null, 2)}
          </pre>
        )}
      </div>

      <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3 shrink-0 text-primary" aria-hidden />
        diagnostics are counted, never copied — rendered source text is dropped unconditionally
        (policy {r.redaction?.policy ?? 'wanyrix.telemetry-redaction/v1'};{' '}
        {r.redaction?.renderedDropped ?? 0} messages dropped, {r.redaction?.secretsScrubbed ?? 0}{' '}
        secrets scrubbed). The demo labels cacheHitRate not-measured — THIS number is measured by
        the real binary.
      </p>
    </motion.div>
  )
}

export function EngineExecPanel() {
  const [mode, setMode] = useState<ExecMode>('doctor')
  const exec = useEngineDoctor()
  const build = useEngineBuild()
  const recordScanRun = useRecordScanRun()
  const addScanEntry = useScanStore((s) => s.addEntry)
  const activeWs = useWorkspaceStore((s) => s.active)
  const { toast } = useToast()
  const [showRaw, setShowRaw] = useState(false)

  const pending = mode === 'doctor' ? exec.isPending : build.isPending
  const data = mode === 'doctor' ? exec.data : build.data
  const err = (mode === 'doctor' ? exec.error : build.error) as EngineExecError | null
  const idle = exec.isIdle && build.isIdle
  const tally = useMemo(
    () => (mode === 'doctor' && exec.data ? tallyFindings(exec.data.report) : null),
    [exec.data, mode],
  )

  /** Doctor exec — on success the REAL run is recorded into scan history. */
  const runDoctor = () => {
    const startedAt = Date.now()
    exec.mutate(undefined, {
      onSuccess: (d) => {
        const finishedAt = Date.now()
        const findings = d.report.findings ?? []
        const counts = tallyFindings(d.report)
        const fingerprint = capFindingIds(
          findings
            .map((f) => f.id)
            .filter((id): id is string => typeof id === 'string'),
        )
        const record = recordScanRun({
          startedAt,
          finishedAt,
          durationMs: finishedAt - startedAt,
          findingCount: findings.length,
          severityCounts: {
            critical: counts.critical,
            warning: counts.warning,
            info: counts.info,
          },
          trigger: 'engine-exec',
          findingIds: fingerprint.ids,
          findingIdsTruncated: fingerprint.truncated,
        })
        // History-list entry (same dual-write the demo replay does in
        // doctor-view's handleScanDone). The engine's doctor scan measures
        // NO build time → buildTime is a visible zero explicitly labeled
        // 'not-measured' (Gate 21 — never a fake "0.0s measured").
        addScanEntry(activeWs, {
          id: `engine-${finishedAt}`,
          workspace: activeWs,
          at: finishedAt,
          durationMs: finishedAt - startedAt,
          findings: findings.length,
          critical: counts.critical,
          warning: counts.warning,
          info: counts.info,
          buildTime: 0,
          estimatedFrom: 0,
          estimatedTo: 0,
          trigger: 'engine-exec',
          buildTimeStatus: 'not-measured',
          findingIds: fingerprint.ids,
          ...(fingerprint.truncated ? { findingIdsTruncated: true } : {}),
        })
        toast({
          title: `Real engine run — ${d.binary.version}`,
          description: `${findings.length} findings · ${d.durationMs}ms · recorded to history (engine exec, ${record.id}) and queued for durable sync`,
        })
      },
      // errors surface inside the panel (honest per-status copy) — no toast spam
    })
  }

  const runBuild = () =>
    build.mutate(undefined, {
      onSuccess: (d) => {
        const s = d.report.summary
        toast({
          title: `Real instrumented build — ${d.binary.version}`,
          description: `${d.report.wallClockMs ?? '—'}ms wall clock · ${s?.cacheHitRate ?? 0}/100 cache hit (${s?.artifactsFresh ?? 0}/${s?.artifactsTotal ?? 0} fresh) · measured, not estimated`,
        })
      },
    })

  const run = () => (mode === 'doctor' ? runDoctor() : runBuild())

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Cpu className="size-3.5 text-primary" aria-hidden />
          Real engine binary
        </span>
      }
      subtitle={
        mode === 'doctor'
          ? 'executes wanyrix doctor --path engine --json on this machine · verbatim stdout · not a fixture'
          : 'executes wanyrix build --path engine --json — an INSTRUMENTED build (measured wall clock + cache-hit rate)'
      }
      actions={
        <div className="flex items-center gap-1.5">
          {/* mode switch */}
          <div
            role="tablist"
            aria-label="Engine exec mode"
            className="flex overflow-hidden rounded-md border border-border/60"
          >
            {(['doctor', 'build'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  'px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] transition-colors',
                  mode === m
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground',
                )}
              >
                {m}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 font-mono text-[10.5px]"
            onClick={run}
            disabled={pending}
            aria-label={
              mode === 'doctor'
                ? 'Execute the real wanyrix binary (doctor scan)'
                : 'Execute the real instrumented build'
            }
          >
            {pending ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : (
              <TerminalSquare className="size-3" aria-hidden />
            )}
            {pending ? 'executing…' : 'Execute'}
          </Button>
        </div>
      }
    >
      {idle && (
        <div className="flex h-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-center">
          <p className="text-xs text-muted-foreground">
            The web demo mirrors the CLI — this button runs the real thing.
          </p>
          <p className="font-mono text-[9.5px] text-muted-foreground/70">
            {mode === 'doctor'
              ? 'spawn · measure · return stdout verbatim (wanyrix.engine-exec/v1)'
              : 'spawn cargo · measure · return stdout verbatim (wanyrix.engine-build/v1)'}
          </p>
        </div>
      )}

      {pending && (
        <div className="flex h-20 items-center justify-center gap-2 rounded-lg border border-dashed border-border">
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
          <p className="font-mono text-[11px] text-muted-foreground">
            {mode === 'doctor'
              ? 'wanyrix doctor --path engine --json — measuring real crates…'
              : 'wanyrix build --path engine — building for real, measuring the stream…'}
          </p>
          <span className="sr-only">Executing engine</span>
        </div>
      )}

      {err && !pending && (
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

      {mode === 'doctor' && exec.data && !exec.isPending && <DoctorView data={exec.data} tally={tally} showRaw={showRaw} setShowRaw={setShowRaw} />}
      {mode === 'build' && build.data && !build.isPending && <BuildModeView data={build.data} />}
    </Panel>
  )
}

function DoctorView({
  data,
  tally,
  showRaw,
  setShowRaw,
}: {
  data: EngineExecPayload
  tally: { critical: number; warning: number; info: number; other: number } | null
  showRaw: boolean
  setShowRaw: (v: boolean) => void
}) {
  const { toast } = useToast()
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

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-3"
    >
      {/* execution facts */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-teal-400/25 bg-teal-400/[0.06] px-2.5 py-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">version</p>
          <p className="mt-1 truncate font-mono text-[12px] font-semibold text-teal-300">
            {data.binary.version.replace(/^wanyrix\s*/, 'v')}
          </p>
        </div>
        <div className="rounded-lg border border-border/60 bg-muted/10 px-2.5 py-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">exec time</p>
          <p className="mt-1 font-mono text-[12px] font-semibold tabular-nums text-foreground/90">
            {data.durationMs}ms
          </p>
        </div>
        <div className="rounded-lg border border-border/60 bg-muted/10 px-2.5 py-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">crates scanned</p>
          <p className="mt-1 flex items-center gap-1 font-mono text-[12px] font-semibold tabular-nums text-foreground/90">
            <PackageOpen className="size-3 text-muted-foreground" aria-hidden />
            {data.report.crates?.length ?? '—'}
          </p>
        </div>
        <div className="rounded-lg border border-border/60 bg-muted/10 px-2.5 py-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">findings</p>
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

      {/* recording note (R8) */}
      <p className="rounded-lg border border-border/60 bg-muted/10 px-3 py-2 text-[10.5px] leading-relaxed text-muted-foreground">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-primary">recorded ·</span>{' '}
        this run entered the scan history with trigger{' '}
        <span className="font-mono text-[10px] text-foreground/85">engine exec</span> and its real
        <span className="font-mono text-[10px] text-foreground/85"> FER-ENG-*</span> finding ids as the
        fingerprint — Compare, CSV export and the durable server sync all work on it. Build time shows
        as <span className="font-mono text-[10px]">not measured</span> (the engine deliberately emits
        none here; run the <span className="font-mono text-[10px]">build</span> mode for measured times).
      </p>

      {/* raw stdout */}
      <div className="rounded-lg border border-border/60">
        <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
          <button
            type="button"
            onClick={() => setShowRaw(!showRaw)}
            className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={showRaw}
          >
            {showRaw ? <ChevronUp className="size-3" aria-hidden /> : <ChevronDown className="size-3" aria-hidden />}
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
  )
}
