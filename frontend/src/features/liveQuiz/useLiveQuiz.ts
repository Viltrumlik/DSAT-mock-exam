"use client";

/**
 * One hook that owns the room as the client understands it.
 *
 * Every field below is filled from a server frame. Nothing here decides whether an answer
 * was right, whether time is up, or what the score is — the countdown on screen is drawn
 * from the server's `ends_at`, so a clock that is wrong shows a wrong number and changes
 * nothing about the game.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LiveParticipant, LiveQuestion, LiveQuizConfig, LiveQuizStatus } from "./api";
import {
  closeReasonText,
  openLiveQuizSocket,
  type LiveQuizFrame,
  type LiveSocketHandle,
  type LiveSocketStatus,
} from "./socket";

export interface AnswerOutcome {
  question_id: number;
  accepted: boolean;
  response_time_ms: number;
  is_correct?: boolean;
  points_awarded?: number;
}

export interface QuestionOutcome {
  correct_answer: unknown;
  explanation: string;
  tally: { answered: number; playing: number; correct: number; by_choice: Record<string, number> };
}

export interface LiveQuizRoom {
  status: LiveQuizStatus | "CONNECTING";
  connection: LiveSocketStatus;
  refusedReason: string | null;
  sessionId: number;
  joinCode: string;
  config: Partial<LiveQuizConfig>;
  currentIndex: number;
  questionTotal: number;
  question: LiveQuestion | null;
  endsAt: string | null;
  participants: LiveParticipant[];
  me: LiveParticipant | null;
  myAnswer: AnswerOutcome | null;
  outcome: QuestionOutcome | null;
  leaderboard: LiveParticipant[];
  tally: QuestionOutcome["tally"] | null;
  timeWarning: boolean;
  finished: boolean;
  removed: boolean;
  error: { code: string; detail: string } | null;
}

const EMPTY: LiveQuizRoom = {
  status: "CONNECTING",
  connection: "connecting",
  refusedReason: null,
  sessionId: 0,
  joinCode: "",
  config: {},
  currentIndex: -1,
  questionTotal: 0,
  question: null,
  endsAt: null,
  participants: [],
  me: null,
  myAnswer: null,
  outcome: null,
  leaderboard: [],
  tally: null,
  timeWarning: false,
  finished: false,
  removed: false,
  error: null,
};

export function useLiveQuiz(sessionId: number | null) {
  const [room, setRoom] = useState<LiveQuizRoom>(EMPTY);
  const handle = useRef<LiveSocketHandle | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    setRoom({ ...EMPTY, sessionId });

    const socket = openLiveQuizSocket(sessionId, {
      onStatus: (connection, detail) =>
        setRoom((prev) => ({
          ...prev,
          connection,
          refusedReason: connection === "refused" ? closeReasonText(detail?.code) : null,
        })),
      onFrame: (frame) => setRoom((prev) => reduce(prev, frame)),
    });
    handle.current = socket;

    return () => {
      socket.close();
      handle.current = null;
    };
  }, [sessionId]);

  const send = useCallback((type: string, payload?: Record<string, unknown>) => {
    handle.current?.send(type, payload);
  }, []);

  const actions = useMemo(
    () => ({
      startGame: () => send("start_game"),
      nextQuestion: () => send("request_next_question"),
      endQuestion: () => send("end_question"),
      pause: () => send("pause_game"),
      resume: () => send("resume_game"),
      endGame: () => send("end_game"),
      removePlayer: (participantId: number) =>
        send("remove_participant", { participant_id: participantId }),
      submitAnswer: (questionId: number, answer: unknown) =>
        send("submit_answer", { question_id: questionId, answer }),
    }),
    [send],
  );

  return { room, actions };
}

/** The empty room, exported so a test can start from the same place the hook does. */
export const EMPTY_ROOM: LiveQuizRoom = EMPTY;

