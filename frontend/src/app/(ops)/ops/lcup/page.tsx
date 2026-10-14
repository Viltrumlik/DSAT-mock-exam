"use client";

import { useState } from "react";
import { Tabs } from "@/components/ui";
import { AccountsPanel, AttendancePushesPanel, GroupsPanel, StatusPanel, StudentsPanel, TeachersPanel } from "@/features/lcup/LcupPanels";

/**
 * The lc-up link: the centre's CRM is the master for groups and who is in them, and our classes
 * follow it. This page is where an administrator settles what the sync could not decide alone —
 * which of our classes an lc-up group is, which account an lc-up student is — and watches the
 * sync itself. Accounts and classes are only created after the initial review is marked done.
 */

const TABS = [
  { value: "status", label: "Status" },
  { value: "groups", label: "Groups" },
  { value: "students", label: "Students" },
  { value: "teachers", label: "Teachers" },
  { value: "accounts", label: "Accounts" },
  { value: "attendance", label: "Attendance" },
];

export default function OpsLcupPage() {
  const [tab, setTab] = useState("status");
  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-lg font-semibold text-foreground">lc-up</h1>
        <p className="text-[13px] text-muted-foreground">
          Groups and their members follow the centre&apos;s CRM. Pair lc-up groups with our classes, link students and
          teachers the sync could not match, and keep an eye on each sync.
        </p>
      </header>
      <Tabs tabs={TABS} value={tab} onValueChange={setTab} aria-label="lc-up sections" />
      {tab === "status" ? <StatusPanel /> : null}
      {tab === "groups" ? <GroupsPanel /> : null}
      {tab === "students" ? <StudentsPanel /> : null}
      {tab === "teachers" ? <TeachersPanel /> : null}
      {tab === "accounts" ? <AccountsPanel /> : null}
      {tab === "attendance" ? <AttendancePushesPanel /> : null}
    </div>
  );
}
