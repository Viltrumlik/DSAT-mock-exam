"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { Icon, type IconName } from "@/components/ui/Icon";
import { LibraryError } from "@/features/builderLibrary/sectionParts";
import { Badge, Tabs } from "@/features/console/ui";
import JournalLessonEditor from "@/features/journals/JournalLessonEditor";
import JournalClassworkEditor from "@/features/journals/JournalClassworkEditor";
import JournalRoadmapEditor from "@/features/journals/JournalRoadmapEditor";
import { journalsApi } from "@/features/journals/api";
import { BACK_LINK, LoadingLine } from "@/features/journals/journalParts";
import type { JournalDetail, LessonDetail } from "@/features/journals/types";

type Tab = "homework" | "classwork" | "roadmap";

/**
 * One journal session has three sides, all authored here: the HOMEWORK students take away,
 * the CLASSWORK the teacher runs in the lesson, and the ROADMAP — the reading a student does
 * on their own before opening the homework.
 *
 * The roadmap is the only optional one. Its tab says "Optional" rather than "Todo" when it
 * is empty, because a session that is pure practice legitimately has nothing to read and an
 * amber badge would read as unfinished work forever.
 *
 * In the console's look (design handoff v0.3). The words and the calls are the page's own.
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
    return <LoadingLine>Loading session…</LoadingLine>;
  }
  if (error || !journal || !lesson) {
    return <LibraryError>{error ?? "Session not found."}</LibraryError>;
  }

  const isMidterm = lesson.lesson_type === "MIDTERM";

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5">
      <div className="animate-ms-fade-in">
        <Link href={`/ops/journals/${journalId}`} className={BACK_LINK}>
          <Icon name="left" size="sm" /> Back to {journal.display_title}
        </Link>
        <h1 className="text-ms-title text-ms-fg">
          Session {lesson.lesson_number}
          <span className="ml-2 text-[16px] font-semibold text-ms-fg-2">
            · {journal.subject_label} {journal.level_label}
          </span>
        </h1>
      </div>

      {isMidterm ? (
        <div className="animate-ms-card-in rounded-ms-card border border-ms-info-line bg-ms-info-soft p-6">
          <div className="mb-2 flex items-center gap-2.5">
            <span className="grid size-10 place-items-center rounded-[12px] bg-ms-card text-ms-info-fg">
              <Icon name="ms-midterm" size="lg" />
            </span>
            <h2 className="text-[18px] font-bold leading-6 text-ms-fg">Midterm session</h2>
          </div>
          <p className="text-[14px] leading-[21px] text-ms-fg-2">
            {lesson.midterm?.title
              ? `Runs “${lesson.midterm.title}”.`
              : "No midterm exam selected yet."}{" "}
            The class is given access {lesson.midterm?.access_days_before ?? 2} days before this
            session, scheduled at the lesson time. Midterm sessions carry no homework or classwork.
          </p>
        </div>
      ) : (
        <>
          {/* Homework | Classwork | Roadmap */}
          <Tabs<Tab>
            label="Session"
            idPrefix="journal-session"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "homework", label: <TabLabel icon="clipboard" label="Homework" ok={lesson.homework_ready} /> },
              { id: "classwork", label: <TabLabel icon="monitor" label="Classwork" ok={lesson.classwork_ready} /> },
              { id: "roadmap", label: <TabLabel icon="book" label="Roadmap" ok={lesson.has_roadmap} optional /> },
            ]}
          />

          <div role="tabpanel" id={`journal-session-${tab}-panel`} aria-labelledby={`journal-session-${tab}`}>
            {tab === "homework" ? (
              <JournalLessonEditor journalId={journalId} lessonId={lessonId} />
            ) : tab === "classwork" ? (
              <JournalClassworkEditor
                journalId={journalId}
                lessonId={lessonId}
                journal={journal}
                onSaved={() => void load()}
              />
            ) : (
              <JournalRoadmapEditor
                journalId={journalId}
                lessonId={lessonId}
                onSaved={() => void load()}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TabLabel({
  icon,
  label,
  ok,
  optional,
}: {
  icon: IconName;
  label: string;
  ok: boolean;
  /** An unfilled OPTIONAL block is not outstanding work, so it does not wear the amber
   *  "Todo" badge that would make every existing journal look unfinished. */
  optional?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <Icon name={icon} size="sm" />
      {label}
      <Badge tone={ok ? "positive" : optional ? "neutral" : "attention"} dot>
        {ok ? "Ready" : optional ? "Optional" : "Todo"}
      </Badge>
    </span>
  );
}
