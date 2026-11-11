"use client";

import type { ReactNode } from "react";

import { AttendancePattern, BalanceRunway, BarChart, Illustration, ScoreTrend, ShareBars, type IllustrationName } from "@/features/console/graphics";
import { Avatar, Badge, Button, EmptyState, HeaderCard, StatTile, Tabs, Timeline, tashkentToday, type TimelineEvent } from "@/features/console/ui";

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 rounded-ms-card bg-ms-card p-6 shadow-ms-1">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-ms-title text-ms-fg">{title}</h3>
        {note ? <p className="text-[14px] text-ms-fg-3">{note}</p> : null}
      </div>
      {children}
    </div>
  );
}

const som = (n: number) => `${Math.round(n).toLocaleString("en-US").replace(/,/g, " ")}`;

const EVENTS: TimelineEvent[] = [
  { id: 1, kind: "security", icon: "ms-freeze", tone: "frozen", title: "Frozen for debt", meta: "Automatic · 5 Nov 2026, 09:00" },
  {
    id: 2,
    kind: "messages",
    icon: "ms-undelivered",
    tone: "critical",
    title: "Debt reminder SMS not delivered",
    meta: "No balance on Eskiz · 4 Nov, 12:15",
    action: <Button size="sm">Resend</Button>,
  },
  { id: 3, kind: "seat", icon: "switch", tone: "info", title: "Moved Middle M3 → Middle M5", meta: "by Dilnoza Karimova · 14 Oct" },
  {
    id: 4,
    kind: "money",
    icon: "ms-paid",
    tone: "positive",
    title: "750 000 so'm paid",
    meta: "Click · via lc-up · 1 Oct",
    aside: <Badge tone="positive" icon="check">Paid</Badge>,
  },
  { id: 5, kind: "security", icon: "key", tone: "neutral", title: "One-time password given", meta: "by Dilnoza Karimova · 12 Sep" },
];

