"use client";

/**
 * The automatic debt warning: the SMS a debtor gets each morning in the days before lc-up's
 * monthly debt freeze — one template for the earlier days, another ("Bugun oxirgi kun!") for the
 * last one. Here are its knobs (on/off, the hour, the two templates and what fills their slots),
 * the list the next warning day would send, "Send now" on a warning day, and the past runs.
 *
 * Three switches must all be on for a warning to go out: the server's SMS_DEBT_WARNINGS_ENABLED
 * (the master kill-switch, set in the environment), this panel's, and lc-up's debt freeze. The
 * panel can only turn its own; it says plainly when one of the others holds it off.
 *
 * Save sends only what changed. A template id always travels with its slots, and the server
 * refuses one that is not usable — so the hour can be saved even before the template list has
 * been synced.
 */

import { useId, useMemo, useState } from "react";

import { Alert, Button, Field, Select, Switch } from "@/components/ui";
import {
  SAMPLE,
  dateTime,
  dayLabel,
  fillPattern,
  hourLabel,
  money,
  plural,
  roleLabel,
  skipLabel,
  slotLabel,
  slotsOf,
  smsParts,
  splitCounts,
  templateOption,
  todayInTashkent,
} from "./format";
import { BOX, CAPTION_TEXT, LoadError, Loading, Section, TABLE, TD, TH, TR, errorText } from "./panelKit";
import type { EskizTemplate, SlotRole, SmsSettings, SmsSettingsPatch, TemplateSlot } from "./smsApi";
import {
  useDebtPreview,
  useDebtRuns,
  useDebtSendNow,
  useSmsSettings,
  useSmsTemplates,
  useUpdateSmsSettings,
} from "./smsHooks";

/** The hours the server accepts. */
export const DEBT_HOURS = Array.from({ length: 13 }, (_, i) => 8 + i);

/** A debt warning fills its slots with the student's name or the debt — nothing typed. */
export function debtRolesFor(slot: TemplateSlot): SlotRole[] {
  return slot.kind === "d" ? ["debt"] : ["student", "debt"];
}

/** A number slot is the debt; a word slot the student, unless the server guessed it is the debt. */
export function startingDebtRoles(t: Pick<EskizTemplate, "slots" | "guessed_roles">): SlotRole[] {
  return t.slots.map((slot, i) => (slot.kind === "d" || t.guessed_roles[i] === "debt" ? "debt" : "student"));
}

const sameRoles = (a: SlotRole[], b: SlotRole[]) => a.length === b.length && a.every((r, i) => r === b[i]);

type Choice = { id: number; roles: SlotRole[] };

/** "Days 1–4" and "Day 5" for a freeze on day 6. */
function dayLabels(freezeDay: number): { before: string; last: string } {
  const last = Math.max(1, freezeDay - 1);
  const before = last - 1;
  return {
    before: before >= 2 ? `Days 1–${before}` : before === 1 ? "Day 1" : "Earlier days",
    last: `Day ${last}`,
  };
}

