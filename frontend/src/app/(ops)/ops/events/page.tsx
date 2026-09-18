"use client";

/**
 * /ops/events — put an event on, and mark who turned up.
 *
 * Built as a sibling of /ops/stories, which is the closest existing job: an admin-authored
 * list with a picture that students see. The difference is that publishing is not just a
 * visibility flag here — it emails every student in the learning center and cannot be undone,
 * so it is the one action on this page that asks first.
 */

import { useState } from "react";
import { CalendarClock, CalendarPlus, Check, Pencil, Users, X } from "lucide-react";

import { Alert, Badge, Button, Field, Input, Modal, Textarea } from "@/components/ui";
import type { BadgeVariant } from "@/components/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import type { LearningEvent } from "@/features/events/eventsApi";
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

/** `datetime-local` speaks local wall-clock with no zone; the API speaks ISO with one. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Same date + time format the event list already prints, just for a registration's row. */
function fmtRegisteredAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function statusOf(event: LearningEvent): { variant: BadgeVariant; label: string } {
  if (event.status === "CANCELLED") return { variant: "neutral", label: "Cancelled" };
  if (event.status === "DRAFT") return { variant: "warning", label: "Draft" };
  if (new Date(event.ends_at).getTime() < Date.now()) {
    return { variant: "neutral", label: "Finished" };
  }
  return { variant: "success", label: "Published" };
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

    let body: FormData | Record<string, unknown>;
    if (file) {
      const fd = new FormData();
      Object.entries(fields).forEach(([k, v]) => fd.append(k, v === null ? "" : String(v)));
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
    <Modal open onClose={onClose} title={event ? "Edit event" : "Add an event"}>
      <div className="space-y-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="Name" hint="What students see first.">
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="About it" hint="What happens, and what to bring.">
          <Textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <Field label="Picture" hint={event ? "Leave empty to keep the current one." : "Optional."}>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Starts">
            <Input
              type="datetime-local"
              value={form.starts_at}
              onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
            />
          </Field>
          <Field label="Ends">
            <Input
              type="datetime-local"
              value={form.ends_at}
              onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Where" hint="The branch and the room.">
          <Input
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
          />
        </Field>
        <Field label="Seats" hint="How many students can sign up.">
          <Input
            type="number"
            value={form.seats}
            onChange={(e) => setForm({ ...form, seats: e.target.value })}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={save.isPending}>Save draft</Button>
        </div>
      </div>
    </Modal>
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
    <Modal open onClose={onClose} title={event.title} description="Who signed up, and who came" size="lg">
      {list.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : list.isError ? (
        <div className="text-sm">
          <p className="font-semibold text-foreground">The list didn&apos;t load.</p>
          <button
            type="button"
            onClick={() => void list.refetch()}
            className="mt-1 font-bold text-primary underline"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Ticket code" hint="Type or paste it — dashes and case don't matter.">
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="4K29-7XPD"
            />
          </Field>
          {lookupCode ? (
            lookup.isPending ? (
              <Alert tone="info">Checking the code…</Alert>
            ) : lookup.isError ? (
              <Alert tone="danger">No ticket with that code.</Alert>
            ) : lookup.data && lookup.data.event.id !== event.id ? (
              <Alert tone="warning">That ticket is for {lookup.data.event.title}.</Alert>
            ) : null
          ) : null}
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Registered {counts?.registered ?? 0} · Attended {counts?.attended ?? 0} · Missed{" "}
            {counts?.missed ?? 0} · Not marked {counts?.not_marked ?? 0}
          </p>
          {!open && opensAt ? (
            <Alert tone="info">
              You can mark arrivals from {opensAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}.
            </Alert>
          ) : null}
          <ul className="divide-y divide-border">
            {matches.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-foreground">{row.student_name}</p>
                  <p className="truncate text-xs font-semibold text-muted-foreground">
                    {row.phone || "No phone"}
                    {row.status === "CANCELLED" ? " · cancelled" : ""}
                  </p>
                </div>
                <span className="text-xs font-bold tracking-widest text-muted-foreground">
                  {row.ticket_code || "No code"}
                </span>
                <span className="text-xs font-bold tracking-widest text-muted-foreground">
                  {fmtRegisteredAt(row.registered_at)}
                </span>
                {row.status === "CANCELLED" ? (
                  <span className="text-xs font-bold text-muted-foreground">Gave the seat back</span>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={row.attendance === "ATTENDED" ? "primary" : "secondary"}
                      disabled={!open || mark.isPending}
                      onClick={() => mark.mutate({ id: row.id, attendance: "ATTENDED" })}
                    >
                      <Check className="mr-1.5 h-4 w-4" aria-hidden />
                      Attended
                    </Button>
                    <Button
                      size="sm"
                      variant={row.attendance === "MISSED" ? "primary" : "secondary"}
                      disabled={!open || mark.isPending}
                      onClick={() => mark.mutate({ id: row.id, attendance: "MISSED" })}
                    >
                      <X className="mr-1.5 h-4 w-4" aria-hidden />
                      Missed
                    </Button>
                  </div>
                )}
              </li>
            ))}
            {matches.length === 0 ? (
              <li className="py-6 text-center text-sm text-muted-foreground">
                {registrations.length === 0 ? "Nobody has signed up yet." : "No match for that code."}
              </li>
            ) : null}
          </ul>
        </div>
      )}
    </Modal>
  );
}

