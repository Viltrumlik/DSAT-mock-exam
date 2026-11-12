"use client";

/**
 * /ops/events — put an event on, and mark who turned up.
 *
 * Built as a sibling of /ops/stories, which is the closest existing job: an admin-authored
 * list with a picture that students see. The difference is that publishing is not just a
 * visibility flag here — it emails every student in the learning center and cannot be undone,
 * so it is the one action on this page that asks first.
 *
 * In the console's look (design handoff v0.3): a card of events, the console dialog for the form
 * and for who came. The words, the checks and the calls are the page's own.
 */

import Link from "next/link";
import { useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { Badge, Button, EmptyState, type BadgeTone } from "@/features/console/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import { CONTROL, FIELD_LABEL, HINT } from "@/features/questionsAdmin/questionLook";
import type { LearningEvent } from "@/features/events/eventsApi";
import { fromLocalInput, toLocalInput } from "@/lib/datetimeLocal";
import { AudiencePicker } from "@/features/ops/telegram-posts/AudiencePicker";
import { draftChats, draftFrom, type AudienceDraft } from "@/features/ops/telegram-posts/audience";
import {
  AREA,
  BOX,
  CAPTION,
  CAPTION_ROW,
  CheckRow,
  FILE_INPUT,
  FormDialog,
  LoadFailed,
  Notice,
  RowsLoading,
  TEXT_LINK,
  dotted,
} from "@/features/ops/telegram-posts/telegramLook";
import { useTelegramGroups } from "@/features/ops/telegram-posts/telegramPostsHooks";
import {
  useAdminEvents,
  useCancelEvent,
  useDeleteEvent,
  useEventRegistrations,
  useMarkAttendance,
  usePublishEvent,
  useSaveEvent,
  useTicket,
} from "@/features/events/eventsHooks";

const EMPTY = {
  title: "",
  description: "",
  location: "",
  seats: "30",
  starts_at: "",
  ends_at: "",
};

/** Same date + time format the event list already prints, just for a registration's row. */
function fmtRegisteredAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function statusOf(event: LearningEvent): { tone: BadgeTone; label: string } {
  if (event.status === "CANCELLED") return { tone: "neutral", label: "Cancelled" };
  if (event.status === "DRAFT") return { tone: "attention", label: "Draft" };
  if (new Date(event.ends_at).getTime() < Date.now()) {
    return { tone: "neutral", label: "Finished" };
  }
  return { tone: "positive", label: "Published" };
}

function EventForm({ event, onClose }: { event: LearningEvent | null; onClose: () => void }) {
  const save = useSaveEvent();
  const [form, setForm] = useState(
    event
      ? {
          title: event.title,
          description: event.description,
          location: event.location,
          seats: String(event.seats),
          starts_at: toLocalInput(event.starts_at),
          ends_at: toLocalInput(event.ends_at),
        }
      : EMPTY,
  );
  const [file, setFile] = useState<File | null>(null);
  const groups = useTelegramGroups();
  // Shown while the event can still reach the groups: a draft posts on Publish, a published one
  // keeps a reminder due the evening before. A cancelled event posts nothing, so it has no choice.
  const telegramOn = groups.data?.enabled === true && event?.status !== "CANCELLED";
  const published = event?.status === "PUBLISHED";
  // A published event with no announcement was published without Telegram (the box unticked, or
  // posting off at the time): it has no reminder either, and the switch is not retroactive, so
  // offering the choice would promise a post that never comes.
  const unposted = published && event?.telegram === null;
  const showTelegram = telegramOn && !unposted;
  const [telegramPost, setTelegramPost] = useState(event?.telegram_post ?? true);
  const [audience, setAudience] = useState<AudienceDraft>(draftFrom(event?.telegram_audience));
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    if (!form.starts_at || !form.ends_at) {
      setError("An event needs a start and an end.");
      return;
    }

    const fields: Record<string, unknown> = {
      title: form.title,
      description: form.description,
      location: form.location,
      seats: Number(form.seats),
      starts_at: fromLocalInput(form.starts_at),
      ends_at: fromLocalInput(form.ends_at),
    };
    if (showTelegram) {
      // Only what the form shows is sent: a hidden choice must not overwrite what is stored.
      fields.telegram_post = telegramPost;
      // Events store subjects × levels only (the picker hides "specific groups" here).
      fields.telegram_audience = { subjects: audience.subjects, levels: audience.levels };
    }

    let body: FormData | Record<string, unknown>;
    if (file) {
      const fd = new FormData();
      Object.entries(fields).forEach(([k, v]) =>
        fd.append(k, v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)),
      );
      fd.append("cover_image", file);
      body = fd;
    } else {
      body = fields;
    }

    save.mutate(
      { id: event?.id, body },
      {
        onSuccess: onClose,
        onError: (e) => {
          const data = (e as { response?: { data?: Record<string, unknown> } })?.response?.data;
          const detail = typeof data?.detail === "string" ? data.detail : null;
          setError(
            detail ??
              (data ? Object.values(data).flat().join(" ") : "Couldn't save that. Try again."),
          );
        },
      },
    );
  };

  return (
    <FormDialog
      title={event ? "Edit event" : "Add an event"}
      onClose={onClose}
      width={600}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" state={save.isPending ? "busy" : "idle"} disabled={save.isPending} onClick={submit}>
            Save draft
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div>
          <label htmlFor="event-title" className={FIELD_LABEL}>
            Name
          </label>
          <input
            id="event-title"
            data-autofocus
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className={CONTROL}
          />
          <p className={HINT}>What students see first.</p>
        </div>
        <div>
          <label htmlFor="event-description" className={FIELD_LABEL}>
            About it
          </label>
          <textarea
            id="event-description"
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className={AREA}
          />
          <p className={HINT}>What happens, and what to bring.</p>
        </div>
        <div>
          <label htmlFor="event-picture" className={FIELD_LABEL}>
            Picture
          </label>
          <input
            id="event-picture"
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className={FILE_INPUT}
          />
          <p className={HINT}>{event ? "Leave empty to keep the current one." : "Optional."}</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor="event-starts" className={FIELD_LABEL}>
              Starts
            </label>
            <input
              id="event-starts"
              type="datetime-local"
              value={form.starts_at}
              onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
              className={CONTROL}
            />
          </div>
          <div className="min-w-0">
            <label htmlFor="event-ends" className={FIELD_LABEL}>
              Ends
            </label>
            <input
              id="event-ends"
              type="datetime-local"
              value={form.ends_at}
              onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
              className={CONTROL}
            />
          </div>
        </div>
        <div>
          <label htmlFor="event-location" className={FIELD_LABEL}>
            Where
          </label>
          <input
            id="event-location"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            className={CONTROL}
          />
          <p className={HINT}>The branch and the room.</p>
        </div>
        <div>
          <label htmlFor="event-seats" className={FIELD_LABEL}>
            Seats
          </label>
          <div className="max-w-[10rem]">
            <input
              id="event-seats"
              type="number"
              value={form.seats}
              onChange={(e) => setForm({ ...form, seats: e.target.value })}
              className={CONTROL}
            />
          </div>
          <p className={HINT}>How many students can sign up.</p>
        </div>
        {telegramOn && unposted ? (
          <p className="text-[13px] text-ms-fg-3">Published without Telegram posts — changing this posts nothing.</p>
        ) : null}
        {showTelegram ? (
          <div className="flex flex-col gap-2.5 rounded-ms-card border border-ms-border p-3.5">
            <CheckRow label="Post to Telegram groups" checked={telegramPost} onChange={() => setTelegramPost(!telegramPost)} />
            {telegramPost ? (
              <AudiencePicker
                groups={groups.data?.groups ?? []}
                value={audience}
                onChange={setAudience}
                allowSpecific={false}
              />
            ) : null}
            <p className="text-[13px] text-ms-fg-3">
              {published
                ? "Already published — this changes the evening-before reminder only."
                : "Posted when you publish, with a reminder the evening before at 18:00."}
            </p>
          </div>
        ) : null}
      </div>
    </FormDialog>
  );
}

