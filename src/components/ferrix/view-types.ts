'use client'

import type { ViewId } from '@/lib/ferrix/types'

export interface ViewProps {
  onNavigate?: (v: ViewId) => void
}
