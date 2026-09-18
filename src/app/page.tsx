'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AppShell } from '@/components/wanyrix/app-shell'
import OverviewView from '@/components/wanyrix/views/overview-view'
import RepositoriesView from '@/components/wanyrix/views/repositories-view'
import DoctorView from '@/components/wanyrix/views/doctor-view'
import DependenciesView from '@/components/wanyrix/views/dependencies-view'
import GraphView from '@/components/wanyrix/views/graph-view'
import FindingsView from '@/components/wanyrix/views/findings-view'
import ArchitectureView from '@/components/wanyrix/views/architecture-view'
import SimulatorView from '@/components/wanyrix/views/simulator-view'
import DiagnosticsView from '@/components/wanyrix/views/diagnostics-view'
import PRView from '@/components/wanyrix/views/pr-view'
import ExperimentsView from '@/components/wanyrix/views/experiments-view'
import RuntimeView from '@/components/wanyrix/views/runtime-view'
import HistoryView from '@/components/wanyrix/views/history-view'
import AiView from '@/components/wanyrix/views/ai-view'
import ScorecardView from '@/components/wanyrix/views/scorecard-view'
import IssuesView from '@/components/wanyrix/views/issues-view'
import OrganizationView from '@/components/wanyrix/views/organization-view'
import SettingsView from '@/components/wanyrix/views/settings-view'
import { useWorkspaceStore } from '@/lib/wanyrix/workspace-store'
import type { ViewId } from '@/lib/wanyrix/types'

/**
 * View registry — one entry per ViewId (AUDIT-I3: 14 required surfaces +
 * 4 pre-existing surfaces that keep their nav entries).
 * Naming note: `graph` renders graph-view.tsx (the band-layout dependency
 * backbone, formerly dependencies-view.tsx); `dependencies` renders the
 * version/duplicate/risk surface.
 */
const VIEWS: Record<ViewId, React.ComponentType<{ onNavigate?: (v: ViewId) => void }>> = {
  overview: OverviewView,
  repositories: RepositoriesView,
  doctor: DoctorView,
  dependencies: DependenciesView,
  graph: GraphView,
  findings: FindingsView,
  architecture: ArchitectureView,
  simulator: SimulatorView,
  diagnostics: DiagnosticsView,
  prs: PRView,
  experiments: ExperimentsView,
  runtime: RuntimeView,
  history: HistoryView,
  ai: AiView,
  scorecard: ScorecardView,
  issues: IssuesView,
  organization: OrganizationView,
  settings: SettingsView,
}

export default function Home() {
  const [view, setView] = useState<ViewId>('overview')
  const activeWs = useWorkspaceStore((s) => s.active)
  const ActiveView = VIEWS[view]

  return (
    <AppShell activeView={view} onNavigate={setView}>
      <AnimatePresence mode="wait">
        <motion.div
          key={`${activeWs}:${view}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="mx-auto max-w-[1400px]"
        >
          <ActiveView onNavigate={setView} />
        </motion.div>
      </AnimatePresence>
    </AppShell>
  )
}
