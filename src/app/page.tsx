'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AppShell } from '@/components/wanyrix/app-shell'
import OverviewView from '@/components/wanyrix/views/overview-view'
import DoctorView from '@/components/wanyrix/views/doctor-view'
import DependenciesView from '@/components/wanyrix/views/dependencies-view'
import SimulatorView from '@/components/wanyrix/views/simulator-view'
import DiagnosticsView from '@/components/wanyrix/views/diagnostics-view'
import PRView from '@/components/wanyrix/views/pr-view'
import ExperimentsView from '@/components/wanyrix/views/experiments-view'
import ScorecardView from '@/components/wanyrix/views/scorecard-view'
import IssuesView from '@/components/wanyrix/views/issues-view'
import { useWorkspaceStore } from '@/lib/wanyrix/workspace-store'
import type { ViewId } from '@/lib/wanyrix/types'

const VIEWS: Record<ViewId, React.ComponentType<{ onNavigate?: (v: ViewId) => void }>> = {
  overview: OverviewView,
  doctor: DoctorView,
  graph: DependenciesView,
  simulator: SimulatorView,
  diagnostics: DiagnosticsView,
  prs: PRView,
  experiments: ExperimentsView,
  scorecard: ScorecardView,
  issues: IssuesView,
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
