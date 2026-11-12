"use client";

/**
 * Broadcast: one announcement to a whole audience, in every inbox it reaches (owner, 2026-10-13:
 * "Xabar yuborishda tanlash" — the learning center's students and the public learners are two
 * audiences now, and the sender picks).
 *
 * super_admin only, like the endpoint: a broadcast cannot be recalled once phones have buzzed,
 * so the page asks for a review that names the audience before anything goes out.
 *
 * In the console's look (design handoff v0.3): a card, the console's fields and buttons, the
 * review as a soft primary panel. The words, the review step and the call are the page's own.
 */

import { useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { Button } from "@/features/console/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import { AREA, CheckRow, FormField, Notice, Panel } from "@/features/ops/settings/settingsParts";
import { CONTROL } from "@/features/questionsAdmin/questionLook";
import {
  notificationsApi,
  type BroadcastAudience,
  type BroadcastPayload,
  type BroadcastResult,
} from "@/features/notifications/notificationsApi";
import { useMe } from "@/hooks/useMe";
import { formatApiErrorForToast } from "@/lib/apiError";

const AUDIENCES: { value: BroadcastAudience; label: string }[] = [
  { value: "centre_students", label: "Learning center students" },
  { value: "public_students", label: "Public students" },
  { value: "all_students", label: "All students" },
  { value: "teachers", label: "Teachers" },
  { value: "staff", label: "Staff" },
  { value: "all", label: "Everyone" },
];

const TITLE_MAX = 160;
const BODY_MAX = 400;

const audienceLabel = (value: BroadcastAudience) => AUDIENCES.find((a) => a.value === value)?.label ?? value;

export default function BroadcastPage() {
  const { me } = useMe();
  const role = String((me as { role?: string; is_superuser?: boolean } | undefined)?.role ?? "").toLowerCase();
  const isSuperAdmin = role === "super_admin" || Boolean((me as { is_superuser?: boolean } | undefined)?.is_superuser);

  const [audience, setAudience] = useState<BroadcastAudience>("centre_students");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [push, setPush] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState<BroadcastResult | null>(null);

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col gap-5">
        <OpsPageHeader section="Broadcast" title="Broadcast" />
        <Notice tone="info">Only a super admin can send a broadcast.</Notice>
      </div>
    );
  }

  const review = () => {
    setFailure(null);
    setSent(null);
    if (!title.trim()) {
      setTitleError("Give the message a title.");
      return;
    }
    setTitleError(null);
    setReviewing(true);
  };

  const send = async () => {
    setSending(true);
    setFailure(null);
    const payload: BroadcastPayload = { title: title.trim(), audience, push };
    if (body.trim()) payload.body = body.trim();
    if (link.trim()) payload.link_url = link.trim();
    try {
      setSent(await notificationsApi.broadcast(payload));
      setReviewing(false);
      setTitle("");
      setBody("");
      setLink("");
      setPush(false);
    } catch (err) {
      // The message stays as typed: a failed send must not cost the sender their words.
      setFailure(formatApiErrorForToast(err));
      setReviewing(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <OpsPageHeader
        section="Broadcast"
        title="Broadcast"
        description="One announcement to a whole audience. It lands in every inbox it reaches and cannot be recalled."
      />

      <Panel title="New announcement" icon="ms-broadcast" className="max-w-3xl">
        <div className="flex flex-col gap-4 p-4 sm:p-5">
          <FormField label="Audience" htmlFor="broadcast-audience">
            <select
              id="broadcast-audience"
              className={CONTROL}
              value={audience}
              disabled={reviewing}
              onChange={(e) => setAudience(e.target.value as BroadcastAudience)}
            >
              {AUDIENCES.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            label="Title"
            htmlFor="broadcast-title"
            required
            error={titleError ?? undefined}
            hint={`Up to ${TITLE_MAX} characters.`}
          >
            <input
              id="broadcast-title"
              className={CONTROL}
              value={title}
              maxLength={TITLE_MAX}
              disabled={reviewing}
              aria-invalid={titleError ? true : undefined}
              onChange={(e) => setTitle(e.target.value)}
            />
          </FormField>
          <FormField label="Message" htmlFor="broadcast-body" hint={`Optional. Up to ${BODY_MAX} characters.`}>
            <textarea
              id="broadcast-body"
              className={AREA}
              rows={3}
              value={body}
              maxLength={BODY_MAX}
              disabled={reviewing}
              onChange={(e) => setBody(e.target.value)}
            />
          </FormField>
          <FormField label="Link" htmlFor="broadcast-link" hint="Optional. A page on the site, such as /events.">
            <input
              id="broadcast-link"
              className={CONTROL}
              value={link}
              placeholder="/events"
              disabled={reviewing}
              onChange={(e) => setLink(e.target.value)}
            />
          </FormField>
          <CheckRow id="broadcast-push" checked={push} disabled={reviewing} onChange={setPush}>
            Also send it as a push notification to phones and browsers
          </CheckRow>

          {failure ? <Notice tone="danger">{failure}</Notice> : null}
          {sent ? (
            <Notice tone="success">
              Sent to {sent.recipients} {sent.recipients === 1 ? "person" : "people"}
              {sent.notified !== sent.recipients ? ` (${sent.notified} have notifications on)` : ""}.
            </Notice>
          ) : null}

          {reviewing ? (
            <div className="animate-ms-fade-in flex flex-col gap-3 rounded-ms-ctl border border-ms-primary-soft-2 bg-ms-primary-soft p-4">
              <p className="flex items-start gap-2.5 text-[15px] leading-[22px] text-ms-fg">
                <Icon name="send" size="sm" className="mt-[3px] text-ms-primary-text" />
                <span className="min-w-0">
                  Send <span className="font-semibold">“{title.trim()}”</span> to{" "}
                  <span className="font-semibold">{audienceLabel(audience)}</span>
                  {push ? ", with a push notification" : ""}? It cannot be recalled.
                </span>
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" disabled={sending} onClick={() => setReviewing(false)}>
                  Back
                </Button>
                <Button variant="primary" icon="send" state={sending ? "busy" : "idle"} onClick={() => void send()}>
                  Send
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end">
              <Button variant="primary" onClick={review}>
                Review
              </Button>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