/** Exported for testing: this is the whole of the client's understanding of the game. */
export function reduce(prev: LiveQuizRoom, frame: LiveQuizFrame): LiveQuizRoom {
  const data = (frame.data ?? {}) as Record<string, any>;

  switch (frame.type) {
    case "session_state":
      // The snapshot is authoritative and complete; it is what makes a refresh or a dropped
      // connection recoverable without replaying anything.
      return {
        ...prev,
        status: data.status,
        joinCode: data.join_code ?? prev.joinCode,
        config: data.config ?? prev.config,
        currentIndex: data.current_index ?? -1,
        questionTotal: data.question_total ?? 0,
        question: data.question ?? null,
        endsAt: data.ends_at ?? null,
        participants: data.participants ?? [],
        me: data.me ?? prev.me,
        leaderboard: data.participants ?? prev.leaderboard,
        finished: data.status === "FINISHED",
        // A reconnect mid-question must not show the previous question's result.
        outcome: data.status === "QUESTION_ACTIVE" ? null : prev.outcome,
      };

    case "participant_joined":
    case "participant_left":
    case "lobby_updated":
      return { ...prev, participants: data.participants ?? prev.participants };

    case "game_started":
      return { ...prev, status: "STARTING", outcome: null, myAnswer: null };

    case "question_started":
      return {
        ...prev,
        status: "QUESTION_ACTIVE",
        question: data.question ?? null,
        currentIndex: data.question?.index ?? prev.currentIndex,
        questionTotal: data.question?.total ?? prev.questionTotal,
        endsAt: data.ends_at ?? null,
        myAnswer: null,
        outcome: null,
        tally: null,
        timeWarning: false,
        error: null,
      };

    case "question_time_warning":
      return { ...prev, timeWarning: true };

    case "question_ended":
      return {
        ...prev,
        status: "QUESTION_RESULTS",
        timeWarning: false,
        endsAt: null,
        outcome: {
          correct_answer: data.correct_answer,
          explanation: data.explanation ?? "",
          tally: data.tally ?? { answered: 0, playing: 0, correct: 0, by_choice: {} },
        },
      };

    case "answer_result":
      return { ...prev, myAnswer: data as AnswerOutcome, error: null };

    case "answer_tally":
      return { ...prev, tally: data as QuestionOutcome["tally"] };

    case "leaderboard_updated":
      return { ...prev, leaderboard: data.rows ?? prev.leaderboard };

    case "game_paused":
      return { ...prev, status: "PAUSED" };

    case "game_resumed":
      return { ...prev, status: data.status ?? prev.status, endsAt: data.ends_at ?? prev.endsAt };

    case "game_finished":
      return {
        ...prev,
        status: "FINISHED",
        finished: true,
        endsAt: null,
        timeWarning: false,
        leaderboard: data.leaderboard?.rows ?? prev.leaderboard,
      };

    case "removed_from_session":
      // Broadcast to the room, so check it is actually us before showing the message. The
      // socket is closed by the server a moment later; this is what the student reads.
      return prev.me && data.participant_id === prev.me.id
        ? { ...prev, removed: true }
        : { ...prev, participants: prev.participants.filter((p) => p.id !== data.participant_id) };

    case "session_terminated":
      return { ...prev, status: "TERMINATED", endsAt: null };

    case "error":
      return {
        ...prev,
        error: { code: String(data.code ?? ""), detail: String(data.detail ?? "") },
      };

    default:
      return prev;
  }
}

/**
 * Seconds left, recomputed every 250 ms from the server's deadline.
 *
 * Deliberately not a client-side countdown that decrements a number: a tab that is
 * backgrounded gets its timers throttled, and it would come back believing it had time it
 * does not have. Reading the difference from a fixed instant is always right.
 */
export function useSecondsLeft(endsAt: string | null): number | null {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!endsAt) {
      setLeft(null);
      return;
    }
    const deadline = new Date(endsAt).getTime();
    const tick = () => setLeft(Math.max(0, (deadline - Date.now()) / 1000));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt]);

  return left;
}
