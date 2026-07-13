"use client";

import { useParams } from "next/navigation";
import JournalLessonEditor from "@/features/journals/JournalLessonEditor";

export default function JournalLessonEditorPage() {
  const params = useParams<{ journalId: string; lessonId: string }>();
  const journalId = Number(params.journalId);
  const lessonId = Number(params.lessonId);
  return <JournalLessonEditor journalId={journalId} lessonId={lessonId} />;
}
