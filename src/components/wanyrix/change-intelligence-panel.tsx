'use client'

import { useMemo, useState } from 'react'
import {
  ArrowLeftRight,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  GitBranch,
  Info,
  ListPlus,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ENGINE_VERSION } from '@/lib/wanyrix/engine-meta'
import {
  useEngineGit,
  useEngineImpact,
  useEngineWhatChanged,
  useRegisteredWorkspaces,
  EngineExecError,
  type EngineImpactPayload,
  type EngineWhatChangedPayload,
} from '@/lib/wanyrix/hooks'
import type { Severity } from '@/lib/wanyrix/types'
import { cn } from '@/lib/utils'
import { Panel, SeverityBadge } from './shared'

/**
 * "Impact & changes" panel (issue #69) — the three engine v0.8.0
 * change-intelligence surfaces wired to the REAL binary through the new
 * routes (`wanyrix.engine-exec/v1` wrappers around verbatim
 * `wanyrix.git/v1` / `wanyrix.impact/v1` / `wanyrix.what-changed/v1`):
 *
 *   - impact   — measured rebuild blast radius per crate: direct dependents
 *     by kind, transitive dependents, workspace size, blast radius per mille;
 *   - changes  — added / resolved / severity-changed findings vs the stored
 *     baseline (`<target>/.wanyrix/store.db`), with severity delta chips.
 *
 * Honesty contract (Gate 21): every number here is engine output; named
 * errors quote the engine's stderr verbatim; a missing scan store is an
 * error state (with the engine's own remediation), a baseline-less store is
 * a valid empty-state (the engine's `baselineNote`), never fabricated data.
 *
 * Target resolution: the repo engine crate (dogfood) by default, or any
 * REGISTERED local project (same resolution contract as the connect-a-
 * project bridge). The crate picker auto-commits the engine's own reported
 * workspace name (then the first changed crate) and always allows any name.
 */

/** Sentinel for the dogfood target — Radix Select items cannot use `''`. */
const DOGFOOD = '__dogfood__'

/** Engine severities are the three known strings; anything else renders as info. */
function asSeverity(s: string | undefined): Severity {
  return s === 'critical' || s === 'warning' || s === 'info' ? s : 'info'
}

/** Severity family color for the + side of a delta chip. */
const SEV_POSITIVE: Record<Severity, string> = {
  critical: 'border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-300',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  info: 'border-teal-500/30 bg-teal-500/10 text-teal-800 dark:text-teal-300',
}

/** Inline named-error block — mirrors the engine-exec panel's styling. */
function EngineErrorBlock({ err }: { err: EngineExecError }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] p-3">
      <p className="flex items-center gap-1.5 text-xs text-amber-300">
        <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
        {err.status === 503
          ? 'Surface unavailable on this machine'
          : err.status === 504
            ? 'Engine timed out'
            : 'Engine execution failed'}
        <span className="font-mono text-[9.5px] text-muted-foreground/70">HTTP {err.status}</span>
      </p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{err.message}</p>
      {err.detail && (
        <p
          className="max-h-16 overflow-y-auto rounded border border-border/50 bg-card p-2 font-mono text-[9.5px] leading-relaxed text-muted-foreground/80"
          aria-label="Engine stderr, quoted verbatim"
        >
          {err.detail}
        </p>
      )}
      {err.hint && (
        <p className="font-mono text-[10px] text-muted-foreground/80">hint: {err.hint}</p>
      )}
    </div>
  )
}

function SectionSpinner({ label }: { label: string }) {
  return (
    <div className="flex h-14 items-center justify-center gap-2 rounded-lg border border-dashed border-border">
      <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
      <p className="font-mono text-[11px] text-muted-foreground">{label}</p>
      <span className="sr-only">Loading</span>
    </div>
  )
}

/** One `+N / -N / ±0` severity-delta chip — sign is explicit, never colored prose. */
function SeverityDeltaChip({ label, value }: { label: string; value: number }) {
  const positive = value > 0
  const negative = value < 0
  const sev: Severity = label === 'critical' ? 'critical' : label === 'warning' ? 'warning' : 'info'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums',
        positive
          ? SEV_POSITIVE[sev]
          : negative
            ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
            : 'border-border/70 bg-muted/30 text-muted-foreground',
      )}
    >
      {positive ? `+${value}` : negative ? `−${Math.abs(value)}` : '±0'}
      <span className="font-sans text-[10px] font-normal text-muted-foreground">{label}</span>
    </span>
  )
}

