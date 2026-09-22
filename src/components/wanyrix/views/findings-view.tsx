'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { FlaskConical, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useDoctor } from '@/lib/wanyrix/hooks'
import type { Finding, FindingSection, Severity } from '@/lib/wanyrix/types'
import {
  ConfidenceBadge,
  DataErrorPanel,
  EmptyState,
  MeasurementBadge,
  Panel,
  SectionHeading,
  SeverityBadge,
  ViewSkeleton,
} from '../shared'
import { FindingSheet } from '../finding-sheet'
import type { ViewProps } from '../view-types'

type SeverityFilter = Severity | 'all'
type SectionFilter = FindingSection | 'all'

const REMEDIATION_LABEL: Record<Finding['remediationKind'], string> = {
  command: 'command',
  config: 'config',
  architecture: 'architecture',
  experiment: 'experiment',
  patch: 'patch',
}

/**
 * Findings (AUDIT-I3 required surface) — the doctor findings list promoted to
 * a first-class view with severity/section/search filters. Detail drill-down
 * stays in the FindingSheet drawer (the doctor view keeps using it too, so
 * both entry points share one state source: the doctor payload).
 */
export default function FindingsView({ onNavigate }: ViewProps) {
  const doctor = useDoctor()
  const [severity, setSeverity] = useState<SeverityFilter>('all')
  const [section, setSection] = useState<SectionFilter>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Finding | null>(null)

  const findings = useMemo(() => doctor.data?.findings ?? [], [doctor.data])

  const sections = useMemo(() => {
    const set = new Set<FindingSection>()
    for (const f of findings) set.add(f.section)
    return [...set]
  }, [findings])

  const counts = useMemo(
    () => ({
      critical: findings.filter((f) => f.severity === 'critical').length,
      warning: findings.filter((f) => f.severity === 'warning').length,
      info: findings.filter((f) => f.severity === 'info').length,
      measured: findings.filter((f) => f.measurementStatus === 'measured').length,
      estimated: findings.filter((f) => f.measurementStatus === 'estimated').length,
    }),
    [findings],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return findings.filter((f) => {
      if (severity !== 'all' && f.severity !== severity) return false
      if (section !== 'all' && f.section !== section) return false
      if (q) {
        const haystack = `${f.id} ${f.title} ${f.description} ${f.affected.join(' ')}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [findings, severity, section, query])

  if (doctor.isLoading) return <ViewSkeleton />
  if (doctor.isError || !doctor.data)
    return (
      <DataErrorPanel
        title="Findings unavailable"
        message={doctor.isError ? (doctor.error as Error).message : 'empty payload'}
        onRetry={() => doctor.refetch()}
      />
    )

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Diagnostic Findings"
        title="Findings"
        description={`${findings.length} evidence-backed findings in ${doctor.data.workspace} — every quantitative claim carries its measurement status (Gate 8 / Gate 21).`}
        actions={
          <Button size="sm" variant="outline" onClick={() => onNavigate?.('doctor')}>
            Open Builds · Doctor
          </Button>
        }
      />

      {/* severity + measurement summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {(
          [
            { key: 'critical', label: 'Critical', node: <SeverityBadge severity="critical" /> },
            { key: 'warning', label: 'Warning', node: <SeverityBadge severity="warning" /> },
            { key: 'info', label: 'Info', node: <SeverityBadge severity="info" /> },
          ] as const
        ).map((s) => (
          <Card key={s.key} className="flex-row items-center justify-between gap-2 p-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
              <p className="mt-1 font-mono text-xl font-semibold tabular-nums">{counts[s.key]}</p>
            </div>
            {s.node}
          </Card>
        ))}
        <Card className="flex-row items-center justify-between gap-2 p-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Measured</p>
            <p className="mt-1 font-mono text-xl font-semibold tabular-nums">{counts.measured}</p>
          </div>
          <MeasurementBadge status="measured" />
        </Card>
        <Card className="flex-row items-center justify-between gap-2 p-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Estimated</p>
            <p className="mt-1 font-mono text-xl font-semibold tabular-nums">{counts.estimated}</p>
          </div>
          <MeasurementBadge status="estimated" />
        </Card>
      </div>

      {/* filters */}
      <Panel title="Filter" subtitle="client-side over the doctor payload — nothing leaves the browser">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search id, title, affected crates…"
              className="pl-8"
              aria-label="Search findings"
            />
          </div>
          <div className="flex gap-2">
            <Select value={severity} onValueChange={(v) => setSeverity(v as SeverityFilter)}>
              <SelectTrigger className="h-9 w-[140px] text-xs" aria-label="Severity filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>
            <Select value={section} onValueChange={(v) => setSection(v as SectionFilter)}>
              <SelectTrigger className="h-9 w-[150px] text-xs" aria-label="Section filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sections</SelectItem>
                {sections.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Panel>

      {/* results */}
      {filtered.length === 0 ? (
        <EmptyState label="No findings match the current filters." />
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((f, i) => (
            <motion.li
              key={f.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: Math.min(i * 0.03, 0.2) }}
            >
              <Card
                role="button"
                tabIndex={0}
                onClick={() => setSelected(f)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setSelected(f)
                  }
                }}
                className="cursor-pointer gap-2 p-4 transition-colors hover:border-primary/30 hover:bg-accent/40"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] tracking-wide text-muted-foreground">{f.id}</span>
                  <SeverityBadge severity={f.severity} />
                  <MeasurementBadge status={f.measurementStatus} />
                  <ConfidenceBadge level={f.confidenceClass} />
                  <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                    {f.section}
                  </Badge>
                  <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                    {REMEDIATION_LABEL[f.remediationKind]}
                  </Badge>
                </div>
                <p className="text-[14px] font-medium leading-snug">{f.title}</p>
                <p className="line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">{f.description}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10.5px] text-muted-foreground">
                  <span>
                    impact: <span className="text-foreground/80">{f.impact}</span>
                  </span>
                  <span>
                    confidence: <span className="tabular-nums text-foreground/80">{f.confidence}%</span>
                  </span>
                  <span className="flex items-center gap-1">
                    affected: <span className="text-foreground/80">{f.affected.slice(0, 3).join(', ')}</span>
                    {f.affected.length > 3 && ` +${f.affected.length - 3}`}
                  </span>
                </div>
              </Card>
            </motion.li>
          ))}
        </ul>
      )}

      {/* experiment shortcut for eligible findings */}
      {filtered.some((f) => f.experimentEligible) && (
        <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <FlaskConical className="size-3.5 shrink-0 text-primary" />
          Findings marked experiment-eligible open a “Create experiment” action in the detail drawer.
        </p>
      )}

      {/* shared detail drawer — same component the doctor view uses */}
      <FindingSheet finding={selected} onOpenChange={(o) => !o && setSelected(null)} onNavigate={onNavigate} />
    </div>
  )
}
