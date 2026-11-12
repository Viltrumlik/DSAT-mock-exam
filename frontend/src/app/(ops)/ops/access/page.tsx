"use client";

/**
 * /ops/access — Centralized access management console.
 *
 * Front-end for the access engine (ResourceAccessGrant). Four tabs:
 *   - Grant access: a Recipients → Tests → Confirm wizard (individual/bulk/classroom).
 *   - By user / By resource: focused views.
 *   - Manage grants: search, filter, revoke, extend, audit history.
 *
 * Backed by /api/access/* (see backend access.views engine API). In the console's look (design handoff
 * v0.3): its header and underline tabs. The words, the calls and the tab staying in the page (not the
 * address) are the page's own.
 */

import { useState } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { GrantPanel } from "@/components/access/GrantPanel";
import { GrantsManager } from "@/components/access/GrantsManager";
import { UserAccessProfile } from "@/components/access/UserAccessProfile";
import { ResourceAccessViewer } from "@/components/access/ResourceAccessViewer";
import { Tabs } from "@/features/console/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";

type Tab = "grant" | "by_user" | "by_resource" | "manage";

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: "grant", label: "Grant access", icon: "key" },
  { key: "by_user", label: "By user", icon: "user" },
  { key: "by_resource", label: "By resource", icon: "bookmark" },
  { key: "manage", label: "Manage grants", icon: "clipboard" },
];

export default function OpsAccessPage() {
  const [tab, setTab] = useState<Tab>("grant");
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <div className="flex flex-col gap-5">
      <OpsPageHeader
        section="Access"
        title="Access management"
        description="Grant and manage access to past papers, mock exams, practice tests, and assessments — by student, by resource, in bulk, or per classroom."
      />

      <Tabs<Tab>
        label="Access management"
        idPrefix="access"
        value={tab}
        onChange={setTab}
        tabs={TABS.map((t) => ({
          id: t.key,
          label: (
            <>
              <Icon name={t.icon} size="sm" />
              {t.label}
            </>
          ),
        }))}
      />

      <div role="tabpanel" id={`access-${tab}-panel`} aria-labelledby={`access-${tab}`} className="min-w-0">
        {tab === "grant" && <GrantPanel onSuccess={bump} />}
        {tab === "by_user" && <UserAccessProfile onChanged={bump} />}
        {tab === "by_resource" && <ResourceAccessViewer onChanged={bump} />}
        {tab === "manage" && <GrantsManager refreshKey={refreshKey} />}
      </div>
    </div>
  );
}
