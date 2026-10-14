"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  BadgeCheck,
  Globe,
  GraduationCap,
  KeyRound,
  NotebookText,
  School,
  Timer,
} from "lucide-react";

import { useMe } from "@/hooks/useMe";
import { isAdminOpsPath, isScopedOpsAdmin } from "@/features/ops/adminScope";
import { usersAdminApi } from "@/lib/usersAdminApi";

// ─── Quick links ──────────────────────────────────────────────────────────────

const QUICK_LINKS = [
  { href: "/ops/students", icon: GraduationCap, title: "Students", cta: "Manage" },
  { href: "/ops/public", icon: Globe, title: "Public users", cta: "Manage" },
  { href: "/ops/staff", icon: BadgeCheck, title: "Staff", cta: "Manage" },
  { href: "/ops/classrooms", icon: School, title: "Classrooms", cta: "View" },
  { href: "/ops/midterms", icon: Timer, title: "Midterms", cta: "Report" },
  { href: "/ops/access", icon: KeyRound, title: "Access", cta: "Manage" },
  { href: "/ops/journals", icon: NotebookText, title: "Journals", cta: "Open" },
];

// ─── Learners ─────────────────────────────────────────────────────────────────

/**
 * Who the learners are now that they are two kinds (owner, 2026-10-13): the learning center's
 * students (from lc-up), public learners who signed up on the site, and the accounts frozen for
 * an lc-up debt. Each number opens its own list on exactly those people.
 *
 * A failed request says so and offers a retry. It never draws zeros: "0 public learners" is a
 * claim about the school, and a dropped connection is not entitled to make it.
 */
function LearnersCard() {
  const population = useQuery({ queryKey: ["users", "population"], queryFn: usersAdminApi.population });
  const p = population.data;

  const figures = p
    ? [
        { href: "/ops/students", label: "Learning center", value: p.centre },
        { href: "/ops/public", label: "Public", value: p.public },
        { href: "/ops/students?status=frozen_debt", label: "Frozen — debt", value: p.frozen_debt },
      ]
    : [];

  return (
    <section aria-labelledby="ops-learners" className="border border-border bg-card">
      <h2
        id="ops-learners"
        className="border-b border-border px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
      >
        Learners
      </h2>
      {population.isError ? (
        <p className="px-3 py-3 text-[13px] text-muted-foreground">
          The learner numbers didn&apos;t load.{" "}
          <button
            type="button"
            onClick={() => void population.refetch()}
            className="font-medium text-primary hover:underline dark:text-primary-hover"
          >
            Retry
          </button>
        </p>
      ) : !p ? (
        <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0" aria-busy>
          {[0, 1, 2].map((i) => (
            <div key={i} className="px-3 py-3">
              <div className="h-3 w-24 animate-pulse rounded-sm bg-surface-2" />
              <div className="mt-2 h-5 w-12 animate-pulse rounded-sm bg-surface-2" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {figures.map((f) => (
              <Link key={f.href} href={f.href} className="group block px-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                <span className="block text-[13px] text-primary group-hover:underline dark:text-primary-hover">{f.label}</span>
                <span className="mt-0.5 block text-xl font-semibold tabular-nums text-foreground">{f.value}</span>
              </Link>
            ))}
          </div>
          <div className="space-y-0.5 border-t border-border px-3 py-2 text-[13px] text-muted-foreground">
            <p>
              New sign-ups: <span className="font-semibold text-foreground tabular-nums">{p.signups_7d}</span> this week,{" "}
              <span className="font-semibold text-foreground tabular-nums">{p.signups_30d}</span> this month
            </p>
            <p>
              Joined the learning center: <span className="font-semibold text-foreground tabular-nums">{p.joined_30d}</span>
              {" · "}Left: <span className="font-semibold text-foreground tabular-nums">{p.left_30d}</span> (last 30 days)
            </p>
          </div>
        </>
      )}
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsDashboardPage() {
  const { me } = useMe();
  // An admin is not shown Midterms or Journals, so neither is a link that opens them.
  const links = isScopedOpsAdmin(me) ? QUICK_LINKS.filter((link) => isAdminOpsPath(link.href)) : QUICK_LINKS;

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Operations</h1>
        <p className="text-[13px] text-muted-foreground">Governance and platform health.</p>
      </div>

      <LearnersCard />

      <section aria-labelledby="ops-quick" className="border border-border bg-card">
        <h2
          id="ops-quick"
          className="border-b border-border px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
        >
          Quick access
        </h2>
        <ul className="divide-y divide-border">
          {links.map((link) => (
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
      </section>
    </div>
  );
}
