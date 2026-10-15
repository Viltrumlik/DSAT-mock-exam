"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArrowRight,
  BookMarked,
  CheckCircle2,
  Database,
  FileText,
  GraduationCap,
  LayoutGrid,
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

// ─── Quick links ──────────────────────────────────────────────────────────────

type QuickLink = { href: string; icon: React.ElementType; title: string; cta: string };

/**
 * The same links, in the same groups, as the dashboard always had. "Question Bank" opens the
 * question bank: it pointed at `/builder/bank`, which the sidebar calls "Sets bank (legacy)".
 */
const QUICK_GROUPS: { caption: string | null; links: QuickLink[] }[] = [
  {
    caption: "Learning",
    links: [
      { href: "/builder/question-bank", icon: Database, title: "Question Bank", cta: "Browse" },
      { href: "/builder/sets", icon: LayoutGrid, title: "Assessments", cta: "Manage" },
      { href: "/builder/midterms", icon: GraduationCap, title: "Midterms", cta: "Manage" },
      { href: "/builder/vocabulary", icon: BookMarked, title: "Vocabulary", cta: "Manage" },
      { href: "/builder/categories", icon: Tag, title: "Categories", cta: "Edit" },
    ],
  },
  {
    caption: "Simulation",
    links: [{ href: "/builder/pastpapers", icon: FileText, title: "Past papers", cta: "Manage" }],
  },
  // Uncaptioned, as Archived sits on its own in the sidebar.
  { caption: null, links: [{ href: "/builder/archived", icon: Archive, title: "Archived", cta: "Review" }] },
];

const STATES = [
  ["DRAFT", "Work in progress."],
  ["ACTIVE", "Approved and assignable."],
  ["ARCHIVED", "Retired, preserved."],
] as const;

function QuickTile({ link }: { link: QuickLink }) {
  return (
    <Link
      href={link.href}
      className="group flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-primary/30 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-surface-2 text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
        <link.icon aria-hidden className="h-5 w-5" />
      </span>
      <span>
        <span className="block text-sm font-extrabold text-foreground">{link.title}</span>
        <span className="mt-0.5 block text-xs font-semibold text-primary">{link.cta} →</span>
      </span>
    </Link>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BuilderDashboardPage() {
  const [session, setSession] = useState<StudioSession | null>(null);

  useEffect(() => {
    setSession(readStudioSession());
  }, []);

  const continueHref = session ? sessionContinueHref(session) : null;
  const continueLabel = session ? sessionContinueLabel(session) : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Content health at a glance.</p>
      </div>

      {/* Session continuity — the last editor this browser had open. */}
      {continueHref && continueLabel ? (
        <Link
          href={continueHref}
          className="group flex items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 shadow-sm transition-colors hover:border-primary/30 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <PlayCircle aria-hidden className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-extrabold text-foreground">Continue working</span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{continueLabel}</span>
          </span>
          <ArrowRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
      ) : null}

      {/* Quick navigation — grouped by domain */}
      <div className="space-y-6">
        {QUICK_GROUPS.map((group) => (
          <section key={group.links[0].href} aria-label={group.caption ?? "Other"}>
            {group.caption ? (
              <h2 className="mb-3 px-0.5 text-[11px] font-black uppercase tracking-[0.15em] text-muted-foreground/70">
                {group.caption}
              </h2>
            ) : null}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {group.links.map((link) => (
                <QuickTile key={link.href} link={link} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* State reference — inline docs for the badges the lists show. */}
      <div className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-start gap-2.5">
          <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            Content is served <strong className="text-foreground">live</strong>: an edit reaches every not-yet-started
            attempt. A student mid-attempt keeps the exact questions they started with.
          </p>
        </div>
        <dl className="grid gap-x-6 gap-y-3 border-t border-border pt-4 sm:grid-cols-3">
          {STATES.map(([state, note]) => (
            <div key={state} className="flex items-center gap-2.5">
              <dt className="shrink-0">
                <StateTag state={state} size="xs" showIcon={false} />
              </dt>
              <dd className="text-xs leading-snug text-muted-foreground">{note}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
