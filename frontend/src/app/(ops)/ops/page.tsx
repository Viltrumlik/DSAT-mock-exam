"use client";

import Link from "next/link";
import {
  KeyRound,
  NotebookText,
  School,
  Timer,
  Users,
} from "lucide-react";

import { useMe } from "@/hooks/useMe";
import { isAdminOpsPath, isScopedOpsAdmin } from "@/features/ops/adminScope";

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
