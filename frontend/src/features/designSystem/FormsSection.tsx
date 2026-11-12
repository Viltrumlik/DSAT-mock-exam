"use client";

import { useState, type ReactNode } from "react";

import {
  Avatar,
  AvatarStack,
  Combobox,
  DateField,
  Field,
  Kbd,
  MoneyInput,
  PeriodPicker,
  RadioGroup,
  Segmented,
  Select,
  Shortcut,
  Switch,
  Tabs,
  TextArea,
  TextInput,
  TimeField,
  periodRange,
  tashkentToday,
  type ListOption,
  type Period,
} from "@/features/console/ui";

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
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

const ROLES: ListOption<"student" | "teacher" | "admin">[] = [
  { value: "student", label: "Student" },
  { value: "teacher", label: "Teacher" },
  { value: "admin", label: "Desk admin", disabledReason: "Only a super admin can make a desk admin" },
];
const LEVELS: ListOption[] = [
  { value: "foundation", label: "Foundation" },
  { value: "junior", label: "Junior" },
  { value: "middle", label: "Middle" },
  { value: "senior", label: "Senior" },
  { value: "none", label: "No level" },
];
const CLASSES: (ListOption & { seats: number })[] = [
  { value: "m3", label: "Middle M3 · English · Kamola", sub: "Tue Thu Sat 16:00 · 14 seats", seats: 14 },
  { value: "m7", label: "Middle M7 · Math", sub: "No teacher yet", meta: "Run by lc-up", seats: 13 },
  { value: "m5", label: "Middle M5 · Math · Muxlisa", disabledReason: "Add seats in lc-up — this class is synced", seats: 16 },
  { value: "j6", label: "Junior J6 · Math", sub: "Mon Wed Fri 14:00 · 11 seats", seats: 11 },
  { value: "s2", label: "Senior S2 · Math", sub: "Tue Thu Sat 18:00 · 9 seats", seats: 9 },
];
const SMS = "MASTER SAT: Shohruh Jo'rayev, sizda 750 000 so'm qarzdorlik mavjud. To'lovni 15-noyabrgacha amalga oshiring.";

/**
 * The Controls board's forms (design handoff v0.3, PR 9a): text fields in every state, select and
 * combobox, date and time, choices, tabs with counts, avatars and keys. Samples only; nothing here saves.
 */
