"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Archive,
  BookMarked,
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
 * The same links, in the same groups, as before the console took the ops frame (2026-10-15).
 * "Question Bank" now opens the question bank: it pointed at `/builder/bank`, which the sidebar
 * has long called "Sets bank (legacy)".
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
  {
    // Uncaptioned, as Archived sits on its own in the sidebar.
    caption: null,
    links: [{ href: "/builder/archived", icon: Archive, title: "Archived", cta: "Review" }],
  },
];

const STATES = [
  ["DRAFT", "Work in progress."],
  ["ACTIVE", "Approved and assignable."],
  ["ARCHIVED", "Retired, preserved."],
] as const;

/** A Django-admin "module": a hairline box under a small uppercase caption, as on /ops. */
function Box({ id, caption, children }: { id: string; caption: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="border border-border bg-card">
      <h2
        id={id}
        className="border-b border-border px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
      >
        {caption}
      </h2>
      {children}
    </section>
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
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
        <p className="text-[13px] text-muted-foreground">Content health at a glance.</p>
      </div>

      {/* Session continuity — the last editor this browser had open. */}
      {continueHref && continueLabel ? (
        <Box id="builder-continue" caption="Continue working">
          <Link
            href={continueHref}
            className="group flex h-10 items-center gap-2.5 px-3 text-[13px] hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          >
            <PlayCircle aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate font-medium text-primary group-hover:underline dark:text-primary-hover">
              {continueLabel}
            </span>
            <span className="ml-auto shrink-0 text-muted-foreground">Open →</span>
          </Link>
        </Box>
      ) : null}

      <Box id="builder-quick" caption="Quick access">
        {QUICK_GROUPS.map((group) => (
          <div key={group.links[0].href} className="border-b border-border last:border-b-0">
            {group.caption ? (
              <p className="border-b border-border bg-surface-2/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {group.caption}
              </p>
            ) : null}
            <ul className="divide-y divide-border">
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="group flex h-9 items-center gap-2.5 px-3 text-[13px] hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                  >
                    <link.icon aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="font-medium text-primary group-hover:underline dark:text-primary-hover">{link.title}</span>
                    <span className="ml-auto text-muted-foreground">{link.cta} →</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Box>

      {/* State reference — inline docs for the badges the lists show. */}
      <Box id="builder-states" caption="Content states">
        <p className="px-3 py-2 text-[13px] text-muted-foreground">
          Content is served <strong className="font-semibold text-foreground">live</strong>: an edit reaches every
          not-yet-started attempt. A student mid-attempt keeps the exact questions they started with.
        </p>
        <dl className="grid divide-y divide-border border-t border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {STATES.map(([state, note]) => (
            <div key={state} className="flex items-center gap-2 px-3 py-2">
              <dt className="shrink-0">
                <StateTag state={state} size="xs" showIcon={false} />
              </dt>
              <dd className="text-[13px] text-muted-foreground">{note}</dd>
            </div>
          ))}
        </dl>
      </Box>
    </div>
  );
}
