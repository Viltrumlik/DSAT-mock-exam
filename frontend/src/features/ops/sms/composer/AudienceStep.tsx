"use client";

import { useId, useState } from "react";
import { X } from "lucide-react";

import { Button, Checkbox, Field, Input, SegmentedControl } from "@/components/ui";
import { cn } from "@/lib/cn";
import { money, plural } from "../format";
import { CAPTION_TEXT, LoadError, TEXT_BUTTON } from "../panelKit";
import type { AudienceBody, AudienceFilter, AudienceKind, AudienceOption, AudienceStudent } from "../smsApi";
import { STUDENT_SEARCH_MIN, useAudienceClassrooms, useAudienceOptions, useAudienceStudents } from "../smsHooks";
import type { AudienceValue } from "./useComposerDraft";

/** The server's caps: `campaigns.LIMIT` and `campaigns.MAX_GROUPS`. */
export const CAMPAIGN_LIMIT = 300;
export const MAX_GROUPS = 50;

const KIND_LABEL: Record<AudienceKind, string> = {
  student: "Students",
  group: "Groups",
  filter: "Filter",
  debtors: "Debtors",
};

/** What the server is asked about; null until the audience is whole. */
export function audienceBody(value: AudienceValue): AudienceBody | null {
  const { audience, ids, filter, excluded } = value;
  const base: AudienceBody = { audience, audience_ids: [], excluded_user_ids: excluded };
  if (audience === "debtors") return base;
  if (audience === "filter") {
    return Object.values(filter).some((values) => values.length > 0) ? { ...base, audience_filter: filter } : null;
  }
  return ids.length > 0 ? { ...base, audience_ids: ids } : null;
}

