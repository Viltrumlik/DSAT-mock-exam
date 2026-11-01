"use client";

import { MessageSquare } from "lucide-react";

import { dateTime, splitCounts } from "@/features/ops/sms/format";
import { StatusPill } from "@/features/ops/sms/look";
import type { SmsMessage } from "@/features/ops/sms/smsApi";
import { useStudentSms } from "@/features/ops/sms/smsHooks";
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
      <span aria-hidden className="absolute -left-[5px] top-[15px] h-2.5 w-2.5 rounded-full bg-[var(--sms-accent)] ring-4 ring-card" />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs tabular-nums text-muted-foreground">{dateTime(m.created_at)}</span>
        <span className="font-medium text-foreground">{m.source.label}</span>
        <StatusPill message={m} />
      </div>
      <p className="mt-1 text-[13px] text-muted-foreground">{m.text}</p>
    </li>
  );
}

export function SmsSection({ id }: { id: number }) {
  const query = useStudentSms(id);

  let body;
  if (query.isPending) {
    body = <p className="py-2 text-muted-foreground">Loading…</p>;
  } else if (query.isError || !query.data) {
    body = forbidden(query.error) ? (
      <p className="py-2 text-muted-foreground">Only admins can see SMS.</p>
    ) : (
      <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-danger-foreground">
        Could not load.{" "}
        <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => void query.refetch()}>
          Retry
        </button>
      </p>
    );
  } else if (!query.data.results.length) {
    body = <p className="py-2 text-muted-foreground">No SMS sent to this student yet.</p>;
  } else {
    const total = Object.values(query.data.summary).reduce((sum, n) => sum + (n ?? 0), 0);
    const counts = splitCounts(total, query.data.summary);
    body = (
      <>
        <p className="mb-2 text-[13px] text-muted-foreground">
          {`${total} SMS · ${counts.delivered} delivered · ${counts.notDelivered} not delivered`}
        </p>
        <ol className="ml-1.5 border-l border-border">
          {query.data.results.map((m) => (
            <Item key={m.id} m={m} />
          ))}
        </ol>
        {total > query.data.results.length ? (
          <p className="mt-3 text-xs text-muted-foreground">{`Showing the latest ${query.data.results.length}.`}</p>
        ) : null}
      </>
    );
  }

  return (
    <Fieldset title="SMS" icon={MessageSquare} tone="neutral" description="Every SMS sent to this student's lc-up phone.">
      {body}
    </Fieldset>
  );
}
