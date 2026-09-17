'use client'

import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, ChevronDown, Lightbulb, RotateCcw, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useGraph } from '@/lib/ferrix/hooks'
import type { BlastEntry, GraphEdge, GraphNode, GraphPayload } from '@/lib/ferrix/types'
import { cn } from '@/lib/utils'
import { ExplainDialog } from '../explain-dialog'
import { CountUp, MeasurementBadge, Panel, SectionHeading } from '../shared'
import type { ViewProps } from '../view-types'

/* ------------------------------------------------------------------ layout */

const BAND_Y = { bin: 90, lib: 320, external: 550 } as const
const X_MIN = 60
const X_MAX = 900

interface Positioned extends GraphNode {
  x: number
  y: number
  r: number
}

/**
 * Band layout: workspace bins (y 90) → workspace libs (y 320) → externals &
 * proc-macros (y 550). Band members spread evenly across X_MIN..X_MAX in the
 * exact order they appear in the payload's nodes array.
 */
function layoutGraph(nodes: GraphNode[]): Map<string, Positioned> {
  const map = new Map<string, Positioned>()
  for (const band of ['bin', 'lib', 'external'] as const) {
    const members = nodes.filter((n) => n.band === band)
    members.forEach((n, i) => {
      const x =
        members.length === 1 ? (X_MIN + X_MAX) / 2 : X_MIN + (i * (X_MAX - X_MIN)) / (members.length - 1)
      const r = Math.min(22, Math.max(9, 7 + n.buildTime * 0.7))
      map.set(n.id, { ...n, x, y: BAND_Y[band], r })
    })
  }
  return map
}

function edgePath(a: Positioned, b: Positioned): string {
  const y1 = a.y + a.r
  const y2 = b.y - b.r
  const my = (y1 + y2) / 2
  return `M ${a.x} ${y1} C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${y2}`
}

function nodeFill(n: GraphNode): { fill: string; fillOpacity: number } {
  if (n.kind === 'proc-macro') return { fill: 'var(--chart-5)', fillOpacity: 0.7 }
  if (n.kind === 'external') return { fill: 'oklch(0.30 0.005 60)', fillOpacity: 1 }
  if (n.critical) return { fill: 'var(--chart-1)', fillOpacity: 0.85 }
  return { fill: 'oklch(0.35 0.03 50)', fillOpacity: 1 }
}

const AMBER = 'rgb(251 191 36)'

/* ------------------------------------------------------------------ graph */

interface GraphPanelProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  query: string
  showExternal: boolean
  selected: string
  onSelect: (id: string) => void
}

