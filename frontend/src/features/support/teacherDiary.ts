/**
 * The support teacher's diary, turned into the words and the buckets their page shows.
 *
 * Pure, and separate from the component, because the one claim this page now exists to make is
 * not a type the compiler can check: **"this hour has already ended and nobody ever said who
 * came."** That is a statement about time, which is the thing a rendered component is worst at
 * pinning down. Every function below takes `now` as a number so a test can fix it.
 *
 * Why it matters, in one line, because the rest of this file reads as bookkeeping without it:
 * `rewards/hooks.sync_support_booking` awards on HELD and revokes everything else, so a session
 * left BOOKED after its hour pays nobody — not the student, not the teacher — and is counted in
 * no figure anywhere, because it is neither attended nor missed. It stays that way for ever.
 */
import type { SupportBooking } from "@/lib/api";
import type { Tone } from "@/features/teacher/ui";

/** Where a session stands, as the teacher reads it — not as the database stores it. */
export type Stand = "waiting" | "upcoming" | "held" | "missed" | "cancelled";

/**
 * Has the hour finished?
 *
 * `ends_at`, never `starts_at`: a session in its own hour is being taught, not neglected, and
 * a teacher asked to settle it while the student is sitting there learns to ignore the ask.
 *
 * An unparseable time answers `false`. "We could not read the clock" must not be dressed up as
 * "you are late with this" — the whole page is built on this one predicate, and a false
 * positive sends a teacher to close a session that has not happened.
 */
export function hasEnded(iso: string | null | undefined, now: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t <= now;
}

/** The sessions that are owed an outcome: taught, finished, never marked. */
export function needsSettling(b: SupportBooking, now: number): boolean {
  return b.status === "BOOKED" && hasEnded(b.slot.ends_at, now);
}

export function standOf(b: SupportBooking, now: number): Stand {
  if (b.status === "HELD") return "held";
  if (b.status === "NO_SHOW") return "missed";
  if (b.status === "CANCELLED") return "cancelled";
  // The same BOOKED is next Tuesday's appointment on one row and August's unfinished
  // paperwork on another. The hour is what tells them apart; the status cannot.
  return hasEnded(b.slot.ends_at, now) ? "waiting" : "upcoming";
}

/**
 * The chip for each stand, and what it means on hover.
 *
 * All five stands are here and all five are reachable: four statuses, with BOOKED splitting in
 * two on the clock. `cancelled` reaches the screen only through the "Everything" filter — the
 * diary endpoint excludes cancelled rows today — but it keeps its chip, because the type
 * permits it and a row that arrives without one would render as a blank verdict.
 *
 * Tones match the support console's (features/supportReport) exactly, so the same session does
 * not change colour depending on which side of the product you read it from.
 */
export const STAND: Record<Stand, { label: string; tone: Tone; note: string }> = {
  waiting: {
    label: "Waiting for you",
    tone: "warning",
    note: "This hour has finished and no outcome was ever recorded, so it has paid nobody — not the student, not you. One press below settles it.",
  },
  upcoming: {
    label: "Booked",
    tone: "info",
    note: "Still to come. Nothing is owed on it yet.",
  },
  held: {
    label: "Held",
    tone: "success",
    note: "You confirmed the student came. This is the outcome that awards their points.",
  },
  // "Missed", never "Absent": the fact is recorded without naming the student a failure.
  missed: {
    label: "Missed",
    tone: "danger",
    note: "The seat was taken and the student did not attend.",
  },
  cancelled: {
    label: "Cancelled",
    tone: "neutral",
    note: "Called off before the hour, so the seat went back to the calendar.",
  },
};

/** The filters over the diary. `all` is the one that is always present, and it hides nothing. */
export type Bucket = "waiting" | "upcoming" | "recorded" | "all";

export function inBucket(stand: Stand, bucket: Bucket): boolean {
  if (bucket === "all") return true;
  // "Recorded" means a teacher wrote the outcome. A cancelled session is finished but nobody
  // recorded anything on it, so it belongs under "Everything" and nowhere else.
  if (bucket === "recorded") return stand === "held" || stand === "missed";
  return stand === bucket;
}

/** The longest-waiting session's start, which is the age the banner reports. */
export function oldestWaiting(rows: SupportBooking[]): string | null {
  let oldest: string | null = null;
  let best = Infinity;
  for (const b of rows) {
    const t = new Date(b.slot.starts_at).getTime();
    if (Number.isFinite(t) && t < best) {
      best = t;
      oldest = b.slot.starts_at;
    }
  }
  return oldest;
}

/** How long ago, in whole days. Null when there is no date, or it has not happened yet. */
export function ageInDays(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((now - t) / 86_400_000);
  return days >= 0 ? days : null;
}

/** "6 weeks ago", "23 days ago", "yesterday" — so nobody has to do the subtraction. */
export function ageLabel(days: number | null): string {
  if (days == null) return "";
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

/** "1 session" / "3 sessions". */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

/* ── time, as the reader's own clock shows it ─────────────────────────────────────────── */

export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, {
    day: "numeric", month: "short", year: "numeric",
  });
}

export function fmtHour(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** "Today" and "Tomorrow" earn their names; after that the weekday is what anyone uses. */
export function dayLabel(iso: string, now: number): { title: string; sub: string } {
  const d = iso.includes("T") ? new Date(iso) : new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return { title: iso, sub: "" };
  d.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  const sub = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (diff === 0) return { title: "Today", sub };
  if (diff === 1) return { title: "Tomorrow", sub };
  return { title: d.toLocaleDateString(undefined, { weekday: "short" }), sub };
}
