/**
 * A stateful in-memory mock of the exam server, so the whole runner loop — load, autosave, submit
 * a module, the between-module transition, module 2, submit, scoring, done — is buildable and
 * reviewable under `vite dev` with no backend. In the real app (Tauri) examApi talks to
 * `/api/exams|midterms/attempts/...` instead; this is only reached when DEV_MOCK is true.
 *
 * Midterm mode mirrors the midterm contract the native lockdown depends on: the sitting starts
 * NOT_STARTED, `start` can refuse `code_required`, an early submit is refused (the paper submits
 * itself at 0:00), the off-screen rule counts and forfeits on the third offence, and the lockdown
 * header is policed exactly as backend/desktop/lockdown.py does — controlled from the dev panel
 * through lib/devLockdown.
 */
import { ApiError, NetworkError } from "@/lib/api";
import { devLockdown } from "@/lib/devLockdown";
import type { LockdownProof } from "@/lib/native";
import type { Attempt, ExamQuestion, OffscreenReport } from "./types";

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

function bank(kind: "rw" | "math", midterm: boolean): Bank {
  if (midterm) {
    return kind === "rw"
      ? { subject: "READING_WRITING", title: "Month 3 Midterm — Reading & Writing", minutes: 32, m1: RW_M1, m2: RW_M2 }
      : { subject: "MATH", title: "Month 3 Midterm — Mathematics", minutes: 35, m1: MATH_M1, m2: MATH_M2 };
  }
  return kind === "rw"
    ? { subject: "READING_WRITING", title: "November 2025 Int. A — Reading & Writing", minutes: 32, m1: RW_M1, m2: RW_M2 }
    : { subject: "MATH", title: "November 2025 Int. A — Mathematics", minutes: 35, m1: MATH_M1, m2: MATH_M2 };
}

export interface MockEngine {
  createOrResume(): Promise<number>;
  getStatus(headers: Record<string, string>): Promise<Attempt>;
  start(headers: Record<string, string>): Promise<Attempt>;
  verifyCode(code: string): Promise<{ ok: boolean; requires_code: boolean }>;
  save(answers: Record<string, string>, flagged: number[], headers: Record<string, string>): Promise<Attempt>;
  submitModule(answers: Record<string, string>, flagged: number[], moduleId: number, headers: Record<string, string>): Promise<Attempt>;
  offscreen(key: string, headers: Record<string, string>): Promise<OffscreenReport>;
  challenge(): Promise<{ nonce: string }>;
  openSession(body: { nonce: string } & LockdownProof): Promise<{ lockdown_session: string; required: boolean }>;
}

const LIMIT = 3;
const GRACE = 3;

function refusal(status: number, reason: string, detail: string): ApiError {
  return new ApiError(status, detail, { detail, reason, desktop_required: true });
}