/** Findings list — severity badge + stable id + title, scroll-capped. */
function FindingList({
  icon,
  label,
  entries,
  tone,
}: {
  icon: React.ReactNode
  label: string
  entries: { id?: string; severity?: string; title?: string; previousSeverity?: string }[]
  tone: string
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <span className={cn('flex items-center', tone)} aria-hidden>
          {icon}
        </span>
        {label}
        <span className="font-mono tabular-nums text-[10px] text-muted-foreground/70">
          {entries.length}
        </span>
      </p>
      {entries.length === 0 ? (
        <p className="mt-1 rounded border border-dashed border-border/60 px-2 py-1 text-[11px] text-muted-foreground/70">
          none
        </p>
      ) : (
        <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto pr-1" aria-label={label}>
          {entries.map((f, i) => (
            <li
              key={`${f.id ?? 'id'}-${i}`}
              className="flex min-w-0 items-center gap-2 rounded border border-border/60 bg-card/60 px-2 py-1"
            >
              <SeverityBadge severity={asSeverity(f.severity)} />
              {f.id && (
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground/80">
                  {f.id}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-[11px]" title={f.title ?? f.id}>
                {f.title ?? f.id}
              </span>
              {f.previousSeverity && (
                <span className="shrink-0 font-mono text-[9.5px] text-muted-foreground/70">
                  {f.previousSeverity} → {f.severity}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Measured impact view — pure rendering of the verbatim `wanyrix.impact/v1`. */
function ImpactResult({ data }: { data: EngineImpactPayload }) {
  const r = data.report
  const perMille = typeof r.blastRadiusPerMille === 'number' ? r.blastRadiusPerMille : 0
  const crates = typeof r.workspaceCrateCount === 'number' ? r.workspaceCrateCount : 0
  const kinds = r.directDependentsByKind ?? {}
  const kindRows: { kind: 'normal' | 'build' | 'dev'; names: string[] }[] = [
    { kind: 'normal', names: kinds.normal ?? [] },
    { kind: 'build', names: kinds.build ?? [] },
    { kind: 'dev', names: kinds.dev ?? [] },
  ]
  return (
    <div className="space-y-2.5" role="status">
      {/* headline figure */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-2xl font-semibold tabular-nums tracking-tight">
          {perMille}
          <span className="ml-0.5 text-base">‰</span>
        </span>
        <span className="text-xs text-muted-foreground">
          of workspace
          {crates > 0 && (
            <span className="text-muted-foreground/70">
              {' '}
              (≈{(perMille / 10).toFixed(1)}% · {crates} crates measured)
            </span>
          )}
        </span>
        {r.crateName && (
          <span className="ml-auto rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10.5px] text-primary">
            {r.crateName}
          </span>
        )}
      </div>

      {/* direct dependents by kind */}
      <div className="grid gap-1.5 sm:grid-cols-3">
        {kindRows.map(({ kind, names }) => (
          <div key={kind} className="rounded-lg border border-border/70 bg-card/60 p-2">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground/70">
              {kind} dependents
            </p>
            <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{names.length}</p>
            {names.length > 0 && (
              <p
                className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground"
                title={names.join(', ')}
              >
                {names.join(', ')}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* transitive dependents */}
      <div>
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <ArrowRight className="size-3" aria-hidden />
          transitive dependents
          <span className="font-mono tabular-nums text-[10px] text-muted-foreground/70">
            {r.transitiveDependents?.length ?? 0}
          </span>
        </p>
        {(r.transitiveDependents?.length ?? 0) === 0 ? (
          <p className="mt-1 rounded border border-dashed border-border/60 px-2 py-1 text-[11px] text-muted-foreground/70">
            none — nothing else rebuilds when this crate changes
          </p>
        ) : (
          <ul
            className="mt-1 flex max-h-28 flex-wrap gap-1 overflow-y-auto pr-1"
            aria-label="Transitive dependents"
          >
            {(r.transitiveDependents ?? []).map((name) => (
              <li
                key={name}
                className="rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 font-mono text-[10px]"
              >
                {name}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* engine's own honesty note */}
      {r.note && (
        <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-muted-foreground/80">
          <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
          {r.note}
        </p>
      )}
    </div>
  )
}

export function ChangeIntelligencePanel() {
  const registered = useRegisteredWorkspaces()
  const [targetValue, setTargetValue] = useState(DOGFOOD)
  const target = targetValue === DOGFOOD ? '' : targetValue

  const git = useEngineGit(target)
  const wc = useEngineWhatChanged(target)

  const [manualCrate, setManualCrate] = useState<string | null>(null)
  const [crateInput, setCrateInput] = useState('')

  // a new target invalidates any manual crate pick (the old name may not exist
  // there) — the React-documented render-time state adjustment, not an effect
  const [lastTarget, setLastTarget] = useState(target)
  if (lastTarget !== target) {
    setLastTarget(target)
    setManualCrate(null)
    setCrateInput('')
  }

  // auto-pick: the engine's own workspace name, else the first measured changed crate
  const autoCrate = useMemo(
    () =>
      wc.data?.report.workspace?.trim() ||
      git.data?.report.changedCrates?.find((c) => typeof c.crateName === 'string' && c.crateName)
        ?.crateName ||
      '',
    [wc.data, git.data],
  )
  const crate = manualCrate ?? autoCrate
  const impact = useEngineImpact(crate, target)

  const busy = git.isFetching || wc.isFetching || impact.isFetching
  const refresh = () => {
    void git.refetch()
    void wc.refetch()
    if (crate.trim()) void impact.refetch()
  }

  const changedCrates = (git.data?.report.changedCrates ?? []).filter(
    (c): c is { crateName: string; changedFiles?: number } => typeof c.crateName === 'string',
  )
  const wcReport = wc.data?.report
  const delta = wcReport?.severityDelta
  const findings = wcReport?.findings

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <GitBranch className="size-4 text-primary" aria-hidden />
          Impact &amp; changes
        </span>
      }
      subtitle={`real engine change intelligence — wanyrix git · impact · what-changed (v${ENGINE_VERSION}, measured only)`}
      actions={
        <>
          <Select
            value={targetValue}
            onValueChange={setTargetValue}
            disabled={registered.isLoading}
          >
            <SelectTrigger
              className="h-8 w-[200px] gap-1.5 text-xs sm:w-[240px]"
              aria-label="Exec target — the registered project the engine surfaces run against"
            >
              <SelectValue placeholder="target" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DOGFOOD} className="text-xs">
                engine/ — this repo (dogfood)
              </SelectItem>
              {(registered.data ?? []).map((ws) => (
                <SelectItem key={ws.id} value={ws.id} className="text-xs">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{ws.name}</span>
                    <span className="ml-auto font-mono text-[9px] text-muted-foreground">
                      {ws.crates} crates
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="icon"
            variant="outline"
            className="size-8"
            onClick={refresh}
            disabled={busy}
            aria-label="Re-run the three engine change-intelligence commands"
            title="Re-run wanyrix git / impact / what-changed"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-3.5" aria-hidden />
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* -------------------------------------------------- impact section */}
        <section aria-label="Rebuild impact" className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
              impact — rebuild blast radius
            </p>
            <div className="ml-auto flex min-w-0 flex-1 items-center gap-1.5 sm:max-w-xs">
              <Input
                value={crateInput}
                onChange={(e) => setCrateInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && crateInput.trim()) setManualCrate(crateInput.trim())
                }}
                placeholder="crate name…"
                className="h-8 min-w-0 flex-1 font-mono text-xs"
                aria-label="Workspace crate name to measure the rebuild blast radius for"
                spellCheck={false}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0 text-xs"
                onClick={() => crateInput.trim() && setManualCrate(crateInput.trim())}
                disabled={!crateInput.trim() || impact.isFetching}
              >
                Go
              </Button>
            </div>
          </div>

          {/* quick picks: crates the git surface just measured as changed */}
          {changedCrates.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Changed crates">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground/60">
                changed:
              </span>
              {changedCrates.map((c) => (
                <Button
                  key={c.crateName}
                  size="sm"
                  variant="outline"
                  className="h-6 rounded-full px-2.5 font-mono text-[10px]"
                  onClick={() => {
                    setCrateInput(c.crateName)
                    setManualCrate(c.crateName)
                  }}
                  aria-label={`Measure impact of ${c.crateName}`}
                >
                  {c.crateName}
                  {typeof c.changedFiles === 'number' && (
                    <span className="ml-1 text-muted-foreground/70">{c.changedFiles}f</span>
                  )}
                </Button>
              ))}
            </div>
          )}

          {impact.isPending && crate.trim() !== '' && (
            <SectionSpinner
              label={`wanyrix impact --crate ${crate} — measuring dependency edges…`}
            />
          )}
          {impact.isError && <EngineErrorBlock err={impact.error as EngineExecError} />}
          {impact.data && <ImpactResult data={impact.data} />}
          {crate.trim() === '' && !impact.isPending && (
            <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
              Enter a workspace crate name to measure its rebuild blast radius — the engine
              reports direct dependents by kind, transitive reach and per-mille of workspace.
            </p>
          )}
        </section>

        {/* ------------------------------------------------- changes section */}
        <section aria-label="What changed" className="space-y-2 border-t border-border/60 pt-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
            what-changed — findings vs stored baseline
            {wcReport?.workspace && (
              <span className="ml-2 normal-case tracking-normal text-muted-foreground/60">
                workspace {wcReport.workspace}
              </span>
            )}
          </p>

          {wc.isPending && (
            <SectionSpinner label="wanyrix what-changed — comparing against the stored baseline…" />
          )}
          {wc.isError && <EngineErrorBlock err={wc.error as EngineExecError} />}

          {wc.data && wcReport && (
            <div className="space-y-2.5" role="status">
              {/* baseline reference or the engine's own empty-store note */}
              {wcReport.against ? (
                <p className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[10.5px] text-emerald-800 dark:text-emerald-300">
                  <CalendarClock className="size-3" aria-hidden />
                  baseline scan #{wcReport.against.scanId ?? '?'} · finished{' '}
                  {wcReport.against.finishedAt ?? 'unknown'}
                </p>
              ) : (
                <div className="flex items-start gap-2 rounded-lg border border-dashed border-border p-2.5">
                  <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {wcReport.baselineNote ??
                      'no stored baseline — save one with `wanyrix store save --db <store> --scan <doctor --json output>`'}
                  </p>
                </div>
              )}

              {/* severity delta chips */}
              {delta && (
                <div className="flex flex-wrap items-center gap-1.5" aria-label="Severity delta">
                  <SeverityDeltaChip label="critical" value={delta.critical ?? 0} />
                  <SeverityDeltaChip label="warning" value={delta.warning ?? 0} />
                  <SeverityDeltaChip label="info" value={delta.info ?? 0} />
                  {(delta.critical ?? 0) === 0 &&
                    (delta.warning ?? 0) === 0 &&
                    (delta.info ?? 0) === 0 && (
                      <span className="text-[11px] text-muted-foreground/70">
                        no severity movement vs baseline
                      </span>
                    )}
                </div>
              )}

              {/* added / resolved / changed findings */}
              <div className="grid gap-3 lg:grid-cols-3">
                <FindingList
                  icon={<ListPlus className="size-3.5" />}
                  tone="text-red-800 dark:text-red-300"
                  label="added"
                  entries={findings?.added ?? []}
                />
                <FindingList
                  icon={<CheckCircle2 className="size-3.5" />}
                  tone="text-emerald-800 dark:text-emerald-300"
                  label="resolved"
                  entries={findings?.resolved ?? []}
                />
                <FindingList
                  icon={<ArrowLeftRight className="size-3.5" />}
                  tone="text-amber-800 dark:text-amber-300"
                  label="changed"
                  entries={findings?.changed ?? []}
                />
              </div>
            </div>
          )}
        </section>
      </div>
    </Panel>
  )
}
