/**
 * Single source of truth for Wanyrix navigation (AUDIT-I3).
 *
 * The 14 required surfaces are: Overview · Repositories · Builds ·
 * Dependencies · Graph · Findings · Architecture · Experiments · Runtime ·
 * History · AI · Policies · Organization · Settings. The four pre-existing
 * surfaces (Diagnostics, PR Analysis, Impact Simulator, Issues & PRs) keep
 * their nav entries so nothing regresses.
 *
 * Consumed by BOTH the sidebar (app-shell) and the command palette so the
 * two can never drift apart. Ids are stable ViewIds — deep links such as
 * `onNavigate('graph')` keep working.
 */
import {
  Activity,
  Blocks,
  Calculator,
  Database,
  FileSearch,
  FlaskConical,
  GitPullRequest,
  History,
  LayoutDashboard,
  ListChecks,
  Microscope,
  Network,
  Package,
  Settings,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Users,
  type LucideIcon,
} from 'lucide-react'

import type { ViewId } from '@/lib/wanyrix/types'

export interface NavItem {
  id: ViewId
  label: string
  icon: LucideIcon
  hint: string
}

export interface NavGroup {
  group: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    group: 'Intelligence',
    items: [
      { id: 'overview', label: 'Overview', icon: LayoutDashboard, hint: 'Engineering health' },
      { id: 'repositories', label: 'Repositories', icon: Database, hint: 'workspace registry' },
      { id: 'doctor', label: 'Builds · Doctor', icon: Stethoscope, hint: 'wanyrix doctor' },
      { id: 'findings', label: 'Findings', icon: FileSearch, hint: 'evidence-backed' },
    ],
  },
  {
    group: 'Structure',
    items: [
      { id: 'dependencies', label: 'Dependencies', icon: Package, hint: 'versions · duplicates' },
      { id: 'graph', label: 'Engineering Graph', icon: Network, hint: 'blast radius' },
      { id: 'architecture', label: 'Architecture', icon: Blocks, hint: 'fan-in / fan-out' },
      { id: 'simulator', label: 'Impact Simulator', icon: Calculator, hint: 'change cost' },
    ],
  },
  {
    group: 'Verification',
    items: [
      { id: 'diagnostics', label: 'Diagnostics', icon: Microscope, hint: 'borrow · async' },
      { id: 'prs', label: 'PR Analysis', icon: GitPullRequest, hint: 'regression guard' },
      { id: 'experiments', label: 'Experiments', icon: FlaskConical, hint: 'verify claims' },
    ],
  },
  {
    group: 'Observability',
    items: [
      { id: 'runtime', label: 'Runtime', icon: Activity, hint: 'captured profiles' },
      { id: 'history', label: 'History', icon: History, hint: 'scan run log' },
    ],
  },
  {
    group: 'Reasoning & Governance',
    items: [
      { id: 'ai', label: 'AI', icon: Sparkles, hint: 'grounded reasoning' },
      { id: 'scorecard', label: 'Policies · Gates', icon: ShieldCheck, hint: 'GO / NO-GO' },
      { id: 'issues', label: 'Issues & PRs', icon: ListChecks, hint: 'traceability' },
    ],
  },
  {
    group: 'Workspace',
    items: [
      { id: 'organization', label: 'Organization', icon: Users, hint: 'plan · members' },
      { id: 'settings', label: 'Settings', icon: Settings, hint: 'local-first' },
    ],
  },
]

/** Flat 18-item list — command palette + mobile nav. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)

/** Topbar title/subtitle for every ViewId. */
export const VIEW_TITLES: Record<ViewId, { title: string; sub: string }> = {
  overview: { title: 'Engineering Health', sub: 'continuously analyzed' },
  repositories: { title: 'Repositories', sub: 'workspace registry · health · recency' },
  doctor: { title: 'Builds · Doctor', sub: 'wanyrix doctor · evidence-backed findings' },
  dependencies: { title: 'Dependencies', sub: 'versions · duplicates · resolution paths' },
  graph: { title: 'Engineering Graph', sub: 'dependency backbone · blast radius' },
  findings: { title: 'Findings', sub: 'every diagnostic, evidence attached' },
  architecture: { title: 'Architecture', sub: 'boundaries · fan-in/fan-out · hotspots' },
  diagnostics: { title: 'Diagnostics', sub: 'borrow-checker explainer · async flow' },
  prs: { title: 'PR Analysis', sub: 'build regression guard' },
  simulator: { title: 'Impact Simulator', sub: 'what will this change cost?' },
  experiments: { title: 'Experiments', sub: 'baseline → candidate → verified' },
  runtime: { title: 'Runtime', sub: 'captured async profile · local engine signals' },
  history: { title: 'History', sub: 'scan run log · persisted locally' },
  ai: { title: 'AI Reasoning', sub: 'grounded in evidence · deterministic fallback' },
  scorecard: { title: 'Policies · Gates', sub: 'release verdict · MVP acceptance gates' },
  issues: { title: 'Issues & PRs', sub: 'every issue fixed by a PR' },
  organization: { title: 'Organization', sub: 'plan · members · policy summary' },
  settings: { title: 'Settings', sub: 'local-first preferences · migration status' },
}
