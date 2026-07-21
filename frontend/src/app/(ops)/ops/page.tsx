"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import api from "@/lib/api";
import {
  AlertOctagon,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  School,
  Timer,
  Users,
  Zap,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

// Admin/Ops is governance-only. Operational assignment monitoring (overdue work)
// lives in the Teacher Portal; the dashboard only surfaces governance signals.
type AttentionData = {
  scoring_failures: number;
};

// ─── Components ───────────────────────────────────────────────────────────────

function AttentionBanner({
  icon: Icon,
  count,
  label,
  description,
  href,
  severity,
}: {
  icon: React.ElementType;
  count: number;
  label: string;
  description: string;
  href: string;
  severity: "critical" | "warning" | "ok";
}) {
  const colors = {
    critical: {
      border: "border-red-200",
      bg: "bg-red-50 hover:bg-red-100/80",
      icon: "text-red-600 bg-red-100",
      badge: "bg-red-100 text-red-700",
      cta: "text-red-700",
    },
    warning: {
      border: "border-amber-200",
      bg: "bg-amber-50 hover:bg-amber-100/80",
      icon: "text-amber-600 bg-amber-100",
      badge: "bg-amber-100 text-amber-700",
      cta: "text-amber-700",
    },
    ok: {
      border: "border-emerald-200",
      bg: "bg-emerald-50",
      icon: "text-emerald-600 bg-emerald-100",
      badge: "bg-emerald-100 text-emerald-700",
      cta: "text-emerald-700",
    },
  }[severity];

  if (severity === "ok") {
    return (
      <div className={`flex items-center gap-3 rounded-2xl border ${colors.border} ${colors.bg} px-4 py-3`}>
        <div className={`shrink-0 rounded-xl p-2 ${colors.icon}`}>
          <Icon className="h-4 w-4" />
        </div>
        <p className="text-sm font-semibold text-emerald-800 flex-1">{description}</p>
        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
      </div>
    );
  }

  return (
    <Link
      href={href}
      className={`flex items-start gap-3 rounded-2xl border ${colors.border} ${colors.bg} px-4 py-3 transition-colors`}
    >
      <div className={`shrink-0 rounded-xl p-2 mt-0.5 ${colors.icon}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-black rounded-full px-2 py-0.5 tabular-nums ${colors.badge}`}>
            {count}
          </span>
          <span className="text-sm font-bold text-foreground">{label}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground leading-snug">{description}</p>
      </div>
      <ArrowRight className={`h-4 w-4 shrink-0 mt-1 ${colors.cta}`} />
    </Link>
  );
}

function SkeletonBanner() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 animate-pulse">
      <div className="h-8 w-8 rounded-xl bg-surface-2 shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-24 rounded bg-surface-2" />
        <div className="h-2.5 w-40 rounded bg-surface-2" />
      </div>
    </div>
  );
}

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
    href: "/ops/scoring-issues",
    icon: AlertOctagon,
    title: "Scoring",
    cta: "Review",
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsDashboardPage() {
  const [attention, setAttention] = useState<AttentionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get("/classes/ops/attention/");
        if (!cancelled) setAttention(r.data as AttentionData);
      } catch {
        // non-critical
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const scoringFailures = attention?.scoring_failures ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground tracking-tight">Operations</h1>
        <p className="text-muted-foreground mt-1">Governance and platform health.</p>
      </div>

      {/* Attention signals */}
      <div className="space-y-2.5">
        {loading ? (
          <SkeletonBanner />
        ) : (
          <AttentionBanner
            icon={Zap}
            count={scoringFailures}
            label={scoringFailures === 1 ? "scoring failure" : "scoring failures"}
            description={
              scoringFailures === 0
                ? "All assessments scored successfully."
                : `${scoringFailures} assessment${scoringFailures !== 1 ? "s" : ""} failed to score — review and retry.`
            }
            href="/ops/scoring-issues"
            severity={scoringFailures === 0 ? "ok" : scoringFailures >= 5 ? "critical" : "warning"}
          />
        )}
      </div>

      {/* Quick navigation */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Quick access
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {QUICK_LINKS.map((link) => (
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
