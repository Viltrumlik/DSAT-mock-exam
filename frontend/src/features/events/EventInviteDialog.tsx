"use client";

/**
 * The event invitation a student meets right after signing in.
 *
 * The same arc the survey prompt went through: a page nobody visits, then a card nobody
 * notices, then a modal that actually moved the number. An event has a harder version of the
 * problem — it happens once, on a date, with a fixed number of seats — so a student who does
 * not hear about it in time cannot act on it later.
 *
 * The rules that keep it a prompt and not a nag:
 *   * Once per sign-in, per event (`lib/eventInvitePrompt`, cleared on logout).
 *   * Never on `/events`: interrupting somebody to suggest the page they are reading is how
 *     a prompt teaches people to dismiss prompts.
 *   * Students only, and only for an event they can actually take a seat at.
 *   * A failed fetch shows nothing — a modal cannot honestly name an event it did not load.
 *
 * Sign up happens in place. The whole point is the seat, and a dialog that only links to a
 * page is the card that already failed twice.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays } from "lucide-react";

import { Modal } from "@/components/ui";
import { useMe } from "@/hooks/useMe";
import { markEventInviteShown, wasEventInviteShown } from "@/lib/eventInvitePrompt";

import { useSignUpForEvent, useUpcomingEvents } from "./eventsHooks";

/** Long enough for the page behind it to settle, short enough to still read as "on sign-in". */
const OPEN_DELAY_MS = 1500;

function fmtWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time}`;
}

export function EventInviteDialog() {
  const { me } = useMe();
  const pathname = usePathname();
  const events = useUpcomingEvents();
  const signUp = useSignUpForEvent();

  // The soonest event the student could still take a seat at — the list arrives ordered by
  // start, so the first one that is open is the one worth interrupting for.
  const featured = (events.data ?? []).find((row) => row.can_sign_up) ?? null;
  const featuredId = featured?.id ?? null;

  const role = String((me as { role?: string } | undefined)?.role ?? "").trim().toLowerCase();
  const onEventsRoute = (pathname || "").startsWith("/events");
  const eligible = role === "student" && !onEventsRoute && featured != null;

  // Read after mount, never during render: `sessionStorage` does not exist while the server
  // renders, and seeding state from it would hydrate-mismatch.
  const [owed, setOwed] = useState(false);
  useEffect(() => {
    setOwed(featuredId != null && !wasEventInviteShown(featuredId));
  }, [featuredId]);

  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!owed || !eligible || featuredId == null) {
      setOpen(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setOpen(true);
      // Marked when it is actually seen: a student who signs in and navigates away at once
      // has not been asked, and should be asked next time.
      markEventInviteShown(featuredId);
    }, OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [owed, eligible, featuredId]);

  if (!eligible || featured == null) return null;

  const close = () => {
    setOpen(false);
    setOwed(false);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="There's an event coming up"
      description="Take a seat now — there are only so many."
    >
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <CalendarDays className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-foreground">{featured.title}</p>
          <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
            {fmtWhen(featured.starts_at)}
            {featured.location ? ` · ${featured.location}` : ""}
          </p>
          <p className="mt-3 text-sm font-bold text-foreground">
            <span className="ds-num">{featured.seats_left}</span> seats left
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={close}
          className="ds-ring rounded-xl px-4 py-2 text-sm font-extrabold text-muted-foreground"
        >
          Later
        </button>
        <Link
          href="/events"
          onClick={close}
          className="ds-ring rounded-xl px-4 py-2 text-sm font-extrabold text-muted-foreground"
        >
          See all events
        </Link>
        <button
          type="button"
          onClick={() => {
            signUp.mutate(featured.id);
            close();
          }}
          disabled={signUp.isPending}
          className="ds-ring rounded-xl bg-primary px-4 py-2 text-sm font-extrabold text-primary-foreground"
        >
          Sign up
        </button>
      </div>
    </Modal>
  );
}
