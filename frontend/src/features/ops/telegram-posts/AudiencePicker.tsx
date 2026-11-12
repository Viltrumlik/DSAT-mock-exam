"use client";

import { Icon } from "@/components/ui/Icon";
import { LEVELS, SUBJECTS, draftChats, type AudienceDraft } from "./audience";
import { CheckRow, RadioPill } from "./telegramLook";
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
    <div className="flex flex-col gap-2.5">
      {allowSpecific ? (
        <div className="flex flex-wrap gap-2">
          <RadioPill checked={value.mode === "filter"} onChange={() => onChange({ ...value, mode: "filter" })}>
            By subject and level
          </RadioPill>
          <RadioPill checked={value.mode === "groups"} onChange={() => onChange({ ...value, mode: "groups" })}>
            Specific groups
          </RadioPill>
        </div>
      ) : null}

      {value.mode === "filter" ? (
        <div className="flex flex-col gap-1 rounded-ms-ctl border border-ms-border bg-ms-surface px-3.5 py-2">
          <div className="flex flex-wrap gap-x-5">
            {SUBJECTS.map((s) => (
              <CheckRow
                key={s.value}
                label={s.label}
                checked={value.subjects.length === 0 || value.subjects.includes(s.value)}
                onChange={() => onChange({ ...value, subjects: toggle(value.subjects, s.value, SUBJECT_VALUES) })}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-5 border-t border-ms-line pt-1">
            {LEVELS.map((l) => (
              <CheckRow
                key={l.value}
                label={l.label}
                checked={value.levels.length === 0 || value.levels.includes(l.value)}
                onChange={() => onChange({ ...value, levels: toggle(value.levels, l.value, LEVEL_VALUES) })}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex max-h-48 flex-col overflow-y-auto rounded-ms-ctl border border-ms-border bg-ms-surface px-3.5 py-1.5">
          {groups.map((g) => (
            <CheckRow
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

      <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ms-fg-2">
        <Icon name="ms-classpost" size="sm" className="text-ms-fg-3" />
        <span>
          Goes to <span className="tabular-nums">{count}</span> Telegram group{count === 1 ? "" : "s"}.
        </span>
      </p>
    </div>
  );
}
