'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { RefreshCw, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { ConfidenceClass, MeasurementStatus, Severity } from '@/lib/wanyrix/types'

/* ------------------------------------------------------------------ badges */

/*
 * Badge contrast (ENG-TCB-2): every badge must hold WCAG AA (≥4.5:1) on BOTH
 * themes. Light theme uses the -800 text shades (≥5.4:1 over the 10% tint on
 * any light surface: card oklch(0.995) and page oklch(0.977)); dark keeps the
 * -400/-300/-200 shades (≥6:1 over oklch(0.18) card). Computation:
 * tool-results/badge-contrast/contrast.mjs.
 */

const SEVERITY_STYLES: Record<Severity, string> = {
  critical: 'text-red-800 dark:text-red-400 bg-red-500/10 border-red-500/25',
  warning: 'text-amber-800 dark:text-amber-400 bg-amber-500/10 border-amber-500/25',
  info: 'text-teal-800 dark:text-teal-300 bg-teal-500/10 border-teal-500/25',
}

const SEVERITY_DOT: Record<Severity, string> = {
  critical: 'bg-red-400',
  warning: 'bg-amber-400',
  info: 'bg-teal-300',
}

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        SEVERITY_STYLES[severity],
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', SEVERITY_DOT[severity])} />
      {severity}
    </span>
  )
}

const CONFIDENCE_STYLES: Record<ConfidenceClass, string> = {
  deterministic: 'text-emerald-800 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/25',
  high: 'text-teal-800 dark:text-teal-300 bg-teal-500/10 border-teal-500/25',
  medium: 'text-amber-800 dark:text-amber-400 bg-amber-500/10 border-amber-500/25',
  estimated: 'text-orange-800 dark:text-orange-300 bg-orange-500/10 border-orange-500/25',
}

export function ConfidenceBadge({ level }: { level: ConfidenceClass }) {
  return (
    <span
      title="Confidence calibration (Gate 13)"
      className={cn(
        'inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide',
        CONFIDENCE_STYLES[level],
      )}
    >
      {level}
    </span>
  )
}

const MEASUREMENT_STYLES: Record<MeasurementStatus, string> = {
  measured: 'text-emerald-800 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/25',
  verified: 'text-emerald-800 dark:text-emerald-200 bg-emerald-500/20 border-emerald-400/40',
  estimated: 'text-orange-800 dark:text-orange-300 bg-orange-500/10 border-orange-500/25',
}

export function MeasurementBadge({ status }: { status: MeasurementStatus }) {
  return (
    <span
      title="Measurement status — estimates are never presented as measurements (Gate 21)"
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide',
        MEASUREMENT_STYLES[status],
      )}
    >
      {status === 'verified' ? '✓ verified' : status}
    </span>
  )
}

/**
 * Workspace provenance (QA-5-B-4) — fixture-backed demo workspaces must never
 * wear a LIVE badge. `fixtureOnly === true` (set by GET /api/wanyrix/workspaces,
 * issue #129) ⇒ DEMO; anything else is engine-measured and may say LIVE.
 * The style map lives beside the other badge maps so the badge-contrast
 * regression test (tests/unit/badge-contrast.test.ts) covers it automatically.
 */
export const PROVENANCE_STYLES: Record<'fixture' | 'measured', string> = {
  fixture: 'text-amber-800 dark:text-amber-300 bg-amber-500/10 border-amber-500/25',
  measured: 'text-emerald-800 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/25',
}

export type WorkspaceProvenance = keyof typeof PROVENANCE_STYLES

/** Pure mapping — only an EXPLICIT `fixtureOnly: true` marks demo data. */
export function workspaceProvenance(w: { fixtureOnly?: boolean }): WorkspaceProvenance {
  return w.fixtureOnly === true ? 'fixture' : 'measured'
}

export function WorkspaceProvenanceBadge({
  fixtureOnly,
  className,
}: {
  fixtureOnly?: boolean
  className?: string
}) {
  const kind = workspaceProvenance({ fixtureOnly })
  const isFixture = kind === 'fixture'
  return (
    <span
      title={isFixture ? 'synthetic demo data' : 'engine-measured workspace'}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wide',
        PROVENANCE_STYLES[kind],
        className,
      )}
    >
      {isFixture ? (
        'demo'
      ) : (
        <>
          <span className="size-1 animate-pulse rounded-full bg-emerald-400" aria-hidden />
          live
        </>
      )}
    </span>
  )
}

/**
 * Overview fixture banner (QA-5-B-4) — the 60-second first impression must
 * state that the default workspaces are synthetic, with a path to real data.
 * Rendered only when the ACTIVE workspace is a fixture (`fixtureOnly: true`).
 */
