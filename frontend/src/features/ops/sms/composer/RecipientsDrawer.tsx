"use client";

import { useId, useState } from "react";

import { Drawer, Field, Input } from "../consoleKit";
import { CAPTION_TEXT, TEXT_BUTTON } from "../panelKit";
import type { PreviewRecipient, SkippedPerson } from "../smsApi";

/**
 * Who gets it, as the last preview worked it out, with a way to take someone out. A person leaves
 * the list at once; the figures catch up with the next preview.
 */
export function RecipientsDrawer({
  open,
  onClose,
  recipients,
  taken,
  excluded,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  recipients: PreviewRecipient[];
  /** People the last preview skipped as taken out: where their names come from. */
  taken: SkippedPerson[];
  excluded: number[];
  onChange: (excluded: number[]) => void;
}) {
  const uid = useId();
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const out = new Set(excluded);
  const names = new Map<number, string>([
    ...taken.map((p): [number, string] => [p.user_id, p.name]),
    ...recipients.map((r): [number, string] => [r.user_id, r.name]),
  ]);
  const rows = recipients.filter((r) => !out.has(r.user_id) && (!term || r.name.toLowerCase().includes(term)));

  return (
    <Drawer open={open} onClose={onClose} title={`Who gets it · ${recipients.length - recipients.filter((r) => out.has(r.user_id)).length}`} width={420}>
      <div className="space-y-3">
        <Field label="Find a person" htmlFor={`${uid}-search`}>
          <Input id={`${uid}-search`} inputSize="sm" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        <ul className="divide-y divide-ms-line border border-ms-border text-[13px]">
          {rows.map((r) => (
            <li key={r.user_id} className="flex items-center gap-2 px-3 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ms-fg">{r.name}</p>
                <p className="truncate text-[12px] text-ms-fg-3">
                  {[r.phone, r.groups.join(", ")].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Remove ${r.name}`}
                className={TEXT_BUTTON}
                onClick={() => onChange([...excluded, r.user_id])}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        {excluded.length > 0 ? (
          <div>
            <p className={`${CAPTION_TEXT} mb-1`}>{`Taken out · ${excluded.length}`}</p>
            <ul className="divide-y divide-ms-line border border-ms-border text-[13px]">
              {excluded.map((id) => {
                const name = names.get(id) ?? `Student #${id}`;
                return (
                  <li key={id} className="flex items-center gap-2 px-3 py-1.5">
                    <p className="min-w-0 flex-1 truncate text-ms-fg">{name}</p>
                    <button
                      type="button"
                      aria-label={`Put back ${name}`}
                      className={TEXT_BUTTON}
                      onClick={() => onChange(excluded.filter((x) => x !== id))}
                    >
                      Put back
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
