import { describe, expect, it } from "vitest";

import { EMPTY_ROOM, reduce, type LiveQuizRoom } from "../useLiveQuiz";
import type { LiveQuizFrame } from "../socket";
import { seedFor, shuffledChoices } from "../theme";

const frame = (type: string, data: Record<string, unknown> = {}): LiveQuizFrame =>
  ({ type, data }) as LiveQuizFrame;

const question = (id: number, index: number) => ({
  id,
  index,
  total: 5,
  prompt: `prompt ${id}`,
  question_prompt: "Which word means this?",
  question_type: "multiple_choice",
  choices: ["A", "B", "C", "D"].map((c) => ({ id: c, text: `${c}-${id}` })),
  points: 1,
  time_limit_seconds: 30,
  form: "definition_to_word",
});

const ME = { id: 4, user_id: 40, display_name: "Ali", score: 0, streak: 0, powerups: [] };

/** A student-paced room in play, its first question open, as a fresh connect would leave it. */
function inPlay(at = 1_000): LiveQuizRoom {
  return reduce(
    EMPTY_ROOM,
    frame("session_state", {
      status: "QUESTION_ACTIVE",
      config: { mode: "student_paced", question_seconds: 30 },
      question: question(11, 0),
      starts_in_ms: 0,
      ends_in_ms: 30_000,
      hidden_choices: [],
      participants: [ME],
      me: ME,
    }),
    at,
  );
}

describe("student-paced: the student's own clock", () => {
  it("knows the mode from the room's config, and an old room is teacher-paced", () => {
    expect(inPlay().mode).toBe("student_paced");
    const legacy = reduce(EMPTY_ROOM, frame("session_state", { status: "LOBBY", config: { question_seconds: 20 } }));
    expect(legacy.mode).toBe("instructor_paced");
  });

  it("turns the server's durations into local instants, whatever this device's clock says", () => {
    const room = inPlay(50_000);
    expect(room.opensAt).toBe(50_000);
    expect(room.deadline).toBe(80_000);
  });

  it("keeps the feedback for the answered question while the next one opens behind it", () => {
    let room = inPlay(1_000);
    room = reduce(
      room,
      frame("answer_result", { question_id: 11, accepted: true, is_correct: true, points_awarded: 1000, score: 1000, streak: 1, rank: 1, correct_count: 1 }),
      5_000,
    );
    expect(room.feedback?.question_id).toBe(11);
    expect(room.feedback?.question?.id).toBe(11);
    expect(room.me?.score).toBe(1000);
    expect(room.me?.correct_count).toBe(1);

    room = reduce(
      room,
      frame("question_started", { question: question(12, 1), starts_in_ms: 3_000, ends_in_ms: 33_000 }),
      5_010,
    );
    // The next question is in hand, but not on screen until its clock starts.
    expect(room.question?.id).toBe(12);
    expect(room.opensAt).toBe(8_010);
    expect(room.feedback?.question_id).toBe(11);
  });

  it("a missed question lands as feedback too", () => {
    const room = reduce(inPlay(), frame("answer_result", { question_id: 11, accepted: false, timed_out: true }), 40_000);
    expect(room.feedback?.timed_out).toBe(true);
  });

  it("the last answer stops the clock", () => {
    const room = reduce(inPlay(), frame("answer_result", { question_id: 11, accepted: true, finished: true }), 2_000);
    expect(room.deadline).toBeNull();
    expect(room.me?.finished).toBe(true);
  });
});

