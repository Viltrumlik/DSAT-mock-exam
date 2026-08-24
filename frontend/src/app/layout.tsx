import type { Metadata } from "next";
import { Baloo_2, Geist, Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import QueryProvider from "@/components/QueryProvider";
import { ToastProvider } from "@/components/ToastProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

/**
 * The rounded display face, used ONLY on the roadmap (`.rmap` in globals.css).
 *
 * It is doing real work rather than decoration: the roadmap is a game-shaped screen — a path
 * of chunky circles a student taps through — and Plus Jakarta's flat terminals make those
 * numerals read as a data table rather than as steps on a trail. Three weights only, so the
 * extra face costs about 30 KB and is loaded on one route.
 */
const baloo = Baloo_2({
  variable: "--font-baloo",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
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
    <html lang="en" suppressHydrationWarning>
      <head />
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${plusJakarta.variable} ${baloo.variable} antialiased`}
      >
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
