'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'

/**
 * Ferrix appearance provider (issue #43).
 * Class-based so globals.css `.dark` / `html:not(.dark)` scopes apply.
 * Default is dark — the rust-on-charcoal terminal aesthetic — with a
 * warm-paper light mode available from the topbar toggle or ⌘K palette.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}
