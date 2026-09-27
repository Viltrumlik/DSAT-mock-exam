"use client";

import { useParams } from "next/navigation";

import { LiveQuizRoom } from "@/features/liveQuiz/LiveQuizRoom";

export default function LiveQuizPlayPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = Number(params?.sessionId);

  if (!Number.isFinite(sessionId) || sessionId <= 0) return null;
  // Not `StudentGame` directly: the room takes a place first, because the socket refuses a
  // handshake from a student who has none, and arriving from "running now" never took one.
  return <LiveQuizRoom sessionId={sessionId} />;
}