export function FormsSection() {
  const today = tashkentToday();
  const [amount, setAmount] = useState<number | null>(1250000);
  const [sms, setSms] = useState(SMS);
  const [role, setRole] = useState<"student" | "teacher" | "admin">("student");
  const [level, setLevel] = useState<string>("middle");
  const [addTo, setAddTo] = useState<string | null>(null);
  const [sendTo, setSendTo] = useState<string[]>(["m3", "j6"]);
  const [date, setDate] = useState<string | null>(today);
  const [time, setTime] = useState("16:00");
  const [timeError, setTimeError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>({ kind: "30d", ...periodRange("30d", today) });
  const [status, setStatus] = useState<"trial" | "active" | "left">("trial");
  const [warn, setWarn] = useState(true);
  const [archived, setArchived] = useState(false);
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const [subject, setSubject] = useState<"all" | "rw" | "math">("all");
  const [tab, setTab] = useState<string>("groups");

  return (
    <div className="flex flex-col gap-5">
      <Group title="Text fields" note="Label above, help below, the error says how to fix it.">
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="First name" help="As on their passport.">
            <TextInput placeholder="e.g. Shohruh" />
          </Field>
          <Field label="Last name">
            <TextInput defaultValue="Jo'rayev" />
          </Field>
          <Field label="Phone" error="Enter 9 digits after +998 — 2 are missing.">
            <TextInput prefix="+998" defaultValue="90 153 85" inputMode="tel" />
          </Field>
          <Field label="Username" help="Set by lc-up. Change it there.">
            <TextInput defaultValue="st13.sardor" disabled />
          </Field>
          <Field label="Created">
            <TextInput defaultValue="30 Jul 2026, 14:02" readOnly />
          </Field>
          <Field label="Amount" help="Groups digits as you type.">
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
          <Field label="Search students" optional>
            <TextInput pill icon="search" placeholder="Name, phone or username" suffix={<Kbd>/</Kbd>} />
          </Field>
          <Field label="Ticket code" help="Door check-in: big, monospaced, scanner-friendly.">
            <TextInput mono defaultValue="9HTR4WQM" />
          </Field>
          <Field
            label="SMS text"
            help="Use {STUDENT}, {AMOUNT}, {DATE} — filled per person."
            counter={`${sms.length} / 160 · ${Math.max(1, Math.ceil(sms.length / 160))} SMS each`}
          >
            <TextArea value={sms} onChange={(e) => setSms(e.target.value)} rows={3} />
          </Field>
        </div>
      </Group>

      <Group title="Select · combobox · date and time" note="Pick from a list, type to narrow it. Days are Tashkent days.">
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="Role">
            <Select value={role} onChange={setRole} options={ROLES} />
          </Field>
          <Field label="Level">
            <Select value={level} onChange={setLevel} options={LEVELS} />
          </Field>
          <Field label="Add to class" help="Type a class, a teacher or a day.">
            <Combobox noun="class" heading="Classes you can add to" options={CLASSES} value={addTo} onChange={setAddTo} placeholder="Find a class" />
          </Field>
          <Field label="Send to">
            <Combobox
              multiple
              noun="class"
              options={CLASSES}
              value={sendTo}
              onChange={setSendTo}
              placeholder="Add class…"
              onCreate={() => {}}
              summary={(p) => {
                const seats = p.reduce((s, o) => s + (CLASSES.find((c) => c.value === o.value)?.seats ?? 0), 0);
                return `${p.length} ${p.length === 1 ? "class" : "classes"} · ${seats} students`;
              }}
            />
          </Field>
          <Field label="Lesson date">
            <DateField value={date} onChange={setDate} />
          </Field>
          <Field label="Time" help="24-hour, Tashkent." error={timeError}>
            <TimeField
              value={time}
              onChange={(t) => {
                setTime(t);
                setTimeError(null);
              }}
              onInvalid={(raw) => setTimeError(`“${raw}” is not a time — type it as 16:00.`)}
            />
          </Field>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[14px] font-medium text-ms-fg">Period</span>
          <PeriodPicker value={period} onChange={setPeriod} />
          <span className="text-[13px] tabular-nums text-ms-fg-3">
            {period.from} → {period.to}
          </span>
        </div>
      </Group>

      <Group title="Choice" note="Radio, switch, segmented. A switch takes effect at once.">
        <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
          <RadioGroup
            legend="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "trial", label: "Trial", description: "No money yet" },
              { value: "active", label: "Active", description: "Pays from the date" },
              { value: "left", label: "Left", disabledReason: "Only lc-up can mark a student as left" },
            ]}
          />
          <div className="flex flex-col gap-1">
            <Switch label="Debt warning SMS" help="Sends on the 5th to everyone who owes." checked={warn} onChange={setWarn} />
            <Switch label="Show archived" checked={archived} onChange={setArchived} />
            <Switch label="lc-up sync" disabledReason="Super admin only" checked onChange={() => {}} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented label="Density" value={density} onChange={setDensity} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />
          <Segmented label="Theme" value={theme} onChange={setTheme} options={[{ value: "light", label: "Light", icon: "sun" }, { value: "dark", label: "Dark", icon: "moon" }, { value: "system", label: "System", icon: "monitor" }]} />
          <Segmented label="Subject" value={subject} onChange={setSubject} options={[{ value: "all", label: "All" }, { value: "rw", label: "R&W" }, { value: "math", label: "Math" }]} />
        </div>
      </Group>

      <Group title="Tabs" note="Kept in the address as ?tab= on real pages. A count only when it carries a verdict or a number worth knowing.">
        <Tabs
          label="Student sections"
          value={tab}
          onChange={setTab}
          idPrefix="demo-tab"
          tabs={[
            { id: "overview", label: "Overview" },
            { id: "groups", label: "Groups", count: 3 },
            { id: "payments", label: "Payments", count: 2, tone: "critical" },
            { id: "attendance", label: "Attendance", count: "72 %", tone: "attention" },
            { id: "results", label: "Results" },
            { id: "sms", label: "SMS", count: 1 },
            { id: "security", label: "Security" },
            { id: "history", label: "History" },
            { id: "telegram", label: "Telegram", disabled: true },
          ]}
        />
      </Group>

      <Group title="Avatars · keys" note="Initials from first + last name (Uzbek oʻ, gʻ kept), colour from the name — never from status.">
        <div className="flex flex-wrap items-center gap-3">
          {["Sardor Qodirov", "Gulnoza Mirzayeva", "Bekzod Jo'rayev", "Shohruh Jo'rayev", "Nodira Ergasheva", "Dilnoza Karimova", "Muxlisa Rahimova", "Oʻtkir Gʻaniyev"].map((n) => (
            <Avatar key={n} name={n} />
          ))}
          <AvatarStack names={["Kamola Karimova", "Doston Saidov", "Laylo Saidova", "Islom Nazarov", "Sardor Qodirov", "Gulnoza Mirzayeva", "Bekzod Jo'rayev"]} />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <Avatar name="Bekzod Jo'rayev" size="sm" />
          <Avatar name="Bekzod Jo'rayev" />
          <Avatar name="Bekzod Jo'rayev" size="lg" frozen />
          <Avatar name="Bekzod Jo'rayev" size="xl" ring="new" />
          <Avatar name="Laylo Saidova" size="lg" ring="seen" />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[14px] text-ms-fg-2">
          <span className="inline-flex items-center gap-1.5"><Shortcut keys={["mod", "K"]} /> search</span>
          <span className="inline-flex items-center gap-1.5"><Kbd>?</Kbd> shortcuts</span>
          <span className="inline-flex items-center gap-1.5"><Kbd>Esc</Kbd> close</span>
          <span className="inline-flex items-center gap-1.5"><Kbd>↵</Kbd> open</span>
          <span className="inline-flex items-center gap-1.5"><Shortcut keys={["J", "K"]} /> move</span>
          <span className="inline-flex items-center gap-1.5"><Kbd>X</Kbd> tick</span>
          <span className="inline-flex items-center gap-1.5"><Kbd>/</Kbd> search the list</span>
        </div>
      </Group>
    </div>
  );
}
