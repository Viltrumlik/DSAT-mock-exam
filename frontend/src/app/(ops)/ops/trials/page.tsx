"use client";

import { Suspense } from "react";
import { Tabs, useTabParam } from "@/features/console/ui";
import { NotOnListPanel, TrialStudentsPanel } from "@/features/lcup/LcupPanels";
import { useLcupFollowups } from "@/features/lcup/lcupHooks";
import { TRIALS_TAB_IDS, TRIALS_TAB_LABEL, type TrialsTab } from "@/features/lcup/lcupTabs";

/**
 * Trials (owner, 2026-10-20): students on trial, and lc-up members no class list shows. The teacher
 * sends both kinds to the desk. While lc-up runs the desk activates or links them there, and they
 * leave these lists within one sync; once it is off the desk activates or removes them here.
 *
 * In the console's look (PR 12b): its header and the tabs in the address (`?tab=missing`), each with
 * its count.
 */

const TAB_IDS = TRIALS_TAB_IDS;

function TrialsPage() {
  const [tab, setTab] = useTabParam(TAB_IDS, "trials");
  const q = useLcupFollowups();
  const free = q.data?.free_trial_lessons ?? 1;
  return (
    <div className="flex flex-col gap-4">
      <header className="animate-ms-fade-in flex flex-col gap-1">
        <h1 className="text-ms-title text-ms-fg">Trials</h1>
        <p className="max-w-3xl text-[14px] text-ms-fg-2">
          {q.data?.seats_open ? (
            <>
              Students on trial. The free trial is {free} lesson{free === 1 ? "" : "s"}. Activate or remove them here.
            </>
          ) : (
            <>
              Students on trial in lc-up, and lc-up members their class list does not show. The free trial is {free} lesson
              {free === 1 ? "" : "s"}. Activate or link a student in lc-up — they leave this page within 15 minutes.
            </>
          )}
        </p>
      </header>
      <Tabs<TrialsTab>
        label="Trials sections"
        idPrefix="trials"
        value={tab}
        onChange={setTab}
        tree
        tabs={[
          { id: "trials", label: TRIALS_TAB_LABEL.trials, count: q.data ? q.data.trials.length : undefined },
          {
            id: "missing",
            label: TRIALS_TAB_LABEL.missing,
            count: q.data ? q.data.not_on_list.length : undefined,
            tone: q.data?.not_on_list.length ? "attention" : undefined,
          },
        ]}
      />
      <div role="tabpanel" id={`trials-${tab}-panel`} aria-labelledby={`trials-${tab}`} className="min-w-0">
        {tab === "trials" ? <TrialStudentsPanel /> : <NotOnListPanel />}
      </div>
    </div>
  );
}

export default function OpsTrialsPage() {
  // useSearchParams (the open tab) needs a Suspense boundary above it, or the production build's prerender fails.
  return (
    <Suspense fallback={null}>
      <TrialsPage />
    </Suspense>
  );
}
