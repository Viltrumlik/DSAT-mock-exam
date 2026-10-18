"use client";

/**
 * /download — the MasterSAT app for Windows and Mac, in the student area beside Services.
 *
 * Dressed like the rest of the house (HeroPage, white quartz cards, token colours that follow
 * the light/dark toggle): the owner wants it to look like the site, not like the app.
 *
 * The card for the student's own computer leads — its button is the solid one and it says
 * "This computer"; a phone or a Chromebook gets neither and a plain note below. Version, sizes
 * and checksums come from `latest.json` beside the files, so a release needs no site deploy,
 * and the buttons point at fixed addresses that work without it.
 */

import { useEffect, useState } from "react";
import { Apple, Download, Laptop, Monitor } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { HeroPage } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  DESKTOP_DOWNLOAD_URL,
  DESKTOP_MAC_DOWNLOAD_URL,
  DESKTOP_RELEASE_MANIFEST_URL,
} from "@/lib/desktop/routes";

import { detectPlatform, formatSize, parseManifest, type DownloadPlatform, type ReleaseManifest } from "./downloadModel";

type Tone = "primary" | "violet";

/** Services' tone table, the two this page wears. */
const TONE: Record<Tone, { icon: string; edge: string; text: string; pill: string; well: string }> = {
  primary: {
    icon: "bg-primary/15 text-primary dark:text-primary-hover",
    edge: "from-primary via-primary/40 to-transparent",
    text: "text-primary dark:text-primary-hover",
    pill: "bg-primary/15 text-primary dark:text-primary-hover",
    well: "bg-primary/[0.07]",
  },
  violet: {
    icon: "bg-[color-mix(in_oklab,var(--chart-6)_16%,transparent)] text-[var(--chart-6)]",
    edge: "from-[var(--chart-6)] via-[color-mix(in_oklab,var(--chart-6)_40%,transparent)] to-transparent",
    text: "text-[var(--chart-6)]",
    pill: "bg-[color-mix(in_oklab,var(--chart-6)_14%,transparent)] text-[var(--chart-6)]",
    well: "bg-[color-mix(in_oklab,var(--chart-6)_8%,transparent)]",
  },
};

type App = {
  id: "windows" | "mac";
  tone: Tone;
  icon: LucideIcon;
  name: string;
  requirement: string;
  href: string;
  fileKind: string;
  steps: string[];
};

const APPS: App[] = [
  {
    id: "windows",
    tone: "primary",
    icon: Monitor,
    name: "Windows",
    requirement: "Windows 10 or 11, 64-bit",
    href: DESKTOP_DOWNLOAD_URL,
    fileKind: "Installer (.exe)",
    steps: [
      "Open the downloaded MasterSAT-Setup.exe.",
      "If Windows says “Windows protected your PC”, choose More info → Run anyway.",
      "MasterSAT installs, opens, and keeps itself up to date.",
    ],
  },
  {
    id: "mac",
    tone: "violet",
    icon: Apple,
    name: "Mac",
    requirement: "macOS 12 or later · Intel or Apple silicon",
    href: DESKTOP_MAC_DOWNLOAD_URL,
    fileKind: "Disk image (.dmg)",
    steps: [
      "Open MasterSAT.dmg and drag MasterSAT into Applications.",
      "If macOS says it cannot check the app, open System Settings → Privacy & Security and choose Open Anyway (on older macOS: right-click MasterSAT → Open).",
      "For a new version, download it here again.",
    ],
  },
];