export default function OpsEventsPage() {
  const events = useAdminEvents();
  const publish = usePublishEvent();
  const cancelEvent = useCancelEvent();
  const remove = useDeleteEvent();
  const [editing, setEditing] = useState<LearningEvent | null | undefined>(undefined);
  const [viewing, setViewing] = useState<LearningEvent | null>(null);

  return (
    <div className="space-y-5">
      <OpsPageHeader
        section="Events"
        title="Events"
        description="Workshops, talks and open days. Publishing one emails every student."
        actions={
          <Button onClick={() => setEditing(null)}>
            <CalendarPlus className="mr-1.5 h-4 w-4" aria-hidden />
            Add an event
          </Button>
        }
      />

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-5 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            All events
          </p>
        </div>

        {events.isPending ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-3 px-5 py-3.5">
                <div className="h-4 w-48 rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : events.isError ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm font-semibold text-foreground">The events didn&apos;t load.</p>
            <button
              type="button"
              onClick={() => void events.refetch()}
              className="mt-1 text-sm font-bold text-primary underline"
            >
              Try again
            </button>
          </div>
        ) : (events.data?.length ?? 0) === 0 ? (
          <div className="px-5 py-12 text-center">
            <CalendarClock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-semibold text-foreground">No events yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add one, then publish it when it is ready.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {events.data?.map((event) => {
              const status = statusOf(event);
              const taken = event.seats - event.seats_left;
              return (
                <li key={event.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{event.title}</p>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs font-semibold text-muted-foreground">
                      <Badge variant={status.variant}>{status.label}</Badge>
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="h-3 w-3" aria-hidden />
                        {new Date(event.starts_at).toLocaleString()}
                      </span>
                      {event.location ? <span>{event.location}</span> : null}
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" aria-hidden />
                        {taken}/{event.seats}
                      </span>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {event.status === "DRAFT" ? (
                      <Button
                        size="sm"
                        onClick={() => {
                          // Publishing IS the send — about 370 emails, and there is no test
                          // send and no undo.
                          if (
                            window.confirm(
                              `Publish “${event.title}” and email every student? This can't be undone.`,
                            )
                          ) {
                            publish.mutate(event.id);
                          }
                        }}
                      >
                        Publish
                      </Button>
                    ) : null}
                    {event.status === "PUBLISHED" ? (
                      <Button size="sm" variant="secondary" onClick={() => setViewing(event)}>
                        <Users className="mr-1.5 h-4 w-4" aria-hidden />
                        Who came
                      </Button>
                    ) : null}
                    <Button size="sm" variant="secondary" onClick={() => setEditing(event)}>
                      <Pencil className="mr-1.5 h-4 w-4" aria-hidden />
                      Edit
                    </Button>
                    {event.status === "DRAFT" ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-bold text-muted-foreground underline-offset-2 hover:text-danger hover:underline"
                        onClick={() => {
                          if (window.confirm(`Delete “${event.title}”? This cannot be undone.`)) {
                            remove.mutate(event.id);
                          }
                        }}
                      >
                        Delete
                      </button>
                    ) : null}
                    {event.status === "PUBLISHED" ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-bold text-muted-foreground underline-offset-2 hover:text-danger hover:underline"
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
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {editing !== undefined ? (
        <EventForm event={editing} onClose={() => setEditing(undefined)} />
      ) : null}
      {viewing ? <AttendancePanel event={viewing} onClose={() => setViewing(null)} /> : null}
    </div>
  );
}
