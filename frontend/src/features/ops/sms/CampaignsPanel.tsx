"use client";

/**
 * Campaigns ("jo'natma"): every manual send — to one or more students, a class or the debtors,
 * now or at a set time. Newest first; a row opens the campaign's page, where it can be cancelled
 * while it waits and its failures retried once it is done. "New campaign" opens the wizard.
 */

import Link from "next/link";
import { useState } from "react";
import { Send } from "lucide-react";

import { Badge, Button } from "@/components/ui";
import { CampaignWizard } from "./CampaignWizard";
import { campaignBadge, dateTime, firstLine } from "./format";
import { BOX, LoadError, Loading, TABLE, TD, TH, TR } from "./panelKit";
import type { Campaign } from "./smsApi";
import { useSmsCampaigns } from "./smsHooks";
import { campaignHref } from "./smsTabs";

/** "12 sent · 10 delivered · 1 failed" — empty before anything went out. */
export function resultLabel(c: Pick<Campaign, "result">): string {
  const r = c.result ?? {};
  if (!r.sent && !r.failed && !r.delivered) return "";
  const parts = [`${r.sent ?? 0} sent`, `${r.delivered ?? 0} delivered`];
  if (r.failed) parts.push(`${r.failed} failed`);
  if (r.uncertain) parts.push(`${r.uncertain} uncertain`);
  return parts.join(" · ");
}

export function CampaignsPanel() {
  const campaigns = useSmsCampaigns();
  const [creating, setCreating] = useState(false);
  const rows = campaigns.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] text-muted-foreground">
          Recipients are worked out when a campaign sends: a debtor who has paid by then is skipped.
        </p>
        <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}>
          <Send className="h-4 w-4" aria-hidden />
          New campaign
        </Button>
      </div>

      {campaigns.isPending ? (
        <Loading />
      ) : campaigns.isError ? (
        <LoadError what="campaigns" onRetry={() => void campaigns.refetch()} />
      ) : rows.length === 0 ? (
        <div className={`${BOX} px-3 py-10 text-center`}>
          <Send className="mx-auto mb-2 h-7 w-7 text-muted-foreground" aria-hidden />
          <p className="text-[13px] font-semibold text-foreground">No campaigns yet</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Send an approved template to a student, a class or every debtor.
          </p>
        </div>
      ) : (
        <div className={`${BOX} overflow-x-auto`}>
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Status</th>
                <th className={TH}>Text</th>
                <th className={TH}>To</th>
                <th className={TH}>When</th>
                <th className={TH}>Result</th>
                <th className={TH}>By</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const badge = campaignBadge(c.status);
                return (
                  <tr key={c.id} className={TR}>
                    <td className={TD}>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </td>
                    <td className={TD}>
                      <Link
                        href={campaignHref(c.id)}
                        title={c.original || c.pattern}
                        className="block max-w-[26rem] truncate font-medium text-primary hover:underline dark:text-primary-hover"
                      >
                        {firstLine(c.original || c.pattern) || `Campaign #${c.id}`}
                      </Link>
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>{c.audience_label}</td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>{dateTime(c.scheduled_at)}</td>
                    <td className={`${TD} whitespace-nowrap text-muted-foreground`}>{resultLabel(c) || "—"}</td>
                    <td className={`${TD} whitespace-nowrap`}>{c.created_by_name || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {creating ? <CampaignWizard onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
