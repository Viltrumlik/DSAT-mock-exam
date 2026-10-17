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
import { errorBody } from "./apiError";
import { PostForm } from "./PostForm";
import { STATE_BADGE, firstLine, kindLabel, plainText, scheduleLabel } from "./audience";
import type { DeliveryStatus, PostAction, PostActionResult } from "./telegramPostsApi";
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
  const detail = errorBody(e)?.detail;
  return typeof detail === "string" ? detail : "That didn't work. Try again.";
}

/** Telegram lets a bot delete its own message for 48 hours after it was sent. */
const DELETE_WINDOW_MS = 48 * 3_600_000;

export function TelegramPostPage({ id }: { id: number }) {
  const post = useTelegramPost(id);
  const action = usePostAction(id);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  // A disabled v5 query reports "pending" forever, so a bad address has to be caught first.
  if (!Number.isInteger(id) || id <= 0) {
    return (
      <div className="space-y-2 px-5 py-8 text-center">
        <p className="text-sm font-semibold text-foreground">That post doesn&apos;t exist.</p>
        <Link href="/ops/telegram-posts" className="text-sm font-bold text-primary underline">
          Back to Telegram posts
        </Link>
      </div>
    );
  }
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
  const busy = action.isPending;
  const editable = live && p.kind === "MANUAL" && (p.when === "WEEKLY" || !last);

  // What the bot can still take down is read off the rows, not off the last run: a weekly post's
  // last run may be days old, and a run's `sent` counts messages already out of reach. It also keeps
  // the button for a post that is already deleted, so a message that would not come down can be
  // tried again (the server's verb is idempotent).
  const reachable = new Set(
    p.runs
      .flatMap((r) => r.deliveries)
      .filter((d) => d.status === "SENT" && d.sent_at && Date.now() - new Date(d.sent_at).getTime() < DELETE_WINDOW_MS)
      .map((d) => d.chat_id),
  );

  const perform = (verb: PostAction, describe: (result: PostActionResult) => string) => {
    setError(null);
    setNotice(null);
    setHint(null);
    action.mutate(verb, {
      onSuccess: (data) => setNotice(describe(data.result)),
      onError: (e) => setError(errorText(e)),
    });
  };

  const retry = () => {
    // Retry never resends a failure that may already be in its group (an interrupted send, no
    // answer from Telegram): a second copy in a class group cannot be unsent in bulk.
    const uncertain = last?.uncertain ?? 0;
    const n = (last?.failed ?? 0) - uncertain;
    if (n <= 0) {
      setError(null);
      setNotice(null);
      setHint("Nothing to resend — the failed groups may already have the post. Check them by hand.");
      return;
    }
    const question =
      `Send this post again to ${plural(n, "Telegram group")}?` +
      (uncertain > 0 ? ` ${uncertain} may already be in their group and are not resent — check them by hand.` : "");
    if (!window.confirm(question)) return;
    perform("retry", (r) =>
      [
        `Sending again to ${plural(r.queued ?? 0, "group")}.`,
        r.uncertain ? `${r.uncertain} may already be in their group and were not resent — check them by hand.` : "",
      ].filter(Boolean).join(" "),
    );
  };

  const sendMissed = () => {
    const n = last?.missed ?? 0;
    if (!window.confirm(`Send this post now to ${plural(n, "Telegram group")} that missed it?`)) return;
    perform("send-missed", (r) => `Sending to ${plural(r.queued ?? 0, "group")} now.`);
  };

  const deleteFromGroups = () => {
    const everSent = p.runs.some((r) => r.deliveries.some((d) => d.sent_at));
    const question = everSent
      ? `Delete this post from ${plural(reachable.size, "Telegram group")} and stop it for good? ` +
        "Messages older than 48 hours can't be deleted by the bot."
      : "Stop this post for good? It hasn't been sent to any group yet.";
    if (!window.confirm(question)) return;
    perform("delete-from-groups", (r) =>
      [
        `Deleted from ${plural(r.deleted ?? 0, "group")}.`,
        r.too_old ? `${r.too_old} too old — remove it by hand.` : "",
        r.failed ? `${r.failed} could not be deleted.` : "",
        r.in_flight ? `${r.in_flight} still sending — removed as they land.` : "",
        r.unknown ? `${r.unknown} may still be in their group — check by hand.` : "",
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
        // A "Now" post has no schedule to name; an empty slot would leave "Now ·  · All groups".
        description={[kindLabel(p), scheduleLabel(p), p.audience_label].filter(Boolean).join(" · ")}
        actions={
          <div className="flex flex-wrap gap-2">
            {editable ? <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit</Button> : null}
            {/* Resume for anything paused, whatever its kind: the server lets any post be paused. */}
            {live && p.is_paused ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => perform("resume", () => "Resumed. What the pause covered stays skipped.")}
              >
                Resume
              </Button>
            ) : live && repeats ? (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => perform("pause", () => "Paused.")}>
                Pause
              </Button>
            ) : null}
            {live && last?.failed ? (
              <Button size="sm" disabled={busy} onClick={retry}>Retry failed</Button>
            ) : null}
            {live && last?.missed ? (
              <Button size="sm" disabled={busy} onClick={sendMissed}>Send missed now</Button>
            ) : null}
            {live || reachable.size > 0 ? (
              <Button size="sm" variant="danger" disabled={busy} onClick={deleteFromGroups}>Delete from groups</Button>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
        <Badge variant={state.variant}>{state.label}</Badge>
        {p.event_id ? <Link href="/ops/events" className="underline">Event: {p.event_title}</Link> : null}
        {p.next_send_at ? <span>Next: {new Date(p.next_send_at).toLocaleString()}</span> : null}
      </div>

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {hint ? <Alert tone="warning">{hint}</Alert> : null}
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
