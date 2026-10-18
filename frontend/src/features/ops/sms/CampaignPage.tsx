"use client";

/**
 * /ops/sms/campaigns/<id> — one campaign: what it said, to whom, when, and how each SMS went.
 *
 * Only the buttons its state allows: Cancel while it is SCHEDULED (the server claims a campaign
 * SCHEDULED→SENDING in one update, so a cancel that loses that race is refused, and says so), and
 * Retry failed once it is DONE with FAILED messages. Retry never resends an UNCERTAIN message —
 * eskiz may already have it — so the count it asks about is the FAILED rows only.
 */

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

import { Alert, Badge, Button } from "@/components/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import { campaignBadge, dateTime, money, plural, roleLabel, statusBadge } from "./format";
import { BOX, CAPTION_TEXT, LoadError, Loading, Section, SkippedList, TABLE, TD, TH, TR, errorText } from "./panelKit";
import type { Campaign } from "./smsApi";
import { useCancelCampaign, useRetryCampaign, useSmsCampaign, useSmsOverview } from "./smsHooks";
import { smsTabHref } from "./smsTabs";

const BACK = (
  <Link
    href={smsTabHref("campaigns")}
    className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"
  >
    <ArrowLeft className="h-4 w-4" aria-hidden />
    Campaigns
  </Link>
);

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 border-b border-border px-3 py-1.5 text-[13px] last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}

/** "Student's name · Same text for all: "Mock imtihon"" — what fills each slot. */
function slotsLabel(c: Campaign): string {
  if (c.slot_roles.length === 0) return "No slots";
  return c.slot_roles
    .map((role, i) => (role === "text" ? `${roleLabel(role)}: “${c.slot_texts[i] ?? ""}”` : roleLabel(role)))
    .join(" · ");
}

const RESULT_FIGURES: { key: keyof Campaign["result"]; label: string }[] = [
  { key: "sent", label: "sent" },
  { key: "delivered", label: "delivered" },
  { key: "undelivered", label: "not delivered" },
  { key: "failed", label: "failed" },
  { key: "rejected", label: "rejected" },
  { key: "uncertain", label: "uncertain" },
  { key: "errors", label: "errors" },
];

export function CampaignPage({ id }: { id: number }) {
  const detail = useSmsCampaign(id);
  const cancel = useCancelCampaign(id);
  const retry = useRetryCampaign(id);
  const overview = useSmsOverview();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A disabled v5 query reports "pending" forever, so a bad address has to be caught first.
  if (!Number.isInteger(id) || id <= 0) {
    return (
      <div className="space-y-2 py-8 text-center">
        <p className="text-sm font-semibold text-foreground">That campaign doesn&apos;t exist.</p>
        {BACK}
      </div>
    );
  }
  if (detail.isPending) return <Loading />;
  if (detail.isError || !detail.data) {
    return (
      <div className="space-y-3">
        {BACK}
        <LoadError what="campaign" onRetry={() => void detail.refetch()} />
      </div>
    );
  }

  const { campaign: c, messages } = detail.data;
  const badge = campaignBadge(c.status);
  const failed = messages.filter((m) => m.status === "FAILED");
  const canCancel = c.status === "SCHEDULED";
  const canRetry = c.status === "DONE" && failed.length > 0;
  const busy = cancel.isPending || retry.isPending;
  const price = overview.data?.price_per_part;
  const started = c.status !== "SCHEDULED" && c.status !== "CANCELLED";

  const onCancel = () => {
    if (!window.confirm("Cancel this campaign? Nothing has been sent yet, and nothing will be.")) return;
    setNotice(null);
    setError(null);
    cancel.mutate(undefined, {
      onSuccess: () => setNotice("Cancelled. Nothing was sent."),
      onError: (e) => setError(errorText(e)),
    });
  };

  const onRetry = () => {
    const parts = failed.reduce((sum, m) => sum + (m.parts || 1), 0);
    const cost = price ? ` (~${money(parts * price)})` : "";
    if (!window.confirm(`Send again to ${plural(failed.length, "recipient")} whose SMS failed${cost}?`)) return;
    setNotice(null);
    setError(null);
    retry.mutate(undefined, {
      onSuccess: (r) => setNotice(`Sending again to ${plural(r.queued, "recipient")}.`),
      onError: (e) => setError(errorText(e)),
    });
  };

  return (
    <div className="space-y-4">
      {BACK}
      <OpsPageHeader
        section="SMS"
        title={`Campaign #${c.id}`}
        description={`${c.audience_label} · ${dateTime(c.scheduled_at)}`}
        actions={
          <>
            {canCancel ? (
              <Button size="sm" variant="danger" disabled={busy} onClick={onCancel}>
                Cancel campaign
              </Button>
            ) : null}
            {canRetry ? (
              <Button size="sm" disabled={busy} onClick={onRetry}>
                Retry failed
              </Button>
            ) : null}
          </>
        }
      />

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {c.error ? <Alert tone="danger">{c.error}</Alert> : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Section title="The campaign">
          <dl>
            <Row label="Status">
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </Row>
            <Row label="To">{c.audience_label}</Row>
            <Row label="Goes out">{dateTime(c.scheduled_at)}</Row>
            <Row label="Started">{dateTime(c.started_at)}</Row>
            <Row label="Finished">{dateTime(c.finished_at)}</Row>
            <Row label="By">{c.created_by_name || "—"}</Row>
            <Row label="Created">{dateTime(c.created_at)}</Row>
          </dl>
        </Section>

        <Section title={`Template #${c.template_eskiz_id}`}>
          <div className="space-y-2 px-3 py-2.5 text-[13px]">
            <p className="whitespace-pre-wrap">{c.original || c.pattern}</p>
            <p className="whitespace-pre-wrap text-muted-foreground">{c.pattern}</p>
            <p>
              <span className="text-muted-foreground">Slots: </span>
              {slotsLabel(c)}
            </p>
          </div>
        </Section>
      </div>

      {started ? (
        <Section title="Result">
          <div className="space-y-3 px-3 py-2.5">
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] tabular-nums">
              {RESULT_FIGURES.map(({ key, label }) => (
                <li key={key}>
                  <span className="font-semibold text-foreground">{Number(c.result?.[key] ?? 0)}</span> {label}
                </li>
              ))}
            </ul>
            <div>
              <p className={`${CAPTION_TEXT} mb-1`}>Left out</p>
              <SkippedList skipped={c.result?.skipped} />
            </div>
          </div>
        </Section>
      ) : null}

      {messages.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Nothing has been sent yet.</p>
      ) : (
        <div className={`${BOX} overflow-x-auto`}>
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Recipient</th>
                <th className={TH}>Phone</th>
                <th className={TH}>Status</th>
                <th className={`${TH} text-right`}>Parts</th>
                <th className={TH}>Sent</th>
                <th className={TH}>Note</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => {
                const s = statusBadge(m.status);
                return (
                  <tr key={m.id} className={TR}>
                    <td className={`${TD} whitespace-nowrap`}>{m.user?.name || "—"}</td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>{m.phone}</td>
                    <td className={TD}>
                      <span title={m.eskiz_status ? `eskiz: ${m.eskiz_status}` : undefined}>
                        <Badge variant={s.variant}>{s.label}</Badge>
                      </span>
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>{m.parts}</td>
                    <td className={`${TD} whitespace-nowrap`}>{dateTime(m.sent_at)}</td>
                    <td className={`${TD} text-muted-foreground`}>{m.error}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
