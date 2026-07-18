"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import JournalLessonEditor from "@/features/journals/JournalLessonEditor";
import JournalClassworkEditor from "@/features/journals/JournalClassworkEditor";
import { journalsApi } from "@/features/journals/api";
import type { JournalDetail, LessonDetail } from "@/features/journals/types";
import { cn } from "@/lib/cn";
import { ArrowLeft, ClipboardList, GraduationCap, Loader2, Presentation } from "lucide-react";

type Tab = "homework" | "classwork";

/**
 * One journal session has two sides: the HOMEWORK students take away, and the
 * CLASSWORK the teacher runs in the lesson. Both are authored here.
 */
export default function JournalSessionEditorPage() {
  const params = useParams<{ journalId: string; lessonId: string }>();
  const journalId = Number(params.journalId);
  const lessonId = Number(params.lessonId);

  const [tab, setTab] = useState<Tab>("homework");
  const [journal, setJournal] = useState<JournalDetail | null>(null);
  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [j, l] = await Promise.all([
        journalsApi.get(journalId),
        journalsApi.lesson(journalId, lessonId),
      ]);
      setJournal(j);
      setLesson(l);
    } catch {
      setError("Could not load this session.");
    } finally {
      setLoading(false);
    }
  }, [journalId, lessonId]);

  useEffect(() => {
    if (Number.isFinite(journalId) && Number.isFinite(lessonId)) void load();
  }, [journalId, lessonId, load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-1 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading session…
      </div>
    );
  }
  if (error || !journal || !lesson) {
    return (
      <div className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
        {error ?? "Session not found."}
      </div>
    );
  }

  const isMidterm = lesson.lesson_type === "MIDTERM";

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <div className="mb-4">
        <Link
          href={`/ops/journals/${journalId}`}
          className="mb-3 inline-flex items-center gap-2 text-[13.5px] font-bold text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" /> Back to {journal.display_title}
        </Link>
        <h1 className="text-[22px] font-extrabold tracking-tight text-foreground">
          Session {lesson.lesson_number}
          <span className="ml-2 text-base font-bold text-muted-foreground">
            · {journal.subject_label} {journal.level_label}
          </span>
        </h1>
      </div>

      {isMidterm ? (
        <div className="rounded-2xl border border-[#6d4ec7]/40 bg-[#6d4ec7]/5 p-6">
          <div className="mb-2 flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#6d4ec7]/15 text-[#6d4ec7]">
              <GraduationCap className="h-5 w-5" />
            </span>
            <h2 className="text-lg font-extrabold text-foreground">Midterm session</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {lesson.midterm?.title
              ? `Runs “${lesson.midterm.title}”.`
              : "No midterm exam selected yet."}{" "}
            The class is given access {lesson.midterm?.access_days_before ?? 2} days before this
            session, scheduled at the lesson time. Midterm sessions carry no homework or classwork.
          </p>
        </div>
      ) : (
        <>
          {/* Homework | Classwork */}
          <div className="mb-5 flex gap-2" role="tablist">
            <TabButton
              active={tab === "homework"}
              onClick={() => setTab("homework")}
              icon={ClipboardList}
              label="Homework"
              ok={lesson.homework_ready}
            />
            <TabButton
              active={tab === "classwork"}
              onClick={() => setTab("classwork")}
              icon={Presentation}
              label="Classwork"
              ok={lesson.classwork_ready}
            />
          </div>

          {tab === "homework" ? (
            <JournalLessonEditor journalId={journalId} lessonId={lessonId} />
          ) : (
            <JournalClassworkEditor
              journalId={journalId}
              lessonId={lessonId}
              journal={journal}
              onSaved={() => void load()}
            />
          )}
        </>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  ok,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof ClipboardList;
  label: string;
  ok: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-xl border-[1.5px] px-4 py-2.5 text-sm font-bold transition-all",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-panel text-muted-foreground hover:border-primary hover:text-primary",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
      <span
        className={cn(
          "rounded-md px-1.5 py-0.5 text-[10px] font-extrabold uppercase",
          ok
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
            : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
        )}
      >
        {ok ? "Ready" : "Todo"}
      </span>
    </button>
  );
}
