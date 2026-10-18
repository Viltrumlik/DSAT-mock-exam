import type { BadgeVariant } from "@/components/ui";
import type { CampaignStatus, SlotRole, SmsKind, SmsStatus, TemplateSlot, TemplateStatus } from "./smsApi";

/**
 * The words and figures the SMS panel prints. The panel speaks English like the rest of /ops;
 * the SMS texts themselves stay as eskiz approved them, in Uzbek.
 */

type Badge = { variant: BadgeVariant; label: string };

/** U+00A0: the digits and the currency never break across a line. */
const NB = " ";

/**
 * "1 020 so'm". Grouped by threes with a non-breaking space — how the centre writes money —
 * rather than the en-US commas of /ops/finance, because this is the figure an admin reads off
 * before a paid send and it should look like the eskiz invoice.
 */
export function money(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "—";
  // `|| 0` so a rounded-away amount reads "0 so'm", not "-0 so'm".
  const whole = Math.round(amount) || 0;
  const digits = String(Math.abs(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, NB);
  return `${whole < 0 ? "-" : ""}${digits}${NB}so'm`;
}

export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

// ── SMS parts ────────────────────────────────────────────────────────────

export function isAscii(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  return !/[^\x00-\x7f]/.test(text);
}

/**
 * How many SMS one text is billed as — the server's rule (sms/templates.parts): plain ASCII is
 * 160 characters in one part and 153 a part after that; one character outside ASCII (an Uzbek
 * ʻ or ‘) makes it 70, then 67. Counted in code points, as Python counts.
 */
export function smsParts(text: string): number {
  const n = Array.from(text).length;
  if (n === 0) return 0;
  if (isAscii(text)) return n <= 160 ? 1 : Math.ceil(n / 153);
  return n <= 70 ? 1 : Math.ceil(n / 67);
}

// ── templates ────────────────────────────────────────────────────────────

/** eskiz's slots: `%d` a number, `%w` one word, `%w{a,b}` a to b words. */
const SLOT = /%(d|w)(?:\{(\d+),(\d+)\})?/g;
const APOSTROPHES = /[‘’ʻʼ`]/g;

/** What the server fills a sample with (sms/templates.SAMPLE_VALUES). */
export const SAMPLE = { student: "Test Testov,", debt: "100000" } as const;

/**
 * The pattern with `values` in its slots, in order — the server's `render`, repeated so a form
 * can show what will go out before anything is sent. A word slot keeps at most its number of
 * words, with curly apostrophes made plain; an empty value shows as "…".
 */
export function fillPattern(pattern: string, values: string[]): string {
  let i = 0;
  return pattern.replace(SLOT, (_match, kind: string, _min?: string, max?: string) => {
    const value = (values[i++] ?? "").trim();
    if (!value) return "…";
    if (kind === "d") return value;
    const words = value.replace(APOSTROPHES, "'").split(/\s+/);
    return words.slice(0, max ? Number(max) : 1).join(" ");
  });
}

/** The sample values for slots in these roles, with `texts` in the `text` slots. */
export function sampleValues(roles: SlotRole[], texts: string[]): string[] {
  return roles.map((role, i) => (role === "student" ? SAMPLE.student : role === "debt" ? SAMPLE.debt : texts[i] ?? ""));
}

/**
 * The guessed roles when they fit the template, otherwise `text` for every slot — the server's
 * guess can only be trusted when it names one role per slot.
 */
export function defaultRoles(slots: TemplateSlot[], guessed: SlotRole[]): SlotRole[] {
  return guessed.length === slots.length ? [...guessed] : slots.map(() => "text");
}

export function slotLabel(slot: TemplateSlot): string {
  if (slot.kind === "d") return "a number";
  if (slot.max <= 1) return "1 word";
  return `${slot.min}–${slot.max} words`;
}

export function firstLine(text: string, max = 90): string {
  const line = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// ── labels ───────────────────────────────────────────────────────────────

export const STATUS_BADGE: Record<SmsStatus, Badge> = {
  PENDING: { variant: "neutral", label: "Pending" },
  SENT: { variant: "info", label: "Sent" },
  DELIVERED: { variant: "success", label: "Delivered" },
  UNDELIVERED: { variant: "danger", label: "Not delivered" },
  REJECTED: { variant: "danger", label: "Rejected" },
  FAILED: { variant: "danger", label: "Failed" },
  // eskiz may or may not have it — never sent again by itself.
  UNCERTAIN: { variant: "warning", label: "Uncertain" },
};

export function statusBadge(status: string): Badge {
  return STATUS_BADGE[status as SmsStatus] ?? { variant: "neutral", label: status };
}

const KIND_LABEL: Record<SmsKind, string> = {
  debt_warning: "Debt warning",
  campaign: "Campaign",
  test: "Test",
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind as SmsKind] ?? kind;
}

export const ROLE_LABEL: Record<SlotRole, string> = {
  student: "Student's name",
  debt: "Debt amount",
  text: "Same text for all",
};

export function roleLabel(role: string): string {
  return ROLE_LABEL[role as SlotRole] ?? role;
}

export const CAMPAIGN_BADGE: Record<CampaignStatus, Badge> = {
  SCHEDULED: { variant: "info", label: "Scheduled" },
  SENDING: { variant: "warning", label: "Sending" },
  DONE: { variant: "success", label: "Done" },
  CANCELLED: { variant: "neutral", label: "Cancelled" },
  FAILED: { variant: "danger", label: "Failed" },
};

export function campaignBadge(status: string): Badge {
  return CAMPAIGN_BADGE[status as CampaignStatus] ?? { variant: "neutral", label: status };
}

/** `reklama` is billed at eskiz's advertising price, so it says so. */
const TEMPLATE_BADGE: Record<TemplateStatus, Badge> = {
  service: { variant: "success", label: "Service" },
  reklama: { variant: "warning", label: "Ad price" },
  moderation: { variant: "info", label: "Moderation" },
  // eskiz's own spelling of "in process".
  inproccess: { variant: "info", label: "Moderation" },
  rejected: { variant: "danger", label: "Rejected" },
  gone: { variant: "neutral", label: "Gone" },
};

export function templateBadge(status: string): Badge {
  return TEMPLATE_BADGE[status as TemplateStatus] ?? { variant: "neutral", label: status };
}

const SKIP_LABEL: Record<string, string> = {
  no_link: "Not linked to lc-up",
  no_phone: "No phone in lc-up",
  not_debtor: "Not in debt",
  bad_text: "Text doesn't fit the template",
};

/** A reason the panel knows by name, or the server's code in words. */
export function skipLabel(reason: string): string {
  return SKIP_LABEL[reason] ?? reason.replace(/_/g, " ");
}

// ── time ─────────────────────────────────────────────────────────────────

export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** "18 Oct 2026, 10:00" in the viewer's zone, "—" for none. */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** "2026-11-01" → "1 Nov 2026". Parsed by hand: `new Date("2026-11-01")` is UTC midnight. */
export function dayLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [year, mon, date] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !mon || !date) return iso;
  return new Date(year, mon - 1, date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Today's "YYYY-MM-DD" in Tashkent — the calendar the server's warning days are counted in. */
export function todayInTashkent(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
