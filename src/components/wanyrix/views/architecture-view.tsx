'use client'

import { useMemo } from 'react'
import { ArrowDownRight, Blocks, GitFork, TriangleAlert, Waypoints } from 'lucide-react'
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
import type { GraphNode } from '@/lib/wanyrix/types'
import { CountUp, DataErrorPanel, MeasurementBadge, Panel, ViewSkeleton } from '../shared'
import type { ViewProps } from '../view-types'

/**
 * Architecture (AUDIT-I3 required surface) — module/package boundary view
 * computed from the graph payload (/api/wanyrix/graph):
 *  - fan-in / fan-out per workspace crate (structural, deterministic — the
 *    edges come from cargo metadata);
 *  - hotspots: a CLIENT-COMPUTED heuristic (fan-in × change frequency), always
 *    labeled INFERRED, never as an engine measurement;
 *  - dependency-direction summary: band transitions + workspace cycle check.
 */

interface WorkspaceRow {
  node: GraphNode
  hotspotScore: number
}

const BAND_RANK: Record<GraphNode['band'], number> = { bin: 0, lib: 1, external: 2 }

/** Detect cycles among workspace crates (iterative DFS with colors). */
function findCycles(nodes: GraphNode[], edges: { from: string; to: string }[]): string[][] {
  const ids = new Set(nodes.map((n) => n.id))
  const adj = new Map<string, string[]>()
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue
    adj.set(e.from, [...(adj.get(e.from) ?? []), e.to])
  }
  const color = new Map<string, 1 | 2>()
  const stack: string[] = []
  const cycles: string[][] = []
  const visit = (id: string) => {
    color.set(id, 1)
    stack.push(id)
    for (const next of adj.get(id) ?? []) {
      const c = color.get(next)
      if (c === 1) {
        const at = stack.indexOf(next)
        cycles.push([...stack.slice(at), next])
      } else if (c === undefined) {
        visit(next)
      }
    }
    stack.pop()
    color.set(id, 2)
  }
  for (const n of nodes) if (!color.has(n.id)) visit(n.id)
  return cycles
}

