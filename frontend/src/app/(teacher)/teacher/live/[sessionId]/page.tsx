"use client";

import { useParams } from "next/navigation";

import { HostGame } from "@/features/liveQuiz/HostGame";

export default function TeacherLiveQuizHostPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = Number(params?.sessionId);

  if (!Number.isFinite(sessionId) || sessionId <= 0) return null;
  return <HostGame sessionId={sessionId} />;
}
