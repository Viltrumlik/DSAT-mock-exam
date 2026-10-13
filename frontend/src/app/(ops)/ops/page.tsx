"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  KeyRound,
  NotebookText,
  School,
  Timer,
  Users,
} from "lucide-react";

import { useMe } from "@/hooks/useMe";
import { isAdminOpsPath, isScopedOpsAdmin } from "@/features/ops/adminScope";
import { usersAdminApi } from "@/lib/usersAdminApi";

// ─── Quick links ──────────────────────────────────────────────────────────────

const QUICK_LINKS = [
  {
    href: "/ops/classrooms",
    icon: School,
    title: "Classrooms",
    cta: "View",
  },
  {
    href: "/ops/midterms",
    icon: Timer,
    title: "Midterms",
    cta: "Report",
  },
  {
    href: "/ops/access",
    icon: KeyRound,
    title: "Access",
    cta: "Manage",
  },
  {
    href: "/ops/users",
    icon: Users,
    title: "Users",
    cta: "Manage",
  },
  {
    href: "/ops/journals",
    icon: NotebookText,
    title: "Journals",
    cta: "Open",
  },
];

// ─── Learners ─────────────────────────────────────────────────────────────────

/**
 * Who the learners are now that they are two kinds (owner, 2026-10-13): the learning center's
 * students (from lc-up), public learners who signed up on the site, and the accounts frozen for
 * an lc-up debt. Each number opens the users list on exactly those people.
 *
 * A failed request says so and offers a retry. It never draws zeros: "0 public learners" is a
 * claim about the school, and a dropped connection is not entitled to make it.
 */
function LearnersCard() {
  const population = useQuery({ queryKey: ["users", "population"], queryFn: usersAdminApi.population });
  const p = population.data;

  const tiles = p
    ? [
        { kind: "centre", label: "Learning center", value: p.centre },
        { kind: "public", label: "Public", value: p.public },
        { kind: "frozen_debt", label: "Frozen — debt", value: p.frozen_debt },
      ]
    : [];

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border bg-surface-2 px-5 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Learners</p>
      </div>
      <div className="p-5">
        {population.isError ? (
          <p className="text-sm text-muted-foreground">
            The learner numbers didn&apos;t load.{" "}
            <button
              type="button"
              onClick={() => void population.refetch()}
              className="font-bold text-primary underline hover:no-underline"
            >
              Retry
            </button>
          </p>
        ) : !p ? (
          <div className="grid gap-2 sm:grid-cols-3" aria-busy>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[72px] animate-pulse rounded-xl bg-surface-2" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              {tiles.map((t) => (
                <Link
                  key={t.kind}
                  href={`/ops/users?kind=${t.kind}`}
                  className="group rounded-xl border border-border p-4 transition-colors hover:border-primary/30 hover:bg-primary/5"
                >
                  <p className="text-xs font-semibold text-muted-foreground">{t.label}</p>
                  <p className="mt-1 text-2xl font-extrabold tabular-nums text-foreground">{t.value}</p>
                </Link>
              ))}
            </div>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>
                New sign-ups: <span className="font-bold text-foreground tabular-nums">{p.signups_7d}</span> this week,{" "}
                <span className="font-bold text-foreground tabular-nums">{p.signups_30d}</span> this month
              </p>
              <p>
                Joined the learning center: <span className="font-bold text-foreground tabular-nums">{p.joined_30d}</span>
                {" · "}Left: <span className="font-bold text-foreground tabular-nums">{p.left_30d}</span> (last 30 days)
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsDashboardPage() {
  const { me } = useMe();
  // An admin is not shown Midterms or Journals, so neither is a tile that opens them.
  const links = isScopedOpsAdmin(me) ? QUICK_LINKS.filter((link) => isAdminOpsPath(link.href)) : QUICK_LINKS;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground tracking-tight">Operations</h1>
        <p className="text-muted-foreground mt-1">Governance and platform health.</p>
      </div>

      <LearnersCard />

      {/* Quick navigation */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Quick access
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
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
    </div>
  );
}
