"use client";

/**
 * The eskiz templates, as the panel caches them (synced by Refresh here and every morning at
 * 09:00). eskiz sends only a text that matches one of its moderated templates character for
 * character, so each row shows both halves: the pattern eskiz approved, with its %w / %d slots,
 * beside the text as it was written, with its (STUDENT) placeholders — the panel guesses each
 * slot's role from those.
 *
 * Only `service` and `reklama` templates can be sent; `reklama` is billed at eskiz's advertising
 * price, so it reads "Ad price". One character outside plain Latin (an Uzbek ʻ or ‘) makes every
 * SMS of a template 70 characters a part instead of 160 — about twice the price — so it is flagged.
 */

import { useState } from "react";
import { FileText, RefreshCw } from "lucide-react";

import { useToast } from "@/components/ToastProvider";
import { Badge, Button } from "@/components/ui";
import { dateTime, roleLabel, slotLabel, templateBadge } from "./format";
import { BOX, LoadError, Loading, TABLE, TD, TH, TR, errorText } from "./panelKit";
import type { EskizTemplate } from "./smsApi";
import { useSmsTemplates, useSyncTemplates } from "./smsHooks";
import { SubmitTemplateModal } from "./SubmitTemplateModal";

/** "1–4 words · Student's name; a number · Debt amount" — each slot and the role guessed for it. */
export function slotsSummary(t: Pick<EskizTemplate, "slots" | "guessed_roles">): string {
  if (t.slots.length === 0) return "—";
  return t.slots
    .map((slot, i) => [slotLabel(slot), t.guessed_roles[i] ? roleLabel(t.guessed_roles[i]) : ""].filter(Boolean).join(" · "))
    .join("; ");
}

const WIDE = "block max-w-[22rem] whitespace-pre-wrap break-words";

export function TemplatesPanel() {
  const templates = useSmsTemplates();
  const sync = useSyncTemplates();
  const { push } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const rows = templates.data?.templates ?? [];
  const syncedAt = templates.data?.synced_at ?? null;

  const refresh = () =>
    sync.mutate(undefined, {
      onSuccess: (r) =>
        push({
          tone: "success",
          message: `Templates refreshed: ${r.added} added, ${r.updated} updated, ${r.gone} gone — ${r.total} in all.`,
        }),
      onError: (e) => push({ tone: "error", message: errorText(e, "Couldn't reach eskiz. Try again.") }),
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] text-muted-foreground">
          {syncedAt ? `Last synced ${dateTime(syncedAt)}.` : "Never synced."} Only service and ad-price templates can be
          sent.
        </p>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={refresh} loading={sync.isPending}>
            {sync.isPending ? null : <RefreshCw className="h-4 w-4" aria-hidden />}
            Refresh from eskiz
          </Button>
          <Button size="sm" onClick={() => setSubmitting(true)}>
            <FileText className="h-4 w-4" aria-hidden />
            New template
          </Button>
        </div>
      </div>

      {templates.isPending ? (
        <Loading />
      ) : templates.isError ? (
        <LoadError what="templates" onRetry={() => void templates.refetch()} />
      ) : rows.length === 0 ? (
        <div className={`${BOX} px-3 py-10 text-center`}>
          <FileText className="mx-auto mb-2 h-7 w-7 text-muted-foreground" aria-hidden />
          <p className="text-[13px] font-semibold text-foreground">No templates yet</p>
          <p className="mt-1 text-[13px] text-muted-foreground">Refresh from eskiz to load the account&apos;s templates.</p>
        </div>
      ) : (
        <div className={`${BOX} overflow-x-auto`}>
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>ID</th>
                <th className={TH}>Status</th>
                <th className={TH}>What eskiz approved</th>
                <th className={TH}>As written</th>
                <th className={TH}>Slots</th>
                <th className={`${TH} text-right`}>Parts</th>
                <th className={TH}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const badge = templateBadge(t.status);
                return (
                  <tr key={t.eskiz_id} className={`${TR} align-top`}>
                    <td className={`${TD} tabular-nums`}>{t.eskiz_id}</td>
                    <td className={TD}>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </td>
                    <td className={TD}>
                      <span className={WIDE}>{t.pattern}</span>
                    </td>
                    <td className={TD}>
                      <span className={`${WIDE} text-muted-foreground`}>{t.original || "—"}</span>
                    </td>
                    <td className={`${TD} text-[12px]`}>{slotsSummary(t)}</td>
                    <td className={`${TD} text-right tabular-nums`}>{t.parts}</td>
                    <td className={`${TD} space-y-1 text-[12px]`}>
                      {t.ascii ? null : (
                        <span
                          className="block"
                          title="One character outside plain Latin makes every SMS 70 characters a part instead of 160 — about twice the price."
                        >
                          <Badge variant="warning">Not plain Latin</Badge>
                        </span>
                      )}
                      {t.submitted_by_name ? (
                        <span className="block text-muted-foreground">
                          Submitted by {t.submitted_by_name}
                          {t.submitted_at ? `, ${dateTime(t.submitted_at)}` : ""}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {submitting ? <SubmitTemplateModal onClose={() => setSubmitting(false)} /> : null}
    </div>
  );
}