const GraphPanel = memo(function GraphPanel({
  nodes,
  edges,
  query,
  showExternal,
  selected,
  onSelect,
}: GraphPanelProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [mouse, setMouse] = useState({ x: 24, y: 24, w: 320, h: 220 })
  const containerRef = useRef<HTMLDivElement>(null)

  const pos = useMemo(() => layoutGraph(nodes), [nodes])

  const q = query.trim().toLowerCase()
  const match = useCallback((id: string) => q === '' || id.toLowerCase().includes(q), [q])

  const visible = useMemo(
    () => nodes.filter((n) => showExternal || n.band !== 'external'),
    [nodes, showExternal],
  )
  const visibleIds = useMemo(() => new Set(visible.map((n) => n.id)), [visible])

  const focusId = hovered ?? selected

  const laidOut = useMemo(
    () =>
      edges.flatMap((e) => {
        const a = pos.get(e.from)
        const b = pos.get(e.to)
        if (!a || !b || !visibleIds.has(a.id) || !visibleIds.has(b.id)) return []
        return [{ key: `${e.from}->${e.to}`, from: e.from, to: e.to, a, b }]
      }),
    [edges, pos, visibleIds],
  )

  const neighbors = useMemo(() => {
    const s = new Set<string>()
    if (focusId) {
      s.add(focusId)
      for (const l of laidOut) {
        if (l.from === focusId) s.add(l.to)
        if (l.to === focusId) s.add(l.from)
      }
    }
    return s
  }, [focusId, laidOut])

  const hoveredNode = hovered ? pos.get(hovered) : undefined

  const trackMouse = (ev: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setMouse({ x: ev.clientX - rect.left, y: ev.clientY - rect.top, w: rect.width, h: rect.height })
  }

  const tipLeft = Math.max(8, Math.min(mouse.x + 16, mouse.w - 196))
  const tipTop = Math.max(8, Math.min(mouse.y + 16, mouse.h - 112))

  return (
    <Panel
      title="Interactive graph"
      subtitle="hover to trace · click to inspect"
      className="xl:col-span-2"
    >
      <div
        ref={containerRef}
        className="relative"
        onMouseMove={trackMouse}
        onMouseLeave={() => setHovered(null)}
      >
        <svg
          viewBox="0 0 960 640"
          className="h-auto w-full rounded-lg border bg-[oklch(0.13_0.004_60)]"
          role="img"
          aria-label="Dependency graph of the helios-platform workspace"
        >
          {/* band labels */}
          <text x={12} y={BAND_Y.bin - 36} fontSize={9} fill="oklch(0.9 0 0 / 0.35)" className="font-mono uppercase">
            bins
          </text>
          <text x={12} y={BAND_Y.lib - 36} fontSize={9} fill="oklch(0.9 0 0 / 0.35)" className="font-mono uppercase">
            libs
          </text>
          {showExternal && (
            <text
              x={12}
              y={BAND_Y.external - 36}
              fontSize={9}
              fill="oklch(0.9 0 0 / 0.35)"
              className="font-mono uppercase"
            >
              external
            </text>
          )}

          {/* edges */}
          <g fill="none">
            {laidOut.map(({ key, from, to, a, b }) => {
              const touch = focusId !== null && (from === focusId || to === focusId)
              const dim = focusId !== null && !touch
              const dimmedBySearch = q !== '' && !match(from) && !match(to)
              return (
                <path
                  key={key}
                  d={edgePath(a, b)}
                  stroke={touch ? 'var(--chart-1)' : 'oklch(1 0 0 / 0.1)'}
                  strokeWidth={touch ? 2 : 1.25}
                  opacity={touch ? 1 : dim || dimmedBySearch ? 0.25 : 1}
                  className="transition-[opacity,stroke] duration-200"
                />
              )
            })}
          </g>

          {/* nodes */}
          <g>
            {visible.map((n, i) => {
              const p = pos.get(n.id)
              if (!p) return null
              const { fill, fillOpacity } = nodeFill(n)
              const isSel = n.id === selected
              const isHov = n.id === hovered
              const matched = match(n.id)
              const searchDim = q !== '' && !matched
              const focusDim = focusId !== null && !neighbors.has(n.id)
              return (
                <g
                  key={n.id}
                  opacity={searchDim ? 0.2 : focusDim ? 0.45 : 1}
                  className="cursor-pointer transition-opacity duration-200"
                  onMouseEnter={() => setHovered(n.id)}
                  onClick={() => onSelect(n.id)}
                  tabIndex={0}
                  role="button"
                  aria-label={`Inspect ${n.id}`}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault()
                      onSelect(n.id)
                    }
                  }}
                  onFocus={() => setHovered(n.id)}
                  onBlur={() => setHovered(null)}
                >
                  {q !== '' && matched && (
                    <circle cx={p.x} cy={p.y} r={p.r + 4} fill="none" stroke={AMBER} strokeWidth={1.25} />
                  )}
                  {isSel && (
                    <circle cx={p.x} cy={p.y} r={p.r + 4} fill="none" stroke="var(--chart-1)" strokeWidth={1.5} />
                  )}
                  {isHov && !isSel && (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={p.r + 4}
                      fill="none"
                      stroke="oklch(1 0 0 / 0.35)"
                      strokeWidth={1}
                    />
                  )}
                  {n.duplicate && (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={p.r + 3}
                      fill="none"
                      stroke={AMBER}
                      strokeWidth={1}
                      strokeDasharray="3 3"
                      opacity={0.85}
                    />
                  )}
                  <motion.circle
                    cx={p.x}
                    cy={p.y}
                    r={p.r}
                    fill={fill}
                    fillOpacity={fillOpacity}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.015 * i, type: 'spring', stiffness: 260, damping: 18 }}
                    style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                  />
                  <text
                    x={p.x}
                    y={p.y + p.r + 12}
                    textAnchor="middle"
                    fontSize={10}
                    fill="oklch(0.9 0 0 / 0.75)"
                    className="select-none font-mono"
                  >
                    {n.id}
                    {n.duplicate && (
                      <tspan dy={-4} fontSize={7} fill={AMBER}>
                        {' '}
                        ×2
                      </tspan>
                    )}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>

        {/* hover tooltip */}
        {hoveredNode && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-20 min-w-44 rounded-lg border border-border bg-popover/95 p-2.5 shadow-xl backdrop-blur"
            style={{ left: tipLeft, top: tipTop }}
          >
            <p className="font-mono text-xs font-semibold text-foreground">{hoveredNode.id}</p>
            <dl className="mt-1.5 space-y-0.5 font-mono text-[10px] text-muted-foreground">
              <div className="flex justify-between gap-4">
                <dt>build</dt>
                <dd className="text-foreground">{hoveredNode.buildTime.toFixed(1)}s</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>downstream</dt>
                <dd className="text-foreground">{hoveredNode.downstream} crates</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>kind</dt>
                <dd className="text-foreground">{hoveredNode.kind}</dd>
              </div>
            </dl>
          </div>
        )}
      </div>
      <p className="mt-3 font-mono text-[10px] text-muted-foreground">
        {visible.length} nodes · {laidOut.length} edges rendered
        {!showExternal ? ' · external band hidden' : ''}
      </p>
    </Panel>
  )
})