function Chip({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-md border px-2 py-1 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        active ? "border-primary bg-primary-soft font-medium text-foreground" : "border-border text-muted-foreground hover:bg-surface-2",
      )}
    >
      {label} <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function StudentPicker({
  value,
  onChange,
  names,
}: {
  value: AudienceValue;
  onChange: (next: AudienceValue) => void;
  names?: Record<number, string>;
}) {
  const uid = useId();
  const [search, setSearch] = useState("");
  const [learned, setLearned] = useState<Record<number, string>>({});
  const students = useAudienceStudents(search);
  const hits = (students.data ?? []).filter((s) => !value.ids.includes(s.id));
  const nameOf = (id: number) => learned[id] ?? names?.[id] ?? `Student #${id}`;
  const full = value.ids.length >= CAMPAIGN_LIMIT;

  const add = (s: AudienceStudent) => {
    if (full) return;
    setLearned({ ...learned, [s.id]: s.name });
    onChange({ ...value, ids: [...value.ids, s.id] });
  };

  return (
    <div className="space-y-3">
      <Field
        label="Find a student"
        htmlFor={`${uid}-search`}
        hint={`Name, username or lc-up name — ${STUDENT_SEARCH_MIN} letters or more. Up to ${CAMPAIGN_LIMIT}.`}
      >
        <Input id={`${uid}-search`} inputSize="sm" value={search} onChange={(e) => setSearch(e.target.value)} />
      </Field>
      {hits.length > 0 ? (
        <ul className="divide-y divide-border border border-border text-[13px]">
          {hits.map((s) => (
            <li key={s.id} className="flex items-center gap-2 px-3 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{s.name}</p>
                <p className="truncate text-[12px] text-muted-foreground">
                  {[s.lcup_name, s.phone || "no phone", s.balance !== null ? money(s.balance) : ""].filter(Boolean).join(" · ")}
                </p>
              </div>
              <Button size="sm" variant="secondary" aria-label={`Add ${s.name}`} disabled={full} onClick={() => add(s)}>
                Add
              </Button>
            </li>
          ))}
        </ul>
      ) : search.trim().length >= STUDENT_SEARCH_MIN && students.data && !students.isFetching ? (
        <p className="text-[13px] text-muted-foreground">No linked student matches.</p>
      ) : null}
      {value.ids.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {value.ids.map((id) => (
            <li key={id} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[13px]">
              {nameOf(id)}
              <button
                type="button"
                aria-label={`Remove ${nameOf(id)}`}
                onClick={() => onChange({ ...value, ids: value.ids.filter((x) => x !== id) })}
                className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function GroupPicker({ value, onChange }: { value: AudienceValue; onChange: (next: AudienceValue) => void }) {
  const uid = useId();
  const classrooms = useAudienceClassrooms();
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const rows = classrooms.data ?? [];
  const shown = term ? rows.filter((c) => c.name.toLowerCase().includes(term)) : rows;
  const full = value.ids.length >= MAX_GROUPS;

  const toggle = (id: number) =>
    onChange({ ...value, ids: value.ids.includes(id) ? value.ids.filter((x) => x !== id) : [...value.ids, id] });
  const selectShown = () => {
    const more = shown.map((c) => c.id).filter((id) => !value.ids.includes(id));
    onChange({ ...value, ids: [...value.ids, ...more].slice(0, MAX_GROUPS) });
  };

  if (classrooms.isError) return <LoadError what="class list" onRetry={() => void classrooms.refetch()} />;

  return (
    <div className="space-y-2">
      <Field label="Find a class" htmlFor={`${uid}-search`} hint="Their active students; a student in two of them gets one SMS.">
        <Input id={`${uid}-search`} inputSize="sm" value={search} onChange={(e) => setSearch(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={TEXT_BUTTON} disabled={full} onClick={selectShown}>
          Select all shown
        </button>
        <button type="button" className={TEXT_BUTTON} disabled={value.ids.length === 0} onClick={() => onChange({ ...value, ids: [] })}>
          Clear
        </button>
        <span className="text-[12px] text-muted-foreground">
          {plural(value.ids.length, "class", "classes")} chosen{full ? ` · At most ${MAX_GROUPS} classes` : ""}
        </span>
      </div>
      <ul className="max-h-64 divide-y divide-border overflow-y-auto border border-border text-[13px]">
        {shown.map((c) => {
          const checked = value.ids.includes(c.id);
          return (
            <li key={c.id} className="px-3 py-1.5">
              <Checkbox
                id={`${uid}-class-${c.id}`}
                checked={checked}
                disabled={full && !checked}
                onChange={() => toggle(c.id)}
                label={`${c.name} · ${plural(c.students, "student")}, ${c.with_phone} with a phone`}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FilterPicker({ value, onChange }: { value: AudienceValue; onChange: (next: AudienceValue) => void }) {
  const options = useAudienceOptions();
  if (options.isError) return <LoadError what="filter options" onRetry={() => void options.refetch()} />;

  const toggle = (key: keyof AudienceFilter, option: string | number) => {
    const chosen = value.filter[key] as (string | number)[];
    const next = chosen.includes(option) ? chosen.filter((x) => x !== option) : [...chosen, option];
    onChange({ ...value, filter: { ...value.filter, [key]: next } });
  };
  const row = (key: keyof AudienceFilter, caption: string, rows: AudienceOption<string | number>[] | undefined) =>
    rows && rows.length > 0 ? (
      <div key={key}>
        <p className={`${CAPTION_TEXT} mb-1`}>{caption}</p>
        <div className="flex flex-wrap gap-1.5">
          {rows.map((o) => (
            <Chip
              key={String(o.value)}
              active={(value.filter[key] as (string | number)[]).includes(o.value)}
              label={o.label}
              count={o.classes}
              onClick={() => toggle(key, o.value)}
            />
          ))}
        </div>
      </div>
    ) : null;

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted-foreground">
        Students in the active classes that match. The number on each choice is how many classes have it.
      </p>
      {row("subjects", "Subject", options.data?.subjects)}
      {row("levels", "Level", options.data?.levels)}
      {row("branches", "Branch", options.data?.branches)}
      {row("days", "Lesson days", options.data?.days)}
    </div>
  );
}

/** Who gets it: some students, some classes, a subject/level/branch slice, or every debtor. */
export function AudienceStep({
  value,
  onChange,
  allowed,
  names,
}: {
  value: AudienceValue;
  onChange: (next: AudienceValue) => void;
  allowed: AudienceKind[];
  /** Names the composer already knows, for students it was handed by id. */
  names?: Record<number, string>;
}) {
  return (
    <div className="space-y-3">
      <SegmentedControl<AudienceKind>
        ariaLabel="Who gets it"
        size="sm"
        value={value.audience}
        // Another kind starts over: its ids mean something else, and nobody stays taken out unseen.
        onChange={(audience) => onChange({ ...value, audience, ids: [], excluded: [] })}
        options={allowed.map((kind) => ({ value: kind, label: KIND_LABEL[kind] }))}
      />
      {value.audience === "student" ? <StudentPicker value={value} onChange={onChange} names={names} /> : null}
      {value.audience === "group" ? <GroupPicker value={value} onChange={onChange} /> : null}
      {value.audience === "filter" ? <FilterPicker value={value} onChange={onChange} /> : null}
      {value.audience === "debtors" ? (
        <p className="text-[13px] text-muted-foreground">
          Every lc-up-linked learner who owes, frozen ones included — worked out when it sends.
        </p>
      ) : null}
    </div>
  );
}
