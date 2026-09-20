'use client'

import { useId } from 'react'

/**
 * Wanyrix brand mark — "The Beacon W".
 *
 * Design story (BRAND.md §mark):
 *  - A geometric W whose center vertex rises past the outer arms —
 *    a pulse spike, the heartbeat of a Rust codebase under scan.
 *  - A beacon dot hovers above the spike: the intelligence observing it.
 *  - Container: warm rust gradient (amber → orange → deep rust), the
 *    established Wanyrix palette and a nod to the Rust language itself.
 *
 * The mark is self-contained (own gradient background) so it renders
 * correctly on both light and dark surfaces without theme adjustments.
 */

const MARK_BG = 'wanyrix-mark-bg'

export function WanyrixLogo({
  size = 28,
  className,
  title,
}: {
  /** Rendered edge length in px. */
  size?: number
  className?: string
  /** Accessible name; defaults to aria-hidden decoration when omitted. */
  title?: string
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const bgId = `${MARK_BG}-${uid}`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={className}
    >
      <defs>
        <linearGradient id={bgId} x1="3" y1="2" x2="29" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f59e0b" />
          <stop offset="0.5" stopColor="#ea580c" />
          <stop offset="1" stopColor="#9a3412" />
        </linearGradient>
      </defs>

      {/* container plate */}
      <rect x="1.5" y="1.5" width="29" height="29" rx="8.5" fill={`url(#${bgId})`} />
      <rect x="1.5" y="1.5" width="29" height="29" rx="8.5" stroke="oklch(1 0 0 / 22%)" strokeWidth="1" />

      {/* beacon dot — the observer */}
      <circle cx="16" cy="6.7" r="1.85" fill="white" fillOpacity="0.95" />

      {/* W pulse — center vertex overshoots as the signal spike */}
      <path
        d="M7.7 12.1 L11.85 22.9 L16 10.6 L20.15 22.9 L24.3 12.1"
        stroke="white"
        strokeOpacity="0.96"
        strokeWidth="2.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

/**
 * Full brand lockup — mark + wordmark + tagline. Used where the brand
 * appears without surrounding HTML text (footer, dialogs, exports).
 * Text stays real HTML (not SVG <text>) so it inherits the document font.
 */
export function WanyrixLockup({
  size = 30,
  tagline = 'engineering intelligence',
  className,
}: {
  size?: number
  tagline?: string | null
  className?: string
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ''}`}>
      <WanyrixLogo size={size} title="Wanyrix" />
      <span className="flex flex-col leading-none">
        <span className="text-sm font-bold tracking-tight">Wanyrix</span>
        {tagline ? (
          <span className="mt-1 font-mono text-[10px] text-muted-foreground">{tagline}</span>
        ) : null}
      </span>
    </span>
  )
}
