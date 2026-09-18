'use client'

import { useMemo } from 'react'
import { ArrowRight, Layers, Package, PackageSearch, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useGraph, useHealth } from '@/lib/wanyrix/hooks'
import { useSimulatorIntentStore } from '@/lib/wanyrix/simulator-intent'
import type { GraphNode } from '@/lib/wanyrix/types'
import { CountUp, DataErrorPanel, DeltaBadge, MeasurementBadge, Panel, ViewSkeleton } from '../shared'
import type { ViewProps } from '../view-types'

/**
 * Dependencies (AUDIT-I3 required surface) — version/duplicate/risk view over
 * the graph payload: duplicate-version groups with their resolution paths,
 * the external-dependency inventory, and the dependency-risk KPI.
 * Topology and blast radius live in the Engineering Graph view; this surface
 * answers "what do we compile, in which versions, and what does it cost".
 */
export default function DependenciesView({ onNavigate }: ViewProps) {
  const graph = useGraph()
  const health = useHealth()
  const setIntent = useSimulatorIntentStore((s) => s.setIntent)

  const externals = useMemo(
    () =>
      (graph.data?.nodes ?? [])
        .filter((n): n is GraphNode => n.kind !== 'workspace')
        .sort((a, b) => b.buildTime - a.buildTime),
    [graph.data],
  )

  const wastedSeconds = useMemo(
    () => (graph.data?.duplicates ?? []).reduce((acc, d) => acc + d.wastedSeconds, 0),
    [graph.data],
  )

  if (graph.isLoading) return <ViewSkeleton />
  if (graph.isError || !graph.data)
    return (
      <DataErrorPanel
        title="Dependency data unavailable"
        message={graph.isError ? (graph.error as Error).message : 'empty payload'}
        onRetry={() => graph.refetch()}
      />
    )

  const d = graph.data
  const duplicateCount = d.duplicates.length

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary/90">Dependency Intelligence</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Dependencies</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {d.meta.workspaceCrates} workspace crates · {externals.length} external crates · {d.meta.totalEdges} edges
            — from <span className="font-mono text-foreground/85">cargo metadata / cargo tree</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => onNavigate?.('graph')}>
            Open Engineering Graph
          </Button>
          <Button size="sm" variant="outline" onClick={() => onNavigate?.('simulator')}>
            Simulate a change
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-border/80 bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">External crates</p>
            <Package className="size-4 text-primary" aria-hidden />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
            <CountUp value={externals.length} />
          </p>
          <p className="mt-1.5 text-[11px] text-muted-foreground">compiled into the build graph</p>
        </div>
        <div className="rounded-xl border border-border/80 bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">Duplicate groups</p>
            <Layers className="size-4 text-amber-400" aria-hidden />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
            <CountUp value={duplicateCount} />
          </p>
          <p className="mt-1.5 text-[11px] text-muted-foreground">versions compiled in parallel</p>
        </div>
        <div className="rounded-xl border border-border/80 bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">Duplicate cost</p>
            <MeasurementBadge status="measured" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
            <CountUp value={wastedSeconds} decimals={1} suffix="s" />
          </p>
          <p className="mt-1.5 text-[11px] text-muted-foreground">per clean build · cargo tree -d</p>
        </div>
        <div className="rounded-xl border border-border/80 bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">Dependency risk</p>
            {health.data && <DeltaBadge delta={health.data.kpis.dependencyRisk.delta} />}
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
            {health.data ? (
              <CountUp value={Math.abs(health.data.kpis.dependencyRisk.delta)} suffix="%" />
            ) : (
              '—'
            )}
          </p>
          <p className="mt-1.5 text-[11px] text-muted-foreground">{health.data?.kpis.dependencyRisk.label ?? 'duplicate + vulnerable surface'}</p>
        </div>
      </div>

      {/* duplicates + resolutions */}
      <Panel
        title="Duplicate version groups"
        subtitle="cargo tree -d · every group carries its resolution path when an upgrade closes it"
        bodyClassName={duplicateCount > 0 ? 'p-0' : undefined}
      >
        {duplicateCount === 0 ? (
          <p className="text-sm text-muted-foreground">
            No duplicate versions detected in the active workspace lockfile.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Crate</TableHead>
                <TableHead>Versions</TableHead>
                <TableHead>Dependents</TableHead>
                <TableHead className="text-right">Wasted (clean)</TableHead>
                <TableHead>Resolution</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.duplicates.map((dup) => {
                const resolution = d.resolutions?.[dup.name]
                return (
                  <TableRow key={dup.name}>
                    <TableCell className="font-mono text-[13px] font-medium">{dup.name}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {dup.versions.map((v) => (
                          <Badge key={v} variant="outline" className="font-mono text-[10px]">
                            {v}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">{dup.dependents.join(' · ')}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums text-amber-300">
                      {dup.wastedSeconds.toFixed(1)}s
                    </TableCell>
                    <TableCell>
                      {resolution ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant="outline"
                            className={
                              resolution.kind === 'full'
                                ? 'border-emerald-500/30 bg-emerald-500/10 font-mono text-[10px] text-emerald-300'
                                : 'border-amber-500/30 bg-amber-500/10 font-mono text-[10px] text-amber-300'
                            }
                            title={resolution.note}
                          >
                            upgrade {resolution.from} → {resolution.to} · {resolution.kind}
                          </Badge>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            CI delta {resolution.ciDelta > 0 ? '+' : ''}
                            {resolution.ciDelta.toFixed(1)}s (simulated)
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 text-[11px]"
                            onClick={() => {
                              setIntent({
                                mode: 'upgrade-dep',
                                target: resolution.scenarioId,
                                source: `Dependencies — duplicate ${dup.name}`,
                              })
                              onNavigate?.('simulator')
                            }}
                          >
                            Simulate
                            <ArrowRight className="size-3" />
                          </Button>
                        </div>
                      ) : (
                        <span className="font-mono text-[10px] text-muted-foreground/70">no upgrade scenario catalogued</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Panel>

      {/* external dependency inventory */}
      <Panel
        title="External dependency inventory"
        subtitle="sorted by compile time · build time measured via cargo build --timings"
        bodyClassName="p-0"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Crate</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Version</TableHead>
              <TableHead className="text-right">Build time</TableHead>
              <TableHead className="text-right">Fan-in</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {externals.map((n) => (
              <TableRow key={n.id}>
                <TableCell className="font-mono text-[13px]">
                  <span className="flex items-center gap-2">
                    {n.id}
                    {n.duplicate && (
                      <Badge variant="outline" className="border-amber-500/30 font-mono text-[9px] text-amber-300">
                        duplicate
                      </Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                    {n.kind}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-[11px] text-muted-foreground">
                  {n.versions?.join(', ') ?? '—'}
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{n.buildTime.toFixed(1)}s</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{n.fanIn}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
                    onClick={() => onNavigate?.('graph')}
                    aria-label={`Inspect ${n.id} in the engineering graph`}
                  >
                    <PackageSearch className="size-3.5" />
                    graph
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>

      {/* honesty footer */}
      <div className="flex flex-wrap items-start gap-2.5 rounded-lg border border-border/70 bg-muted/10 p-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-400" aria-hidden />
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Version lists and duplicate groups are read from the lockfile (deterministic). Per-crate compile times are
          measured from <span className="font-mono text-foreground/85">cargo build --timings</span>; CI deltas on
          resolution paths are <span className="font-mono text-foreground/85">simulated</span> estimates and become
          verified only through an experiment (Gate 21).
        </p>
      </div>
    </div>
  )
}