/* --------------------------------------------------------------- inspector */

function DetailStat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-semibold text-foreground">{children}</p>
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>
}

function NodeDetails({
  node,
  edges,
  blast,
  onNavigate,
}: {
  node: GraphNode
  edges: GraphEdge[]
  blast: BlastEntry[]
  onNavigate?: ViewProps['onNavigate']
}) {
  const dependents = edges.filter((e) => e.to === node.id).map((e) => e.from)
  const touching = edges.filter((e) => e.from === node.id || e.to === node.id)
  const blastEntry = blast.find((b) => b.crate === node.id)

  return (
    <Panel title="Inspector" subtitle={`selected node · ${node.band} band`} className="self-start">
      <div className="space-y-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{node.id}</h3>
            <Badge variant="outline" className="font-mono text-[10px]">
              {node.kind}
            </Badge>
            {node.critical && (
              <Badge className="border-amber-500/30 bg-amber-500/10 font-mono text-[10px] text-amber-300">
                critical
              </Badge>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <DetailStat label="build time">
            <CountUp value={node.buildTime} decimals={1} suffix="s" />
          </DetailStat>
          <DetailStat label="fan-in">{node.fanIn}</DetailStat>
          <DetailStat label="fan-out">{node.fanOut}</DetailStat>
          <DetailStat label="changes 90d">{node.changeFreq}</DetailStat>
        </div>

        {node.downstream >= 20 && (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5">
            <p className="text-[11px] text-amber-200/90">
              blocks{' '}
              <span className="font-mono text-lg font-semibold text-amber-300">
                <CountUp value={node.downstream} />
              </span>{' '}
              workspace crates
            </p>
          </div>
        )}

        {node.duplicate && node.versions && (
          <div className="space-y-1.5 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5">
            <div className="flex gap-1.5">
              {node.versions.map((v) => (
                <Badge key={v} variant="outline" className="font-mono text-[10px]">
                  {v}
                </Badge>
              ))}
            </div>
            <p className="text-[11px] text-amber-300">duplicate compiled ×2 — unify to one version</p>
          </div>
        )}

        <div>
          <SectionLabel>Dependents ({dependents.length})</SectionLabel>
          {dependents.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {dependents.slice(0, 6).map((d) => (
                <Badge key={d} variant="secondary" className="font-mono text-[10px]">
                  {d}
                </Badge>
              ))}
              {dependents.length > 6 && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  +{dependents.length - 6} more
                </span>
              )}
            </div>
          ) : (
            <p className="mt-1.5 text-[11px] text-muted-foreground">top-level — nothing in the backbone depends on it</p>
          )}
        </div>

        {blastEntry && (
          <div className="space-y-1.5 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2.5">
            <SectionLabel>Blast radius</SectionLabel>
            <p className="font-mono text-[11px] text-red-300">{blastEntry.file}</p>
            <p className="text-[11px] text-muted-foreground">
              touching it re-invalidates{' '}
              <span className="font-mono font-semibold text-foreground">
                <CountUp value={blastEntry.affectedWorkspace} />
              </span>{' '}
              crates
            </p>
            <p className="font-mono text-[11px] text-muted-foreground">{blastEntry.chain.join(' → ')}</p>
            <p className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="font-mono text-red-300">+{blastEntry.incrementalDelta}s incremental (estimated)</span>
              <MeasurementBadge status="estimated" />
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2.5 border-t border-border/60 pt-3">
          <ExplainDialog
            kind="issue"
            context={JSON.stringify({ node, edges: touching })}
            question="Why is this crate important in the workspace graph?"
          />
          <Button variant="outline" size="sm" className="w-full" onClick={() => onNavigate?.('simulator')}>
            Open Impact Simulator
          </Button>
        </div>
      </div>
    </Panel>
  )
}

/* -------------------------------------------------------------- duplicates */

function DuplicatesPanel({ duplicates }: { duplicates: GraphPayload['duplicates'] }) {
  const total = duplicates.reduce((acc, d) => acc + d.wastedSeconds, 0)
  return (
    <Panel
      title="Duplicate dependency versions"
      subtitle="Cargo.lock multiplicity — deterministic (Gate 13)"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Crate</TableHead>
            <TableHead>Versions</TableHead>
            <TableHead>Dependents</TableHead>
            <TableHead className="text-right">Wasted</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {duplicates.map((d) => (
            <TableRow key={d.name}>
              <TableCell className="font-mono text-xs">{d.name}</TableCell>
              <TableCell>
                <div className="flex gap-1">
                  {d.versions.map((v) => (
                    <Badge key={v} variant="outline" className="font-mono text-[10px]">
                      {v}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{d.dependents.join(', ')}</TableCell>
              <TableCell className="text-right font-mono text-xs text-amber-300">
                {d.wastedSeconds.toFixed(1)}s
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={3} className="text-xs font-medium">
              TOTAL wasted
            </TableCell>
            <TableCell className="text-right font-mono text-xs font-semibold text-amber-300">
              {total.toFixed(1)}s / clean build
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <MeasurementBadge status="measured" />
        <p className="text-[11px] text-muted-foreground">
          existence of duplicate versions is measured; unification is tracked as{' '}
          <span className="font-mono text-foreground/80">FER-BLD-002</span>
        </p>
      </div>
    </Panel>
  )
}

/* -------------------------------------------------------------- blast list */

function BlastPanel({ blast, onNavigate }: { blast: BlastEntry[]; onNavigate?: ViewProps['onNavigate'] }) {
  const [openIdx, setOpenIdx] = useState<number>(0)

  return (
    <Panel title="Blast radius explorer" subtitle="what happens if I touch this file?">
      <div className="space-y-1.5">
        {blast.map((b, i) => {
          const open = i === openIdx
          return (
            <div key={b.file}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenIdx(open ? -1 : i)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                  open
                    ? 'border-primary/50 bg-primary/10'
                    : 'border-border/70 bg-card hover:border-primary/30',
                )}
              >
                <span className="flex-1 truncate font-mono text-[11px]">{b.file}</span>
                <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                  {b.crate}
                </Badge>
                <span className="shrink-0 font-mono text-xs text-amber-300">{b.affectedWorkspace}</span>
                <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
              </button>

              {open && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="mt-1.5 space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-3xl font-semibold text-foreground">
                      <CountUp value={b.affectedWorkspace} />
                    </span>
                    <span className="text-xs text-muted-foreground">workspace crates re-invalidate</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {b.chain.map((c, j) => (
                      <span key={`${c}-${j}`} className="flex items-center gap-1.5">
                        {j > 0 && <ArrowRight className="size-3 text-muted-foreground" />}
                        <span className="rounded-md border border-border/70 bg-card px-1.5 py-0.5 font-mono text-[10px]">
                          {c}
                        </span>
                      </span>
                    ))}
                  </div>

                  <p className="font-mono text-[11px] text-red-300">
                    +{b.incrementalDelta}s incremental (estimated)
                  </p>

                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-2">
                    <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                    <p className="text-[11px] text-amber-200/90">{b.suggestion}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => onNavigate?.('simulator')}>
                      Simulate edit
                    </Button>
                    <ExplainDialog
                      kind="impact"
                      context={JSON.stringify(b)}
                      question="What happens if I edit this file?"
                    />
                  </div>
                </motion.div>
              )}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

/* -------------------------------------------------------------------- view */

const LEGEND_ITEMS: { label: string; swatch: ReactNode }[] = [
  { label: 'workspace', swatch: <span className="size-2 rounded-full bg-primary" /> },
  { label: 'external', swatch: <span className="size-2 rounded-full bg-zinc-500" /> },
  { label: 'proc-macro', swatch: <span className="size-2 rounded-full" style={{ background: 'var(--chart-5)' }} /> },
  { label: 'critical', swatch: <span className="size-2 rounded-full bg-primary ring-1 ring-amber-400" /> },
  { label: 'duplicate', swatch: <span className="size-2 rounded-full border border-dashed border-amber-400" /> },
]

export default function DependenciesView({ onNavigate }: ViewProps) {
  const graph = useGraph()
  const data = graph.data

  const [query, setQuery] = useState('')
  const [showExternal, setShowExternal] = useState(true)
  const [selected, setSelected] = useState('common')

  const handleSelect = useCallback((id: string) => setSelected(id), [])
  const resetSelection = useCallback(() => {
    setSelected('common')
    setQuery('')
  }, [])

  if (graph.isPending) {
    return (
      <div className="space-y-5">
        <SectionHeading eyebrow="Engineering Graph" title="Dependency backbone" />
        <div className="grid gap-4 xl:grid-cols-3">
          <Skeleton className="h-[520px] xl:col-span-2" />
          <Skeleton className="h-[520px]" />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    )
  }

  if (graph.isError || !data) {
    return (
      <div className="space-y-5">
        <SectionHeading eyebrow="Engineering Graph" title="Dependency backbone" />
        <Panel title="Interactive graph">
          <div className="flex flex-col items-start gap-3 py-10">
            <p className="text-sm text-red-300">
              Could not load the workspace graph
              {graph.error ? ` — ${(graph.error as Error).message}` : ''}.
            </p>
            <Button variant="outline" size="sm" onClick={() => graph.refetch()}>
              Retry
            </Button>
          </div>
        </Panel>
      </div>
    )
  }

  const node = data.nodes.find((n) => n.id === selected) ?? data.nodes[0]
  const externals = data.nodes.filter((n) => n.band === 'external').length
  const lastScan = data.meta.lastScan.slice(0, 10)

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Engineering Graph"
        title="Dependency backbone"
        description={`${data.meta.workspaceCrates} first-class workspace crates · ${externals} externals shown · ${data.meta.totalEdges} edges · last scan ${lastScan}`}
      />

      <div className="flex flex-wrap items-center gap-1.5" aria-label="Graph legend">
        {LEGEND_ITEMS.map((item) => (
          <span
            key={item.label}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground"
          >
            {item.swatch}
            {item.label}
          </span>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <GraphPanel
          nodes={data.nodes}
          edges={data.edges}
          query={query}
          showExternal={showExternal}
          selected={selected}
          onSelect={handleSelect}
        />
        <NodeDetails node={node} edges={data.edges} blast={data.blast} onNavigate={onNavigate} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <DuplicatesPanel duplicates={data.duplicates} />
        <BlastPanel blast={data.blast} onNavigate={onNavigate} />
      </div>
    </div>
  )
}
