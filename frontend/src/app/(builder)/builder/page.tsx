"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArrowRight,
  BookMarked,
  CheckCircle2,
  FileText,
  GraduationCap,
  LayoutGrid,
  Library,
  PlayCircle,
  Tag,
} from "lucide-react";
import { StateTag } from "@/components/governance";
import {
  readStudioSession,
  sessionContinueHref,
  sessionContinueLabel,
  type StudioSession,
} from "@/lib/studioSession";

// ─── Types ────────────────────────────────────────────────────────────────────


// ─── Quick links ──────────────────────────────────────────────────────────────

type QuickLink = { href: string; icon: React.ElementType; title: string; cta: string; section?: string };

const QUICK_LINKS: QuickLink[] = [
  // Learning system
  { href: "/builder/bank",       icon: Library,        title: "Question Bank", cta: "Browse",  section: "Learning" },
  { href: "/builder/sets",       icon: LayoutGrid,     title: "Assessments",   cta: "Manage",  section: "Learning" },
  { href: "/builder/midterms",   icon: GraduationCap,  title: "Midterms",      cta: "Manage",  section: "Learning" },
  { href: "/builder/vocabulary", icon: BookMarked,     title: "Vocabulary",    cta: "Manage",  section: "Learning" },
  { href: "/builder/categories", icon: Tag,            title: "Categories",    cta: "Edit",    section: "Learning" },
  // Simulation system
  { href: "/builder/pastpapers", icon: FileText,        title: "Past papers",   cta: "Manage", section: "Simulation" },
  // Ops
  { href: "/builder/archived",   icon: Archive,        title: "Archived",      cta: "Review" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BuilderDashboardPage() {
  const [session, setSession] = useState<StudioSession | null>(null);

  // Read session on client only (localStorage unavailable during SSR).
  useEffect(() => {
    setSession(readStudioSession());
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Content health at a glance.</p>
      </div>

      {/* Session continuity — "Continue working" card */}
      {(() => {
        if (!session) return null;
        const href = sessionContinueHref(session);
        const label = sessionContinueLabel(session);
        if (!href || !label) return null;
        return (
          <Link
            href={href}
            className="flex items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 hover:border-primary/30 hover:bg-surface-2/60 transition-colors"
          >
            <div className="shrink-0 rounded-xl bg-surface-2 p-3">
              <PlayCircle className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-extrabold text-foreground">Continue working</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{label}</p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        );
      })()}

      {/* Quick navigation — grouped by domain */}
      <div className="space-y-4">
        {(["Learning", "Simulation"] as const).map((section) => {
          const links = QUICK_LINKS.filter((l) => l.section === section);
          return (
            <div key={section}>
              <p className="text-[9px] font-black uppercase tracking-[0.15em] text-muted-foreground/60 mb-2 px-0.5">
                {section}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="group flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 hover:border-primary/30 hover:bg-primary/5 transition-colors"
                  >
                    <link.icon className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    <div>
                      <p className="text-sm font-extrabold text-foreground">{link.title}</p>
                      <p className="text-xs text-primary font-semibold mt-0.5">{link.cta} →</p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
        {/* Ops utilities */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {QUICK_LINKS.filter((l) => !l.section).map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 hover:border-primary/30 hover:bg-primary/5 transition-colors"
            >
              <link.icon className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
              <div>
                <p className="text-sm font-extrabold text-foreground">{link.title}</p>
                <p className="text-xs text-primary font-semibold mt-0.5">{link.cta} →</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* State reference — keep as useful inline docs */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Content is served <strong className="text-foreground">live</strong>: an edit reaches
            every not-yet-started attempt. A student mid-attempt keeps the exact questions they
            started with.
          </p>
        </div>
        <div className="border-t border-border pt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          {(
            [
              ["DRAFT", "Work in progress."],
              ["ACTIVE", "Approved and assignable."],
              ["ARCHIVED", "Retired, preserved."],
            ] as const
          ).map(([state, note]) => (
            <div key={state} className="flex items-start gap-2">
              <StateTag state={state} size="xs" showIcon={false} className="shrink-0 mt-0.5" />
              <span className="text-[11px] text-muted-foreground leading-snug">{note}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
