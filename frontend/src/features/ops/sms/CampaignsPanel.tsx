"use client";

/**
 * Campaigns ("jo'natma"): every manual send — to one or more students, some classes, a filter or
 * the debtors, now or at a set time. Newest first; a row opens the campaign's page, where it can be
 * cancelled while it waits and its failures retried once it is done. "New campaign" opens the composer.
 */

import Link from "next/link";
import { Send } from "lucide-react";

import { Badge } from "@/components/ui";
import { DeliveryRing, ringOf } from "./DeliveryRing";
import { campaignBadge, dateTime, firstLine } from "./format";
import { LiveDot } from "./look";
import { BOX, LINK_BUTTON, LoadError, Loading } from "./panelKit";
import type { Campaign } from "./smsApi";
import { useSmsCampaigns } from "./smsHooks";
import { NEW_CAMPAIGN_PATH, campaignHref } from "./smsTabs";

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
  const rows = campaigns.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] text-muted-foreground">
          Recipients are worked out when a campaign sends: a debtor who has paid by then is skipped.
        </p>
        <Link href={NEW_CAMPAIGN_PATH} className={`${LINK_BUTTON} ml-auto`}>
          <Send className="h-4 w-4" aria-hidden />
          New campaign
        </Link>
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
            Send an approved template to a student, some classes, a filter or every debtor.
          </p>
        </div>
      ) : (
        <ul className={`${BOX} divide-y divide-border`}>
          {rows.map((c) => {
            const badge = campaignBadge(c.status);
            const ring = ringOf(c);
            return (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2 hover:bg-surface-2">
                {/* The same width either way, so the rows' text lines up. */}
                <div className="w-[52px] shrink-0">{ring ? <DeliveryRing {...ring} /> : null}</div>
                <div className="min-w-0 flex-1 text-[13px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    {c.status === "SENDING" ? <LiveDot /> : null}
                    <Link
                      href={campaignHref(c.id)}
                      title={c.original || c.pattern}
                      className="min-w-0 truncate font-medium text-primary hover:underline dark:text-primary-hover"
                    >
                      {firstLine(c.original || c.pattern) || `Campaign #${c.id}`}
                    </Link>
                  </div>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {[c.audience_label, dateTime(c.scheduled_at), c.created_by_name, resultLabel(c)].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
