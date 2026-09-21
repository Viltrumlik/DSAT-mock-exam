"use client";

import { useParams } from "next/navigation";

import { StudentGame } from "@/features/liveQuiz/StudentGame";

export default function LiveQuizPlayPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = Number(params?.sessionId);

  if (!Number.isFinite(sessionId) || sessionId <= 0) return null;
  return <StudentGame sessionId={sessionId} />;
}
