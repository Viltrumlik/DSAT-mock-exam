"use client";

/**
 * Take your place, then play.
 *
 * A student reaches a room two ways: they type the code their teacher put on the board, or
 * they tap it in "running now" on `/live`. Only the first one used to give them a place, and
 * the socket refuses a handshake from somebody who has none — so arriving the second way
 * showed "Lost contact — trying to reconnect" for as long as the student was willing to wait.
 *
 * Asking for a place here rather than on the button covers every way in, including a
 * bookmark, a refresh and the back button. It is safe to ask again: the server hands back the
 * place you already had. And when it refuses — another class's room, a room that has ended, a
 * student the host removed — that reason is worth showing, which a refused socket cannot do
 * (a handshake rejected before it opens carries no close code, so the client only ever sees
 * "the connection dropped").
 */

import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";

import { ErrorState, LoadingState } from "@/features/classroom/ui";
import { normalizeApiError } from "@/lib/apiError";

import { liveQuizApi } from "./api";
import { StudentGame } from "./StudentGame";

export function LiveQuizRoom({ sessionId }: { sessionId: number }) {
  const place = useMutation({
    mutationFn: () => liveQuizApi.joinSession(sessionId),
  });

  const { mutate } = place;
  useEffect(() => {
    mutate();
  }, [mutate, sessionId]);

  if (place.isError) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-6">
        <ErrorState
          title="You cannot join this quiz"
          message={normalizeApiError(place.error).message}
          onRetry={() => place.mutate()}
        />
      </div>
    );
  }

  if (!place.isSuccess) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-6">
        <LoadingState label="Joining the quiz…" />
      </div>
    );
  }

  // Only now: mounting the game opens the socket, and it is refused without a place.
  return <StudentGame sessionId={sessionId} />;
}
