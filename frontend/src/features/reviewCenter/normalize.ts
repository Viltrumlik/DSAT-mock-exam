import type { AssessmentQuestion } from "@/features/assessments/types";
import type { AdminModuleQuestion } from "@/features/questionsAdmin/types";
import type { ReviewChoice, ReviewQuestion } from "./types";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

function joinCorrect(parts: string[]): string {
  return parts.filter((p) => p !== "").join("  •  ") || "—";
}

/**
 * Assessment set question (assessments.AssessmentQuestion) → ReviewQuestion.
 * `choices` are already `[{id,text}]`; `correct_answer` is the choice id for MCQ and the
 * value(s) for numeric/short/boolean. Option images ride alongside as option_a..d_image.
 */
export function normalizeAssessmentQuestion(q: AssessmentQuestion, idx: number): ReviewQuestion {
  const optionImages = [q.option_a_image, q.option_b_image, q.option_c_image, q.option_d_image];
  const rawChoices = Array.isArray(q.choices) ? q.choices : [];
  const choices: ReviewChoice[] = rawChoices.map((c: any, i: number) => ({
    id: String(c?.id ?? LETTERS[i] ?? i),
    text: String(c?.text ?? ""),
    image: optionImages[i] ?? null,
  }));

  const isChoice = q.question_type === "multiple_choice";
  const raw = q.correct_answer;
  const correctArr =
    Array.isArray(raw)
      ? raw.map((x) => String(x))
      : raw != null && raw !== ""
        ? [String(raw)]
        : [];

  const correctIds = isChoice ? correctArr : [];
  const correctText = isChoice
    ? joinCorrect(
        correctArr.map((cid) => {
          const ch = choices.find((c) => c.id === cid);
          return ch ? `${ch.id}. ${ch.text}` : cid;
        }),
      )
    : joinCorrect(correctArr);

  return {
    key: `a-${q.id}`,
    order: typeof q.order === "number" ? q.order : idx,
    prompt: q.prompt ?? "",
    questionPrompt: q.question_prompt || undefined,
    image: q.question_image ?? null,
    isChoice,
    choices: isChoice ? choices : [],
    correctIds,
    correctText,
    explanation: q.explanation || undefined,
    points: typeof q.points === "number" ? q.points : null,
  };
}

/**
 * Exams-style admin question (pastpaper module, mock section, midterm) → ReviewQuestion.
 * These use flat option_a..d fields + a singular `correct_answer` that is a choice LETTER
 * for MCQ, or the numeric value for grid-in (`is_math_input === true`).
 */
export function normalizeAdminModuleQuestion(q: AdminModuleQuestion, idx: number): ReviewQuestion {
  const isChoice = !q.is_math_input;
  const opts = [q.option_a, q.option_b, q.option_c, q.option_d];
  const optImgs = [q.option_a_image, q.option_b_image, q.option_c_image, q.option_d_image];

  const choices: ReviewChoice[] = [];
  if (isChoice) {
    opts.forEach((text, i) => {
      const t = (text ?? "").toString();
      const img = optImgs[i] ?? null;
      if (t.trim() !== "" || img) {
        choices.push({ id: LETTERS[i], text: t, image: img });
      }
    });
  }

  const rawCorrect = (q.correct_answer ?? "").toString().trim();
  const correctLetter = rawCorrect.toUpperCase();
  const correctIds = isChoice && rawCorrect ? [correctLetter] : [];
  const correctText = isChoice
    ? (() => {
        const ch = choices.find((c) => c.id === correctLetter);
        return ch ? `${ch.id}. ${ch.text}` : rawCorrect || "—";
      })()
    : rawCorrect || "—";

  return {
    key: `q-${q.id ?? idx}`,
    order: typeof q.order === "number" ? q.order : idx,
    prompt: (q.question_text ?? "").toString(),
    questionPrompt: q.question_prompt || undefined,
    image: q.question_image ?? null,
    isChoice,
    choices,
    correctIds,
    correctText,
    explanation: q.explanation || undefined,
    points: typeof q.score === "number" ? q.score : null,
  };
}
