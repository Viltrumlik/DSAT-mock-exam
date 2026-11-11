"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Drawer } from "./consoleKit";
import { dateTime, kindLabel, money } from "./format";
import { OperatorDot, StatusPill, TONE_COLOR, toneOf } from "./look";
import { CAPTION_TEXT, TEXT_BUTTON } from "./panelKit";
import type { SmsMessage } from "./smsApi";
import { campaignHref } from "./smsTabs";
import { useConfirmedResend } from "./UndeliveredList";

/**
 * One SMS's story (plan 2026-11-01-sms-v2, Task 9): the whole text, when it was written, when eskiz
 * took it and what the operator then said, why it stands where it does, and — only when it did not
 * arrive — Resend. eskiz's request id is here because it is what eskiz's support asks for.
 */

const Muted = ({ children }: { children: ReactNode }) => <span className="text-ms-fg-3">{children}</span>;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 border-b border-ms-border py-1.5 text-[13px] last:border-b-0">
      <dt className="text-ms-fg-3">{label}</dt>
      <dd className="min-w-0 break-words text-ms-fg">{children}</dd>
    </div>
  );
}

function Step({ label, at, done, color }: { label: string; at: string | null; done: boolean; color?: string }) {
  return (
    <li className="relative pl-5">
      <span
        aria-hidden
        className={`absolute left-[-5px] top-1 size-2.5 rounded-full border-2 ${done ? "border-transparent" : "border-ms-border bg-ms-card"}`}
        style={done ? { background: color ?? "var(--sms-accent)" } : undefined}
      />
      <span className="font-medium text-ms-fg">{label}</span> <Muted>{at ? dateTime(at) : "—"}</Muted>
    </li>
  );
}

export function MessageDrawer({ m, pricePerPart, onClose }: { m: SmsMessage; pricePerPart: number; onClose: () => void }) {
  const resend = useConfirmedResend(pricePerPart);
  const tone = toneOf(m.status);
  // The step says how it ended; the pill under the timeline says why.
  const ending = tone === "delivered" ? "Delivered" : tone === "pending" ? "Waiting for the operator" : "Not delivered";

  return (
    <Drawer open onClose={onClose} title={`SMS #${m.id}`} width={480}>
      <div className="space-y-4">
        <div>
          <p className={`${CAPTION_TEXT} mb-1`}>The text</p>
          <p className="whitespace-pre-wrap border border-ms-border bg-ms-surface-2 px-3 py-2 text-[13px]">{m.text}</p>
        </div>

        <div>
          <p className={`${CAPTION_TEXT} mb-2`}>What happened</p>
          <ol className="ml-1.5 space-y-2 border-l border-ms-border text-[13px]">
            <Step label="Created" at={m.created_at} done />
            <Step label="Sent to eskiz" at={m.sent_at} done={Boolean(m.sent_at)} />
            <Step label={ending} at={tone === "pending" ? null : m.checked_at} done={tone !== "pending"} color={TONE_COLOR[tone]} />
          </ol>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusPill message={m} />
          {m.can_resend ? (
            <button
              type="button"
              className={TEXT_BUTTON}
              // A paid send asks with its price first: no price yet, no Resend.
              disabled={resend.isPending || pricePerPart <= 0}
              title={pricePerPart <= 0 ? "Waiting for the price per SMS…" : undefined}
              onClick={() => resend.send([m], onClose)}
            >
              Resend
            </button>
          ) : null}
        </div>

        <dl>
          <Row label="To">
            {m.user ? (
              <Link href={`/ops/students/${m.user.id}?tab=sms`} className={TEXT_BUTTON}>
                {m.user.name}
              </Link>
            ) : (
              "—"
            )}{" "}
            <span className="inline-flex items-center gap-1">
              <OperatorDot operator={m.operator} />
              <Muted>{m.phone}</Muted>
            </span>
            {m.groups.length ? <div className="text-ms-fg-3">{m.groups.join(", ")}</div> : null}
          </Row>
          <Row label="Source">
            {m.campaign_id ? (
              <Link href={campaignHref(m.campaign_id)} className={TEXT_BUTTON}>
                {m.source.label}
              </Link>
            ) : (
              m.source.label || kindLabel(m.kind)
            )}
          </Row>
          <Row label="Template">{m.template.label || <Muted>—</Muted>}</Row>
          <Row label="Parts">{`${m.parts} · ~${money(m.cost)}`}</Row>
          <Row label="Request id">
            {m.request_id ? <span className="font-mono text-[12px]">{m.request_id}</span> : <Muted>—</Muted>}
          </Row>
          <Row label="By">{m.created_by_name || <Muted>The system</Muted>}</Row>
          {m.eskiz_status ? <Row label="eskiz said">{m.eskiz_status}</Row> : null}
          {m.error ? (
            <Row label="Error">
              <span className="text-ms-critical-fg">{m.error}</span>
            </Row>
          ) : null}
        </dl>
      </div>
    </Drawer>
  );
}