export function FixtureDataBanner({ onNavigateRepositories }: { onNavigateRepositories?: () => void }) {
  return (
    <div
      role="note"
      aria-label="Sample data notice"
      className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/[0.08] px-3.5 py-2.5 text-amber-800 dark:text-amber-300 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="flex items-start gap-2 text-[12.5px] leading-snug">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <span className="font-semibold">Sample data</span> — you&rsquo;re viewing synthetic demo
          data. Register a real workspace to see your own.
        </span>
      </p>
      {onNavigateRepositories && (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5 border-amber-500/40 text-amber-800 hover:bg-amber-500/10 dark:text-amber-300"
          onClick={onNavigateRepositories}
        >
          Connect a local project →
        </Button>
      )}
    </div>
  )
}

export function DeltaBadge({
  delta,
  suffix = '%',
  goodWhenDown = true,
}: {
  delta: number
  suffix?: string
  goodWhenDown?: boolean
}) {
  const down = delta < 0
  const good = goodWhenDown ? down : !down
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px]',
        good
          ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
          : 'border-red-500/25 bg-red-500/10 text-red-800 dark:text-red-300',
      )}
    >
      {down ? '↓' : '↑'}
      {Math.abs(delta)}
      {suffix}
    </span>
  )
}

export function StatusDot({ status }: { status: 'pass' | 'fail' | 'running' | 'pending' }) {
  const cls =
    status === 'pass'
      ? 'bg-emerald-400'
      : status === 'fail'
        ? 'bg-red-400'
        : status === 'running'
          ? 'bg-amber-400 animate-pulse'
          : 'bg-zinc-500'
  return <span className={cn('inline-block size-2 rounded-full', cls)} aria-label={status} />
}

/* ------------------------------------------------------------------ layout */

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  scrollableLabel,
}: {
  title?: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
  /** Set on scrollable bodies (overflow-y-auto) so keyboard users can reach the scroll port (axe: scrollable-region-focusable). */
  scrollableLabel?: string
}) {
  return (
    <section
      className={cn(
        // min-w-0: grid/flex items default to min-width:auto, so a wide
        // inner table would otherwise force the panel (and the page) past
        // the viewport — the inner overflow-x-auto wrapper must be allowed
        // to scroll instead (UI audit, issue #70).
        'min-w-0 rounded-xl border border-border/80 bg-card shadow-[0_1px_0_0_oklch(1_0_0/4%)_inset]',
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold tracking-tight">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div
        className={cn('p-4', bodyClassName)}
        {...(scrollableLabel ? { tabIndex: 0, role: 'region', 'aria-label': scrollableLabel } : {})}
      >
        {children}
      </div>
    </section>
  )
}

export function KpiCard({
  label,
  value,
  delta,
  deltaSuffix,
  goodWhenDown = true,
  hint,
  icon,
  accent = 'primary',
}: {
  label: string
  value: React.ReactNode
  delta?: number
  deltaSuffix?: string
  goodWhenDown?: boolean
  hint?: string
  icon?: React.ReactNode
  accent?: 'primary' | 'amber' | 'teal' | 'red'
}) {
  const accents: Record<string, string> = {
    primary: 'text-primary',
    amber: 'text-amber-400',
    teal: 'text-teal-300',
    red: 'text-red-400',
  }
  return (
    <div className="group corner-ticks relative overflow-hidden rounded-xl border border-border/80 bg-card p-4 transition-all duration-200 hover:border-primary/30 hover:shadow-[0_0_24px_-8px_oklch(0.72_0.16_45/30%)]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {icon && <span className={cn('opacity-80', accents[accent])}>{icon}</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-mono text-2xl font-semibold tabular-nums tracking-tight">{value}</span>
        {delta !== undefined && <DeltaBadge delta={delta} suffix={deltaSuffix} goodWhenDown={goodWhenDown} />}
      </div>
      {hint && <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
      <div className="pointer-events-none absolute -right-8 -top-8 size-24 rounded-full bg-primary/5 blur-2xl transition-opacity group-hover:opacity-100" />
    </div>
  )
}

export function CountUp({
  value,
  decimals = 0,
  suffix = '',
  prefix = '',
  duration = 900,
  className,
}: {
  value: number
  decimals?: number
  suffix?: string
  prefix?: string
  duration?: number
  className?: string
}) {
  const [display, setDisplay] = useState(0)
  const prev = useRef(0)
  useEffect(() => {
    const from = prev.current
    const to = value
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(from + (to - from) * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
      else prev.current = to
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])
  return (
    <span className={cn('tabular-nums', className)}>
      {prefix}
      {display.toFixed(decimals)}
      {suffix}
    </span>
  )
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && (
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary/90">{eyebrow}</p>
        )}
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && (
        /* issue #138: the action cluster must be allowed to wrap its own
           children — without flex-wrap its min-content width is the SUM of
           every button, so on narrow viewports (375px, Builds · Doctor) the
           nowrap Run button pushed the row past the viewport edge (378px
           scrollWidth). flex-wrap + min-w-0 drops the min-content width to
           the widest single child, so the cluster stacks gracefully; at sm+
           there is room and nothing wraps (desktop layout untouched). */
        <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  )
}

export function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
      {label}
    </div>
  )
}

/**
 * Shared loading skeleton for first-class views (AUDIT-I3) — heading block +
 * KPI row + panel rows, so every new view degrades the same way.
 */
export function ViewSkeleton({ kpiCount = 4 }: { kpiCount?: number }) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: kpiCount }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[280px] rounded-xl" />
    </div>
  )
}