/** One attempt's worth of mutable state, advanced like the real server. */
export function createMockEngine(kind: "rw" | "math", opts: { midterm?: boolean } = {}): MockEngine {
  const midterm = !!opts.midterm;
  const b = bank(kind, midterm);
  const id = midterm ? (kind === "rw" ? 71001 : 71002) : kind === "rw" ? 70001 : 70002;
  let module = 1;
  let state: Attempt["current_state"] = midterm ? "NOT_STARTED" : "MODULE_1_ACTIVE";
  let moduleStartedAt = Date.now();
  let completed = false;
  let score: number | null = null;
  let savedAnswers: Record<string, unknown> = {};
  let savedFlags: number[] = [];
  let version = 1;
  let violations = 0;
  let terminatedReason = "";
  let codeVerified = false;
  let token: string | null = null;
  let requiredBound = false;
  let seq = 0;
  const offscreenReplies = new Map<string, OffscreenReport>();

  const moduleSeconds = () => (midterm && devLockdown.get().shortModule ? 20 : b.minutes * 60);
  const live = () => state === "NOT_STARTED" || state === "MODULE_1_ACTIVE" || state === "MODULE_2_ACTIVE";
  const active = () => state === "MODULE_1_ACTIVE" || state === "MODULE_2_ACTIVE";
  const remaining = () => Math.max(0, Math.ceil(moduleSeconds() - (Date.now() - moduleStartedAt) / 1000));
  const applies = () => midterm && devLockdown.get().desktopRequired && live() && (state === "NOT_STARTED" || requiredBound);

  /** A dropped connection (dev panel), after a little realistic latency. */
  const net = async () => {
    await new Promise((r) => setTimeout(r, 120));
    if (devLockdown.takeDrop()) throw new NetworkError("dev: connection dropped");
  };

  /** backend/desktop/lockdown.py `refusal()`: the header must carry THIS sitting's current token. */
  const police = (headers: Record<string, string>, reading = false) => {
    if (!applies()) return;
    if (reading && state === "NOT_STARTED") return; // reads of a not-started sitting are open
    if (devLockdown.get().replaceSession && token) {
      token = `dev-token-elsewhere-${++seq}`; // another window bound it
      devLockdown.set({ replaceSession: false });
    }
    const presented = headers["X-Lockdown-Session"];
    if (presented && token && presented === token) return;
    if (presented && token) {
      throw refusal(403, "desktop_session_replaced", "This midterm was opened in another MasterSAT window. Continue there.");
    }
    throw refusal(403, "desktop_required", "This midterm can only be taken in the MasterSAT app for Windows.");
  };

  const finish = () => {
    savedAnswers = {};
    savedFlags = [];
    if (midterm) {
      // The runner path never carries a midterm score; the paper scores, then completes.
      state = "SCORING";
      setTimeout(() => {
        state = "COMPLETED";
        completed = true;
        version += 1;
      }, 2500);
    } else {
      completed = true;
      state = "COMPLETED";
    }
  };

  const snapshot = (): Attempt => {
    const running = active();
    const questions = module === 1 ? b.m1 : b.m2;
    const now = new Date().toISOString();
    return {
      id,
      current_state: state,
      version_number: version,
      practice_test_details: {
        id: midterm ? 1 : kind === "rw" ? 101 : 102,
        subject: b.subject,
        title: b.title,
        total_question_count: running ? undefined : b.m1.length + b.m2.length,
        calculator_enabled: kind === "math",
        modules: [
          { id: 1, module_order: 1, time_limit_minutes: midterm && devLockdown.get().shortModule ? 1 : b.minutes },
          { id: 2, module_order: 2, time_limit_minutes: midterm && devLockdown.get().shortModule ? 1 : b.minutes },
        ],
        mock_kind: midterm ? "MIDTERM" : undefined,
      },
      current_module: running ? module : null,
      current_module_details: running ? { id: module, module_order: module, time_limit_minutes: b.minutes, questions } : null,
      current_module_start_time: running ? new Date(moduleStartedAt).toISOString() : null,
      server_now: now,
      remaining_seconds: running ? remaining() : null,
      module_duration_seconds: running ? moduleSeconds() : null,
      current_module_saved_answers: running ? savedAnswers : {},
      current_module_flagged_questions: running ? savedFlags : [],
      is_completed: completed,
      is_expired: running && remaining() <= 0,
      is_paused: false,
      can_submit: running,
      score,
      ...(midterm
        ? {
            desktop_required: applies(),
            offscreen_violations: violations,
            offscreen_limit: LIMIT,
            offscreen_grace_seconds: GRACE,
            terminated_reason: terminatedReason,
          }
        : {}),
    };
  };

  return {
    async createOrResume() {
      await net();
      return id;
    },

    async getStatus(headers) {
      await net();
      police(headers, true);
      return snapshot();
    },

    async start(headers) {
      await net();
      if (!midterm || state !== "NOT_STARTED") return snapshot();
      if (devLockdown.get().requiresCode && !codeVerified) {
        throw new ApiError(403, "Enter the access code from your teacher first.", {
          detail: "Enter the access code from your teacher first.",
          reason: "code_required",
        });
      }
      police(headers);
      state = "MODULE_1_ACTIVE";
      module = 1;
      moduleStartedAt = Date.now();
      version += 1;
      return snapshot();
    },

    async verifyCode(code) {
      await net();
      if (!devLockdown.get().requiresCode) return { ok: true, requires_code: false };
      if (code === "123456") {
        codeVerified = true;
        return { ok: true, requires_code: true };
      }
      throw new ApiError(403, "Incorrect access code.", { ok: false, requires_code: true, detail: "Incorrect access code." });
    },

    async save(answers, flagged, headers) {
      await net();
      police(headers);
      if (!active()) return snapshot();
      savedAnswers = { ...answers };
      savedFlags = [...flagged];
      version += 1;
      return snapshot();
    },

    async submitModule(answers, flagged, moduleId, headers) {
      await net();
      police(headers);
      if (!active() || moduleId !== module) return snapshot(); // a stale/retried submit is a no-op
      // The midterm contract: no early hand-in. The paper submits itself when time runs out.
      if (midterm && remaining() > 2 && violations < LIMIT) {
        const detail = "This midterm can only be submitted when its time runs out.";
        throw new ApiError(403, detail, { detail });
      }
      version += 1;
      if (module === 1) {
        module = 2;
        state = "MODULE_2_ACTIVE";
        moduleStartedAt = Date.now();
        savedAnswers = {};
        savedFlags = [];
      } else {
        if (!midterm) {
          // A toy score out of 100 just so the Done screen has something to show.
          const answeredCount = Object.values(answers).filter(Boolean).length + flagged.length * 0;
          score = Math.min(100, 40 + answeredCount * 10);
        }
        finish();
      }
      return snapshot();
    },

    async offscreen(key, headers) {
      await net();
      police(headers);
      const seen = offscreenReplies.get(key);
      if (seen) return seen; // idempotent: a retried report is never a second offence
      if (!active()) return { violations, grace_seconds: 0, terminated: !!terminatedReason, limit: LIMIT };
      violations += 1;
      version += 1;
      let reply: OffscreenReport;
      if (violations >= LIMIT) {
        terminatedReason = "OFFSCREEN";
        finish();
        reply = { violations, grace_seconds: 0, terminated: true, limit: LIMIT, attempt: snapshot() };
      } else {
        reply = { violations, grace_seconds: GRACE, terminated: false, limit: LIMIT, attempt: snapshot() };
      }
      offscreenReplies.set(key, reply);
      return reply;
    },

    async challenge() {
      await net();
      if (!live()) throw refusal(409, "desktop_not_live", "This midterm is no longer running.");
      return { nonce: `dev-nonce-${++seq}` };
    },

    async openSession(body) {
      await net();
      const fault = devLockdown.get().bindFault;
      if (fault !== "none") {
        devLockdown.set({ bindFault: "none" });
        const detail: Record<string, string> = {
          desktop_challenge_invalid: "The app's check expired. Try again.",
          desktop_proof_invalid: "The app could not prove it is locked down. Restart the MasterSAT app and try again.",
          desktop_update_required: "Update the MasterSAT app to take this midterm.",
          desktop_not_live: "This midterm is no longer running.",
        };
        const status = fault === "desktop_update_required" ? 426 : fault === "desktop_not_live" ? 409 : 403;
        throw refusal(status, fault, detail[fault]);
      }
      if (!body.nonce.startsWith("dev-nonce-")) throw refusal(403, "desktop_challenge_invalid", "The app's check expired. Try again.");
      if (!live()) throw refusal(409, "desktop_not_live", "This midterm is no longer running.");
      token = `dev-token-${++seq}`;
      if (devLockdown.get().desktopRequired) requiredBound = true;
      return { lockdown_session: token, required: devLockdown.get().desktopRequired };
    },
  };
}