export default function ArchitectureView({ onNavigate }: ViewProps) {
  const graph = useGraph()
  const health = useHealth()

  const rows = useMemo<WorkspaceRow[]>(
    () =>
      (graph.data?.nodes ?? [])
        .filter((n) => n.kind === 'workspace')
        .map((node) => ({ node, hotspotScore: node.fanIn * node.changeFreq }))
        .sort((a, b) => b.hotspotScore - a.hotspotScore),
    [graph.data],
  )

  const direction = useMemo(() => {
    const byId = new Map((graph.data?.nodes ?? []).map((n) => [n.id, n]))
    const counts = { down: 0, intra: 0, up: 0 }
    for (const e of graph.data?.edges ?? []) {
      const from = byId.get(e.from)
      const to = byId.get(e.to)
      if (!from || !to) continue
      const d = BAND_RANK[to.band] - BAND_RANK[from.band]
      if (d > 0) counts.down += 1
      else if (d === 0) counts.intra += 1
      else counts.up += 1
    }
    return counts
  }, [graph.data])

  const cycles = useMemo(
    () => findCycles(graph.data?.nodes ?? [], graph.data?.edges ?? []),
    [graph.data],
  )

  if (graph.isLoading) return <ViewSkeleton />
  if (graph.isError || !graph.data)
    return (
      <DataErrorPanel
        title="Architecture data unavailable"
        message={graph.isError ? (graph.error as Error).message : 'empty payload'}
        onRetry={() => graph.refetch()}
      />
    )

  const workspaceCrates = rows.length
  const hotspots = rows.filter((r) => r.node.fanIn >= 3 && r.node.changeFreq >= 5)
  const maxFanIn = Math.max(1, ...rows.map((r) => r.node.fanIn))
  const maxDownstream = Math.max(1, ...rows.map((r) => r.node.downstream))

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary/90">Module Boundaries</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Architecture</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {workspaceCrates} workspace crates · {graph.data.meta.totalEdges} edges · dependency direction and
            coupling from the engineering graph
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => onNavigate?.('graph')}>
            Open Engineering Graph
          </Button>
          <Button size="sm" variant="outline" onClick={() => onNavigate?.('simulator')}>
            Model a crate split
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-border/80 bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Architecture debt</p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
            {health.data ? <CountUp value={health.data.kpis.architectureDebt.count} /> : '—'}
          </p>
          <p className="mt-1.5 text-[11px] text-muted-foreground">oversized / high fan-out crates</p>
        </div>
        <div className="rounded-xl border border-border/80 bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Hotspots (inferred)</p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
            <CountUp value={hotspots.length} />
          </p>
          <p className="mt-1.5 text-[11px] text-muted-foreground">fan-in ≥ 3 and ≥ 5 changes/90d</p>
        </div>
        <div className="rounded-xl border border-border/80 bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Edges pointing down</p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
            <CountUp value={direction.down} />
          </p>
          <p className="mt-1.5 text-[11px] text-muted-foreground">bin → lib → external (healthy direction)</p>
        </div>
        <div className="rounded-xl border border-border/80 bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Workspace cycles</p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
            <CountUp value={cycles.length} />
          </p>
          <p className="mt-1.5 text-[11px] text-muted-foreground">crate-level dependency loops</p>
        </div>
      </div>

      {/* fan-in / fan-out table */}
      <Panel
        title="Coupling — fan-in / fan-out"
        subtitle="fan-in = crates depending on it · fan-out = crates it depends on · downstream = transitive rebuild set"
        bodyClassName="p-0"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Crate</TableHead>
              <TableHead className="text-right">Fan-in</TableHead>
              <TableHead className="text-right">Fan-out</TableHead>
              <TableHead className="text-right">Downstream</TableHead>
              <TableHead className="text-right">Changes / 90d</TableHead>
              <TableHead className="text-right">Build</TableHead>
              <TableHead>Flags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ node }) => (
              <TableRow key={node.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13px] font-medium">{node.id}</span>
                    {node.critical && (
                      <Badge variant="outline" className="border-red-500/30 font-mono text-[9px] text-red-300">
                        critical path
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1.5 flex h-1 gap-1">
                    <span
                      className="block h-full rounded-full bg-primary/60"
                      style={{ width: `${(node.fanIn / maxFanIn) * 60}%` }}
                      aria-hidden
                    />
                    <span
                      className="block h-full rounded-full bg-amber-400/60"
                      style={{ width: `${(node.downstream / maxDownstream) * 40}%` }}
                      aria-hidden
                    />
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{node.fanIn}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{node.fanOut}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{node.downstream}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{node.changeFreq}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{node.buildTime.toFixed(1)}s</TableCell>
                <TableCell>
                  {node.fanIn >= 3 && node.changeFreq >= 5 ? (
                    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 font-mono text-[9px] uppercase text-amber-300">
                      inferred hotspot
                    </Badge>
                  ) : (
                    <span className="font-mono text-[10px] text-muted-foreground/90">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>

      {/* dependency direction + cycles */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Dependency direction" subtitle="band transitions across bin → lib → external">
          <ul className="space-y-2.5">
            <li className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/10 px-3 py-2">
              <span className="flex items-center gap-2 text-[13px]">
                <ArrowDownRight className="size-4 text-emerald-300" aria-hidden />
                downward edges
              </span>
              <span className="font-mono text-sm tabular-nums text-emerald-300">{direction.down}</span>
            </li>
            <li className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/10 px-3 py-2">
              <span className="flex items-center gap-2 text-[13px]">
                <Waypoints className="size-4 text-muted-foreground" aria-hidden />
                intra-band edges
              </span>
              <span className="font-mono text-sm tabular-nums">{direction.intra}</span>
            </li>
            <li className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/10 px-3 py-2">
              <span className="flex items-center gap-2 text-[13px]">
                <TriangleAlert className="size-4 text-amber-300" aria-hidden />
                upward (inverted) edges
              </span>
              <span className={`font-mono text-sm tabular-nums ${direction.up > 0 ? 'text-amber-300' : ''}`}>
                {direction.up}
              </span>
            </li>
          </ul>
          <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
            {direction.up === 0 && cycles.length === 0
              ? 'The workspace graph is acyclic with no band inversions — dependencies consistently point from binaries toward libraries toward externals (deterministic cargo metadata).'
              : 'Inversions or cycles exist — listed here exactly as derived from cargo metadata; open the Engineering Graph to trace them.'}
          </p>
        </Panel>

        <Panel title="Workspace cycles" subtitle="crate-level loops (DFS over workspace nodes)">
          {cycles.length === 0 ? (
            <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
              No cycles detected among workspace crates.
            </div>
          ) : (
            <ul className="space-y-2">
              {cycles.map((cycle, i) => (
                <li key={i} className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 font-mono text-[11.5px] text-amber-200">
                  {cycle.join(' → ')}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex items-center gap-2">
            <GitFork className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <p className="text-[11px] text-muted-foreground">
              cycles make incremental rebuilds order-dependent — a split candidate for the simulator
            </p>
          </div>
        </Panel>
      </div>

      {/* honesty legend */}
      <Panel title="How to read these numbers" subtitle="measurement honesty (Gate 21)">
        <ul className="space-y-2 text-[12.5px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
          <li className="flex min-w-0 items-start gap-2">
            <MeasurementBadge status="measured" />
            <span>
              build times — <span className="font-mono text-foreground/85">cargo build --timings</span>; change
              frequency — git log over the last 90 days.
            </span>
          </li>
          <li className="flex min-w-0 items-start gap-2">
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 font-mono text-[10px] uppercase text-emerald-300">
              deterministic
            </Badge>
            <span>
              fan-in, fan-out, downstream and direction — structural facts derived from the cargo metadata graph.
            </span>
          </li>
          <li className="flex min-w-0 items-start gap-2">
            <MeasurementBadge status="estimated" />
            <span>
              <strong className="text-foreground/85">hotspot score = fan-in × change frequency</strong> — a
              client-side heuristic (INFERRED), not an engine measurement. Treat it as a pointer, verify with an
              experiment before acting.
            </span>
          </li>
        </ul>
      </Panel>
    </div>
  )
}
