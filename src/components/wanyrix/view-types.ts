'use client'

import type { ViewId } from '@/lib/wanyrix/types'

export interface ViewProps {
  onNavigate?: (v: ViewId) => void
}
