"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, BookOpen, Calculator, Send, DoorClosed } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatLessonDaysShort } from "@/lib/classroomSchedule";
import { Tabs } from "../ui/Tabs";
import { Pill } from "../ui/Pill";
import { capabilitiesFor, ROLE_LABEL, normalizeRole } from "../capabilities";
import { useRankings } from "../rankingsHooks";
import { useTelegramGroup } from "../telegramHooks";
import type { ClassroomWithRole } from "../types";
import { TelegramJoinDialog } from "./TelegramJoinDialog";
import { visibleTabs, type ClassroomTabId } from "./tabs";

function fmtPts(n: number | null | undefined): string {
  return n == null ? "—" : Math.round(n).toLocaleString("en-US");
}

/** A single right-aligned header metric (e.g. "#3 / RANK"). Sizes/colors match the
 *  MasterSAT Classroom mockup 1:1 (blue rank, teal points, faint 10px labels). */
function Stat({ value, label, tone }: { value: React.ReactNode; label: string; tone?: "primary" | "accent" }) {
  const color = tone === "primary" ? "text-primary" : tone === "accent" ? "text-teal-600 dark:text-teal-400" : "text-foreground";
  return (
    <div className="px-4 text-center sm:px-5">
      <div className={cn("text-[21px] font-extrabold leading-none tabular-nums", color)}>{value}</div>
      <div className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.04em] text-slate-400">{label}</div>
    </div>
  );
}

function JoinCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(code).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1 font-mono text-xs font-semibold text-foreground hover:bg-card"
      title="Copy join code"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
      {code}
    </button>
  );
}

/**
 * Classroom workspace chrome: back link, identity header, role-aware tab nav, content slot.
 * Tab visibility derives from the viewer's capabilities (see ../capabilities + ./tabs).
 */
export function ClassroomShell({
  classroom,
  active,
  onTabChange,
  children,
  backHref = "/classes",
  backLabel = "All classes",
}: {
  classroom: ClassroomWithRole;
  active: ClassroomTabId;
  onTabChange: (id: ClassroomTabId) => void;
  children: React.ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  const caps = capabilitiesFor(classroom.my_role);
  const role = normalizeRole(classroom.my_role);
  const tabs = visibleTabs(caps);

  const classId = Number(classroom.id);
  const isStudent = role === "STUDENT";
  // Header metrics: a student sees their own rank + points (academic board).
  const { data: ranking } = useRankings(classId, "ACADEMIC", isStudent);
  const my = ranking?.my ?? null;
  const studentCount = classroom.student_count ?? classroom.members_count ?? null;

  const subject = String((classroom as { subject?: string }).subject ?? "").toUpperCase();
  const isMath = subject === "MATH";
  const SubjectIcon = isMath ? Calculator : BookOpen;
  const schedule = formatLessonDaysShort((classroom as { lesson_days?: string }).lesson_days);
  const lessonTime = (classroom as { lesson_time?: string }).lesson_time;
  const joinCode = classroom.join_code;
  const room = (classroom.room_number || "").trim();
  // Read next to the other classroom fields, and rendered in the meta row BELOW the
  // student/staff split further down — the group is the same group whoever is looking at it,
  // and a button placed on the right-hand side would reach only one of the two audiences.
  const telegram = (classroom.telegram_group_url || "").trim();
  // A managed group is one the bot administers: the button opens the join dialog and the
  // student leaves with a single-use invite. A class with only the old static link keeps the
  // old behaviour — a plain anchor — so nothing regresses for the classes nobody has set up
  // yet. A failed lookup lands in that same branch, which is the right way to fail: the
  // legacy link still works, and the dialog explains itself properly if they get that far.
  const { data: tgState } = useTelegramGroup(classId);
  const tgManaged = Boolean(tgState?.managed);
  const [tgOpen, setTgOpen] = useState(false);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-4 sm:px-6">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {backLabel}
      </Link>

      <header className="cr-rise mt-4 flex flex-wrap items-center justify-between gap-4 rounded-[18px] border-t-4 border-l-[5px] border-r border-b border-t-primary border-l-primary border-r-border border-b-border bg-card px-[22px] py-[18px] shadow-[0_6px_16px_rgba(15,23,41,0.06)]">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <SubjectIcon className="h-7 w-7" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[22px] font-extrabold tracking-tight text-foreground sm:text-[26px]">{classroom.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
              <Pill tone={isMath ? "info" : "primary"}>{isMath ? "Math" : "English"}</Pill>
              {schedule && <span>{schedule}{lessonTime ? ` · ${lessonTime}` : ""}</span>}
              {room && (
                <span className="inline-flex items-center gap-1">
                  <DoorClosed className="h-3.5 w-3.5" aria-hidden /> {room}
                </span>
              )}
              {role && <span>· {ROLE_LABEL[role]}</span>}
            </div>
            {tgManaged ? (
              <button
                type="button"
                onClick={() => setTgOpen(true)}
                className="ds-ring mt-2.5 inline-flex items-center gap-1.5 rounded-xl bg-[#2AABEE] px-3 py-1.5 text-[13px] font-bold text-white transition-opacity hover:opacity-90"
              >
                <Send className="h-[15px] w-[15px]" aria-hidden />
                {tgState?.status === "JOINED" ? "Telegram group" : "Join Telegram group"}
              </button>
            ) : (
              telegram && (
                <a
                  href={telegram}
                  target="_blank"
                  // `noopener` is the security half — a new tab must not get `window.opener`
                  // back into this app. `noreferrer` follows it because they are the pair.
                  rel="noopener noreferrer"
                  className="ds-ring mt-2.5 inline-flex items-center gap-1.5 rounded-xl bg-[#2AABEE] px-3 py-1.5 text-[13px] font-bold text-white transition-opacity hover:opacity-90"
                >
                  <Send className="h-[15px] w-[15px]" aria-hidden /> Join Telegram group
                </a>
              )
            )}
          </div>
        </div>

        {/* Right metrics */}
        {isStudent ? (
          <div className="flex items-center divide-x divide-border">
            <Stat value={my ? `#${my.rank}` : "—"} label="Rank" tone="primary" />
            <Stat value={studentCount ?? "—"} label="Students" />
            {/* The class board runs on XP now, not points. Points still exist and still buy
                coins — they live on the student's own Points page. */}
            <Stat value={fmtPts(my?.score)} label="Your XP" tone="accent" />
          </div>
        ) : (
          <div className="flex items-center gap-4">
            {studentCount != null && <Stat value={studentCount} label="Students" />}
            {caps.canManageClass && joinCode && (
              <div className="flex flex-col items-end gap-1 border-l border-border pl-4">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Join code</span>
                <JoinCode code={joinCode} />
              </div>
            )}
          </div>
        )}
      </header>

      <div className="mt-6">
        <Tabs
          items={tabs.map((t) => ({ id: t.id, label: t.label, icon: t.icon }))}
          active={active}
          onChange={(id) => onTabChange(id as ClassroomTabId)}
        />
      </div>

      <div className="mt-6">{children}</div>

      {/* Mounted only once the button has been pressed: the dialog fetches the Telegram
          sign-in config on open, and a classroom page should not make that call for the
          many visits where nobody touches the group. */}
      {tgOpen && (
        <TelegramJoinDialog
          open={tgOpen}
          onClose={() => setTgOpen(false)}
          classId={classId}
          className={classroom.name}
        />
      )}
    </div>
  );
}
