'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
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
import PlansView from '@/components/wanyrix/views/plans-view'
import SettingsView from '@/components/wanyrix/views/settings-view'
import { useWorkspaceStore } from '@/lib/wanyrix/workspace-store'
import { hashForView, viewFromHash } from '@/lib/wanyrix/view-hash'
import type { ViewId } from '@/lib/wanyrix/types'

/**
 * View registry — one entry per ViewId (AUDIT-I3: 14 required surfaces +
 * 4 pre-existing surfaces that keep their nav entries + `plans`, the local
 * subscription surface, issue #94 E1).
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
  plans: PlansView,
  settings: SettingsView,
}

/* QA-1 F-1 — the location hash is the single source of truth for the active
   view. Subscribed via useSyncExternalStore (the app-shell `mounted` pattern):
   hashchange covers navigations AND manual hash edits, popstate additionally
   covers history traversal, and both funnel into one cheap re-read. */
const subscribeToViewHash = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange)
  window.addEventListener('popstate', onChange)
  return () => {
    window.removeEventListener('hashchange', onChange)
    window.removeEventListener('popstate', onChange)
  }
}

/** Client snapshot: the view named by the URL, null when the hash names none. */
const readViewHash = () => viewFromHash(window.location.hash)

export default function Home() {
  const activeWs = useWorkspaceStore((s) => s.active)

  /* The server snapshot is null (⇒ Overview) so SSR and the first hydration
     render always agree; React then adopts the client snapshot, so a deep
     link restores its view without a hydration mismatch. Unknown hashes fall
     back to Overview. */
  const hashView = useSyncExternalStore(subscribeToViewHash, readViewHash, () => null)
  const view: ViewId = hashView ?? 'overview'
  const ActiveView = VIEWS[view]

  /* Canonicalize a missing/invalid hash to `#/overview` so refresh/bookmark
     keeps the default view shareable (replaceState: no history entry, no
     hashchange event, no reload). */
  useEffect(() => {
    if (viewFromHash(window.location.hash) === null) {
      window.history.replaceState(null, '', hashForView('overview'))
    }
  }, [])

  /* Every navigation choke point (sidebar, palette, view CTAs) funnels
     through here. Writing the hash IS the state update: a plain hash write
     pushes a history entry WITHOUT any reload and fires hashchange, which the
     store above picks up — so Back/Forward step between views. The write is
     skipped when the hash already names the view, so no duplicate history
     entry is created. */
  const navigate = useCallback((v: ViewId) => {
    if (viewFromHash(window.location.hash) !== v) {
      window.location.hash = hashForView(v)
    }
  }, [])

  return (
    <AppShell activeView={view} onNavigate={navigate}>
      <AnimatePresence mode="wait">
        <motion.div
          key={`${activeWs}:${view}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="mx-auto max-w-[1400px]"
        >
          <ActiveView onNavigate={navigate} />
        </motion.div>
      </AnimatePresence>
    </AppShell>
  )
}
