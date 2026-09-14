"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { School, Settings2, User } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { EmailVerificationModal } from "@/components/EmailVerificationModal";
import { useToast } from "@/components/ToastProvider";
import { HeroPage, Skeleton } from "@/components/ui";
import { examsStudentApi } from "@/features/examsStudent/api";
import { rewardsApi, type MyRewards } from "@/features/rewards/rewardsApi";
// The house devices. Importing the classroom's kit is what makes this page read as part of
// the same product as the homework it opens onto.
import { ErrorState, Tabs, type TabItem } from "@/features/classroom/ui";
import { capabilitiesFor } from "@/features/classroom/capabilities";
import { ClassesTab, type ClassPerson } from "@/features/profile/ClassesTab";
import { OverviewTab } from "@/features/profile/OverviewTab";
import { ProfileHero } from "@/features/profile/ProfileHero";
import { SettingsTab } from "@/features/profile/SettingsTab";
import type { HomeworkRow, ScheduleEvent } from "@/features/profile/profileModel";
import {
  SETTINGS_SECTIONS,
  toProfileMe,
  type ExamDateOption,
  type Load,
  type ProfileAttempt,
  type ProfileClass,
  type ProfileMe,
  type SettingsSectionKey,
  type TelegramConfig,
} from "@/features/profile/types";
import { invalidateMe } from "@/hooks/useMe";
import { classesApi, usersApi } from "@/lib/api";
import { displayEmail } from "@/lib/email";

type ProfileTab = "overview" | "classes" | "settings";

const TAB_KEYS: ProfileTab[] = ["overview", "classes", "settings"];

/** What the Telegram callback appends to `next` when linking fails, in a student's words. */
const TELEGRAM_ERRORS: Record<string, string> = {
  already_linked_to_another_account: "That Telegram account is already connected to another MasterSAT account.",
  account_already_linked: "Your account already has a Telegram account connected.",
};

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Runs a request into a `Load`, so every panel can tell loading, failed and empty apart. */
async function into<T>(set: (load: Load<T>) => void, request: () => Promise<T>) {
  set({ status: "loading" });
  try {
    set({ status: "ready", data: await request() });
  } catch {
    set({ status: "error" });
  }
}

