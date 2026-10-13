"use client";

/**
 * Broadcast: one announcement to a whole audience, in every inbox it reaches (owner, 2026-10-13:
 * "Xabar yuborishda tanlash" — the learning center's students and the public learners are two
 * audiences now, and the sender picks).
 *
 * super_admin only, like the endpoint: a broadcast cannot be recalled once phones have buzzed,
 * so the page asks for a review that names the audience before anything goes out.
 */

import { useState } from "react";
import { Megaphone } from "lucide-react";

import { Alert, Button, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
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
      <div className="space-y-5">
        <OpsPageHeader section="Broadcast" title="Broadcast" />
        <Alert tone="info">Only a super admin can send a broadcast.</Alert>
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
    <div className="space-y-5">
      <OpsPageHeader
        section="Broadcast"
        title="Broadcast"
        description="One announcement to a whole audience. It lands in every inbox it reaches and cannot be recalled."
      />

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-5 py-2.5">
          <Megaphone className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">New announcement</p>
        </div>
        <div className="space-y-4 p-5">
          <Field label="Audience" htmlFor="broadcast-audience">
            <Select
              id="broadcast-audience"
              value={audience}
              disabled={reviewing}
              onChange={(e) => setAudience(e.target.value as BroadcastAudience)}
            >
              {AUDIENCES.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title" htmlFor="broadcast-title" required error={titleError ?? undefined} hint={`Up to ${TITLE_MAX} characters.`}>
            <Input
              id="broadcast-title"
              value={title}
              maxLength={TITLE_MAX}
              disabled={reviewing}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="Message" htmlFor="broadcast-body" hint={`Optional. Up to ${BODY_MAX} characters.`}>
            <Textarea
              id="broadcast-body"
              rows={3}
              value={body}
              maxLength={BODY_MAX}
              disabled={reviewing}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          <Field label="Link" htmlFor="broadcast-link" hint="Optional. A page on the site, such as /events.">
            <Input
              id="broadcast-link"
              value={link}
              placeholder="/events"
              disabled={reviewing}
              onChange={(e) => setLink(e.target.value)}
            />
          </Field>
          <Checkbox
            id="broadcast-push"
            label="Also send it as a push notification to phones and browsers"
            checked={push}
            disabled={reviewing}
            onChange={(e) => setPush(e.target.checked)}
          />

          {failure ? <Alert tone="danger">{failure}</Alert> : null}
          {sent ? (
            <Alert tone="success">
              Sent to {sent.recipients} {sent.recipients === 1 ? "person" : "people"}
              {sent.notified !== sent.recipients ? ` (${sent.notified} have notifications on)` : ""}.
            </Alert>
          ) : null}

          {reviewing ? (
            <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
              <p className="text-sm text-foreground">
                Send <span className="font-bold">“{title.trim()}”</span> to{" "}
                <span className="font-bold">{audienceLabel(audience)}</span>
                {push ? ", with a push notification" : ""}? It cannot be recalled.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" disabled={sending} onClick={() => setReviewing(false)}>
                  Back
                </Button>
                <Button loading={sending} onClick={() => void send()}>
                  Send
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end">
              <Button onClick={review}>Review</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
