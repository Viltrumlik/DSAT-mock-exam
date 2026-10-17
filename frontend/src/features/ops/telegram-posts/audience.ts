import type { BadgeVariant } from "@/components/ui";
import type { Audience, GroupPost, PostState, TelegramGroup } from "./telegramPostsApi";

export const SUBJECTS = [
  { value: "MATH", label: "Math" },
  { value: "ENGLISH", label: "English" },
] as const;

export const LEVELS = [
  { value: "foundation", label: "Foundation" },
  { value: "junior", label: "Junior" },
  { value: "middle", label: "Middle" },
  { value: "senior", label: "Senior" },
] as const;

/** `date.weekday()` order: 0 = Monday. */
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/**
 * The distinct chats an audience reaches — the server's rule (telegram_posts/audience.py),
 * repeated only so a confirm can name the number before anything is sent.
 */
export function targetChats(groups: TelegramGroup[], audience: Audience): string[] {
  const ids = audience.classroom_ids ?? [];
  const chosen = ids.length
    ? groups.filter((g) => ids.includes(g.id))
    : groups.filter(
        (g) =>
          (audience.subjects.length === 0 || audience.subjects.includes(g.subject)) &&
          (audience.levels.length === 0 || audience.levels.includes(g.level)),
      );
  return Array.from(new Set(chosen.map((g) => g.chat_id).filter(Boolean)));
}

export const STATE_BADGE: Record<PostState, { variant: BadgeVariant; label: string }> = {
  scheduled: { variant: "info", label: "Scheduled" },
  sending: { variant: "warning", label: "Sending" },
  sent: { variant: "success", label: "Sent" },
  failed: { variant: "danger", label: "Some failed" },
  missed: { variant: "warning", label: "Missed" },
  paused: { variant: "neutral", label: "Paused" },
  deleted: { variant: "neutral", label: "Deleted" },
  done: { variant: "neutral", label: "Nothing to send" },
  event_cancelled: { variant: "neutral", label: "Event cancelled" },
};

export function kindLabel(post: Pick<GroupPost, "kind" | "when">): string {
  if (post.kind === "EVENT_ANNOUNCE") return "Event announcement";
  if (post.kind === "EVENT_REMINDER") return "Event reminder";
  if (post.when === "WEEKLY") return "Weekly";
  return post.when === "ONCE" ? "Once" : "Now";
}

export function scheduleLabel(post: Pick<GroupPost, "when" | "weekdays" | "time_of_day" | "send_at">): string {
  if (post.when === "WEEKLY") {
    const days = post.weekdays.map((d) => WEEKDAYS[d]).join(", ");
    return `Every ${days} at ${(post.time_of_day ?? "").slice(0, 5)}`;
  }
  if (post.when === "EVENT") return "The evening before, 18:00";
  return post.send_at ? new Date(post.send_at).toLocaleString() : "";
}

/** The message as plain text: tags dropped, the entities the server's `esc` writes decoded. */
export function plainText(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function firstLine(markup: string): string {
  const line = plainText(markup).split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

export function sentLabel(post: Pick<GroupPost, "last_run">): string {
  const run = post.last_run;
  if (!run) return "";
  const parts = [`Sent ${run.sent}/${run.total}`];
  if (run.failed) parts.push(`${run.failed} failed`);
  if (run.missed) parts.push(`${run.missed} missed`);
  return parts.join(" · ");
}

/** The picker's state: an audience plus which half of it is in use. */
export interface AudienceDraft extends Audience {
  mode: "filter" | "groups";
}

export function draftFrom(saved: Partial<Audience> | undefined): AudienceDraft {
  const ids = saved?.classroom_ids ?? [];
  return { mode: ids.length ? "groups" : "filter", subjects: saved?.subjects ?? [], levels: saved?.levels ?? [], classroom_ids: ids };
}

export function draftChats(groups: TelegramGroup[], draft: AudienceDraft): string[] {
  if (draft.mode === "groups") {
    return (draft.classroom_ids ?? []).length ? targetChats(groups, draft) : [];
  }
  return targetChats(groups, { subjects: draft.subjects, levels: draft.levels });
}

export function draftToFields(draft: AudienceDraft): Required<Audience> {
  return draft.mode === "groups"
    ? { subjects: [], levels: [], classroom_ids: draft.classroom_ids ?? [] }
    : { subjects: draft.subjects, levels: draft.levels, classroom_ids: [] };
}