describe("student-paced: power-ups", () => {
  it("adds an earned one to the bar", () => {
    const room = reduce(inPlay(), frame("powerup_awarded", { powerup: "double", inventory: ["double"] }), 7);
    expect(room.inventory).toEqual(["double"]);
    expect(room.awarded).toEqual({ key: "double", at: 7 });
  });

  it("50-50 hides the options the server picked", () => {
    const room = reduce(
      inPlay(),
      frame("powerup_applied", { powerup: "fifty_fifty", inventory: [], hidden_choices: ["B", "D"], armed: ["fifty_fifty"], starts_in_ms: 0, ends_in_ms: 20_000 }),
      10_000,
    );
    expect(room.hidden).toEqual(["B", "D"]);
    expect(room.armed).toEqual(["fifty_fifty"]);
    expect(room.inventory).toEqual([]);
  });

  it("time freeze takes the deadline away", () => {
    const room = reduce(
      inPlay(),
      frame("powerup_applied", { powerup: "time_freeze", inventory: [], frozen: true, starts_in_ms: 0, ends_in_ms: null }),
      10_000,
    );
    expect(room.frozen).toBe(true);
    expect(room.deadline).toBeNull();
  });
});

describe("student-paced: the host's board", () => {
  it("takes the board from the snapshot and fills squares as students move", () => {
    let room = reduce(
      EMPTY_ROOM,
      frame("session_state", {
        status: "QUESTION_ACTIVE",
        config: { mode: "student_paced" },
        participants: [ME],
        board: [{ participant_id: 4, cells: [{ order: 2, correct: true, timed_out: false, points: 900 }] }],
      }),
    );
    expect(room.board[4]).toHaveLength(1);

    room = reduce(
      room,
      frame("player_progress", {
        participant: { ...ME, score: 900, progress: 2 },
        cell: { order: 0, correct: false, timed_out: true, points: 0 },
      }),
    );
    expect(room.board[4].map((c) => c.order)).toEqual([0, 2]);
    expect(room.participants[0].progress).toBe(2);
  });
});

describe("the option shuffle", () => {
  const choices = question(11, 0).choices;

  it("is the same for the same student and question, every time", () => {
    expect(shuffledChoices(choices, seedFor(4, 11))).toEqual(shuffledChoices(choices, seedFor(4, 11)));
  });

  it("only moves options, never changes them", () => {
    const shuffled = shuffledChoices(choices, seedFor(9, 11));
    expect([...shuffled].sort((a, b) => a.id.localeCompare(b.id))).toEqual(choices);
  });
});

describe("student-paced: second chance", () => {
  it("marks a question that came back, and clears the mark on the next", () => {
    let room = reduce(
      inPlay(),
      frame("question_started", { question: question(13, 5), starts_in_ms: 3_000, ends_in_ms: 33_000, second_try: true }),
      1_000,
    );
    expect(room.secondTry).toBe(true);
    room = reduce(room, frame("question_started", { question: question(14, 0), starts_in_ms: 0, ends_in_ms: 30_000 }), 2_000);
    expect(room.secondTry).toBe(false);
  });
});

describe("team mode", () => {
  it("keeps the teams' standings from snapshots, refreshes and the finish", () => {
    const team = (t: number, score: number, rank: number) => ({ team: t, name: `T${t}`, score, members: 2, rank });
    let room = reduce(EMPTY_ROOM, frame("session_state", { status: "LOBBY", config: { mode: "student_paced", teams: 2 }, teams: [team(0, 0, 1), team(1, 0, 1)] }));
    expect(room.teams).toHaveLength(2);
    room = reduce(room, frame("leaderboard_updated", { rows: [], teams: [team(1, 900, 1), team(0, 300, 2)] }));
    expect(room.teams[0].team).toBe(1);
    room = reduce(room, frame("game_finished", { leaderboard: { rows: [], teams: [team(0, 1200, 1), team(1, 900, 2)] } }));
    expect(room.teams[0].score).toBe(1200);
  });

  it("follows the host moving this student to another team in the lobby", () => {
    let room = reduce(EMPTY_ROOM, frame("session_state", { status: "LOBBY", config: { mode: "student_paced", teams: 2 }, participants: [{ ...ME, team: 0 }], me: { ...ME, team: 0 } }));
    room = reduce(room, frame("lobby_updated", { participants: [{ ...ME, team: 1 }, { ...ME, id: 5, team: 0 }] }));
    expect(room.me?.team).toBe(1);
    room = reduce(room, frame("participant_left", { participants: [{ ...ME, id: 5, team: 0 }] }));
    expect(room.me?.team).toBe(1);
  });
});
