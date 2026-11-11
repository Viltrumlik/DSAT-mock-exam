import { Avatar } from "@/components/ui";
import { Badge } from "@/features/console/ui";
import { useChanged } from "@/features/console/useChanged";
import type { ChangeListColumn } from "@/features/ops/changelist/ChangeList";
import type { PeopleRowBase } from "@/features/ops/changelist/peopleApi";

/**
 * Cells the three people lists share (design handoff v0.3, DataDisplay board): the person first,
 * the username under the name, the status as a verdict badge (icon + word), dates quiet.
 */

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
      // The photo beside every name, as on the person's page (owner: "rasmi ham ko'rinib turishi kerak").
      // The username sits under the name, not beside it: side by side, with the photo, the column
      // ran "Last seen" off a 1440px screen.
      <span className="flex max-w-[15rem] items-center gap-2.5" title={[r.name, r.username].filter(Boolean).join(" · ")}>
        <Avatar src={r.avatar_url ?? null} name={r.name || r.username || ""} size={28} />
        <span className="min-w-0 leading-tight">
          <span className="block truncate">{r.name || r.username || `User ${r.id}`}</span>
          {r.name && r.username ? (
            <span className="block truncate text-[13px] font-normal text-ms-fg-3">{r.username}</span>
          ) : null}
        </span>
      </span>
    ),
  };
}

/**
 * A status as a verdict (icon + word). When it changes in front of you — a freeze lands — the badge
 * comes in again and a Frozen snowflake turns in (Motion board, "Freeze"); on a plain load nothing moves.
 */
function StatusBadge({ status, frozen }: { status: string; frozen: boolean }) {
  const label = statusLabel(status, frozen);
  const changed = useChanged(label);
  const motion = changed ? "animate-ms-fade-in" : undefined;
  return frozen || label.startsWith("Frozen") ? (
    <Badge key={label} tone="frozen" icon="snow" className={motion} iconClassName={changed ? "animate-ms-snow-in" : undefined}>
      {label}
    </Badge>
  ) : (
    <Badge key={label} tone="positive" dot className={motion}>
      {label}
    </Badge>
  );
}

export function statusColumn<R extends PeopleRowBase>(): ChangeListColumn<R> {
  return {
    key: "status",
    label: "Status",
    render: (r) => <StatusBadge status={r.status} frozen={Boolean(r.is_frozen)} />,
  };
}

export function joinedColumn<R extends PeopleRowBase>(): ChangeListColumn<R> {
  return {
    key: "joined",
    label: "Joined",
    sortKey: "joined",
    render: (r) => <span className="tabular-nums text-ms-fg-2">{formatDate(r.date_joined)}</span>,
  };
}

export function lastSeenColumn<R extends PeopleRowBase>(): ChangeListColumn<R> {
  return {
    key: "last_seen",
    label: "Last seen",
    sortKey: "last_seen",
    render: (r) => (
      <span className="tabular-nums text-ms-fg-2" title={r.last_seen ? new Date(r.last_seen).toLocaleString("en-US") : undefined}>
        {formatLastSeen(r.last_seen)}
      </span>
    ),
  };
}

/** One line, cut with an ellipsis; the whole text on hover. */
export function Truncated({ text, className }: { text: string; className?: string }) {
  if (!text) return <span className="text-ms-fg-3">—</span>;
  return (
    <span title={text} className={`block truncate ${className ?? "max-w-[11rem]"}`}>
      {text}
    </span>
  );
}