function AttendancePanel({ event, onClose }: { event: LearningEvent; onClose: () => void }) {
  const list = useEventRegistrations(event.id);
  const mark = useMarkAttendance(event.id);
  const opensAt = list.data?.marking_opens_at ? new Date(list.data.marking_opens_at) : null;
  const open = opensAt ? Date.now() >= opensAt.getTime() : false;
  const counts = list.data?.counts;

  // The typed box and the QR scan share one lookup. Below 8 cleaned characters it can only
  // ever be a partial code, so the list is filtered client-side; at 8 — a full code — the
  // server is asked, the same way a scan would be.
  const [typed, setTyped] = useState("");
  const cleaned = typed.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const lookupCode = cleaned.length === 8 ? cleaned : "";
  const lookup = useTicket(lookupCode);
  const registrations = list.data?.registrations ?? [];
  const matches =
    lookupCode && lookup.data?.event.id === event.id
      ? registrations.filter((r) => r.id === lookup.data!.registration_id)
      : cleaned.length >= 4
        ? registrations.filter((r) => (r.ticket_code || "").replace("-", "").includes(cleaned))
        : registrations;

  return (
    <FormDialog title={event.title} description="Who signed up, and who came" onClose={onClose} width={760}>
      {list.isPending ? (
        <div role="status" aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">Loading…</span>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-ms-shimmer rounded-ms-ctl bg-ms-surface-2" />
          ))}
        </div>
      ) : list.isError ? (
        <LoadFailed onRetry={() => void list.refetch()}>The list didn&apos;t load.</LoadFailed>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor="event-ticket-code" className={FIELD_LABEL}>
              Ticket code
            </label>
            <div className="max-w-xs font-ms-mono">
              <input
                id="event-ticket-code"
                data-autofocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="4K29-7XPD"
                autoComplete="off"
                spellCheck={false}
                className={CONTROL}
              />
            </div>
            <p className={HINT}>Type or paste it — dashes and case don&apos;t matter.</p>
          </div>
          {lookupCode ? (
            lookup.isPending ? (
              <Notice tone="info">Checking the code…</Notice>
            ) : lookup.isError ? (
              <Notice tone="danger">No ticket with that code.</Notice>
            ) : lookup.data && lookup.data.event.id !== event.id ? (
              <Notice tone="warning">That ticket is for {lookup.data.event.title}.</Notice>
            ) : null
          ) : null}
          <p className={`${CAPTION} tabular-nums`}>
            Registered {counts?.registered ?? 0} · Attended {counts?.attended ?? 0} · Missed{" "}
            {counts?.missed ?? 0} · Not marked {counts?.not_marked ?? 0}
          </p>
          {!open && opensAt ? (
            <Notice tone="info">
              You can mark arrivals from {opensAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}.
            </Notice>
          ) : null}
          <ul className="divide-y divide-ms-line overflow-hidden rounded-ms-ctl border border-ms-border">
            {matches.map((row) => (
              <li key={row.id} data-registration={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">
                <div className="min-w-0 flex-1 basis-[12rem]">
                  <p className="truncate text-[14px] font-semibold text-ms-fg">{row.student_name}</p>
                  <p className="truncate text-[13px] text-ms-fg-2">
                    {row.phone || "No phone"}
                    {row.status === "CANCELLED" ? " · cancelled" : ""}
                  </p>
                </div>
                <span className="font-ms-mono text-[13px] tracking-[.06em] text-ms-fg-2">{row.ticket_code || "No code"}</span>
                <span className="text-[13px] tabular-nums text-ms-fg-3">{fmtRegisteredAt(row.registered_at)}</span>
                {row.status === "CANCELLED" ? (
                  <span className="text-[13px] font-medium text-ms-fg-3">Gave the seat back</span>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      icon="check"
                      variant={row.attendance === "ATTENDED" ? "primary" : "secondary"}
                      disabled={!open || mark.isPending}
                      onClick={() => mark.mutate({ id: row.id, attendance: "ATTENDED" })}
                    >
                      Attended
                    </Button>
                    <Button
                      size="sm"
                      icon="x"
                      variant={row.attendance === "MISSED" ? "primary" : "secondary"}
                      disabled={!open || mark.isPending}
                      onClick={() => mark.mutate({ id: row.id, attendance: "MISSED" })}
                    >
                      Missed
                    </Button>
                  </div>
                )}
              </li>
            ))}
            {matches.length === 0 ? (
              <li className="px-3.5 py-6 text-center text-[14px] text-ms-fg-3">
                {registrations.length === 0 ? "Nobody has signed up yet." : "No match for that code."}
              </li>
            ) : null}
          </ul>
        </div>
      )}
    </FormDialog>
  );
}

