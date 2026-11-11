"use client";

import { Suspense } from "react";
import { Tabs, useTabParam } from "@/features/console/ui";
import { AccountsPanel, ArchivePanel, AttendancePushesPanel, GroupsPanel, StatusPanel, StudentsPanel, TeachersPanel } from "@/features/lcup/LcupPanels";
import { useLcupStatus } from "@/features/lcup/lcupHooks";

/**
 * The lc-up link: the centre's CRM is the master for groups and who is in them, and our classes
 * follow it. This page is where an administrator settles what the sync could not decide alone —
 * which of our classes an lc-up group is, which account an lc-up student is — and watches the
 * sync itself. Accounts and classes are only created after the initial review is marked done.
 *
 * In the console's look (PR 12b): its header, the tabs in the address (`?tab=groups`) so the Status
 * tiles and a link land on a tab, and on each tab what waits in it, from the same status the Status
 * tab reads.
 */

type LcupTab = "status" | "groups" | "students" | "teachers" | "accounts" | "attendance" | "archive";
const TAB_IDS: readonly LcupTab[] = ["status", "groups", "students", "teachers", "accounts", "attendance", "archive"];
const LABEL: Record<LcupTab, string> = {
  status: "Status",
  groups: "Groups",
  students: "Students",
  teachers: "Teachers",
  accounts: "Accounts",
  attendance: "Attendance",
  archive: "Archive",
};

function LcupPage() {
  const [tab, setTab] = useTabParam(TAB_IDS, "status");
  const c = useLcupStatus().data?.counts;
  // Work to do is amber; claimed-or-not accounts are a plain count.
  const waiting: Partial<Record<LcupTab, { count: number; tone?: "attention" }>> = c
    ? {
        groups: { count: c.groups_pending, tone: "attention" },
        students: { count: c.needs_review_students + c.unmatched_students, tone: "attention" },
        teachers: { count: c.needs_review_teachers, tone: "attention" },
        accounts: { count: c.unclaimed_accounts },
      }
    : {};
  return (
    <div className="flex flex-col gap-4">
      <header className="animate-ms-fade-in flex flex-col gap-1">
        <h1 className="text-ms-title text-ms-fg">lc-up (CRM link)</h1>
        <p className="max-w-3xl text-[14px] text-ms-fg-2">
          Groups and their members follow the centre&apos;s CRM. Pair lc-up groups with our classes, link students and
          teachers the sync could not match, and keep an eye on each sync.
        </p>
      </header>
      <Tabs<LcupTab>
        label="lc-up sections"
        idPrefix="lcup"
        value={tab}
        onChange={setTab}
        tabs={TAB_IDS.map((id) => {
          const w = waiting[id];
          return { id, label: LABEL[id], count: w && w.count > 0 ? w.count : undefined, tone: w?.tone };
        })}
      />
      <div role="tabpanel" id={`lcup-${tab}-panel`} aria-labelledby={`lcup-${tab}`} className="min-w-0">
        {tab === "status" ? <StatusPanel /> : null}
        {tab === "groups" ? <GroupsPanel /> : null}
        {tab === "students" ? <StudentsPanel /> : null}
        {tab === "teachers" ? <TeachersPanel /> : null}
        {tab === "accounts" ? <AccountsPanel /> : null}
        {tab === "attendance" ? <AttendancePushesPanel /> : null}
        {tab === "archive" ? <ArchivePanel /> : null}
      </div>
    </div>
  );
}

export default function OpsLcupPage() {
  // useSearchParams (the open tab) needs a Suspense boundary above it, or the production build's prerender fails.
  return (
    <Suspense fallback={null}>
      <LcupPage />
    </Suspense>
  );
}
