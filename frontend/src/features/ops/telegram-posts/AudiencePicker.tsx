"use client";

import { Checkbox } from "@/components/ui";
import { LEVELS, SUBJECTS, draftChats, type AudienceDraft } from "./audience";
import type { TelegramGroup } from "./telegramPostsApi";

/**
 * Toggle one value in an "empty means all" list. Unticking the last one is refused, not
 * turned into an empty list, because an empty list reads back as "all" again.
 */
function toggle(list: string[], value: string, all: readonly string[]): string[] {
  const current = list.length === 0 ? [...all] : list;
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  if (next.length === 0) return list;
  return next.length === all.length ? [] : next;
}

const SUBJECT_VALUES = SUBJECTS.map((s) => s.value);
const LEVEL_VALUES = LEVELS.map((l) => l.value);

export function AudiencePicker({
  groups,
  value,
  onChange,
  allowSpecific = true,
}: {
  groups: TelegramGroup[];
  value: AudienceDraft;
  onChange: (next: AudienceDraft) => void;
  /** Events store subjects × levels only, so their form hides the specific-groups half. */
  allowSpecific?: boolean;
}) {
  const count = draftChats(groups, value).length;
  const ids = value.classroom_ids ?? [];

  return (
    <div className="space-y-2">
      {allowSpecific ? (
        <div className="flex flex-wrap gap-4 text-sm font-semibold">
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" checked={value.mode === "filter"} onChange={() => onChange({ ...value, mode: "filter" })} />
            By subject and level
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" checked={value.mode === "groups"} onChange={() => onChange({ ...value, mode: "groups" })} />
            Specific groups
          </label>
        </div>
      ) : null}

      {value.mode === "filter" ? (
        <>
          <div className="flex flex-wrap gap-4">
            {SUBJECTS.map((s) => (
              <Checkbox
                key={s.value}
                label={s.label}
                checked={value.subjects.length === 0 || value.subjects.includes(s.value)}
                onChange={() => onChange({ ...value, subjects: toggle(value.subjects, s.value, SUBJECT_VALUES) })}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-4">
            {LEVELS.map((l) => (
              <Checkbox
                key={l.value}
                label={l.label}
                checked={value.levels.length === 0 || value.levels.includes(l.value)}
                onChange={() => onChange({ ...value, levels: toggle(value.levels, l.value, LEVEL_VALUES) })}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
          {groups.map((g) => (
            <Checkbox
              key={g.id}
              label={g.name}
              checked={ids.includes(g.id)}
              onChange={() =>
                onChange({ ...value, classroom_ids: ids.includes(g.id) ? ids.filter((i) => i !== g.id) : [...ids, g.id] })
              }
            />
          ))}
        </div>
      )}

      <p className="text-xs font-semibold text-muted-foreground">
        Goes to {count} Telegram group{count === 1 ? "" : "s"}.
      </p>
    </div>
  );
}
