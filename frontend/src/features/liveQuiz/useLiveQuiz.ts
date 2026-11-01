"use client";

/**
 * One hook that owns the room as the client understands it.
 *
 * Every field below is filled from a server frame. Nothing here decides whether an answer
 * was right, whether time is up, or what the score is — the countdown on screen is drawn
 * from the server's deadline, so a clock that is wrong shows a wrong number and changes
 * nothing about the game.
 *
 * Two modes share this state. Teacher-paced is one question for the room, closed by the
 * server. Student-paced is each student on their own question: their own frames arrive with
 * `starts_in_ms` / `ends_in_ms` — durations, turned into local instants the moment the frame
 * lands, so a phone whose clock is minutes out still counts down correctly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  BoardCell,
  LiveParticipant,
  LiveQuestion,
  LiveQuizConfig,
  LiveQuizMode,
  LiveQuizStatus,
  PowerUpKey,
} from "./api";
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

/** Student-paced: what the student is told the moment they leave a question. */
export interface OwnFeedback extends AnswerOutcome {
  timed_out?: boolean;
  second_try?: boolean;
  breakdown?: { base: number; speed: number; multiplier: number; total: number };
  streak?: number;
  best_streak?: number;
  score?: number;
  awarded?: PowerUpKey | null;
  powerups_used?: PowerUpKey[];
  correct_answer?: unknown;
  explanation?: string;
  rank?: number;
  player_count?: number;
  leaders?: Array<{ id: number; display_name: string; score: number }>;
  progress?: number;
  question_total?: number;
  finished?: boolean;
  /** Local instant it arrived — the feedback screen runs on this, not the server's clock. */
  receivedAt: number;
  /** The question it was about, so the screen can show which option was right. */
  question: LiveQuestion | null;
}

export interface GemsAwarded {
  earned: number;
  balance: number;
  /** The daily cap cut this game's share. */
  capped: boolean;
  breakdown: { correct?: number; finish?: number; podium?: number; total?: number };
}

export interface LiveQuizRoom {
  status: LiveQuizStatus | "CONNECTING";
  connection: LiveSocketStatus;
  refusedReason: string | null;
  sessionId: number;
  joinCode: string;
  config: Partial<LiveQuizConfig>;
  mode: LiveQuizMode;
  currentIndex: number;
  questionTotal: number;
  question: LiveQuestion | null;
  endsAt: string | null;
  /** Student-paced: local instants for when the question appears and when its clock ends. */
  opensAt: number | null;
  deadline: number | null;
  hidden: string[];
  armed: PowerUpKey[];
  frozen: boolean;
  /** Student-paced: this question is a second chance at one they missed. */
  secondTry: boolean;
  inventory: PowerUpKey[];
  awarded: { key: PowerUpKey; at: number } | null;
  feedback: OwnFeedback | null;
  /** Host, student-paced: every student's answers so far, keyed by participant id. */
  board: Record<number, BoardCell[]>;
  /** What this student earned when the game finished. */
  gems: GemsAwarded | null;
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
  mode: "instructor_paced",
  currentIndex: -1,
  questionTotal: 0,
  question: null,
  endsAt: null,
  opensAt: null,
  deadline: null,
  hidden: [],
  armed: [],
  frozen: false,
  secondTry: false,
  inventory: [],
  awarded: null,
  feedback: null,
  board: {},
  gems: null,
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
      onFrame: (frame) => {
        const at = Date.now();
        setRoom((prev) => reduce(prev, frame, at));
      },
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
      usePowerUp: (key: PowerUpKey) => send("use_powerup", { powerup: key }),
    }),
    [send],
  );

  return { room, actions };
}

/** The empty room, exported so a test can start from the same place the hook does. */
export const EMPTY_ROOM: LiveQuizRoom = EMPTY;

function modeOf(config: Partial<LiveQuizConfig> | undefined, fallback: LiveQuizMode): LiveQuizMode {
  const raw = config?.mode;
  return raw === "student_paced" || raw === "instructor_paced" ? raw : fallback;
}

/** `starts_in_ms` / `ends_in_ms` → local instants. `undefined` means "this frame has no own clock". */
function ownClock(data: Record<string, any>, at: number) {
  if (data.starts_in_ms === undefined) return undefined;
  return {
    opensAt: at + Number(data.starts_in_ms || 0),
    deadline:
      data.ends_in_ms === null || data.ends_in_ms === undefined || data.frozen
        ? null
        : at + Number(data.ends_in_ms),
  };
}

function upsertRow(rows: LiveParticipant[], row: LiveParticipant): LiveParticipant[] {
  const found = rows.some((r) => r.id === row.id);
  return found ? rows.map((r) => (r.id === row.id ? { ...r, ...row } : r)) : [...rows, row];
}

/**
 * Exported for testing: this is the whole of the client's understanding of the game.
 *
 * `at` is when the frame arrived on this device; only the student-paced clock reads it.
 */
