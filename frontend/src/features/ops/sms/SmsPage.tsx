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

import { Tabs } from "@/features/console/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import { activeTab, panelId, tabId, type Tab } from "@/features/ops/detail/tabs";
import { useCan } from "@/features/ops/useCan";
import { BalanceBanner } from "./BalanceBanner";
import { CampaignsPanel } from "./CampaignsPanel";
import { DebtPanel } from "./DebtPanel";
import { JournalPanel } from "./JournalPanel";
import { OverviewPanel } from "./OverviewPanel";
import { useSmsOverview } from "./smsHooks";
import { SMS_TAB_LABEL, SMS_TAB_NEEDS, smsTabHref, type SmsTab } from "./smsTabs";
import { TemplatesPanel } from "./TemplatesPanel";

const TABS: Tab<SmsTab>[] = [
  { key: "overview", label: SMS_TAB_LABEL.overview, icon: Gauge },
  { key: "journal", label: SMS_TAB_LABEL.journal, icon: ScrollText },
  { key: "campaigns", label: SMS_TAB_LABEL.campaigns, icon: Send },
  { key: "debt", label: SMS_TAB_LABEL.debt, icon: BellRing },
  { key: "templates", label: SMS_TAB_LABEL.templates, icon: FileText },
];
const NEEDS = SMS_TAB_NEEDS;

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
  const can = useCan();
  const allowed = TABS.filter((t) => can(...NEEDS[t.key]));
  // The layout lets nobody here who holds neither; the fallback only keeps activeTab from an empty list.
  const tabs = allowed.length ? allowed : TABS.slice(0, 1);
  const tab = activeTab(new URLSearchParams(search.toString()), tabs);
  // The overview is one cached query: every tab reads it for the balance banner at no extra cost.
  const forecast = useSmsOverview().data?.forecast;

  return (
    <div className="space-y-4">
      <OpsPageHeader
        section="SMS"
        title="SMS"
        description="The eskiz account: balance, every SMS sent, campaigns, the automatic debt warning and the approved templates."
      />
      {forecast ? <BalanceBanner forecast={forecast} /> : null}
      <Tabs<SmsTab>
        label="SMS sections"
        value={tab}
        onChange={(key) => router.replace(smsTabHref(key), { scroll: false })}
        tree
        ids={{ tab: (key) => tabId("sms", key), panel: (key) => panelId("sms", key) }}
        tabs={tabs.map((t) => ({ id: t.key, label: t.label }))}
      />
      {/* key={tab}: a new tab mounts afresh, so it eases in (sms-rise; still under reduced motion). */}
      <div key={tab} className="sms-rise" role="tabpanel" id={panelId("sms", tab)} aria-labelledby={tabId("sms", tab)}>
        {tab === "overview" ? <OverviewPanel /> : null}
        {tab === "journal" ? <JournalPanel /> : null}
        {tab === "campaigns" ? <CampaignsPanel /> : null}
        {tab === "debt" ? <DebtPanel /> : null}
        {tab === "templates" ? <TemplatesPanel /> : null}
      </div>
    </div>
  );
}
