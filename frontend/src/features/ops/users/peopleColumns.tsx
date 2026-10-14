import type { ChangeListColumn } from "@/features/ops/changelist/ChangeList";
import type { PeopleRowBase } from "@/features/ops/changelist/peopleApi";

/** Cells the three people lists share. Plain text throughout — no badges, no tints. */

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** "just now", "12 min ago", "5 h ago", "3 d ago", then the date; "Never" for no session at all. */
export function formatLastSeen(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "Never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const minutes = Math.floor((now - t) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return formatDate(iso);
}

const STATUS_LABELS: Record<string, string> = {
  // A learner who is not frozen is simply active; centre vs public is which list they are in.
  centre: "Active",
  public: "Active",
  active: "Active",
  frozen_debt: "Frozen — unpaid",
  frozen_admin: "Frozen — by admin",
  frozen: "Frozen",
};

export function statusLabel(status: string, isFrozen = false): string {
  return STATUS_LABELS[status] ?? (isFrozen ? "Frozen" : "Active");
}

export function nameColumn<R extends PeopleRowBase>(): ChangeListColumn<R> {
  return {
    key: "name",
    label: "Name",
    sortKey: "name",
    render: (r) => (
      <span className="block max-w-[16rem] truncate" title={[r.name, r.username].filter(Boolean).join(" · ")}>
        {r.name || r.username || `User ${r.id}`}
        {r.name && r.username ? <span className="ml-1.5 font-normal text-muted-foreground">{r.username}</span> : null}
      </span>
    ),
  };
}

export function statusColumn<R extends PeopleRowBase>(): ChangeListColumn<R> {
  return {
    key: "status",
    label: "Status",
    render: (r) => (
      <span className={r.is_frozen ? "text-foreground" : "text-muted-foreground"}>{statusLabel(r.status, r.is_frozen)}</span>
    ),
  };
}

export function joinedColumn<R extends PeopleRowBase>(): ChangeListColumn<R> {
  return {
    key: "joined",
    label: "Joined",
    sortKey: "joined",
    render: (r) => <span className="tabular-nums text-muted-foreground">{formatDate(r.date_joined)}</span>,
  };
}

export function lastSeenColumn<R extends PeopleRowBase>(): ChangeListColumn<R> {
  return {
    key: "last_seen",
    label: "Last seen",
    sortKey: "last_seen",
    render: (r) => (
      <span className="tabular-nums text-muted-foreground" title={r.last_seen ? new Date(r.last_seen).toLocaleString("en-US") : undefined}>
        {formatLastSeen(r.last_seen)}
      </span>
    ),
  };
}

/** One line, cut with an ellipsis; the whole text on hover. */
export function Truncated({ text, className }: { text: string; className?: string }) {
  if (!text) return <span className="text-muted-foreground">—</span>;
  return (
    <span title={text} className={`block truncate ${className ?? "max-w-[11rem]"}`}>
      {text}
    </span>
  );
}
