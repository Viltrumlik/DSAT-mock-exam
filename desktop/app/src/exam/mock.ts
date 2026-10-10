/**
 * A stateful in-memory mock of the exam server, so the whole runner loop — load, autosave, submit
 * a module, the between-module transition, module 2, submit, scoring, done — is buildable and
 * reviewable under `vite dev` with no backend. In the real app (Tauri) examApi talks to
 * `/api/exams|midterms/attempts/...` instead; this is only reached when DEV_MOCK is true.
 */
import type { Attempt, ExamQuestion } from "./types";

const RW_M1: ExamQuestion[] = [
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
      "map of the entire ocean floor. Her work ______ the theory of continental drift.",
    question_prompt: "Which choice completes the text so that it conforms to the conventions of Standard English?",
    options: { A: "supporting", B: "to support", C: "supported", D: "having supported" },
  },
];

const RW_M2: ExamQuestion[] = [
  {
    id: 9101,
    question_type: "READING",
    question_text:
      "Honeybees communicate the location of food through a \"waggle dance.\" The angle of the dance " +
      "relative to vertical encodes the direction of the food relative to the sun, and the duration " +
      "of the waggle encodes the distance.",
    question_prompt: "Based on the text, what can be concluded about the waggle dance?",
    options: {
      A: "It is used only when food is very far away.",
      B: "It conveys both the direction and the distance of a food source.",
      C: "It is performed exclusively at night.",
      D: "It replaces the need for bees to leave the hive.",
    },
  },
];

const MATH_M1: ExamQuestion[] = [
  {
    id: 8001,
    question_type: "MATH",
    question_text: "If $3x + 5 = 20$, what is the value of $x$?",
    options: { A: "$x = 3$", B: "$x = 5$", C: "$x = 7$", D: "$x = 15$" },
  },
  {
    id: 8002,
    question_type: "MATH",
    question_text:
      "A line in the $xy$-plane passes through the points $(0, -2)$ and $(4, 6)$. What is the slope of the line?",
    options: { A: "$-2$", B: "$\\tfrac{1}{2}$", C: "$2$", D: "$4$" },
  },
  {
    id: 8003,
    question_type: "MATH",
    question_text: "What is the value of $\\dfrac{3}{4} + \\dfrac{1}{8}$? Enter your answer as a fraction.",
    is_math_input: true,
  },
];

const MATH_M2: ExamQuestion[] = [
  {
    id: 8101,
    question_type: "MATH",
    question_text: "If $f(x) = 2x^2 - 3$, what is $f(4)$?",
    options: { A: "$13$", B: "$29$", C: "$32$", D: "$61$" },
  },
];

interface Bank {
  subject: string;
  title: string;
  minutes: number;
  m1: ExamQuestion[];
  m2: ExamQuestion[];
}

function bank(kind: "rw" | "math"): Bank {
  return kind === "rw"
    ? { subject: "READING_WRITING", title: "November 2025 Int. A — Reading & Writing", minutes: 32, m1: RW_M1, m2: RW_M2 }
    : { subject: "MATH", title: "November 2025 Int. A — Mathematics", minutes: 35, m1: MATH_M1, m2: MATH_M2 };
}

export interface MockEngine {
  getStatus(): Attempt;
  save(answers: Record<string, string>, flagged: number[]): Attempt;
  submitModule(answers: Record<string, string>, flagged: number[]): Attempt;
}

/** One attempt's worth of mutable state, advanced by submit_module just like the real server. */
export function createMockEngine(kind: "rw" | "math"): MockEngine {
  const b = bank(kind);
  const id = kind === "rw" ? 70001 : 70002;
  let module = 1;
  let state: Attempt["current_state"] = "MODULE_1_ACTIVE";
  let completed = false;
  let score: number | null = null;
  let savedAnswers: Record<string, unknown> = {};
  let savedFlags: number[] = [];
  let version = 1;

  const snapshot = (): Attempt => {
    const questions = module === 1 ? b.m1 : b.m2;
    const now = new Date().toISOString();
    return {
      id,
      current_state: state,
      version_number: version,
      practice_test_details: {
        id: kind === "rw" ? 101 : 102,
        subject: b.subject,
        title: b.title,
        total_question_count: b.m1.length + b.m2.length,
        calculator_enabled: kind === "math",
        modules: [
          { id: 1, module_order: 1, time_limit_minutes: b.minutes },
          { id: 2, module_order: 2, time_limit_minutes: b.minutes },
        ],
      },
      current_module: completed ? null : module,
      current_module_details: completed
        ? null
        : { id: module, module_order: module, time_limit_minutes: b.minutes, questions },
      current_module_start_time: now,
      server_now: now,
      remaining_seconds: completed ? null : b.minutes * 60,
      module_duration_seconds: completed ? null : b.minutes * 60,
      current_module_saved_answers: savedAnswers,
      current_module_flagged_questions: savedFlags,
      is_completed: completed,
      is_expired: false,
      is_paused: false,
      can_submit: true,
      score,
    };
  };

  return {
    getStatus: () => snapshot(),
    save: (answers, flagged) => {
      savedAnswers = { ...answers };
      savedFlags = [...flagged];
      version += 1;
      return snapshot();
    },
    submitModule: (answers, flagged) => {
      savedAnswers = {};
      savedFlags = [];
      version += 1;
      if (module === 1) {
        module = 2;
        state = "MODULE_2_ACTIVE";
      } else {
        completed = true;
        state = "COMPLETED";
        // A toy score out of 100 just so the Done screen has something to show.
        const answeredCount = Object.values(answers).filter(Boolean).length + flagged.length * 0;
        score = Math.min(100, 40 + answeredCount * 10);
      }
      return snapshot();
    },
  };
}
