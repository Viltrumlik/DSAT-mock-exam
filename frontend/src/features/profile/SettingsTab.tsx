"use client";

import { BellRing, KeyRound, MonitorSmartphone, Palette, Target, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { NotificationPreferencesCard } from "@/features/notifications/NotificationPreferencesCard";
import { cn } from "@/lib/cn";

import { IconTile, TONE, type Tone } from "./profileUi";
import { AccountSection } from "./settings/AccountSection";
import { AppearanceSection } from "./settings/AppearanceSection";
import { DevicesSection } from "./settings/DevicesSection";
import { GoalSection } from "./settings/GoalSection";
import { SignInSection } from "./settings/SignInSection";
import { SETTINGS_SECTIONS, type ExamDateOption, type ProfileMe, type SettingsSectionKey, type TelegramConfig } from "./types";

const MENU: Record<SettingsSectionKey, { label: string; hint: string; icon: LucideIcon; tone: Tone }> = {
  account: { label: "Account", hint: "Photo, name and phone", icon: UserRound, tone: "primary" },
  goal: { label: "Study goal", hint: "Target score and SAT date", icon: Target, tone: "amber" },
  appearance: { label: "Appearance", hint: "Light, dark or automatic", icon: Palette, tone: "violet" },
  notifications: { label: "Notifications", hint: "What reaches you", icon: BellRing, tone: "sky" },
  signin: { label: "Sign-in & password", hint: "Email, Telegram, password", icon: KeyRound, tone: "emerald" },
  devices: { label: "Devices", hint: "Where you're signed in", icon: MonitorSmartphone, tone: "rose" },
};

/**
 * Every setting a student has, one section at a time: a menu on the left (a scrolling row on a
 * phone) and the chosen section beside it. Before, the tab was a Telegram banner, the
 * notification switches and a session log stacked in one column; the name, photo, phone and goal
 * lived in a modal behind "Edit profile", and theme and password lived nowhere.
 */
export function SettingsTab({
  section,
  onSection,
  me,
  realEmail,
  examDates,
  telegram,
  onSaved,
  onOpenEmail,
  onPasswordChanged,
}: {
  section: SettingsSectionKey;
  onSection: (section: SettingsSectionKey) => void;
  me: ProfileMe;
  realEmail: string;
  examDates: ExamDateOption[];
  telegram: TelegramConfig | null;
  onSaved: (me: ProfileMe) => void;
  onOpenEmail: () => void;
  onPasswordChanged: (changedAt: string | null) => void;
}) {
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
      <nav data-settings-nav aria-label="Settings" className="quartz squircle p-2 [--sq:13px] lg:sticky lg:top-4">
        {/* `p-1` is headroom for the focus ring: the row scrolls sideways on a phone, and a
            scrolling box clips whatever pokes past its edge. */}
        <div role="tablist" aria-orientation="vertical" className="flex gap-1 overflow-x-auto p-1 lg:flex-col lg:overflow-visible">
          {SETTINGS_SECTIONS.map((key) => {
            const item = MENU[key];
            const active = key === section;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                id={`settings-tab-${key}`}
                aria-selected={active}
                aria-controls="settings-panel"
                onClick={() => onSection(key)}
                className={cn(
                  "ds-ring squircle flex shrink-0 items-center gap-3 px-2.5 py-2 text-left font-[inherit] transition-colors [--sq:9px] lg:w-full",
                  active ? TONE[item.tone].well : "hover:bg-primary/[0.04]",
                )}
              >
                <IconTile icon={item.icon} tone={item.tone} size="sm" />
                <span className="min-w-0 pr-1">
                  <span className={cn("block whitespace-nowrap text-[13.5px] font-extrabold", active ? TONE[item.tone].text : "text-foreground")}>
                    {item.label}
                  </span>
                  <span className="hidden truncate text-[12px] font-medium text-muted-foreground lg:block">{item.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Keyed by section so a switch replays the entrance instead of swapping in place. */}
      <div key={section} id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${section}`} className="cr-section min-w-0">
        {section === "account" ? (
          <AccountSection me={me} onSaved={onSaved} />
        ) : section === "goal" ? (
          <GoalSection me={me} examDates={examDates} onSaved={onSaved} />
        ) : section === "appearance" ? (
          <AppearanceSection />
        ) : section === "notifications" ? (
          <NotificationPreferencesCard />
        ) : section === "signin" ? (
          <SignInSection
            me={me}
            realEmail={realEmail}
            telegram={telegram}
            onOpenEmail={onOpenEmail}
            onPasswordChanged={onPasswordChanged}
          />
        ) : (
          <DevicesSection />
        )}
      </div>
    </div>
  );
}
