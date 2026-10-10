/**
 * A mock attempt so the runner's whole UI — two-pane Reading & Writing, single-pane Math with
 * KaTeX, grid-in, timer, navigation — is buildable and reviewable under `vite dev` with no server.
 * Replaced by the real `GET /api/exams/attempts/{id}/status/` in the API-wiring increment.
 */
import type { Attempt, ExamQuestion } from "./types";

const RW_QUESTIONS: ExamQuestion[] = [
  {
    id: 9001,
    question_type: "READING",
    question_text:
      "The city of Venice has long drawn travelers to its canals and bridges. In recent years, " +
      "however, local officials have grown concerned that the sheer number of visitors threatens " +
      "the fragile lagoon on which the city rests. To manage the crowds, the city introduced a " +
      "modest entry fee for day-trippers — the first measure of its kind for a major urban center.",
    question_prompt: "Which choice best states the **main idea** of the text?",
    options: {
      A: "Venice is primarily known for its historic bridges.",
      B: "A new entry fee reflects Venice's effort to limit the strain of tourism on the city.",
      C: "Day-trippers are unaware of the damage they cause to the lagoon.",
      D: "Most major cities now charge visitors an entry fee.",
    },
  },
  {
    id: 9002,
    question_type: "WRITING",
    question_text:
      "Marie Tharp, a geologist and oceanographic cartographer, co-created the first scientific " +
      "map of the entire ocean floor. Her work ______ the theory of continental drift, which many " +
      "scientists had dismissed.",
    question_prompt: "Which choice completes the text so that it conforms to the conventions of Standard English?",
    options: {
      A: "supporting",
      B: "to support",
      C: "supported",
      D: "having supported",
    },
  },
];

const MATH_QUESTIONS: ExamQuestion[] = [
  {
    id: 8001,
    question_type: "MATH",
    question_text: "If $3x + 5 = 20$, what is the value of $x$?",
    options: {
      A: "$x = 3$",
      B: "$x = 5$",
      C: "$x = 7$",
      D: "$x = 15$",
    },
  },
  {
    id: 8002,
    question_type: "MATH",
    question_text:
      "A line in the $xy$-plane passes through the points $(0, -2)$ and $(4, 6)$. " +
      "What is the slope of the line?",
    options: { A: "$-2$", B: "$\\tfrac{1}{2}$", C: "$2$", D: "$4$" },
  },
  {
    id: 8003,
    question_type: "MATH",
    question_text: "What is the value of $\\dfrac{3}{4} + \\dfrac{1}{8}$? Enter your answer as a fraction.",
    is_math_input: true,
  },
];

export function mockAttempt(kind: "rw" | "math"): Attempt {
  const isRw = kind === "rw";
  const questions = isRw ? RW_QUESTIONS : MATH_QUESTIONS;
  const minutes = isRw ? 32 : 35;
  return {
    id: isRw ? 70001 : 70002,
    current_state: "MODULE_1_ACTIVE",
    version_number: 1,
    practice_test_details: {
      id: isRw ? 101 : 102,
      subject: isRw ? "READING_WRITING" : "MATH",
      title: isRw ? "November 2025 Int. A — Reading & Writing" : "November 2025 Int. A — Mathematics",
      total_question_count: questions.length,
      calculator_enabled: !isRw,
      modules: [
        { id: 1, module_order: 1, time_limit_minutes: minutes },
        { id: 2, module_order: 2, time_limit_minutes: minutes },
      ],
    },
    current_module: 1,
    current_module_details: {
      id: 1,
      module_order: 1,
      time_limit_minutes: minutes,
      questions,
    },
    current_module_start_time: new Date().toISOString(),
    server_now: new Date().toISOString(),
    remaining_seconds: minutes * 60,
    module_duration_seconds: minutes * 60,
    current_module_saved_answers: null,
    current_module_flagged_questions: null,
    is_completed: false,
    is_expired: false,
    is_paused: false,
    can_submit: true,
    score: null,
  };
}
