"use client";

/**
 * A test SMS: one real, paid SMS to a typed number, through the same delivery as everything
 * else, so the whole chain — the login, the template, the sender, the operator — is seen to work.
 * The server fills the student and debt slots with its sample values ("Test Testov,", 100000);
 * a `text` slot is typed here. It asks before sending, with the number and the price.
 */

import { useId, useMemo, useState } from "react";

import { Alert, Button, Field, Input, Select, type AlertTone } from "@/components/ui";
import { defaultRoles, fillPattern, firstLine, isAscii, money, sampleValues, slotLabel, smsParts, statusBadge } from "./format";
import { CAPTION_TEXT, Section, errorText } from "./panelKit";
import type { EskizTemplate, SmsMessage } from "./smsApi";
import { useSendTestSms, useSmsTemplates } from "./smsHooks";

/** "+998 88 003-25-08" → "998880032508"; a bare 9-digit number gets the country code. */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length === 9 ? `998${digits}` : digits;
}

export const isUzbekMobile = (phone: string) => /^998\d{9}$/.test(phone);

export function templateOption(t: EskizTemplate): string {
  return `#${t.eskiz_id} · ${firstLine(t.original || t.pattern, 70)}${t.status === "reklama" ? " (ad price)" : ""}`;
}

function resultTone(message: SmsMessage): AlertTone {
  const variant = statusBadge(message.status).variant;
  return variant === "danger" ? "danger" : variant === "warning" ? "warning" : "success";
}

export function TestSmsForm({ pricePerPart }: { pricePerPart: number }) {
  const uid = useId();
  const templates = useSmsTemplates();
  const send = useSendTestSms();
  const usable = useMemo(() => (templates.data?.templates ?? []).filter((t) => t.usable), [templates.data]);

  const [phone, setPhone] = useState("");
  const [chosenId, setChosenId] = useState<number | null>(null);
  const [texts, setTexts] = useState<Record<number, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SmsMessage | null>(null);

  // The first usable template until one is picked: the confirm names it before anything goes out.
  const template = usable.find((t) => t.eskiz_id === chosenId) ?? usable[0] ?? null;
  const roles = template ? defaultRoles(template.slots, template.guessed_roles) : [];
  const typed = template ? texts[template.eskiz_id] ?? roles.map(() => "") : [];
  const sample = template ? fillPattern(template.pattern, sampleValues(roles, typed)) : "";
  const parts = smsParts(sample);

  const setText = (i: number, value: string) => {
    if (!template) return;
    const next = [...typed];
    next[i] = value;
    setTexts({ ...texts, [template.eskiz_id]: next });
  };

  const submit = () => {
    setError(null);
    setResult(null);
    const number = normalisePhone(phone);
    if (!isUzbekMobile(number)) return setError("Enter an Uzbek mobile number: 998 and 9 digits.");
    if (!template) return setError("Pick a template.");
    if (roles.some((r, i) => r === "text" && !(typed[i] ?? "").trim())) return setError("Fill in every text slot.");

    const cost = parts * pricePerPart;
    if (!window.confirm(`Send 1 SMS (~${money(cost)}) to ${number} with template #${template.eskiz_id}?`)) return;
    send.mutate(
      {
        phone: number,
        template_id: template.eskiz_id,
        slot_texts: roles.map((r, i) => (r === "text" ? (typed[i] ?? "").trim() : "")),
      },
      { onSuccess: (message) => setResult(message), onError: (e) => setError(errorText(e)) },
    );
  };

  return (
    <Section title="Test SMS">
      <div className="space-y-3 px-3 py-3">
        <p className="text-[13px] text-muted-foreground">
          A real SMS to any number, billed like any other. The student&apos;s name and the debt are filled with samples.
        </p>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {result ? (
          <Alert tone={resultTone(result)}>
            Test SMS to {result.phone}: {statusBadge(result.status).label}.{result.error ? ` ${result.error}` : ""}
          </Alert>
        ) : null}

        {templates.isError ? (
          <p className="text-[13px] text-muted-foreground">The templates didn&apos;t load, so nothing can be sent yet.</p>
        ) : !templates.isPending && usable.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No usable template yet — refresh the list on the Templates tab.
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Phone" htmlFor={`${uid}-phone`} hint="998 and 9 digits.">
            <Input
              id={`${uid}-phone`}
              inputSize="sm"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="998901234567"
            />
          </Field>
          <Field label="Template" htmlFor={`${uid}-template`}>
            <Select
              id={`${uid}-template`}
              selectSize="sm"
              value={template ? String(template.eskiz_id) : ""}
              onChange={(e) => setChosenId(Number(e.target.value))}
              disabled={usable.length === 0}
            >
              {usable.map((t) => (
                <option key={t.eskiz_id} value={t.eskiz_id}>
                  {templateOption(t)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {template
          ? roles.map((role, i) =>
              role === "text" ? (
                <Field key={`${template.eskiz_id}-${i}`} label={`Slot ${i + 1} — ${slotLabel(template.slots[i])}`} htmlFor={`${uid}-slot-${i}`}>
                  <Input
                    id={`${uid}-slot-${i}`}
                    inputSize="sm"
                    value={typed[i] ?? ""}
                    onChange={(e) => setText(i, e.target.value)}
                  />
                </Field>
              ) : null,
            )
          : null}

        {template ? (
          <div>
            <p className={`${CAPTION_TEXT} mb-1`}>Sample</p>
            <p className="whitespace-pre-wrap border border-border bg-surface-2 px-3 py-2 text-[13px]">{sample}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {parts} SMS part{parts === 1 ? "" : "s"} · ~{money(parts * pricePerPart)}
              {isAscii(sample) ? "" : " · not plain Latin: 70 characters a part"}
            </p>
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button size="sm" onClick={submit} loading={send.isPending} disabled={!template}>
            Send test SMS
          </Button>
        </div>
      </div>
    </Section>
  );
}
