"use client";

/**
 * /ops/telegram-posts/<id> — one post: what it says, who got it on each run, and the buttons
 * that act on exactly what the rows show. Deleting is the only way back from a wrong post, and
 * Telegram allows it for 48 hours, so the page says plainly what it could not take down.
 */

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";

import { Alert, Badge, Button } from "@/components/ui";
import type { BadgeVariant } from "@/components/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import { PostForm } from "./PostForm";
import { STATE_BADGE, firstLine, kindLabel, plainText, scheduleLabel } from "./audience";
import type { DeliveryStatus, PostAction } from "./telegramPostsApi";
import { usePostAction, useTelegramPost } from "./telegramPostsHooks";

const DELIVERY_BADGE: Record<DeliveryStatus, { variant: BadgeVariant; label: string }> = {
  PENDING: { variant: "neutral", label: "Pending" },
  SENDING: { variant: "warning", label: "Sending" },
  SENT: { variant: "success", label: "Sent" },
  FAILED: { variant: "danger", label: "Failed" },
  MISSED: { variant: "warning", label: "Missed" },
  DELETED: { variant: "neutral", label: "Deleted" },
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function errorText(e: unknown): string {
  const data = (e as { response?: { data?: Record<string, unknown> } })?.response?.data;
  return typeof data?.detail === "string" ? data.detail : "That didn't work. Try again.";
}

export function TelegramPostPage({ id }: { id: number }) {
  const post = useTelegramPost(id);
  const action = usePostAction(id);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (post.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (post.isError || !post.data) {
    return (
      <div className="px-5 py-8 text-center">
        <p className="text-sm font-semibold text-foreground">The post didn&apos;t load.</p>
        <button type="button" onClick={() => void post.refetch()} className="mt-1 text-sm font-bold text-primary underline">
          Try again
        </button>
      </div>
    );
  }

  const p = post.data;
  const state = STATE_BADGE[p.state];
  const last = p.last_run;
  const live = !p.deleted_at;
  const repeats = p.when === "WEEKLY" || p.when === "EVENT";
  const editable = live && p.kind === "MANUAL" && (p.when === "WEEKLY" || !last);

  const perform = (verb: PostAction, describe: (result: Record<string, number>) => string) => {
    setError(null);
    setNotice(null);
    action.mutate(verb, {
      onSuccess: (data) => setNotice(describe(data.result)),
      onError: (e) => setError(errorText(e)),
    });
  };

  const deleteFromGroups = () => {
    const sent = last?.sent ?? 0;
    const question =
      `Delete this post from ${plural(sent, "Telegram group")}${repeats ? " and stop it for good" : ""}? ` +
      "The bot can only delete what it sent in the last 48 hours.";
    if (!window.confirm(question)) return;
    perform("delete-from-groups", (r) =>
      [
        `Deleted from ${plural(r.deleted ?? 0, "group")}.`,
        r.too_old ? `${r.too_old} too old — remove it by hand.` : "",
        r.failed ? `${r.failed} could not be deleted.` : "",
        r.in_flight ? `${r.in_flight} still sending — removed as they land.` : "",
      ].filter(Boolean).join(" "),
    );
  };

  return (
    <div className="space-y-5">
      <Link href="/ops/telegram-posts" className="inline-flex items-center gap-1 text-sm font-bold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Telegram posts
      </Link>

      <OpsPageHeader
        section="Telegram posts"
        title={firstLine(p.preview || p.text) || "Post"}
        description={`${kindLabel(p)} · ${scheduleLabel(p)} · ${p.audience_label}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {editable ? <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit</Button> : null}
            {live && repeats ? (
              p.is_paused ? (
                <Button size="sm" variant="secondary" onClick={() => perform("resume", () => "Resumed. What the pause covered stays skipped.")}>
                  Resume
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => perform("pause", () => "Paused.")}>Pause</Button>
              )
            ) : null}
            {live && last?.failed ? (
              <Button size="sm" onClick={() => perform("retry", (r) => `Sending again to ${plural(r.queued ?? 0, "group")}.`)}>
                Retry failed
              </Button>
            ) : null}
            {live && last?.missed ? (
              <Button size="sm" onClick={() => perform("send-missed", (r) => `Sending to ${plural(r.queued ?? 0, "group")} now.`)}>
                Send missed now
              </Button>
            ) : null}
            {live ? <Button size="sm" variant="danger" onClick={deleteFromGroups}>Delete from groups</Button> : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
        <Badge variant={state.variant}>{state.label}</Badge>
        {p.event_id ? <Link href="/ops/events" className="underline">Event: {p.event_title}</Link> : null}
        {p.next_send_at ? <span>Next: {new Date(p.next_send_at).toLocaleString()}</span> : null}
      </div>

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">The message</p>
        {p.image_url ? (
          // A signed, expiring R2 URL — not a host next/image is configured for.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image_url} alt="" className="mb-3 max-h-64 rounded-xl" />
        ) : null}
        <p className="whitespace-pre-wrap text-sm">{plainText(p.preview || p.text)}</p>
      </div>

      {p.runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing has been sent yet.</p>
      ) : (
        p.runs.map((run) => (
          <section key={run.run_on} className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="border-b border-border bg-surface-2 px-5 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{run.run_on}</p>
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2 font-semibold">Group</th>
                  <th className="px-2 py-2 font-semibold">Status</th>
                  <th className="px-2 py-2 font-semibold">Sent</th>
                  <th className="px-5 py-2 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {run.deliveries.map((d) => {
                  const badge = DELIVERY_BADGE[d.status];
                  return (
                    <tr key={d.id}>
                      <td className="px-5 py-2 font-semibold">{d.group_names || d.chat_id}</td>
                      <td className="px-2 py-2"><Badge variant={badge.variant}>{badge.label}</Badge></td>
                      <td className="px-2 py-2 text-xs">{d.sent_at ? new Date(d.sent_at).toLocaleTimeString() : ""}</td>
                      <td className="px-5 py-2 text-xs text-muted-foreground">{d.error}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))
      )}

      {editing ? <PostForm post={p} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