export function reduce(prev: LiveQuizRoom, frame: LiveQuizFrame, at: number = Date.now()): LiveQuizRoom {
  const data = (frame.data ?? {}) as Record<string, any>;

  switch (frame.type) {
    case "session_state": {
      // The snapshot is authoritative and complete; it is what makes a refresh or a dropped
      // connection recoverable without replaying anything.
      const clock = ownClock(data, at);
      const board: Record<number, BoardCell[]> = {};
      for (const row of (data.board ?? []) as Array<{ participant_id: number; cells: BoardCell[] }>) {
        board[row.participant_id] = row.cells ?? [];
      }
      return {
        ...prev,
        status: data.status,
        joinCode: data.join_code ?? prev.joinCode,
        config: data.config ?? prev.config,
        mode: modeOf(data.config, prev.mode),
        currentIndex: data.question?.index ?? data.current_index ?? -1,
        questionTotal:
          data.question?.total ?? data.me?.question_total ?? data.question_total ?? 0,
        question: data.question ?? null,
        endsAt: data.ends_at ?? null,
        opensAt: clock ? clock.opensAt : null,
        deadline: clock ? clock.deadline : null,
        hidden: data.hidden_choices ?? [],
        armed: data.armed ?? [],
        frozen: Boolean(data.frozen),
        secondTry: Boolean(data.second_try),
        inventory: data.me?.powerups ?? prev.inventory,
        board: data.board ? board : prev.board,
        participants: data.participants ?? [],
        me: data.me ?? prev.me,
        leaderboard: data.participants ?? prev.leaderboard,
        finished: data.status === "FINISHED",
        // A reconnect mid-question must not show the previous question's result.
        outcome: data.status === "QUESTION_ACTIVE" ? null : prev.outcome,
      };
    }

    case "participant_joined":
    case "participant_left":
    case "lobby_updated":
      return { ...prev, participants: data.participants ?? prev.participants };

    case "game_started":
      return { ...prev, status: "STARTING", outcome: null, myAnswer: null, feedback: null };

    case "question_started": {
      const clock = ownClock(data, at);
      if (clock) {
        // Student-paced: the student's own next question. The feedback for the last one stays
        // — the screen keeps showing it until `opensAt`.
        return {
          ...prev,
          status: "QUESTION_ACTIVE",
          question: data.question ?? null,
          currentIndex: data.question?.index ?? prev.currentIndex,
          questionTotal: data.question?.total ?? prev.questionTotal,
          endsAt: data.ends_at ?? null,
          opensAt: clock.opensAt,
          deadline: clock.deadline,
          hidden: data.hidden_choices ?? [],
          armed: data.armed ?? [],
          frozen: Boolean(data.frozen),
          secondTry: Boolean(data.second_try),
          myAnswer: null,
          error: null,
        };
      }
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
    }

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

    case "answer_result": {
      if (prev.mode !== "student_paced") {
        return { ...prev, myAnswer: data as AnswerOutcome, error: null };
      }
      const feedback = { ...data, receivedAt: at, question: prev.question } as OwnFeedback;
      const me = prev.me
        ? {
            ...prev.me,
            score: data.score ?? prev.me.score,
            correct_count: data.correct_count ?? prev.me.correct_count,
            answered_count: data.answered_count ?? prev.me.answered_count,
            streak: data.streak ?? prev.me.streak,
            best_streak: data.best_streak ?? prev.me.best_streak,
            progress: data.progress ?? prev.me.progress,
            finished: data.finished ?? prev.me.finished,
          }
        : prev.me;
      return {
        ...prev,
        myAnswer: data as AnswerOutcome,
        feedback,
        me,
        // Their clock on that question is over; the next frame brings the next one.
        deadline: data.finished ? null : prev.deadline,
        error: null,
      };
    }

    case "answer_tally":
      return { ...prev, tally: data as QuestionOutcome["tally"] };

    case "leaderboard_updated":
      return { ...prev, leaderboard: data.rows ?? prev.leaderboard };

    case "player_progress": {
      const row = data.participant as LiveParticipant | undefined;
      const cell = data.cell as BoardCell | undefined;
      if (!row || !cell) return prev;
      const cells = (prev.board[row.id] ?? []).filter((c) => c.order !== cell.order);
      return {
        ...prev,
        board: { ...prev.board, [row.id]: [...cells, cell].sort((a, b) => a.order - b.order) },
        participants: upsertRow(prev.participants, row),
      };
    }

    case "powerup_awarded":
      return {
        ...prev,
        inventory: data.inventory ?? prev.inventory,
        awarded: data.powerup ? { key: data.powerup as PowerUpKey, at } : prev.awarded,
      };

    case "powerup_applied": {
      const clock = ownClock(data, at);
      return {
        ...prev,
        inventory: data.inventory ?? prev.inventory,
        hidden: data.hidden_choices ?? prev.hidden,
        armed: data.armed ?? prev.armed,
        frozen: Boolean(data.frozen),
        deadline: data.frozen ? null : clock ? clock.deadline : prev.deadline,
        error: null,
      };
    }

    case "gems_awarded":
      return { ...prev, gems: data as GemsAwarded };

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
        deadline: null,
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
      return { ...prev, status: "TERMINATED", endsAt: null, deadline: null };

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

/** The same, from a local instant — the student-paced clock, already corrected for skew. */
export function useSecondsUntil(deadline: number | null): number | null {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (deadline === null) {
      setLeft(null);
      return;
    }
    const tick = () => setLeft(Math.max(0, (deadline - Date.now()) / 1000));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [deadline]);

  return left;
}

/** True once `instant` has passed; re-renders at that moment. Null counts as passed. */
export function useHasPassed(instant: number | null): boolean {
  const [passed, setPassed] = useState(() => instant === null || Date.now() >= instant);

  useEffect(() => {
    if (instant === null || Date.now() >= instant) {
      setPassed(true);
      return;
    }
    setPassed(false);
    const id = setTimeout(() => setPassed(true), instant - Date.now());
    return () => clearTimeout(id);
  }, [instant]);

  return passed;
}