const SMS_DAYS = ["28", "29", "30", "31", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map((d, i) => ({
  label: d,
  full: `${d} ${i < 4 ? "Oct" : "Nov"}`,
  href: "/ops/sms?tab=journal",
  values: [[22, 31, 18, 26, 34, 12, 0, 29, 33, 27, 24, 30, 19, 25][i], [1, 0, 2, 0, 1, 0, 0, 11, 1, 0, 2, 0, 1, 0][i]],
}));

const SPOTS: { name: IllustrationName; title: string; detail: string; where: string }[] = [
  { name: "chairs", title: "No students in this class yet", detail: "Add the first one, or move a student here from another class.", where: "empty · Classroom › Students" },
  { name: "sunrise", title: "All caught up", detail: "Nothing needs you right now. New trials, failed SMS and debts will show up here.", where: "done · Today, Review queue" },
  { name: "magnifier", title: "No one matches “Bekzot”", detail: "Search also works by phone or username. 2 filters are on.", where: "empty, filtered · any list" },
  { name: "unplugged", title: "Couldn’t load students", detail: "The list didn’t load — it is not empty. Nothing was changed.", where: "error · any data region" },
  { name: "laptop", title: "Open this editor on a computer", detail: "Editing a module needs a wider screen. You can still check its status here.", where: "phone · Builder editors" },
  { name: "plane", title: "Sent to 13 students", detail: "11 delivered so far. The rest show here as the operator reports back.", where: "done · SMS campaign, Telegram post" },
];

/**
 * The DataDisplay and Graphics boards (design handoff v0.3, PR 9b): stat tiles, the header card, the
 * timeline, a chart with its table, the four data graphics and the six spot illustrations. Synthetic data.
 */
export function DataSection() {
  const today = tashkentToday();
  return (
    <div className="flex flex-col gap-5">
      <Panel title="Stat tiles" note="A number, its label, its unit — and where it leads. Shown with loading and error.">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatTile label="Owe money" value={13} unit="students" sub="9 450 000 so'm in total" tone="critical" href="/ops/finance" />
          <StatTile label="Frozen for debt" icon="ms-freeze" value={3} unit="students" sub="1 exempt" tone="frozen" href="/ops/students?status=frozen_debt" />
          <StatTile label="Came today" value="38" unit="of 47" sub="4 absent · 5 not marked" href="/ops/classrooms" />
          <StatTile label="SMS balance" value={som(182400)} unit="so'm" sub="about 1 216 SMS" href="/ops/sms" />
          <StatTile label="Income, Nov" state="error" error="Couldn’t load from lc-up." onRetry={() => {}} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatTile label="Loading" state="loading" />
        </div>
      </Panel>

      <Panel title="Header card" note="Who, what state, what to do — before any tab. Did he come today? Does he owe?">
        <HeaderCard
          className="shadow-none ring-1 ring-ms-line"
          avatar={<Avatar name="Bekzod Jo'rayev" size="lg" frozen />}
          title="Bekzod Jo'rayev"
          badges={
            <>
              <Badge tone="neutral" icon="user">Student</Badge>
              <Badge tone="frozen" icon="snow">Frozen for debt</Badge>
              <Badge tone="line" icon="link">lc-up linked</Badge>
            </>
          }
          meta={["@st21.bekzod", "+998 90 123 45 67", "Parent: Rustam Jo'rayev · +998 93 555 13 07"]}
          actions={
            <>
              <Button variant="primary" icon="snow">Unfreeze</Button>
              <Button icon="key">One-time password</Button>
            </>
          }
          facts={[
            { label: "Today", value: "Came 15:02", sub: "Middle M5 · Math · lesson 15:00", tone: "positive" },
            { label: "Owes", value: "750 000", unit: "so'm", sub: "November unpaid · last paid 1 Oct", tone: "critical" },
            { label: "Attendance", value: "72 %", sub: "last 30 days · 2 classes" },
            { label: "Last seen", value: "1 h ago", sub: "iOS app 2.4.1 · joined 30 Jul 2026" },
          ]}
          notice={{
            tone: "frozen",
            icon: "ms-freeze",
            title: "Frozen for debt since 5 Nov.",
            body: "He can still come to lessons but cannot open homework or mocks. The freeze lifts when lc-up records the payment.",
          }}
        >
          <Tabs
            label="Student sections"
            idPrefix="hc-tab"
            value="overview"
            onChange={() => {}}
            tabs={[
              { id: "overview", label: "Overview" },
              { id: "groups", label: "Groups", count: 2 },
              { id: "payments", label: "Payments", count: 1, tone: "critical" },
              { id: "attendance", label: "Attendance" },
              { id: "results", label: "Results" },
              { id: "sms", label: "SMS" },
              { id: "security", label: "Security" },
              { id: "history", label: "History" },
            ]}
          />
        </HeaderCard>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Timeline" note="History, newest first.">
          <Timeline
            events={EVENTS}
            filters={[
              { id: "money", label: "Money" },
              { id: "seat", label: "Seat" },
              { id: "messages", label: "Messages" },
              { id: "security", label: "Security" },
            ]}
          />
        </Panel>
        <Panel title="Chart" note="Only where the shape is the answer. Every bar opens that day; “Table” shows the exact values.">
          <BarChart
            title="SMS by day"
            sub="last 14 days"
            series={[
              { label: "Delivered", tone: "primary" },
              { label: "Not delivered", tone: "critical" },
            ]}
            bars={SMS_DAYS}
            insight="4 Nov stands out: 11 debt reminders did not arrive."
            link={{ href: "/ops/sms?tab=journal", label: "See why" }}
          />
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Attendance pattern" note="A weekday that keeps being missed.">
          <AttendancePattern
            title="Bekzod, last 9 weeks"
            sub="Middle M5 · Mon Wed Fri"
            weeks={["15 Sep", "22 Sep", "29 Sep", "6 Oct", "13 Oct", "20 Oct", "27 Oct", "3 Nov", "10 Nov"]}
            rows={[
              { day: "Mon", marks: ["present", "present", "present", "late", "present", "present", "present", "present", "present"] },
              { day: "Wed", marks: ["present", "present", "excused", "present", "present", "late", "present", "present", "coming"] },
              { day: "Fri", marks: ["present", "absent", "present", "absent", "absent", "present", "absent", "absent", "coming"] },
            ]}
            link={{ href: "/ops/students", label: "Open attendance" }}
          />
        </Panel>
        <Panel title="Mock scores" note="A score climbing towards a target. Blue bands — no red for low scores.">
          <ScoreTrend
            title="Mock scores · Bekzod"
            sub="Target 1450 · set by the student"
            target={1450}
            points={[
              { label: "Jun", total: 1050 },
              { label: "Jul", total: 1120 },
              { label: "Aug", total: 1100 },
              { label: "Sep", total: 1190 },
              { label: "Oct", total: 1240 },
              { label: "Nov", total: 1290 },
            ]}
          />
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="A balance running out" note="Known balance solid, forecast dashed. With no history only the forecast is drawn.">
          <BalanceRunway
            title="SMS balance"
            sub="last 14 days · forecast dashed"
            balance={182400}
            perDay={22800}
            today={today}
            past={[340000, 330000, 326000, 322000, 290000, 286000, 282000, 278000, 274000, 255000, 251000, 247000, 205000, 182400]}
            format={(n) => `${som(n)} so'm`}
            action={<Button size="sm" variant="primary">Top up</Button>}
          />
        </Panel>
        <Panel title="Where debt sits" note="Bars plus the finding the numbers don't give.">
          <ShareBars
            format={som}
            rows={[
              { label: "Senior S4 · English", value: 2400000 },
              { label: "Middle M5 · Math", value: 2050000 },
              { label: "Foundation F3 · Math", value: 1300000 },
              { label: "Senior S2 · Math", value: 1100000 },
              { label: "Junior J6 · Math", value: 900000 },
              { label: "Junior J11 · English", value: 800000 },
              { label: "Middle M7 · Math", value: 500000 },
              { label: "Senior S1 · English", value: 400000 },
            ]}
          />
          <p className="text-[14px] font-semibold text-ms-fg">Two groups hold almost half the debt.</p>
        </Panel>
      </div>

      <Panel title="Spot illustrations" note="240 × 160, token colours only — they change with dark mode. One per screen, never in tables or dialogs.">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {SPOTS.map((s) => (
            <div key={s.name} className="flex flex-col items-center gap-1.5 rounded-[16px] bg-ms-surface p-5 text-center">
              <Illustration name={s.name} className="w-[200px]" />
              <b className="text-[15px] font-semibold text-ms-fg">{s.title}</b>
              <p className="text-[13.5px] text-ms-fg-2">{s.detail}</p>
              <span className="text-[12px] text-ms-fg-3">{s.where}</span>
            </div>
          ))}
        </div>
        <div className="rounded-[16px] ring-1 ring-ms-line">
          <EmptyState art="magnifier" title="No students match" detail="Try another search, or clear the filters." action={<Button size="sm">Clear filters</Button>} />
        </div>
      </Panel>
    </div>
  );
}
