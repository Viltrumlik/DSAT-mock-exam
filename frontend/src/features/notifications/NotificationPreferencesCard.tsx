"use client";

import {
  Award,
  Bell,
  BellOff,
  BellRing,
  ClipboardCheck,
  Coins,
  FileText,
  LifeBuoy,
  Megaphone,
  Smartphone,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Skeleton, Switch } from "@/components/ui";
// The house devices, so this card reads as part of the same product as the page it sits on.
import { EmptyState, ErrorState } from "@/features/classroom/ui";
import { cn } from "@/lib/cn";

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
 *
 * In white quartz since the profile's Settings tab was rebuilt: each section on a tint of its
 * own colour with its own icon, and each switch named for a screen reader rather than a second
 * time on screen — the rows used to read "Grades … Grades notifications".
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

/** A face per section. A section the server adds later still gets a switch, with the bell. */
const LOOK: Partial<Record<NotificationCategory, { icon: LucideIcon; tile: string }>> = {
  GRADES: { icon: Award, tile: "bg-success/15 text-success-foreground" },
  HOMEWORK: { icon: ClipboardCheck, tile: "bg-warning/15 text-warning-foreground" },
  EXAMS: { icon: FileText, tile: "bg-primary/12 text-primary dark:text-primary-hover" },
  CLASSROOM: { icon: Users, tile: "bg-info/15 text-info-foreground" },
  SUPPORT: { icon: LifeBuoy, tile: "bg-success/15 text-success-foreground" },
  REWARDS: { icon: Coins, tile: "bg-warning/15 text-warning-foreground" },
  SYSTEM: { icon: Megaphone, tile: "bg-[color-mix(in_oklab,var(--chart-6)_16%,transparent)] text-[var(--chart-6)]" },
};

const FALLBACK_LOOK = { icon: Bell, tile: "bg-primary/12 text-primary dark:text-primary-hover" };

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
    <section className="quartz squircle cr-cardrise p-5 [--sq:13px] sm:p-6">
      <div className="flex items-center gap-3">
        <span className="squircle grid h-11 w-11 shrink-0 place-items-center bg-info/15 text-info-foreground [--sq:7px]">
          <BellRing className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="text-[17px] font-extrabold leading-tight tracking-[-0.01em] text-foreground">Notifications</h3>
          <p className="mt-0.5 text-[13px] font-medium text-muted-foreground">
            Choose what reaches you. You can change these whenever you like.
          </p>
        </div>
      </div>

      {/* Four branches. A failed fetch rendered as "nothing to configure" would tell a student
          they have no choices, which is the opposite of what this card exists to say. */}
      <div className="mt-5">
        {prefs.isPending ? (
          <div className="space-y-2">
            <Skeleton className="squircle h-16 [--sq:10px]" />
            <Skeleton className="squircle h-16 [--sq:10px]" />
            <Skeleton className="squircle h-16 [--sq:10px]" />
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
          <ul className="space-y-2">
            {sections.map((section) => {
              const on = !muted.includes(section.value);
              const look = LOOK[section.value] ?? FALLBACK_LOOK;
              const Icon = look.icon;
              return (
                <li
                  key={section.value}
                  className={cn(
                    "squircle flex items-center gap-3 px-3.5 py-3 transition-colors [--sq:10px]",
                    // Off is a paler tint of the same blue, never grey: the row is still there to turn on.
                    on ? "bg-primary/[0.05]" : "bg-primary/[0.02]",
                  )}
                >
                  <span className={cn("squircle grid h-9 w-9 shrink-0 place-items-center [--sq:6px]", look.tile, !on && "opacity-60")}>
                    <Icon className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
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
                    ariaLabel={`${section.label} notifications`}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* The phone toggle is deliberately outside the four branches above: it belongs to the
          same fetch, but it is a different question — the bell and the buzz are separate, and
          a student may well want every section on screen and none of them on their phone. */}
      {!prefs.isPending && !prefs.isError ? (
        <div className="squircle mt-4 flex items-center gap-3 border border-dashed border-primary/25 bg-primary/[0.04] px-3.5 py-3 [--sq:10px]">
          <span className="squircle grid h-9 w-9 shrink-0 place-items-center bg-primary/12 text-primary [--sq:6px] dark:text-primary-hover">
            <Smartphone className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold text-foreground">Push to my phone</p>
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
            ariaLabel="Push notifications"
          />
        </div>
      ) : null}

      {save.isError ? (
        <p className="mt-3 text-xs font-bold text-danger">
          That didn&apos;t save. Your settings are unchanged — try again.
        </p>
      ) : null}
    </section>
  );
}
