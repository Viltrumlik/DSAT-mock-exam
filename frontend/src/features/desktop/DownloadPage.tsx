"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Laptop, Monitor } from "lucide-react";

import { SatColorRule } from "@/features/testing-simulation/components/SatColorRule";
import {
  DESKTOP_DOWNLOAD_URL,
  DESKTOP_MAC_DOWNLOAD_URL,
  DESKTOP_RELEASE_MANIFEST_URL,
} from "@/lib/desktop/routes";

import { detectPlatform, formatSize, parseManifest, type DownloadPlatform, type ReleaseManifest } from "./downloadModel";

type Card = {
  id: "windows" | "mac";
  name: string;
  icon: React.ElementType;
  requirement: string;
  href: string;
  fileKind: string;
  steps: string[];
};

const CARDS: Card[] = [
  {
    id: "windows",
    name: "Windows",
    icon: Monitor,
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
    name: "Mac",
    icon: Laptop,
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

const primaryButton =
  "inline-flex w-full items-center justify-center gap-2 rounded-full bg-blue-700 px-6 py-3 text-base font-bold text-white transition-colors hover:bg-blue-800";
const outlineButton =
  "inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-300 px-6 py-3 text-base font-bold text-slate-800 transition-colors hover:bg-slate-50";

/**
 * mastersat.uz/download — the MasterSAT app for Windows and Mac. Public (no sign-in), so a
 * teacher can share the link. The card for the visitor's own computer leads; version and size
 * come from `latest.json` beside the files, and the buttons work without it.
 */
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
    <div className="flex min-h-screen flex-col bg-white">
      <SatColorRule />
      <header className="mx-auto flex w-full max-w-4xl items-center px-6 pt-6">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/logo.png" alt="" className="h-8 w-8 object-contain" />
          <span className="text-lg font-extrabold tracking-tight text-slate-900">MasterSAT</span>
        </Link>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">Download the MasterSAT app</h1>
        <p className="mt-3 max-w-2xl text-base font-medium text-slate-600">
          Take your midterms and past papers in the MasterSAT app. It keeps the test window locked while you work —
          install it before test day.
        </p>
        {manifest ? (
          <p className="mt-2 text-sm font-semibold text-slate-500">Version {manifest.version}</p>
        ) : null}

        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {CARDS.map((card) => {
            const recommended = platform === card.id;
            const file = manifest?.[card.id];
            const Icon = card.icon;
            return (
              <section
                key={card.id}
                aria-labelledby={`download-${card.id}`}
                data-recommended={recommended ? "true" : "false"}
                className={`rounded-3xl border bg-white p-7 shadow-sm ${recommended ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200"}`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
                    <Icon className="h-6 w-6" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 id={`download-${card.id}`} className="text-xl font-extrabold text-slate-900">
                      {card.name}
                    </h2>
                    <p className="text-sm font-medium text-slate-500">{card.requirement}</p>
                  </div>
                  {recommended ? (
                    <span className="shrink-0 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                      This computer
                    </span>
                  ) : null}
                </div>
                <a href={card.href} className={`${recommended ? primaryButton : outlineButton} mt-6`}>
                  <Download className="h-5 w-5" aria-hidden /> Download for {card.name}
                </a>
                <p className="mt-2 text-center text-xs font-medium text-slate-500">
                  {card.fileKind}
                  {file ? ` · ${formatSize(file.bytes)}` : ""}
                </p>
                <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm text-slate-600">
                  {card.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </section>
            );
          })}
        </div>

        <p className="mt-8 text-sm font-medium text-slate-500">
          On a phone, a tablet or a Chromebook? The app runs on Windows and Mac computers only — ask your teacher
          before test day.
        </p>

        {manifest ? (
          <details className="mt-6 text-xs text-slate-500">
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
      </main>
      <SatColorRule />
    </div>
  );
}
