"use client";

import { BellOff, BellRing, Smartphone } from "lucide-react";

import { Skeleton, Switch } from "@/components/ui";
// The house devices, so this card reads as part of the same product as the page it sits on.
import { Card, CardHeader, EmptyState, ErrorState } from "@/features/classroom/ui";

import { type NotificationCategory } from "./notificationsApi";
import {
  useNotificationPreferences,
  usePushConfig,
  useSaveNotificationPreferences,
} from "./notificationsHooks";

/**
 * The student's own notification switches.
 *
 * `/api/notifications/preferences/` shipped as a working GET/PATCH with **no client at all**:
 * the server has honoured a muted category since day one — `services.notify` checks it before
 * every write — and there was no screen anywhere that could set one. So "you can turn a
 * section off" was true of the API and false of the product.
 *
 * It lives here rather than inline on the profile page so the fetching, the four render
 * branches and the copy stay next to the rest of the notifications feature, and so the page
 * that hosts it only has to know the component's name.
 */

/** Category copy the server does not own: *why* a student might want this section. */
const HINTS: Partial<Record<NotificationCategory, string>> = {
  GRADES: "When your work has been marked, and when results are ready.",
  HOMEWORK: "New assignments, and a nudge while there's still time to finish.",
  EXAMS: "Midterms and mocks that have been scheduled for you.",
  CLASSROOM: "Announcements from your class, and replies to your comments.",
  SUPPORT: "Support sessions you've booked, changed or been reminded about.",
  REWARDS: "Points you've earned and shop orders ready to collect.",
  SYSTEM: "Occasional messages from the learning center itself.",
};

export function NotificationPreferencesCard() {
  const prefs = useNotificationPreferences();
  const pushConfig = usePushConfig();
  const save = useSaveNotificationPreferences();

  const muted = prefs.data?.muted_categories ?? [];
  const sections = prefs.data?.categories ?? [];

  const setMuted = (category: NotificationCategory, on: boolean) => {
    // `on` is what the student wants the SECTION to do, so muting is its inverse. The server
    // stores exceptions only — the list is what is switched off, never what is switched on.
    const next = on
      ? muted.filter((c) => c !== category)
      : Array.from(new Set([...muted, category]));
    save.mutate({ muted_categories: next });
  };

  return (
    <Card className="cr-card space-y-3">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <BellRing className="h-4 w-4 text-primary" /> Notifications
          </span>
        }
        description="Choose what reaches you. You can change these whenever you like."
      />

      {/* Four branches. A failed fetch rendered as "nothing to configure" would tell a student
          they have no choices, which is the opposite of what this card exists to say. */}
      {prefs.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
        </div>
      ) : prefs.isError ? (
        <ErrorState
          title="Couldn't load your notification settings."
          message="Nothing has changed — only this panel failed to load."
          onRetry={() => void prefs.refetch()}
        />
      ) : sections.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title="No sections to set yet"
          description="Notification sections will appear here as the platform adds them."
        />
      ) : (
        <ul className="divide-y divide-border">
          {sections.map((section) => {
            const on = !muted.includes(section.value);
            return (
              <li
                key={section.value}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-extrabold text-foreground">{section.label}</p>
                  {HINTS[section.value] ? (
                    <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                      {HINTS[section.value]}
                    </p>
                  ) : null}
                </div>
                <Switch
                  checked={on}
                  disabled={save.isPending}
                  onCheckedChange={(next) => setMuted(section.value, next)}
                  label={`${section.label} notifications`}
                />
              </li>
            );
          })}
        </ul>
      )}

      {/* The phone toggle is deliberately outside the four branches above: it belongs to the
          same fetch, but it is a different question — the bell and the buzz are separate, and
          a student may well want every section on screen and none of them on their phone. */}
      {!prefs.isPending && !prefs.isError ? (
        <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-2 p-3">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 text-sm font-extrabold text-foreground">
              <Smartphone className="h-4 w-4 text-primary" aria-hidden /> Push to my phone
            </p>
            <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
              {pushConfig.data?.enabled === false
                ? "Push isn't switched on for this site yet — the bell above still works."
                : "Only the important ones: marks, homework and support sessions."}
            </p>
          </div>
          <Switch
            checked={Boolean(prefs.data?.push_enabled)}
            // Disabled when the deployment has no VAPID keys, because the switch would then
            // promise something nothing can deliver. It is NOT hidden: a student who turned
            // push off last term should still be able to see that they did.
            disabled={save.isPending || pushConfig.data?.enabled === false}
            onCheckedChange={(next) => save.mutate({ push_enabled: next })}
            label="Push notifications"
          />
        </div>
      ) : null}

      {save.isError ? (
        <p className="text-xs font-bold text-rose-500">
          That didn&apos;t save. Your settings are unchanged — try again.
        </p>
      ) : null}
    </Card>
  );
}
