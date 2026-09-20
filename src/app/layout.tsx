import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { QueryProvider } from "@/components/query-provider";
import { ThemeProvider } from "@/components/theme-provider";
// ENG-T3A-1: no analytics component here. Wanyrix is local-first with a
// documented zero-telemetry posture (docs/PRIVACY.md) — any future, strictly
// opt-in telemetry must be added behind an explicit user setting, never
// silently at the root layout.

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Canonical base for resolving absolute OG/twitter image URLs. Override in
  // deployment via NEXT_PUBLIC_SITE_URL; the default keeps local previews valid.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://wanyrix.dev"),
  title: "Wanyrix — Engineering Intelligence",
  applicationName: "Wanyrix",
  description:
    "Wanyrix continuously understands your Rust codebase: why builds are slow, what a change will cost, and how to verify improvements — grounded in evidence.",
  keywords: ["Rust", "cargo", "build intelligence", "engineering intelligence", "wanyrix", "W-EIR"],
  authors: [{ name: "Wanyrix" }],
  openGraph: {
    title: "Wanyrix — Engineering Intelligence",
    description: "Rust made software safer. Wanyrix makes Rust development easier to understand and operate.",
    siteName: "Wanyrix",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Wanyrix — the Beacon-W mark on a warm rust gradient, wordmark and tagline: Engineering Intelligence for Rust",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Wanyrix — Engineering Intelligence",
    description:
      "Wanyrix continuously understands your Rust codebase: why builds are slow, what a change will cost, and how to verify improvements.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider>
          <QueryProvider>{children}</QueryProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
