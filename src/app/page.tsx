'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AppShell } from '@/components/ferrix/app-shell'
import OverviewView from '@/components/ferrix/views/overview-view'
import DoctorView from '@/components/ferrix/views/doctor-view'
import DependenciesView from '@/components/ferrix/views/dependencies-view'
import SimulatorView from '@/components/ferrix/views/simulator-view'
import DiagnosticsView from '@/components/ferrix/views/diagnostics-view'
import PRView from '@/components/ferrix/views/pr-view'
import ExperimentsView from '@/components/ferrix/views/experiments-view'
import ScorecardView from '@/components/ferrix/views/scorecard-view'
import IssuesView from '@/components/ferrix/views/issues-view'
import type { ViewId } from '@/lib/ferrix/types'

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
  const ActiveView = VIEWS[view]

  return (
    <AppShell activeView={view} onNavigate={setView}>
      <AnimatePresence mode="wait">
        <motion.div
          key={view}
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
