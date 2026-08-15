"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, BellRing, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { EmptyState, Skeleton } from "@/components/ui";
// ErrorState lives with the classroom devices, not in the shared barrel.
import { ErrorState } from "@/features/classroom/ui";
import {
  useMarkRead,
  useNotifications,
  usePushConfig,
} from "./notificationsHooks";
import { notificationsApi, type NotificationCategory } from "./notificationsApi";
import { permissionState, pushSupported, subscribeToPush } from "@/lib/push";

function ago(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The permission ask, as a card the student presses — never an automatic popup.
 *
 * Two reasons it works this way. Browsers ignore `requestPermission` outside a user gesture,
 * so an automatic prompt on login would silently do nothing. And a REFUSED permission is
 * permanent per origin: asking at a moment the student has no reason to say yes burns the
 * platform's one chance, forever. So it renders only when push is actually configured, only
 * when they have not already answered, and it is dismissible.
 */
function PushPrompt() {
  const config = usePushConfig();
  const [dismissed, setDismissed] = useState(false);
  const [state, setState] = useState<"idle" | "asking" | "done" | "refused">("idle");

  const supported = pushSupported();
  const permission = supported ? permissionState() : "unsupported";

  if (
    dismissed ||
    !supported ||
    !config.data?.enabled ||
    permission !== "default" ||
    state === "done"
  ) {
    return null;
  }

  const ask = async () => {
    setState("asking");
    const subscription = await subscribeToPush(config.data.public_key);
    if (!subscription) {
      setState("refused");
      return;
    }
    await notificationsApi.subscribe(subscription);
    setState("done");
  };

  return (
    <div className="mb-3 rounded-xl border border-border bg-surface-2 p-3">
      <p className="flex items-center gap-2 text-sm font-bold text-foreground">
        <BellRing className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        Get these on your phone
      </p>
      <p className="mt-1 text-xs font-semibold text-muted-foreground">
        We&apos;ll only send the ones that matter — marks, homework and support sessions.
      </p>
      {state === "refused" ? (
        <p className="mt-2 text-xs font-bold text-muted-foreground">
          Your browser blocked it. You can turn it back on in site settings.
        </p>
      ) : (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => void ask()}
            disabled={state === "asking"}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-extrabold text-primary-foreground disabled:opacity-60"
          >
            {state === "asking" ? "Waiting…" : "Turn on"}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded-lg px-3 py-1.5 text-xs font-extrabold text-muted-foreground"
          >
            Not now
          </button>
        </div>
      )}
    </div>
  );
}

export function NotificationPanel({ open }: { open: boolean }) {
  const [category, setCategory] = useState<NotificationCategory | null>(null);
  // `open` gates the fetch: the drawer is mounted permanently by the shell, and without this
  // every page load would fetch an inbox nobody has opened.
  const inbox = useNotifications(category, open);
  const markRead = useMarkRead();

  const rows = inbox.data?.notifications ?? [];
  const sections = inbox.data?.categories ?? [];
  const counts = inbox.data?.unread_by_category ?? {};

  return (
    <div className="space-y-3">
      <PushPrompt />

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setCategory(null)}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-bold transition-colors",
            category === null
              ? "bg-primary text-primary-foreground"
              : "bg-surface-2 text-muted-foreground hover:text-foreground",
          )}
        >
          All
        </button>
        {sections.map((section) => (
          <button
            key={section.value}
            type="button"
            onClick={() => setCategory(section.value)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-bold transition-colors",
              category === section.value
                ? "bg-primary text-primary-foreground"
                : "bg-surface-2 text-muted-foreground hover:text-foreground",
            )}
          >
            {section.label}
            {counts[section.value] ? (
              <span className="ml-1 opacity-70">{counts[section.value]}</span>
            ) : null}
          </button>
        ))}
      </div>

      {(inbox.data?.unread_total ?? 0) > 0 ? (
        <button
          type="button"
          onClick={() => markRead.mutate(category ? { category } : {})}
          className="flex items-center gap-1.5 text-xs font-extrabold text-primary"
        >
          <Check className="h-3.5 w-3.5" aria-hidden />
          Mark {category ? "this section" : "all"} as read
        </button>
      ) : null}

      {/* Four branches. An error rendered as "you're all caught up" is the exact lie this
          panel was rebuilt to stop telling. */}
      {inbox.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : inbox.isError ? (
        <ErrorState
          title="Notifications aren't loading."
          message="Nothing has been missed — the list just couldn't be fetched."
          onRetry={() => void inbox.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          compact
          icon={Bell}
          title="You're all caught up"
          description="Grades, assignments and reminders will appear here."
        />
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => {
            const content = (
              <div className={cn("flex gap-3 py-3", !row.is_read && "font-bold")}>
                <span
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    row.is_read ? "bg-transparent" : "bg-primary",
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{row.title}</p>
                  {row.body ? (
                    <p className="truncate text-xs font-semibold text-muted-foreground">
                      {row.body}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-[11px] font-semibold text-muted-foreground">
                    {row.category_label} · {ago(row.created_at)}
                  </p>
                </div>
              </div>
            );
            return (
              <li key={row.id}>
                {row.link_url ? (
                  <Link
                    href={row.link_url}
                    onClick={() => markRead.mutate({ ids: [row.id] })}
                    className="block hover:bg-surface-2"
                  >
                    {content}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => markRead.mutate({ ids: [row.id] })}
                    className="block w-full text-left hover:bg-surface-2"
                  >
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
