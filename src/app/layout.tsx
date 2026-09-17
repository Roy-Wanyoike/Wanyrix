import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { QueryProvider } from "@/components/query-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ferrix — Rust Engineering Intelligence",
  description:
    "Ferrix continuously understands your Rust codebase: why builds are slow, what a change will cost, and how to verify improvements — grounded in evidence.",
  keywords: ["Rust", "cargo", "build intelligence", "engineering intelligence", "ferrix"],
  authors: [{ name: "Ferrix" }],
  openGraph: {
    title: "Ferrix — Rust Engineering Intelligence",
    description: "Rust made software safer. Ferrix makes Rust development easier to understand and operate.",
    siteName: "Ferrix",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <QueryProvider>{children}</QueryProvider>
        <Toaster />
      </body>
    </html>
  );
}
