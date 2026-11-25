const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-27" → "27 Nov 2026". Read by hand: `new Date("2026-11-27")` is midnight UTC, and the copy moves `Date`. */
export function dayText(iso: string | null | undefined): string {
  const [year, month, day] = String(iso ?? "").slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return iso ? String(iso) : "—";
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** The calendar day `days` after "YYYY-MM-DD". */
export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** A moment, in Tashkent: "25 Nov, 14:05". */
export function stampText(iso: string | null | undefined): string {
  if (!iso) return "—";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return String(iso);
  return at.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" });
}

/** "+1 day", "+3 days". */
export function offsetText(days: number): string {
  return `+${days} day${days === 1 ? "" : "s"}`;
}
