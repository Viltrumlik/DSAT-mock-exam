"use client";

import Link from "next/link";
import { MessageSquare, Send } from "lucide-react";

import { dateTime, splitCounts } from "@/features/ops/sms/format";
import { StatusPill } from "@/features/ops/sms/look";
import type { SmsMessage } from "@/features/ops/sms/smsApi";
import { useStudentSms } from "@/features/ops/sms/smsHooks";
import { NEW_CAMPAIGN_PATH } from "@/features/ops/sms/smsTabs";
import { buttonClass } from "@/features/console/ui";
import { Fieldset } from "../Fieldset";

/**
 * Every SMS this student was sent, newest first (plan 2026-11-01-sms-v2, Task 10): when, what it
 * was (a debt warning, a campaign, an automatic SMS), how it went in plain words, and its text.
 * The SMS API is admins' only; anyone else is told so, not shown a failed load.
 */

const forbidden = (error: unknown) => (error as { response?: { status?: number } })?.response?.status === 403;

function Item({ m }: { m: SmsMessage }) {
  return (
    <li className="relative break-words py-2 pl-6">
      <span aria-hidden className="absolute -left-[5px] top-[15px] h-2.5 w-2.5 rounded-full bg-[var(--sms-accent)] ring-4 ring-ms-card" />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs tabular-nums text-ms-fg-3">{dateTime(m.created_at)}</span>
        <span className="font-medium text-ms-fg">{m.source.label}</span>
        <StatusPill message={m} />
      </div>
      <p className="mt-1 text-[13px] text-ms-fg-3">{m.text}</p>
    </li>
  );
}

export function SmsSection({ id }: { id: number }) {
  const query = useStudentSms(id);

  let body;
  if (query.isPending) {
    body = <p className="py-2 text-ms-fg-3">Loading…</p>;
  } else if (query.isError || !query.data) {
    body = forbidden(query.error) ? (
      <p className="py-2 text-ms-fg-3">Only admins can see SMS.</p>
    ) : (
      <p role="alert" className="rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-3 py-2.5 text-ms-critical-fg">
        Could not load.{" "}
        <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => void query.refetch()}>
          Retry
        </button>
      </p>
    );
  } else if (!query.data.results.length) {
    body = <p className="py-2 text-ms-fg-3">No SMS sent to this student yet.</p>;
  } else {
    const total = Object.values(query.data.summary).reduce((sum, n) => sum + (n ?? 0), 0);
    const counts = splitCounts(total, query.data.summary);
    body = (
      <>
        <p className="mb-2 text-[13px] text-ms-fg-3">
          {`${total} SMS · ${counts.delivered} delivered · ${counts.notDelivered} not delivered`}
        </p>
        <ol className="ml-1.5 border-l border-ms-border">
          {query.data.results.map((m) => (
            <Item key={m.id} m={m} />
          ))}
        </ol>
        {total > query.data.results.length ? (
          <p className="mt-3 text-xs text-ms-fg-3">{`Showing the latest ${query.data.results.length}.`}</p>
        ) : null}
      </>
    );
  }

  return (
    <Fieldset title="SMS" icon={MessageSquare} tone="neutral" description="Every SMS sent to this student's lc-up phone.">
      {query.data ? (
        <Link href={`${NEW_CAMPAIGN_PATH}?student=${id}`} className={buttonClass({ size: "sm", className: "mb-3" })}>
          <Send className="h-4 w-4" aria-hidden />
          Send SMS
        </Link>
      ) : null}
      {body}
    </Fieldset>
  );
}
