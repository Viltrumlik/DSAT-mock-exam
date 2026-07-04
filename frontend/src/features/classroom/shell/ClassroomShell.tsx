"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, BookOpen, Calculator } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatLessonDaysShort } from "@/lib/classroomSchedule";
import { Tabs } from "../ui/Tabs";
import { Pill } from "../ui/Pill";
import { capabilitiesFor, ROLE_LABEL, normalizeRole } from "../capabilities";
import { useRankings } from "../rankingsHooks";
import type { ClassroomWithRole } from "../types";
import { visibleTabs, type ClassroomTabId } from "./tabs";

function fmtPts(n: number | null | undefined): string {
  return n == null ? "—" : Math.round(n).toLocaleString("en-US");
}

/** A single right-aligned header metric (e.g. "#3 / RANK"). */
function Stat({ value, label, tone }: { value: React.ReactNode; label: string; tone?: "primary" | "accent" }) {
  const color = tone === "primary" ? "text-primary" : tone === "accent" ? "text-emerald-600 dark:text-emerald-400" : "text-foreground";
  return (
    <div className="px-3.5 text-center sm:px-5">
      <div className={cn("text-xl font-extrabold leading-none tabular-nums sm:text-[26px]", color)}>{value}</div>
      <div className="mt-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
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

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-4 sm:px-6">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {backLabel}
      </Link>

      <header className="cr-rise mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border-2 border-primary bg-card p-4 shadow-sm sm:p-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <SubjectIcon className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">{classroom.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Pill tone={isMath ? "info" : "primary"}>{isMath ? "Math" : "English"}</Pill>
              {schedule && <span>{schedule}{lessonTime ? ` · ${lessonTime}` : ""}</span>}
              {role && <span className="text-xs">· {ROLE_LABEL[role]}</span>}
            </div>
          </div>
        </div>

        {/* Right metrics */}
        {isStudent ? (
          <div className="flex items-center divide-x divide-border">
            <Stat value={my ? `#${my.rank}` : "—"} label="Rank" tone="primary" />
            <Stat value={studentCount ?? "—"} label="Students" />
            <Stat value={fmtPts(my?.score)} label="Your pts" tone="accent" />
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
    </div>
  );
}
