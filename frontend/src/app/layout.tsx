import type { Metadata } from "next";
import localFont from "next/font/local";
import "./fonts/subsets.css";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import QueryProvider from "@/components/QueryProvider";
import { ToastProvider } from "@/components/ToastProvider";

/*
 * The faces are committed under ./fonts instead of coming from next/font/google, which downloads
 * them from Google Fonts during `next build` — so a Google Fonts hiccup failed CI and could fail
 * a release. The files are the ones Google served, byte for byte (./fonts/README.md).
 *
 * Google serves each family as several files, one per subset, told apart by unicode-range; only
 * the latin one is preloaded, the rest are fetched by a page that has one of their characters
 * (Cyrillic, latin-ext accents, …). next/font/local takes ONE unicode-range per call, and names
 * the family after the variable it is assigned to, so the same split is written in two halves:
 *   - the call below declares the latin file: preloaded, with the variable the CSS reads;
 *   - its `fallback` names two families in ./fonts/subsets.css — "… Subsets", the other subset
 *     files, and "… Fallback", the metric-matched local face next/font/google generated (copied
 *     exactly, so the text measures the same while the real face loads). `adjustFontFallback` is
 *     off because next/font would otherwise insert its own fallback ahead of the subsets, and that
 *     local face would catch the Cyrillic and the accents before the real files could.
 * Weights are listed one by one rather than as a range because Google declared one face per
 * weight, so a weight in between still snaps to the nearest one, as it did. The `fallback` names
 * take SINGLE quotes: Turbopack pastes them unescaped into a double-quoted JS string, and double
 * quotes there fail the build.
 */
const geistSans = localFont({
  src: "./fonts/geist-latin.woff2",
  weight: "100 900",
  variable: "--font-geist-sans",
  adjustFontFallback: false,
  fallback: ["'Geist Subsets'", "'Geist Fallback'"],
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const plusJakarta = localFont({
  src: [
    { path: "./fonts/plus-jakarta-sans-latin.woff2", weight: "400" },
    { path: "./fonts/plus-jakarta-sans-latin.woff2", weight: "500" },
    { path: "./fonts/plus-jakarta-sans-latin.woff2", weight: "600" },
    { path: "./fonts/plus-jakarta-sans-latin.woff2", weight: "700" },
    { path: "./fonts/plus-jakarta-sans-latin.woff2", weight: "800" },
  ],
  variable: "--font-plus-jakarta",
  adjustFontFallback: false,
  fallback: ["'Plus Jakarta Sans Subsets'", "'Plus Jakarta Sans Fallback'"],
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

/**
 * The rounded display face, used ONLY on the roadmap (`.rmap` in globals.css).
 *
 * It is doing real work rather than decoration: the roadmap is a game-shaped screen — a path
 * of chunky circles a student taps through — and Plus Jakarta's flat terminals make those
 * numerals read as a data table rather than as steps on a trail. Three weights only, so the
 * extra face costs about 30 KB and is loaded on one route.
 */
const baloo = localFont({
  src: [
    { path: "./fonts/baloo-2-latin.woff2", weight: "600" },
    { path: "./fonts/baloo-2-latin.woff2", weight: "700" },
    { path: "./fonts/baloo-2-latin.woff2", weight: "800" },
  ],
  variable: "--font-baloo",
  adjustFontFallback: false,
  fallback: ["'Baloo 2 Subsets'", "'Baloo 2 Fallback'"],
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

export const metadata: Metadata = {
  title: "MasterSAT",
  description: "MasterSAT - Advanced SAT Preparation Platform",
  icons: {
    icon: "/images/logo.png",
    apple: "/images/logo.png",
  },
};

import Script from "next/script";
import "katex/dist/katex.min.css";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The font variables go on <html>, not <body>. Tailwind declares its @theme tokens on :root,
    // and a custom property resolves its var() where it is declared: with --font-geist-sans only
    // on <body>, `--font-sans: var(--font-geist-sans), …` resolved to nothing, and every
    // var(--font-sans) silently fell back to inheriting whatever surrounded it.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${plusJakarta.variable} ${baloo.variable}`}
    >
      <head />
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <QueryProvider>
            <ToastProvider>
              {children}
            </ToastProvider>
          </QueryProvider>
        </ThemeProvider>
        <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" />
      </body>
    </html>
  );
}