function DownloadCard({
  app,
  index,
  recommended,
  bytes,
}: {
  app: App;
  index: number;
  recommended: boolean;
  bytes: number | null;
}) {
  const t = TONE[app.tone];
  const Icon = app.icon;
  return (
    <article
      aria-labelledby={`download-${app.id}`}
      data-recommended={recommended ? "true" : "false"}
      className="quartz squircle cr-cardrise relative flex h-full flex-col gap-4 overflow-hidden p-5 [--sq:13px]"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", t.edge)} />
      <div className="flex items-start gap-3">
        <span className={cn("squircle flex h-12 w-12 shrink-0 items-center justify-center [--sq:7.5px]", t.icon)}>
          <Icon className="h-[22px] w-[22px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`download-${app.id}`} className="text-[17px] font-extrabold tracking-[-0.01em] text-foreground">
            {app.name}
          </h2>
          <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{app.requirement}</p>
        </div>
        {recommended ? (
          <span className={cn("shrink-0 rounded-full px-3 py-1 text-[12px] font-bold", t.pill)}>This computer</span>
        ) : null}
      </div>

      <div>
        <a
          href={app.href}
          className={cn(
            "ds-ring inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[14px] font-bold no-underline transition-colors",
            recommended
              ? "bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(67,56,202,0.35)] hover:bg-primary-hover"
              : t.pill,
          )}
        >
          <Download className="h-4 w-4" aria-hidden /> Download for {app.name}
        </a>
        <p className="mt-1.5 text-center text-[12px] font-medium text-muted-foreground">
          {app.fileKind}
          {bytes ? ` · ${formatSize(bytes)}` : ""}
        </p>
      </div>

      <div className={cn("squircle px-3.5 py-3 [--sq:8px]", t.well)}>
        <p className={cn("text-[10.5px] font-extrabold uppercase tracking-[0.08em]", t.text)}>How to install</p>
        <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-[13px] leading-relaxed text-foreground">
          {app.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
    </article>
  );
}

export function DownloadPage() {
  const [platform, setPlatform] = useState<DownloadPlatform | null>(null);
  const [manifest, setManifest] = useState<ReleaseManifest | null>(null);

  useEffect(() => {
    setPlatform(detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0));
    let live = true;
    fetch(DESKTOP_RELEASE_MANIFEST_URL, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (live) setManifest(parseManifest(json));
      })
      .catch(() => {
        // No version line then; the buttons point at fixed addresses and still work.
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <HeroPage className="flex flex-col gap-7">
      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <section className="quartz squircle cr-cardrise relative overflow-hidden [--sq:15px]">
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-primary/60 to-[var(--chart-6)]"
        />
        <div className="relative flex items-start gap-4 px-6 py-7 sm:px-8">
          <span className="squircle flex h-14 w-14 shrink-0 items-center justify-center bg-primary/10 text-primary [--sq:8.5px] dark:text-primary-hover">
            <Laptop className="h-7 w-7" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[28px] font-extrabold leading-[1.1] tracking-[-0.025em] text-foreground sm:text-[32px]">
              Download the MasterSAT app
            </h1>
            <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-muted-foreground">
              Take your midterms and past papers in the MasterSAT app. It keeps the test window locked while you
              work — install it before test day.
            </p>
            {manifest ? (
              <span className="mt-3 inline-flex rounded-full bg-primary/10 px-3 py-1 text-[12px] font-bold text-primary dark:text-primary-hover">
                Version {manifest.version}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        {APPS.map((app, i) => (
          <DownloadCard
            key={app.id}
            app={app}
            index={i}
            recommended={platform === app.id}
            bytes={manifest ? manifest[app.id].bytes : null}
          />
        ))}
      </div>

      <p className="text-[13px] leading-relaxed text-muted-foreground">
        On a phone, a tablet or a Chromebook? The app runs on Windows and Mac computers only — ask your teacher
        before test day.
      </p>

      {manifest ? (
        <details className="-mt-3 text-[12px] text-muted-foreground">
          <summary className="cursor-pointer font-semibold">Checksums (SHA-256)</summary>
          <dl className="mt-2 space-y-1 break-all font-mono">
            <div>
              <dt className="inline font-semibold">Windows: </dt>
              <dd className="inline">{manifest.windows.sha256}</dd>
            </div>
            <div>
              <dt className="inline font-semibold">Mac: </dt>
              <dd className="inline">{manifest.mac.sha256}</dd>
            </div>
          </dl>
        </details>
      ) : null}
    </HeroPage>
  );
}
