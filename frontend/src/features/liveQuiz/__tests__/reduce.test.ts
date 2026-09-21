import { describe, expect, it } from "vitest";

import { EMPTY_ROOM, reduce } from "../useLiveQuiz";
import type { LiveQuizFrame } from "../socket";

const frame = (type: string, data: Record<string, unknown> = {}): LiveQuizFrame =>
  ({ type, data }) as LiveQuizFrame;

const QUESTION = {
  id: 7,
  index: 0,
  total: 3,
  prompt: "2 + 2",
  question_prompt: "",
  question_type: "multiple_choice",
  choices: [{ id: "A", text: "4" }],
  points: 1,
  time_limit_seconds: 20,
  question_image: null,
  option_a_image: null,
  option_b_image: null,
  option_c_image: null,
  option_d_image: null,
};

describe("the client's picture of the room", () => {
  it("takes the whole room from a state snapshot", () => {
    const room = reduce(
      EMPTY_ROOM,
      frame("session_state", {
        status: "LOBBY",
        join_code: "ABC234",
        current_index: -1,
        question_total: 3,
        participants: [{ id: 1, display_name: "Ali", score: 0 }],
        config: { question_seconds: 20 },
      }),
    );

    expect(room.status).toBe("LOBBY");
    expect(room.joinCode).toBe("ABC234");
    expect(room.questionTotal).toBe(3);
    expect(room.participants).toHaveLength(1);
  });

  it("clears the last question's result when a new question opens", () => {
    const withResult = reduce(
      EMPTY_ROOM,
      frame("question_ended", { correct_answer: "A", tally: { answered: 3 } }),
    );
    expect(withResult.outcome).not.toBeNull();

    const next = reduce(
      withResult,
      frame("question_started", { question: QUESTION, ends_at: "2026-09-21T10:00:20Z" }),
    );

    expect(next.outcome).toBeNull();
    expect(next.myAnswer).toBeNull();
    expect(next.status).toBe("QUESTION_ACTIVE");
    expect(next.endsAt).toBe("2026-09-21T10:00:20Z");
  });

  it("does not carry a stale result back after a reconnect mid-question", () => {
    // The bug this guards: rejoining during question 2 and being shown question 1's answer.
    const withResult = reduce(EMPTY_ROOM, frame("question_ended", { correct_answer: "A" }));
    const reconnected = reduce(
      withResult,
      frame("session_state", { status: "QUESTION_ACTIVE", question: QUESTION, participants: [] }),
    );

    expect(reconnected.outcome).toBeNull();
  });

  it("keeps the result when reconnecting to the results screen", () => {
    const withResult = reduce(EMPTY_ROOM, frame("question_ended", { correct_answer: "A" }));
    const reconnected = reduce(
      withResult,
      frame("session_state", { status: "QUESTION_RESULTS", participants: [] }),
    );

    expect(reconnected.outcome).not.toBeNull();
  });

  it("stops the clock when the question ends", () => {
    const active = reduce(
      EMPTY_ROOM,
      frame("question_started", { question: QUESTION, ends_at: "2026-09-21T10:00:20Z" }),
    );
    const ended = reduce(active, frame("question_ended", { correct_answer: "A", tally: {} }));

    expect(ended.endsAt).toBeNull();
    expect(ended.status).toBe("QUESTION_RESULTS");
    expect(ended.timeWarning).toBe(false);
  });

  it("records the answer the server accepted", () => {
    const room = reduce(
      EMPTY_ROOM,
      frame("answer_result", {
        question_id: 7,
        accepted: true,
        is_correct: true,
        points_awarded: 140,
      }),
    );

    expect(room.myAnswer?.is_correct).toBe(true);
    expect(room.myAnswer?.points_awarded).toBe(140);
    expect(room.error).toBeNull();
  });

  it("surfaces a server error without disturbing the rest of the room", () => {
    const active = reduce(EMPTY_ROOM, frame("question_started", { question: QUESTION }));
    const refused = reduce(active, frame("error", { code: "too_late", detail: "Time is up." }));

    expect(refused.error).toEqual({ code: "too_late", detail: "Time is up." });
    expect(refused.question?.id).toBe(7);
    expect(refused.status).toBe("QUESTION_ACTIVE");
  });

  it("finishes with the final leaderboard", () => {
    const room = reduce(
      EMPTY_ROOM,
      frame("game_finished", {
        leaderboard: { rows: [{ id: 1, display_name: "Ali", score: 300 }] },
      }),
    );

    expect(room.finished).toBe(true);
    expect(room.status).toBe("FINISHED");
    expect(room.leaderboard).toHaveLength(1);
    expect(room.endsAt).toBeNull();
  });

  it("ignores a frame it does not know", () => {
    const room = reduce(EMPTY_ROOM, frame("something_new_from_a_later_release"));
    expect(room).toBe(EMPTY_ROOM);
  });
});
