"use client";

import { useMemo, useState } from "react";

import { useToast } from "@/components/ui";
import { dateTime, money } from "./format";
import { OperatorDot, StatusPill } from "./look";
import { LoadError, Loading, Section, TABLE, TD, TEXT_BUTTON, TH, TR, paidErrorText } from "./panelKit";
import type { SmsMessage } from "./smsApi";
import { useResendMessages, useSmsMessages } from "./smsHooks";

/**
 * What did not arrive — not delivered, refused, or eskiz never reached — with Resend, one at a time
 * or ticked together (plan 2026-11-01-sms-v2). Every resend is paid, so it asks first with the count
 * and the price, and the request is never retried. A delivered SMS is never in this list.
 */

export type UndeliveredFilter = { from?: string; to?: string; campaign?: number; automation?: number };

const PAGE = { q: "", o: "", page: 1, pageSize: 50 };

/**
 * Resend with the panel's one rule for paid sends: ask first with the count and the price, never
 * retry, and say how it went. The list and the journal's drawer both use it.
 */
export function useConfirmedResend(pricePerPart: number) {
  const resend = useResendMessages();
  const toast = useToast();
  const send = (targets: SmsMessage[], onDone?: () => void) => {
    if (!targets.length || resend.isPending) return;
    const cost = targets.reduce((sum, m) => sum + m.parts * pricePerPart, 0);
    if (!window.confirm(`Resend ${targets.length} SMS, ~${money(cost)}?`)) return;
    resend.mutate(
      targets.map((m) => m.id),
      {
        onSuccess: (result) => {
          onDone?.();
          toast({
            tone: "success",
            title: `${result.queued.length} SMS going again`,
            description: result.not_resendable.length ? `${result.not_resendable.length} had already changed.` : undefined,
          });
        },
        onError: (e) => toast({ tone: "danger", title: "Resend didn't go through", description: paidErrorText(e) }),
      },
    );
  };
  return { send, isPending: resend.isPending };
}

export function UndeliveredList({ filter, pricePerPart }: { filter: UndeliveredFilter; pricePerPart: number }) {
  const filters = useMemo(() => {
    const out: Record<string, string> = { resendable: "1" };
    for (const [key, value] of Object.entries(filter)) if (value !== undefined && value !== "") out[key] = String(value);
    return out;
  }, [filter]);
  const list = useSmsMessages({ ...PAGE, filters });
  const resend = useConfirmedResend(pricePerPart);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const rows = list.data?.results ?? [];
  const chosen = rows.filter((m) => picked.has(m.id));
  const send = (targets: SmsMessage[]) => resend.send(targets, () => setPicked(new Set()));

  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  let body;
  if (list.isPending) {
    body = <div className="px-3 py-3"><Loading /></div>;
  } else if (list.isError || !list.data) {
    body = <div className="p-2"><LoadError what="list of what did not arrive" onRetry={() => void list.refetch()} /></div>;
  } else if (!rows.length) {
    body = <p className="px-3 py-3 text-[13px] text-muted-foreground">Everything in this range arrived.</p>;
  } else {
    body = (
      <>
        <table className={`${TABLE} hidden sm:table`}>
          <thead>
            <tr>
              <th className={`${TH} w-8`}>
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={chosen.length === rows.length}
                  onChange={() => setPicked(chosen.length === rows.length ? new Set() : new Set(rows.map((m) => m.id)))}
                />
              </th>
              <th className={TH}>Student</th>
              <th className={TH}>Phone</th>
              <th className={TH}>Why</th>
              <th className={TH}>Sent</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className={TR}>
                <td className={TD}>
                  <input type="checkbox" aria-label={`Select ${m.user?.name || m.phone}`} checked={picked.has(m.id)} onChange={() => toggle(m.id)} />
                </td>
                <td className={TD}>{m.user?.name || <span className="text-muted-foreground">—</span>}</td>
                <td className={TD}>
                  <span className="inline-flex items-center gap-1.5 tabular-nums">
                    <OperatorDot operator={m.operator} />
                    {m.phone}
                  </span>
                </td>
                <td className={TD}><StatusPill message={m} /></td>
                <td className={`${TD} text-muted-foreground`}>{dateTime(m.created_at)}</td>
                <td className={`${TD} text-right`}>
                  <button type="button" className={TEXT_BUTTON} disabled={resend.isPending} onClick={() => send([m])}>
                    Resend
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="divide-y divide-border sm:hidden">
          {rows.map((m) => (
            <li key={m.id} className="flex items-start gap-2 px-3 py-2 text-[13px]">
              <input type="checkbox" aria-label={`Select ${m.user?.name || m.phone} on a phone`} className="mt-1" checked={picked.has(m.id)} onChange={() => toggle(m.id)} />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="font-medium">{m.user?.name || m.phone}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill message={m} />
                  <OperatorDot operator={m.operator} />
                  <span className="text-muted-foreground">{m.operator}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <Section
      title={`Did not arrive${list.data ? ` (${list.data.count})` : ""}`}
      actions={
        chosen.length ? (
          <button type="button" className={TEXT_BUTTON} disabled={resend.isPending} onClick={() => send(chosen)}>
            {`Resend ${chosen.length}`}
          </button>
        ) : null
      }
    >
      {body}
    </Section>
  );
}
