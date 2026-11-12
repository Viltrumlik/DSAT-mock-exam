"use client";

import { useId, useState } from "react";

import { Alert, Field, Input, Select } from "../consoleKit";
import { cn } from "@/lib/cn";
import { defaultRoles, firstLine, plural, roleLabel, slotLabel } from "../format";
import { LoadError } from "../panelKit";
import type { EskizTemplate, SlotRole, TemplateSlot } from "../smsApi";
import { useSmsTemplates } from "../smsHooks";
import type { MessageValue } from "./useComposerDraft";

/** A number slot cannot carry a name; a word slot can carry anything. */
export function rolesFor(slot: TemplateSlot): SlotRole[] {
  return slot.kind === "d" ? ["debt", "text"] : ["student", "debt", "text"];
}

function startingRoles(t: EskizTemplate, roleChoices: (slot: TemplateSlot) => SlotRole[]): SlotRole[] {
  return defaultRoles(t.slots, t.guessed_roles).map((role, i) => (roleChoices(t.slots[i]).includes(role) ? role : "text"));
}

/**
 * Which approved text, and what fills each of its slots: the student's name as lc-up holds it,
 * their debt, or one text typed here and the same for everyone. The most used template comes
 * first (the server's order), and the roles start from the server's guess.
 */
export function MessageStep({
  templateId,
  roles,
  texts,
  roleChoices,
  onChange,
}: MessageValue & {
  roleChoices: (slot: TemplateSlot) => SlotRole[];
  onChange: (next: MessageValue) => void;
}) {
  const uid = useId();
  const templates = useSmsTemplates();
  const [search, setSearch] = useState("");
  const usable = (templates.data?.templates ?? []).filter((t) => t.usable);
  const chosen = usable.find((t) => t.eskiz_id === templateId) ?? null;
  const term = search.trim().toLowerCase();
  const shown = term ? usable.filter((t) => `${t.label} ${t.original} ${t.pattern}`.toLowerCase().includes(term)) : usable;

  const choose = (t: EskizTemplate) =>
    onChange({ templateId: t.eskiz_id, roles: startingRoles(t, roleChoices), texts: t.slots.map(() => "") });
  const setRole = (i: number, role: SlotRole) => onChange({ templateId, texts, roles: roles.map((r, j) => (j === i ? role : r)) });
  const setText = (i: number, value: string) => onChange({ templateId, roles, texts: texts.map((t, j) => (j === i ? value : t)) });

  if (templates.isError) return <LoadError what="template list" onRetry={() => void templates.refetch()} />;

  return (
    <div className="space-y-3">
      {templateId && templates.data && !chosen ? (
        <Alert tone="warning">That template can no longer be used. Pick another one.</Alert>
      ) : null}
      <Field label="Find a template" htmlFor={`${uid}-search`}>
        <Input id={`${uid}-search`} inputSize="sm" value={search} onChange={(e) => setSearch(e.target.value)} />
      </Field>
      {!templates.isPending && usable.length === 0 ? (
        <p className="text-[13px] text-ms-fg-3">No usable template yet — refresh the list on the Templates tab.</p>
      ) : (
        <ul className="max-h-72 space-y-1.5 overflow-y-auto">
          {shown.map((t) => (
            <li key={t.eskiz_id}>
              <button
                type="button"
                aria-pressed={t.eskiz_id === templateId}
                onClick={() => choose(t)}
                className={cn(
                  "w-full rounded-md border px-3 py-2 text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ms-ring",
                  t.eskiz_id === templateId ? "border-ms-primary bg-ms-primary-soft" : "border-ms-border hover:bg-ms-surface-2",
                )}
              >
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold text-ms-fg">{t.label}</span>
                  {t.used_count > 0 ? (
                    <span className="text-[12px] text-ms-fg-3">Used {plural(t.used_count, "time")}</span>
                  ) : null}
                  {t.status === "reklama" ? <span className="text-[12px] text-ms-fg-3">Ad price</span> : null}
                </span>
                <span className="mt-0.5 block truncate text-ms-fg-3">{firstLine(t.original || t.pattern)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {chosen && chosen.slots.length === 0 ? (
        <p className="text-[13px] text-ms-fg-3">This template has no slots: everyone gets the same text.</p>
      ) : null}
      {chosen
        ? chosen.slots.map((slot, i) => (
            <div key={i} className="space-y-2 border border-ms-border p-3">
              <Field label={`Slot ${i + 1} — ${slotLabel(slot)}`} htmlFor={`${uid}-role-${i}`}>
                <Select
                  id={`${uid}-role-${i}`}
                  selectSize="sm"
                  value={roles[i]}
                  onChange={(e) => setRole(i, e.target.value as SlotRole)}
                >
                  {roleChoices(slot).map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </Select>
              </Field>
              {roles[i] === "text" ? (
                <Field label={`Text for slot ${i + 1}`} htmlFor={`${uid}-text-${i}`}>
                  <Input
                    id={`${uid}-text-${i}`}
                    inputSize="sm"
                    value={texts[i] ?? ""}
                    onChange={(e) => setText(i, e.target.value)}
                  />
                </Field>
              ) : null}
            </div>
          ))
        : null}
      {chosen && roles.includes("debt") ? (
        <p className="text-[13px] text-ms-fg-3">A debt slot leaves out anyone who is not in debt when it sends.</p>
      ) : null}
    </div>
  );
}
