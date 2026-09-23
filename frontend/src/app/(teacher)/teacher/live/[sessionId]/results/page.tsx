"use client";

import { useParams } from "next/navigation";

import { LiveQuizResults } from "@/features/liveQuiz/LiveQuizResults";

export default function TeacherLiveQuizResultsPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = Number(params?.sessionId);

  if (!Number.isFinite(sessionId) || sessionId <= 0) return null;
  return <LiveQuizResults sessionId={sessionId} />;
}
