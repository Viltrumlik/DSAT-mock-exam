"use client";

/**
 * /ops/telegram-posts/<id> — one post: what it says, who got it on each run, and the buttons
 * that act on exactly what the rows show. Deleting is the only way back from a wrong post, and
 * Telegram allows it for 48 hours, so the page says plainly what it could not take down.
 *
 * In the console's look (design handoff v0.3): the header's buttons, notices in their verdict's
 * tone, the message as a card and a hairline table per run. The words and the calls are the page's own.
 */

import Link from "next/link";
import { useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { Badge, Button, type BadgeTone } from "@/features/console/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import { errorBody } from "./apiError";
import { PostForm } from "./PostForm";
import { STATE_BADGE, firstLine, kindLabel, plainText, scheduleLabel } from "./audience";
import { BOX, CAPTION, CAPTION_ROW, LoadFailed, Notice, TEXT_LINK, dotted, toneOf } from "./telegramLook";
import type { DeliveryStatus, PostAction, PostActionResult } from "./telegramPostsApi";
import { usePostAction, useTelegramPost } from "./telegramPostsHooks";

const DELIVERY_BADGE: Record<DeliveryStatus, { tone: BadgeTone; label: string }> = {
  PENDING: { tone: "neutral", label: "Pending" },
  SENDING: { tone: "attention", label: "Sending" },
  SENT: { tone: "positive", label: "Sent" },
  FAILED: { tone: "critical", label: "Failed" },
  MISSED: { tone: "attention", label: "Missed" },
  DELETED: { tone: "neutral", label: "Deleted" },
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function errorText(e: unknown): string {
  const detail = errorBody(e)?.detail;
  return typeof detail === "string" ? detail : "That didn't work. Try again.";
}

/** Telegram lets a bot delete its own message for 48 hours after it was sent. */
const DELETE_WINDOW_MS = 48 * 3_600_000;

const BACK_LINK = "inline-flex items-center gap-1 self-start text-[14px] font-medium text-ms-fg-2 hover:text-ms-fg";
const TH = "h-10 whitespace-nowrap border-b border-ms-border px-3 text-left text-[13px] font-medium text-ms-fg-3 first:pl-5 last:pr-5";
const TD = "border-b border-ms-line px-3 py-2.5 first:pl-5 last:pr-5";

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
      <div className={`animate-ms-card-in flex flex-col items-center gap-2 px-5 py-10 text-center ${BOX}`}>
        <span className="grid size-12 place-items-center rounded-full bg-ms-surface-2 text-ms-fg-3">
          <Icon name="search" size="lg" />
        </span>
        <p className="text-[16px] font-semibold text-ms-fg">That post doesn&apos;t exist.</p>
        <Link href="/ops/telegram-posts" className={`text-[14px] ${TEXT_LINK}`}>
          Back to Telegram posts
        </Link>
      </div>
    );
  }
  if (post.isPending) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-3">
        <span className="sr-only">Loading…</span>
        <div className="h-16 animate-ms-shimmer rounded-ms-card bg-ms-surface-2" />
        <div className="h-40 animate-ms-shimmer rounded-ms-card bg-ms-surface-2" />
      </div>
    );
  }
  if (post.isError || !post.data) {
    return (
      <div className={BOX}>
        <LoadFailed onRetry={() => void post.refetch()}>The post didn&apos;t load.</LoadFailed>
      </div>
    );
  }

  const p = post.data;
  const state = STATE_BADGE[p.state];
  const stateTone = toneOf(state.variant);
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
    <div className="flex flex-col gap-5">
      <Link href="/ops/telegram-posts" className={BACK_LINK}>
        <Icon name="left" size="sm" />
        Telegram posts
      </Link>

      <OpsPageHeader
        section="Telegram posts"
        title={firstLine(p.preview || p.text) || "Post"}
        // A "Now" post has no schedule to name; an empty slot would leave "Now ·  · All groups".
        description={[kindLabel(p), scheduleLabel(p), p.audience_label].filter(Boolean).join(" · ")}
        actions={
          <>
            {editable ? (
              <Button size="sm" variant="secondary" icon="pencil" onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
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
              <Button size="sm" variant="primary" icon="refresh" disabled={busy} onClick={retry}>
                Retry failed
              </Button>
            ) : null}
            {live && last?.missed ? (
              <Button size="sm" variant="primary" icon="send" disabled={busy} onClick={sendMissed}>
                Send missed now
              </Button>
            ) : null}
            {live || reachable.size > 0 ? (
              <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={deleteFromGroups}>
                Delete from groups
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-ms-fg-2">
        <Badge tone={stateTone} dot={dotted(stateTone)}>
          {state.label}
        </Badge>
        {p.event_id ? (
          <Link href="/ops/events" className={`inline-flex items-center gap-1.5 ${TEXT_LINK}`}>
            <Icon name="ticket" size="sm" className="size-3.5" />
            Event: {p.event_title}
          </Link>
        ) : null}
        {p.next_send_at ? (
          <span className="inline-flex items-center gap-1.5">
            <Icon name="clock" size="sm" className="size-3.5 text-ms-fg-3" />
            Next: {new Date(p.next_send_at).toLocaleString()}
          </span>
        ) : null}
      </div>

      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {hint ? <Notice tone="warning">{hint}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <section className={`animate-ms-card-in p-5 ${BOX}`}>
        <p className={`mb-3 ${CAPTION}`}>The message</p>
        {p.image_url ? (
          // A signed, expiring R2 URL — not a host next/image is configured for.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image_url} alt="" className="mb-3 max-h-64 rounded-ms-ctl border border-ms-border" />
        ) : null}
        <p className="whitespace-pre-wrap text-[15px] leading-6 text-ms-fg">{plainText(p.preview || p.text)}</p>
      </section>

      {p.runs.length === 0 ? (
        <p className="text-[14px] text-ms-fg-3">Nothing has been sent yet.</p>
      ) : (
        p.runs.map((run, i) => (
          <section key={run.run_on} style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }} className={`animate-ms-card-in ${BOX}`}>
            <div className={CAPTION_ROW}>
              <p className={`${CAPTION} tabular-nums`}>{run.run_on}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0 text-[14px] text-ms-fg">
                <thead>
                  <tr>
                    <th className={TH}>Group</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>Sent</th>
                    <th className={TH}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {run.deliveries.map((d) => {
                    const badge = DELIVERY_BADGE[d.status];
                    return (
                      <tr key={d.id} className="ms-transition hover:bg-ms-surface [&:last-child>td]:border-b-0">
                        <td className={`${TD} font-medium`}>{d.group_names || d.chat_id}</td>
                        <td className={TD}>
                          <Badge tone={badge.tone} dot={dotted(badge.tone)}>
                            {badge.label}
                          </Badge>
                        </td>
                        <td className={`${TD} whitespace-nowrap text-[13px] tabular-nums text-ms-fg-2`}>
                          {d.sent_at ? new Date(d.sent_at).toLocaleTimeString() : ""}
                        </td>
                        <td className={`${TD} text-[13px] text-ms-fg-3`}>{d.error}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      {editing ? <PostForm post={p} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
