"use client";

/**
 * /ops/access — Centralized access management console (MasterSAT Access redesign).
 *
 * Front-end for the access engine (ResourceAccessGrant). Four tabs:
 *   - Grant access: a Recipients → Tests → Confirm wizard (individual/bulk/classroom).
 *   - By user / By resource: focused views.
 *   - Manage grants: search, filter, revoke, extend, audit history.
 *
 * Backed by /api/access/* (see backend access.views engine API). Functionality is
 * unchanged from the previous console — this is a visual redesign only.
 */

import { useState } from "react";
import { BookMarked, KeyRound, ListChecks, UserCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { GrantPanel } from "@/components/access/GrantPanel";
import { GrantsManager } from "@/components/access/GrantsManager";
import { UserAccessProfile } from "@/components/access/UserAccessProfile";
import { ResourceAccessViewer } from "@/components/access/ResourceAccessViewer";
import { accClass, Watermark } from "@/components/access/accessUi";
import { jakarta, playfair } from "@/components/access/fonts";

type Tab = "grant" | "by_user" | "by_resource" | "manage";

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "grant", label: "Grant access", icon: KeyRound },
  { key: "by_user", label: "By user", icon: UserCheck },
  { key: "by_resource", label: "By resource", icon: BookMarked },
  { key: "manage", label: "Manage grants", icon: ListChecks },
];

export default function OpsAccessPage() {
  const [tab, setTab] = useState<Tab>("grant");
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <div className={cn(playfair.variable, jakarta.variable, accClass.scope, "relative space-y-6")}>
      <Watermark />

      {/* Header */}
      <div className="relative z-[1]">
        <p className={accClass.eyebrow + " text-primary"}>Admin console · Access</p>
        <h1 className={cn(accClass.serif, "mt-1.5 text-[34px] font-extrabold leading-tight")}>Access management</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Grant and manage access to past papers, mock exams, practice tests, and assessments —
          by student, by resource, in bulk, or per classroom.
        </p>
      </div>

      {/* Tab bar — segmented control */}
      <div className="relative z-[1] inline-flex flex-wrap gap-1.5 rounded-2xl border border-border bg-card p-1.5">
        {TABS.map((t) => {
          const active = tab === t.key;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-[background,color,box-shadow] duration-150",
                active
                  ? "bg-primary text-primary-foreground shadow-[0_6px_16px_-10px_rgba(42,104,192,0.8)]"
                  : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="relative z-[1]">
        {tab === "grant" && <GrantPanel onSuccess={bump} />}
        {tab === "by_user" && <UserAccessProfile onChanged={bump} />}
        {tab === "by_resource" && <ResourceAccessViewer onChanged={bump} />}
        {tab === "manage" && <GrantsManager refreshKey={refreshKey} />}
      </div>
    </div>
  );
}
