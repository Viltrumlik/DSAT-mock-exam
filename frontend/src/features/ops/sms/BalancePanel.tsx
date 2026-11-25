"use client";

/**
 * The balance SMS: two automatic texts to a student's parent (else the student, else the account's phone) —
 * "balance low" when the balance is above zero but under two lessons' worth, once per dip, and "frozen for debt",
 * once per freeze. Here are its knobs (on/off, the hour, the two templates and what fills their slots), today's
 * list (who would get what, written without sending) and "Send now".
 *
 * It starts switched off, and four things must all be on for a text to go out: the server's
 * SMS_BALANCE_WARNINGS_ENABLED, this panel's switch, the ledger being ours and students paying per lesson.
 * The panel can only turn its own; it says plainly when one of the others holds it off.
 *
 * Save sends only what changed; a template id always travels with its slots. "Send now" asks first with the
 * count and the price: an SMS cannot be unsent. Once it is queued the list is asked again every few seconds until
 * nobody is left to tell (two minutes at most).
 */

import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { Alert, Button, Field, Select, Switch } from "./consoleKit";
import { Choice, TemplateChoice } from "./DebtPanel";
import { dateTime, dayLabel, hourLabel, money, plural, skipLabel } from "./format";
import { BOX, LoadError, Loading, Section, TABLE, TD, TH, TR, errorText, paidErrorText } from "./panelKit";
import type { BalanceRow, EskizTemplate, SlotRole, SmsSettings, SmsSettingsPatch, TemplateSlot } from "./smsApi";
import {
  DEBT_POLL_FOR_MS,
  useBalancePreview,
  useBalanceSendNow,
  useSmsSettings,
  useSmsTemplates,
  useUpdateSmsSettings,
} from "./smsHooks";

/** The hours the server accepts. */
export const BALANCE_HOURS = Array.from({ length: 13 }, (_, i) => 8 + i);

/** A balance SMS fills its slots with the student's name or the balance — nothing typed. A number slot cannot hold a name. */
export function balanceRolesFor(slot: TemplateSlot): SlotRole[] {
  return slot.kind === "d" ? ["balance"] : ["student", "balance"];
}

/** The slot the server guessed is the student stays; if it guessed none, the first word slot is; the rest are the balance. */
export function startingBalanceRoles(t: Pick<EskizTemplate, "slots" | "guessed_roles">): SlotRole[] {
  let named = t.guessed_roles.includes("student");
  return t.slots.map((slot, i) => {
    if (t.guessed_roles[i] === "student") return "student";
    if (!named && slot.kind === "w") {
      named = true;
      return "student";
    }
    return "balance";
  });
}

const sameRoles = (a: SlotRole[], b: SlotRole[]) => a.length === b.length && a.every((r, i) => r === b[i]);

