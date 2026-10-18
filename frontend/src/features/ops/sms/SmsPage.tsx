"use client";

/**
 * /ops/sms — everything the eskiz SMS account does, for super admins and admins (plan
 * 2026-10-18-sms-ops-panel.md): the balance and the account's health, a journal of every SMS,
 * campaigns to a student, a class or the debtors, the automatic debt warning's knobs, and the
 * eskiz templates. One page with five tabs; the open tab lives in `?tab=` so a link, a reload and
 * Back land on it, and the Overview is the bare address.
 *
 * Every SMS costs money and cannot be unsent, so every send in here asks first with the count
 * and the price.
 */

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BellRing, FileText, Gauge, ScrollText, Send } from "lucide-react";

import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import { TabBar, activeTab, panelId, tabId, type Tab } from "@/features/ops/detail/tabs";
import { CampaignsPanel } from "./CampaignsPanel";
import { DebtPanel } from "./DebtPanel";
import { JournalPanel } from "./JournalPanel";
import { OverviewPanel } from "./OverviewPanel";
import { smsTabHref, type SmsTab } from "./smsTabs";
import { TemplatesPanel } from "./TemplatesPanel";

const TABS: Tab<SmsTab>[] = [
  { key: "overview", label: "Overview", icon: Gauge },
  { key: "journal", label: "Journal", icon: ScrollText },
  { key: "campaigns", label: "Campaigns", icon: Send },
  { key: "debt", label: "Debt warnings", icon: BellRing },
  { key: "templates", label: "Templates", icon: FileText },
];

export function SmsPage() {
  // useSearchParams needs a Suspense boundary above it, or the production build's prerender fails.
  return (
    <Suspense fallback={null}>
      <SmsPageInner />
    </Suspense>
  );
}

function SmsPageInner() {
  const search = useSearchParams();
  const router = useRouter();
  const tab = activeTab(new URLSearchParams(search.toString()), TABS);

  return (
    <div className="space-y-4">
      <OpsPageHeader
        section="SMS"
        title="SMS"
        description="The eskiz account: balance, every SMS sent, campaigns, the automatic debt warning and the approved templates."
      />
      <TabBar
        scope="sms"
        label="SMS sections"
        tabs={TABS}
        active={tab}
        onSelect={(key) => router.replace(smsTabHref(key), { scroll: false })}
      />
      <div role="tabpanel" id={panelId("sms", tab)} aria-labelledby={tabId("sms", tab)}>
        {tab === "overview" ? <OverviewPanel /> : null}
        {tab === "journal" ? <JournalPanel /> : null}
        {tab === "campaigns" ? <CampaignsPanel /> : null}
        {tab === "debt" ? <DebtPanel /> : null}
        {tab === "templates" ? <TemplatesPanel /> : null}
      </div>
    </div>
  );
}