/** Shared error state — honest failure copy + retry, no fake data. */
export function DataErrorPanel({
  title,
  message,
  onRetry,
}: {
  title: string
  message: string
  onRetry: () => void
}) {
  return (
    <Panel title={title}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-red-300">
          Failed to load: <span className="font-mono text-xs">{message}</span>
        </p>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={onRetry}>
          <RefreshCw className="size-3.5" />
          Retry
        </Button>
      </div>
    </Panel>
  )
}

/**
 * Degraded-state banner (issue #99) — shown when a view still renders its
 * last successful payload after a mid-session API failure. The Overview view
 * replaces itself with an error panel when it has NO data; these views keep
 * the cached table (usually more useful than a blank page) but must say so
 * honestly instead of silently passing stale figures off as live.
 */
export function CachedDataBanner({
  message,
  onRetry,
  retrying,
}: {
  message?: string
  onRetry: () => void
  retrying?: boolean
}) {
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/[0.08] px-3.5 py-2.5 text-amber-800 dark:text-amber-300 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="flex items-start gap-2 text-[12.5px] leading-snug">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <span className="font-semibold">Showing cached data</span> — the last refresh failed
          {message ? (
            <>
              {' '}
              (<span className="font-mono text-[11px]">{message}</span>)
            </>
          ) : null}
          . Figures below may be stale until the engine responds again.
        </span>
      </p>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 gap-1.5 border-amber-500/40 text-amber-800 hover:bg-amber-500/10 dark:text-amber-300"
        onClick={onRetry}
        disabled={retrying}
      >
        <RefreshCw className={`size-3.5 ${retrying ? 'animate-spin' : ''}`} aria-hidden />
        {retrying ? 'Retrying…' : 'Retry now'}
      </Button>
    </div>
  )
}

/**
 * Reveal (round 10) — one-shot entrance: subtle rise + fade with an optional
 * stagger delay. Respects prefers-reduced-motion (renders a plain div), so
 * the global reduced-motion kill-switch and framer-motion agree.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode
  delay?: number
  className?: string
}) {
  const reduce = useReducedMotion()
  if (reduce) return <div className={className}>{children}</div>
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

/* ---------------------------------------------------------------- terminal */

export type TerminalTone = 'cmd' | 'ok' | 'warn' | 'err' | 'dim' | 'plain' | 'accent'

const TONE_CLASS: Record<TerminalTone, string> = {
  cmd: 'text-primary font-semibold',
  ok: 'text-emerald-300',
  warn: 'text-amber-300',
  err: 'text-red-300',
  dim: 'text-muted-foreground',
  plain: 'text-foreground/90',
  accent: 'text-orange-300',
}

export function Terminal({
  title = 'wanyrix — zsh',
  lines,
  step = 420,
  className,
  running = false,
  footer,
}: {
  title?: string
  lines: { text: string; tone?: TerminalTone }[]
  step?: number
  className?: string
  running?: boolean
  footer?: React.ReactNode
}) {
  return (
    <div className={cn('terminal-glow scanlines overflow-hidden rounded-xl border border-border bg-[oklch(0.12_0.004_60)]', className)}>
      <div className="relative z-10 flex items-center gap-2 border-b border-border/60 bg-black/30 px-3 py-2">
        <span className="size-2.5 rounded-full bg-red-500/70" />
        <span className="size-2.5 rounded-full bg-amber-500/70" />
        <span className="size-2.5 rounded-full bg-emerald-500/70" />
        <span className="ml-2 font-mono text-[11px] text-muted-foreground">{title}</span>
        {running && (
          <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-primary">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" />
            scanning
          </span>
        )}
      </div>
      <div className="relative z-10 space-y-1 px-4 py-3 font-mono text-[12px] leading-relaxed">
        {lines.map((line, i) => (
          <motion.p
            key={i}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * (step / 1000), duration: 0.25 }}
            className={cn('whitespace-pre-wrap break-words', TONE_CLASS[line.tone ?? 'plain'])}
          >
            {line.tone === 'cmd' ? <span className="mr-2 text-muted-foreground">$</span> : null}
            {line.text}
          </motion.p>
        ))}
        {footer}
        <p className="flex items-center gap-1 text-primary" aria-hidden="true">
          <span className="inline-block h-3.5 w-2 animate-pulse bg-primary/80" />
        </p>
      </div>
    </div>
  )
}
