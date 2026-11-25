"use client";

import { useState } from "react";

import { TabPanel, Tabs } from "@/features/console/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";

import { MessagesPanel } from "./MessagesPanel";
import { PeoplePanel } from "./PeoplePanel";
import { RegisterPanel } from "./RegisterPanel";
import { StatusPanel } from "./StatusPanel";
import { TasksPanel } from "./TasksPanel";
import { TimeMachinePanel } from "./TimeMachinePanel";

type ToolboxTab = "time" | "people" | "register" | "tasks" | "messages" | "status";

const TABS: { id: ToolboxTab; label: string }[] = [
  { id: "time", label: "Time machine" },
  { id: "people", label: "People" },
  { id: "register", label: "Register" },
  { id: "tasks", label: "Run now" },
  { id: "messages", label: "Messages" },
  { id: "status", label: "Status" },
];

/**
 * /ops/toolbox — the test copy's tools (only there: NEXT_PUBLIC_STAGING_TOOLBOX=1, and the API answers 404 anywhere
 * else). Payments, freezes and group moves are not here on purpose: they are done in the console itself.
 * The time machine reloads the page when it is done, which lands back on its own tab.
 */
export function ToolboxPage() {
  const [tab, setTab] = useState<ToolboxTab>("time");
  return (
    <div className="flex flex-col gap-5">
      <OpsPageHeader
        section="Test copy"
        title="Toolbox"
        description="Move the copy's date, make test students, fill registers and read what the copy would have sent. Every action is logged."
      />
      <Tabs label="Toolbox sections" idPrefix="toolbox" tabs={TABS} value={tab} onChange={setTab} />
      <TabPanel idPrefix="toolbox" id={tab}>
        {tab === "time" ? <TimeMachinePanel /> : null}
        {tab === "people" ? <PeoplePanel /> : null}
        {tab === "register" ? <RegisterPanel /> : null}
        {tab === "tasks" ? <TasksPanel /> : null}
        {tab === "messages" ? <MessagesPanel /> : null}
        {tab === "status" ? <StatusPanel /> : null}
      </TabPanel>
    </div>
  );
}