function SettingsForm({ settings: s, usable }: { settings: SmsSettings; usable: EskizTemplate[] }) {
  const uid = useId();
  const update = useUpdateSmsSettings();
  const [enabled, setEnabled] = useState(s.balance_enabled);
  const [hour, setHour] = useState(s.balance_hour);
  const [low, setLow] = useState<Choice>({ id: s.low_template_id, roles: s.low_slots });
  const [frozen, setFrozen] = useState<Choice>({ id: s.frozen_template_id, roles: s.frozen_slots });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setNotice(null);
    setError(null);
    const patch: SmsSettingsPatch = {};
    if (enabled !== s.balance_enabled) patch.balance_enabled = enabled;
    if (hour !== s.balance_hour) patch.balance_hour = hour;
    if (low.id !== null && (low.id !== s.low_template_id || !sameRoles(low.roles, s.low_slots))) {
      patch.low_template_id = low.id;
      patch.low_slots = low.roles;
    }
    if (frozen.id !== null && (frozen.id !== s.frozen_template_id || !sameRoles(frozen.roles, s.frozen_slots))) {
      patch.frozen_template_id = frozen.id;
      patch.frozen_slots = frozen.roles;
    }
    if (Object.keys(patch).length === 0) return setNotice("Nothing has changed.");
    if (patch.balance_enabled === false && !window.confirm("Turn the balance SMS off? No parent is told until it is turned back on.")) {
      return;
    }
    if (
      patch.balance_enabled === true &&
      !window.confirm(`Turn the balance SMS on? From the next ${hourLabel(hour)} run, parents get a text when a balance runs low or an account is frozen.`)
    ) {
      return;
    }
    update.mutate(patch, {
      onSuccess: () => setNotice("Saved."),
      onError: (e) => setError(errorText(e, "Couldn't save. Try again.")),
    });
  };

  const pickedBoth = s.low_template_id !== null && s.frozen_template_id !== null;

  return (
    <Section
      title="Settings"
      actions={
        s.updated_at ? (
          <span className="text-[12px] text-ms-fg-3">
            Changed {dateTime(s.updated_at)}
            {s.updated_by_name ? ` by ${s.updated_by_name}` : ""}
          </span>
        ) : null
      }
    >
      <div className="space-y-3 px-3 py-3">
        {!s.balance_env_enabled ? (
          <Alert tone="warning">
            The server&apos;s master switch (SMS_BALANCE_WARNINGS_ENABLED) is off — no balance SMS goes out, whatever is
            set here. It is turned on in the server&apos;s environment.
          </Alert>
        ) : null}
        {!s.balance_billing_ready ? (
          <Alert tone="info">
            The balance SMS waits for the ledger to be ours and students to pay per lesson: until then there is no balance
            to warn about.
          </Alert>
        ) : null}
        {!pickedBoth ? (
          <Alert tone="info">Pick and save both templates below: nothing is sent without an approved text.</Alert>
        ) : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="flex flex-wrap items-end gap-6">
          <Switch
            id={`${uid}-on`}
            label="Send balance SMS"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!s.balance_env_enabled}
          />
          <Field label="Send at" htmlFor={`${uid}-hour`} hint="Tashkent time, once a day.">
            <Select id={`${uid}-hour`} selectSize="sm" value={String(hour)} onChange={(e) => setHour(Number(e.target.value))}>
              {BALANCE_HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <TemplateChoice
            label="Low balance"
            hint="The balance is above zero but under two lessons' worth. Told once per dip."
            value={low}
            onChange={setLow}
            usable={usable}
            savedPattern={s.low_pattern}
            rolesFor={balanceRolesFor}
            startingRoles={startingBalanceRoles}
          />
          <TemplateChoice
            label="Frozen for debt"
            hint="The account was frozen because the balance went below zero. Told once per freeze."
            value={frozen}
            onChange={setFrozen}
            usable={usable}
            savedPattern={s.frozen_pattern}
            rolesFor={balanceRolesFor}
            startingRoles={startingBalanceRoles}
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

function Rows({ title, rows }: { title: string; rows: BalanceRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-[13px] font-semibold text-ms-fg">{`${title} · ${rows.length}`}</p>
      <div className={`${BOX} overflow-x-auto`}>
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Student</th>
              <th className={TH}>Phone</th>
              <th className={`${TH} text-right`}>Balance</th>
              <th className={TH}>Text</th>
              <th className={`${TH} text-right`}>Parts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.name}-${r.phone}`} className={TR}>
                <td className={`${TD} whitespace-nowrap`}>{r.name}</td>
                <td className={`${TD} whitespace-nowrap tabular-nums`}>{r.phone}</td>
                <td className={`${TD} whitespace-nowrap text-right tabular-nums`}>{money(r.balance)}</td>
                <td className={TD}>
                  <span title={r.text} className="block max-w-[26rem] truncate">
                    {r.text}
                  </span>
                </td>
                <td className={`${TD} text-right tabular-nums`}>{r.parts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TodaysList({
  settings,
  pollUntil,
  onSent,
  onSettled,
}: {
  settings: SmsSettings | undefined;
  /** Until when the list is asked again (0: not now). */
  pollUntil: number;
  onSent: () => void;
  onSettled: () => void;
}) {
  const preview = useBalancePreview(pollUntil);
  const sendNow = useBalanceSendNow();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const count = preview.data?.count;

  // Everyone has been told: stop asking.
  useEffect(() => {
    if (pollUntil > 0 && count === 0) onSettled();
  }, [pollUntil, count, onSettled]);

  if (preview.isPending) return <Loading />;
  if (preview.isError || !preview.data) {
    return <LoadError what="today's balance list" onRetry={() => void preview.refetch()} />;
  }

  const p = preview.data;
  const skipped = Object.entries(p.skipped ?? {}).filter(([, n]) => n > 0);

  const onSendNow = () => {
    const at = settings ? ` The ${hourLabel(settings.balance_hour)} run then skips them.` : "";
    if (!window.confirm(`Send the balance SMS now to ${plural(p.count, "family", "families")} (~${money(p.cost)})?${at}`)) return;
    setNotice(null);
    setError(null);
    sendNow.mutate(undefined, {
      onSuccess: () => {
        setNotice("Queued — the texts are going out now. The list follows them as they land.");
        onSent();
      },
      onError: (e) => setError(paidErrorText(e)),
    });
  };

  return (
    <Section
      title={`Today's list · ${dayLabel(p.day)}`}
      actions={
        <Button size="sm" onClick={onSendNow} loading={sendNow.isPending} disabled={Boolean(p.blocked) || p.count === 0}>
          {`Send now to ${plural(p.count, "family", "families")}`}
        </Button>
      }
    >
      <div className="space-y-3 px-3 py-3">
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {p.blocked ? <Alert tone="warning">{p.blocked}</Alert> : null}
        <p className="text-[13px] tabular-nums text-ms-fg">
          <span className="font-semibold">{plural(p.count, "text")}</span>
          {` · ~${money(p.cost)}`}
          {skipped.length > 0 ? (
            <span className="text-ms-fg-3">
              {" "}
              · Left out: {skipped.map(([reason, n]) => `${skipLabel(reason)}: ${n}`).join(" · ")}
            </span>
          ) : null}
        </p>
        {p.count === 0 ? (
          <p className="text-[13px] text-ms-fg-3">Nobody would get a balance SMS right now.</p>
        ) : (
          <>
            <Rows title="Low balance" rows={p.low} />
            <Rows title="Frozen for debt" rows={p.frozen} />
          </>
        )}
      </div>
    </Section>
  );
}

export function BalancePanel() {
  const settings = useSmsSettings();
  const templates = useSmsTemplates();
  const usable = useMemo(() => (templates.data?.templates ?? []).filter((t) => t.usable), [templates.data]);
  const [pollUntil, setPollUntil] = useState(0);
  const onSent = () => setPollUntil(Date.now() + DEBT_POLL_FOR_MS);
  const onSettled = useCallback(() => setPollUntil(0), []);

  return (
    <div className="space-y-4">
      {templates.isError ? <LoadError what="template list" onRetry={() => void templates.refetch()} /> : null}
      {settings.isPending ? (
        <Loading />
      ) : settings.isError || !settings.data ? (
        <LoadError what="balance SMS settings" onRetry={() => void settings.refetch()} />
      ) : (
        <SettingsForm settings={settings.data} usable={usable} />
      )}
      <TodaysList settings={settings.data} pollUntil={pollUntil} onSent={onSent} onSettled={onSettled} />
    </div>
  );
}