function TemplateChoice({
  label,
  hint,
  value,
  onChange,
  usable,
  savedPattern,
}: {
  label: string;
  hint: string;
  value: Choice;
  onChange: (next: Choice) => void;
  usable: EskizTemplate[];
  /** The pattern the setting holds, for a template the list does not carry (not synced yet). */
  savedPattern: string;
}) {
  const uid = useId();
  const chosen = usable.find((t) => t.eskiz_id === value.id) ?? null;
  const pattern = chosen?.pattern ?? savedPattern;
  const slots = chosen?.slots ?? slotsOf(pattern);
  const sample = fillPattern(pattern, value.roles.map((r) => (r === "debt" ? SAMPLE.debt : SAMPLE.student)));
  const parts = smsParts(sample);

  const pick = (id: number) => {
    const t = usable.find((x) => x.eskiz_id === id);
    if (t) onChange({ id, roles: startingDebtRoles(t) });
  };

  return (
    <div className="space-y-2 border border-border p-3">
      <Field label={label} htmlFor={`${uid}-template`} hint={hint}>
        <Select id={`${uid}-template`} selectSize="sm" value={String(value.id)} onChange={(e) => pick(Number(e.target.value))}>
          {chosen ? null : <option value={value.id}>{`#${value.id} · not in the template list — refresh it`}</option>}
          {usable.map((t) => (
            <option key={t.eskiz_id} value={t.eskiz_id}>
              {templateOption(t)}
            </option>
          ))}
        </Select>
      </Field>
      {slots.map((slot, i) => (
        <Field key={i} label={`Slot ${i + 1} — ${slotLabel(slot)}`} htmlFor={`${uid}-role-${i}`}>
          <Select
            id={`${uid}-role-${i}`}
            selectSize="sm"
            value={value.roles[i] ?? "student"}
            onChange={(e) => onChange({ ...value, roles: value.roles.map((r, j) => (j === i ? (e.target.value as SlotRole) : r)) })}
          >
            {debtRolesFor(slot).map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </Select>
        </Field>
      ))}
      <div>
        <p className={`${CAPTION_TEXT} mb-1`}>Sample</p>
        <p className="whitespace-pre-wrap border border-border bg-surface-2 px-3 py-2 text-[13px]">{sample}</p>
        <p className="mt-1 text-[12px] text-muted-foreground">{plural(parts, "SMS part")} each</p>
      </div>
    </div>
  );
}

function SettingsForm({ settings: s, usable }: { settings: SmsSettings; usable: EskizTemplate[] }) {
  const uid = useId();
  const update = useUpdateSmsSettings();
  const [enabled, setEnabled] = useState(s.debt_enabled);
  const [hour, setHour] = useState(s.debt_hour);
  const [warning, setWarning] = useState<Choice>({ id: s.warning_template_id, roles: s.warning_slots });
  const [lastDay, setLastDay] = useState<Choice>({ id: s.last_day_template_id, roles: s.last_day_slots });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const days = dayLabels(s.freeze_day);

  const save = () => {
    setNotice(null);
    setError(null);
    const patch: SmsSettingsPatch = {};
    if (enabled !== s.debt_enabled) patch.debt_enabled = enabled;
    if (hour !== s.debt_hour) patch.debt_hour = hour;
    if (warning.id !== s.warning_template_id || !sameRoles(warning.roles, s.warning_slots)) {
      patch.warning_template_id = warning.id;
      patch.warning_slots = warning.roles;
    }
    if (lastDay.id !== s.last_day_template_id || !sameRoles(lastDay.roles, s.last_day_slots)) {
      patch.last_day_template_id = lastDay.id;
      patch.last_day_slots = lastDay.roles;
    }
    if (Object.keys(patch).length === 0) return setNotice("Nothing has changed.");
    if (
      patch.debt_enabled === false &&
      !window.confirm("Turn the debt warning off? No warning goes out until it is turned back on.")
    ) {
      return;
    }
    update.mutate(patch, {
      onSuccess: () => setNotice("Saved."),
      onError: (e) => setError(errorText(e, "Couldn't save. Try again.")),
    });
  };

  return (
    <Section
      title="Settings"
      actions={
        s.updated_at ? (
          <span className="text-[12px] text-muted-foreground">
            Changed {dateTime(s.updated_at)}
            {s.updated_by_name ? ` by ${s.updated_by_name}` : ""}
          </span>
        ) : null
      }
    >
      <div className="space-y-3 px-3 py-3">
        {!s.env_enabled ? (
          <Alert tone="warning">
            The server&apos;s master switch (SMS_DEBT_WARNINGS_ENABLED) is off — no warning goes out, whatever is set
            here. It is turned on in the server&apos;s environment.
          </Alert>
        ) : null}
        {!s.freeze_enabled ? (
          <Alert tone="info">
            lc-up&apos;s debt freeze is off, so no warning goes out either: the warning is about the freeze.
          </Alert>
        ) : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="flex flex-wrap items-end gap-6">
          <Switch
            id={`${uid}-on`}
            label="Send debt warnings"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!s.env_enabled}
          />
          <Field label="Send at" htmlFor={`${uid}-hour`} hint="Tashkent time; failures are retried an hour and two hours later.">
            <Select id={`${uid}-hour`} selectSize="sm" value={String(hour)} onChange={(e) => setHour(Number(e.target.value))}>
              {DEBT_HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <TemplateChoice
            label={`${days.before} — the warning`}
            hint={`Before the last day; lc-up freezes debtors on day ${s.freeze_day}.`}
            value={warning}
            onChange={setWarning}
            usable={usable}
            savedPattern={s.warning_pattern}
          />
          <TemplateChoice
            label={`${days.last} — the last day`}
            hint="The day before the freeze."
            value={lastDay}
            onChange={setLastDay}
            usable={usable}
            savedPattern={s.last_day_pattern}
          />
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={save} loading={update.isPending}>
            Save
          </Button>
        </div>
      </div>
    </Section>
  );
}

function NextDay({ settings }: { settings: SmsSettings | undefined }) {
  const preview = useDebtPreview();
  const sendNow = useDebtSendNow();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (preview.isPending) return <Loading />;
  if (preview.isError || !preview.data) {
    return <LoadError what="next warning day" onRetry={() => void preview.refetch()} />;
  }

  const p = preview.data;
  const isToday = p.day === todayInTashkent();
  const enabled = Boolean(settings && settings.env_enabled && settings.debt_enabled && settings.freeze_enabled);
  const skipped = Object.entries(p.skipped ?? {}).filter(([, n]) => n > 0);

  const onSendNow = () => {
    const at = settings ? ` The ${hourLabel(settings.debt_hour)} run then skips them.` : "";
    if (!window.confirm(`Send today's debt warning now to ${plural(p.count, "student")} (~${money(p.cost)})?${at}`)) return;
    setNotice(null);
    setError(null);
    sendNow.mutate(undefined, {
      onSuccess: () => setNotice("Queued — the warnings are going out now. The history below fills in as they land."),
      onError: (e) => setError(errorText(e)),
    });
  };

  return (
    <Section
      title={`Next warning day · ${dayLabel(p.day)}${p.is_last_day ? " · the last day" : ""}`}
      actions={
        isToday ? (
          <Button size="sm" onClick={onSendNow} loading={sendNow.isPending} disabled={!enabled || p.count === 0}>
            Send now
          </Button>
        ) : null
      }
    >
      <div className="space-y-3 px-3 py-3">
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {p.blocked ? <Alert tone="warning">{p.blocked}</Alert> : null}
        {isToday && !enabled ? (
          <p className="text-[13px] text-muted-foreground">The warning is off, so it can&apos;t be sent now.</p>
        ) : null}
        <p className="text-[13px] tabular-nums text-foreground">
          <span className="font-semibold">{plural(p.count, "student")}</span> · ~{money(p.cost)}
          {skipped.length > 0 ? (
            <span className="text-muted-foreground">
              {" "}
              · Left out: {skipped.map(([reason, n]) => `${skipLabel(reason)}: ${n}`).join(" · ")}
            </span>
          ) : null}
        </p>
        {p.warnings.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nobody would get a warning that day.</p>
        ) : (
          <div className={`${BOX} overflow-x-auto`}>
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Student</th>
                  <th className={TH}>Phone</th>
                  <th className={`${TH} text-right`}>Debt</th>
                  <th className={TH}>Text</th>
                  <th className={`${TH} text-right`}>Parts</th>
                </tr>
              </thead>
              <tbody>
                {p.warnings.map((w) => (
                  <tr key={w.lcup_student_id} className={TR}>
                    <td className={`${TD} whitespace-nowrap`}>{w.name}</td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>{w.phone}</td>
                    <td className={`${TD} whitespace-nowrap text-right tabular-nums`}>{money(w.debt)}</td>
                    <td className={TD}>
                      <span title={w.text} className="block max-w-[26rem] truncate">
                        {w.text}
                      </span>
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>{w.parts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Section>
  );
}

function History() {
  const runs = useDebtRuns();
  if (runs.isPending) return <Loading />;
  if (runs.isError) return <LoadError what="history" onRetry={() => void runs.refetch()} />;
  const rows = runs.data ?? [];

  return (
    <Section title="History · the last 60 days">
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-[13px] text-muted-foreground">No debt warning has gone out yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Day</th>
                <th className={`${TH} text-right`}>SMS</th>
                <th className={`${TH} text-right`}>Delivered</th>
                <th className={`${TH} text-right`}>Not delivered</th>
                <th className={`${TH} text-right`}>Other</th>
                <th className={`${TH} text-right`}>Parts</th>
                <th className={`${TH} text-right`}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const split = splitCounts(r.total, r.by_status);
                return (
                  <tr key={r.run_on} className={TR}>
                    <td className={`${TD} whitespace-nowrap`}>{dayLabel(r.run_on)}</td>
                    <td className={`${TD} text-right tabular-nums`}>{r.total}</td>
                    <td className={`${TD} text-right tabular-nums`}>{split.delivered}</td>
                    <td className={`${TD} text-right tabular-nums`}>{split.notDelivered}</td>
                    <td className={`${TD} text-right tabular-nums`}>{split.other}</td>
                    <td className={`${TD} text-right tabular-nums`}>{r.parts}</td>
                    <td className={`${TD} whitespace-nowrap text-right tabular-nums`}>{money(r.cost)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

export function DebtPanel() {
  const settings = useSmsSettings();
  const templates = useSmsTemplates();
  const usable = useMemo(() => (templates.data?.templates ?? []).filter((t) => t.usable), [templates.data]);

  return (
    <div className="space-y-4">
      {settings.isPending ? (
        <Loading />
      ) : settings.isError || !settings.data ? (
        <LoadError what="debt warning settings" onRetry={() => void settings.refetch()} />
      ) : (
        <SettingsForm settings={settings.data} usable={usable} />
      )}
      <NextDay settings={settings.data} />
      <History />
    </div>
  );
}