export default function ProfilePage() {
  /**
   * Three tabs, rebuilt in white quartz (the owner, 2026-09-14: "profile page. har xil settingslar
   * qo'shing chiroyli dizaynda. classrooms dizaynini o'zgartirin … Overviewga ham functionlar
   * qo'shing. Payments blockini overviewga qo'shib ichiga coming soon deb yozib qo'ying").
   *
   * - Overview does things now: its figures open their pages, its checklist opens the step it
   *   names, homework to do opens the homework, and Payments holds its place, coming soon.
   * - Classes shows each class's next lesson, teacher and way in, beside its classmates.
   * - Settings is a section per setting — account, goal, appearance, notifications, sign-in and
   *   password, devices — where the edit modal, a Telegram banner and a session log used to be.
   *
   * Each tab's data is its own request with its own failure, so one slow or broken panel never
   * blanks the page — and a failure is never drawn as "nothing here".
   */
  const toast = useToast();
  const queryClient = useQueryClient();
  const tabsRef = useRef<HTMLDivElement>(null);

  const [tab, setTab] = useState<ProfileTab>("overview");
  const [section, setSection] = useState<SettingsSectionKey>("account");

  const [me, setMe] = useState<ProfileMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [classes, setClasses] = useState<ProfileClass[]>([]);
  const [telegram, setTelegram] = useState<TelegramConfig | null>(null);
  const [examDates, setExamDates] = useState<ExamDateOption[]>([]);
  const [verifyOpen, setVerifyOpen] = useState(false);

  const [rewards, setRewards] = useState<Load<MyRewards>>({ status: "loading" });
  const [homework, setHomework] = useState<Load<HomeworkRow[]>>({ status: "loading" });
  const [attempts, setAttempts] = useState<Load<ProfileAttempt[]>>({ status: "loading" });
  const [schedule, setSchedule] = useState<Load<ScheduleEvent[]>>({ status: "loading" });
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [people, setPeople] = useState<Load<ClassPerson[]>>({ status: "loading" });

  /* ── Where the student is on the page, kept in the address so a reload or a shared link
        lands in the same place: /profile?tab=settings&section=devices ─────────────────── */

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wantedTab = params.get("tab") as ProfileTab | null;
    const wantedSection = params.get("section") as SettingsSectionKey | null;
    if (wantedTab && TAB_KEYS.includes(wantedTab)) setTab(wantedTab);
    if (wantedSection && SETTINGS_SECTIONS.includes(wantedSection)) setSection(wantedSection);

    // Back from Telegram's link flow, which lands on /profile?tg_linked=1 or ?tg_error=….
    const linked = params.get("tg_linked");
    const tgError = params.get("tg_error");
    if (linked || tgError) {
      setTab("settings");
      setSection("signin");
      toast.push(
        linked
          ? { tone: "success", message: "Telegram is connected. You can sign in with one tap now." }
          : { tone: "error", message: TELEGRAM_ERRORS[tgError ?? ""] ?? "Telegram couldn't be connected. Try again." },
      );
    }
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("tg_linked");
    url.searchParams.delete("tg_error");
    if (tab === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    if (tab === "settings") url.searchParams.set("section", section);
    else url.searchParams.delete("section");
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, "", next);
    }
  }, [tab, section]);

  /* ── Data ────────────────────────────────────────────────────────────────────────── */

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [meData, classData, tgWidget, examDatesRaw] = await Promise.all([
        usersApi.getMe(),
        classesApi.list(),
        usersApi.getTelegramWidgetConfig().catch(() => null),
        usersApi.listExamDates().catch(() => []),
      ]);
      setMe(toProfileMe(meData));
      setTelegram(tgWidget);
      setExamDates(Array.isArray(examDatesRaw) ? (examDatesRaw as ExamDateOption[]) : []);
      // Every class the user holds a seat in. This named STUDENT and ADMIN, all the roles there
      // were when it was written; the OWNER, TEACHER and TA seats that came later fell off the list.
      const mine = (classData.items as ProfileClass[]).filter((c) => capabilitiesFor(c.my_role).isMember);
      setClasses(mine);
      setSelectedClassId((prev) => prev ?? mine[0]?.id ?? null);
    } catch {
      // Not an empty profile: a failed fetch that renders as a blank page tells the student
      // their account is empty, which is a different and much worse claim.
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRewards = useCallback(() => into(setRewards, () => rewardsApi.me()), []);
  // One request for every class's homework, where this used to ask for each class's list and
  // then for every single assignment's submission in turn.
  const loadHomework = useCallback(
    () => into(setHomework, async () => (await classesApi.myAssignments()).items as unknown as HomeworkRow[]),
    [],
  );
  const loadAttempts = useCallback(
    () => into(setAttempts, async () => (await examsStudentApi.getAttempts()).items as unknown as ProfileAttempt[]),
    [],
  );
  const loadSchedule = useCallback(() => {
    const today = new Date();
    const until = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 21);
    return into(setSchedule, async () => (await classesApi.mySchedule(isoDay(today), isoDay(until))).events as ScheduleEvent[]);
  }, []);
  const loadPeople = useCallback(
    (classId: number) =>
      into(setPeople, async () => {
        const rows = await classesApi.people(classId);
        return (Array.isArray(rows) ? rows : []) as ClassPerson[];
      }),
    [],
  );

  useEffect(() => {
    void loadProfile();
    void loadRewards();
    void loadHomework();
    void loadAttempts();
  }, [loadProfile, loadRewards, loadHomework, loadAttempts]);

  // The Classes tab's own requests wait until someone opens it.
  const classesOpened = tab === "classes";
  useEffect(() => {
    if (classesOpened && schedule.status === "loading") void loadSchedule();
    // Only on opening; a retry is the button's job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classesOpened]);
  useEffect(() => {
    if (classesOpened && selectedClassId != null) void loadPeople(selectedClassId);
  }, [classesOpened, selectedClassId, loadPeople]);

  /* ── Actions ─────────────────────────────────────────────────────────────────────── */

  const openSettings = useCallback((next: SettingsSectionKey) => {
    setTab("settings");
    setSection(next);
    tabsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, []);

  const onSaved = useCallback(
    (next: ProfileMe) => {
      setMe(next);
      // The header's avatar and name come from the shared `/users/me` query.
      void invalidateMe(queryClient);
    },
    [queryClient],
  );

  const copyUsername = async () => {
    if (!me) return;
    try {
      await navigator.clipboard.writeText(me.username);
      toast.push({ tone: "success", message: `@${me.username} is copied.` });
    } catch {
      toast.push({ tone: "error", message: "Couldn't copy — select it and copy it by hand." });
    }
  };

  const tabs: TabItem[] = useMemo(
    () => [
      { id: "overview", label: "Overview", icon: User },
      { id: "classes", label: "Classes", icon: School, count: classes.length },
      { id: "settings", label: "Settings", icon: Settings2 },
    ],
    [classes.length],
  );

  /* ── Render ──────────────────────────────────────────────────────────────────────── */

  if (loading && !me) {
    return (
      <HeroPage className="flex flex-col gap-5">
        <Skeleton className="squircle h-[168px] [--sq:15px]" />
        <Skeleton className="squircle h-14 w-80 max-w-full [--sq:13px]" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="squircle h-36 [--sq:12px]" />
          ))}
        </div>
        <Skeleton className="squircle h-72 [--sq:13px]" />
      </HeroPage>
    );
  }

  if (loadFailed || !me) {
    return (
      <HeroPage>
        <section className="quartz squircle [--sq:13px]">
          <ErrorState
            title="Your profile isn't loading right now."
            message="Nothing has changed on your account — it will be here once the connection comes back."
            onRetry={() => void loadProfile()}
          />
        </section>
      </HeroPage>
    );
  }

  // Empty for Telegram signups and released accounts: their stored address is a placeholder,
  // and showing it would read as a real contact address.
  const realEmail = displayEmail(me.email);
  const telegramStartUrl = telegram?.enabled && telegram.start_url ? telegram.start_url : null;

  return (
    <HeroPage className="flex flex-col gap-5">
      <ProfileHero
        me={me}
        realEmail={realEmail}
        onEdit={() => openSettings("account")}
        onConfirmEmail={() => setVerifyOpen(true)}
        onCopyUsername={() => void copyUsername()}
      />

      <div ref={tabsRef} className="scroll-mt-4">
        <Tabs items={tabs} active={tab} onChange={(id) => setTab(id as ProfileTab)} />
      </div>

      {/* Keyed by tab so switching replays the entrance instead of swapping the panels in place. */}
      <div key={tab} className="cr-section">
        {tab === "overview" ? (
          <OverviewTab
            me={me}
            realEmail={realEmail}
            rewards={rewards}
            homework={homework}
            attempts={attempts}
            telegramStartUrl={telegramStartUrl}
            onOpenSettings={openSettings}
            onConfirmEmail={() => setVerifyOpen(true)}
            onRetryHomework={() => void loadHomework()}
            onRetryAttempts={() => void loadAttempts()}
          />
        ) : tab === "classes" ? (
          <ClassesTab
            classes={classes}
            schedule={schedule}
            selectedId={selectedClassId}
            onSelect={setSelectedClassId}
            people={people}
            selfId={me.id}
            onRetryPeople={() => selectedClassId != null && void loadPeople(selectedClassId)}
          />
        ) : (
          <SettingsTab
            section={section}
            onSection={setSection}
            me={me}
            realEmail={realEmail}
            examDates={examDates}
            telegram={telegram}
            onSaved={onSaved}
            onOpenEmail={() => setVerifyOpen(true)}
            onPasswordChanged={(changedAt) => setMe((prev) => (prev ? { ...prev, last_password_change: changedAt } : prev))}
          />
        )}
      </div>

      <EmailVerificationModal
        open={verifyOpen}
        currentEmail={realEmail}
        onClose={() => setVerifyOpen(false)}
        onVerified={(confirmed) => {
          setVerifyOpen(false);
          setMe((prev) => (prev ? { ...prev, email: confirmed, email_verified: true } : prev));
          void invalidateMe(queryClient);
          toast.push({ tone: "success", message: "Your email is confirmed." });
        }}
      />
    </HeroPage>
  );
}