export default function OpsEventsPage() {
  const events = useAdminEvents();
  const publish = usePublishEvent();
  const cancelEvent = useCancelEvent();
  const remove = useDeleteEvent();
  const telegramGroups = useTelegramGroups();
  const [editing, setEditing] = useState<LearningEvent | null | undefined>(undefined);
  const [viewing, setViewing] = useState<LearningEvent | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <OpsPageHeader
        section="Events"
        title="Events"
        description="Workshops, talks and open days. Publishing one emails every student and, when ticked, posts it into the class Telegram groups."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setEditing(null)}>
            Add an event
          </Button>
        }
      />

      <section className={`animate-ms-card-in ${BOX}`}>
        <div className={CAPTION_ROW}>
          <p className={CAPTION}>All events</p>
        </div>

        {events.isPending ? (
          <RowsLoading />
        ) : events.isError ? (
          <LoadFailed onRetry={() => void events.refetch()}>The events didn&apos;t load.</LoadFailed>
        ) : (events.data?.length ?? 0) === 0 ? (
          <EmptyState icon="cal" title="No events yet" detail="Add one, then publish it when it is ready." />
        ) : (
          <ul className="divide-y divide-ms-line">
            {events.data?.map((event) => {
              const status = statusOf(event);
              const taken = event.seats - event.seats_left;
              return (
                <li key={event.id} data-event={event.id} className="ms-transition flex flex-wrap items-center gap-3 px-5 py-3.5 hover:bg-ms-surface">
                  <div className="min-w-0 flex-1 basis-[18rem]">
                    <p className="truncate text-[15px] font-semibold text-ms-fg">{event.title}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ms-fg-2">
                      <Badge tone={status.tone} dot={dotted(status.tone)}>
                        {status.label}
                      </Badge>
                      <span className="inline-flex items-center gap-1.5">
                        <Icon name="cal" size="sm" className="size-3.5 text-ms-fg-3" />
                        {new Date(event.starts_at).toLocaleString()}
                      </span>
                      {event.location ? <span>{event.location}</span> : null}
                      <span className="inline-flex items-center gap-1.5 tabular-nums">
                        <Icon name="users" size="sm" className="size-3.5 text-ms-fg-3" />
                        {taken}/{event.seats}
                      </span>
                      {event.telegram ? (
                        <Link href={`/ops/telegram-posts/${event.telegram.post_id}`} className={`inline-flex items-center gap-1.5 ${TEXT_LINK}`}>
                          <Icon name="ms-classpost" size="sm" className="size-3.5" />
                          {event.telegram.total === 0 && event.telegram.deleted > 0
                            ? "Telegram post deleted"
                            : `Telegram ${event.telegram.sent}/${event.telegram.total}${
                                event.telegram.failed ? ` · ${event.telegram.failed} failed` : ""
                              }`}
                        </Link>
                      ) : null}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {event.status === "DRAFT" ? (
                      <Button
                        size="sm"
                        variant="primary"
                        icon="send"
                        onClick={() => {
                          // Publishing IS the send — about 370 emails and, when ticked, a post
                          // in every chosen class group. There is no test send and no undo.
                          // Telegram is left out only when the server says posting is off or
                          // the box is unticked. Groups that have not loaded (or failed to) are
                          // no reason to hide that the post will happen — only the count waits.
                          const tg = telegramGroups.data;
                          let question = `Publish “${event.title}” and email every student? This can't be undone.`;
                          if (event.telegram_post !== false && tg?.enabled !== false) {
                            const n = tg ? draftChats(tg.groups, draftFrom(event.telegram_audience)).length : null;
                            const where = n === null ? "the Telegram groups" : `${n} Telegram group${n === 1 ? "" : "s"}`;
                            question = `Publish “${event.title}”, email every student and post to ${where}? This can't be undone.`;
                          }
                          if (window.confirm(question)) publish.mutate(event.id);
                        }}
                      >
                        Publish
                      </Button>
                    ) : null}
                    {event.status === "PUBLISHED" ? (
                      <Button size="sm" variant="secondary" icon="users" onClick={() => setViewing(event)}>
                        Who came
                      </Button>
                    ) : null}
                    <Button size="sm" variant="secondary" icon="pencil" onClick={() => setEditing(event)}>
                      Edit
                    </Button>
                    {event.status === "DRAFT" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="trash"
                        onClick={() => {
                          if (window.confirm(`Delete “${event.title}”? This cannot be undone.`)) {
                            remove.mutate(event.id);
                          }
                        }}
                      >
                        Delete
                      </Button>
                    ) : null}
                    {event.status === "PUBLISHED" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="x"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Call off “${event.title}”? Everyone who signed up will be emailed.`,
                            )
                          ) {
                            cancelEvent.mutate(event.id);
                          }
                        }}
                      >
                        Call it off
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editing !== undefined ? (
        <EventForm event={editing} onClose={() => setEditing(undefined)} />
      ) : null}
      {viewing ? <AttendancePanel event={viewing} onClose={() => setViewing(null)} /> : null}
    </div>
  );
}
