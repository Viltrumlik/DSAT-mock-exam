"use client";

import { useState } from "react";
import { Tabs } from "@/components/ui";
import { NotOnListPanel, TrialStudentsPanel } from "@/features/lcup/LcupPanels";
import { useLcupFollowups } from "@/features/lcup/lcupHooks";

/**
 * Trials (owner, 2026-10-20): students lc-up holds on trial, and lc-up members no class list shows.
 * The teacher sends both kinds to the desk. The desk activates or links them in lc-up, and they
 * leave these lists within one sync. Nothing here writes.
 */
export default function OpsTrialsPage() {
  const [tab, setTab] = useState("trials");
  const q = useLcupFollowups();
  const free = q.data?.free_trial_lessons ?? 1;
  const tabs = [
    { value: "trials", label: q.data ? `Trial students (${q.data.trials.length})` : "Trial students" },
    { value: "missing", label: q.data ? `Not on class list (${q.data.not_on_list.length})` : "Not on class list" },
  ];
  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-lg font-semibold text-foreground">Trials</h1>
        <p className="text-[13px] text-muted-foreground">
          Students on trial in lc-up, and lc-up members their class list does not show. The free trial is {free} lesson
          {free === 1 ? "" : "s"}. Activate or link a student in lc-up — they leave this page within 15 minutes.
        </p>
      </header>
      <Tabs tabs={tabs} value={tab} onValueChange={setTab} aria-label="Trials sections" />
      {tab === "trials" ? <TrialStudentsPanel /> : <NotOnListPanel />}
    </div>
  );
}
