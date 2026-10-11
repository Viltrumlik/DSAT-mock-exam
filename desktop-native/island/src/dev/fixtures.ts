// The contracts/v1 fixtures as the dev harness's modules (pure: the caller supplies the parsed
// JSON, so tests read the files from disk and the browser page imports them through Vite).
import type { IslandAnnotation, IslandAnnotationSet, IslandQuestion, IslandReviewInfo } from "../protocol";
import type { DevModule } from "./fakeNative";

type Json = Record<string, unknown>;
type AnyModule = { id?: number; order?: number; questions?: IslandQuestion[] | null };

/** The fixture files the harness offers, in the order its module buttons appear. */
export const DEV_FIXTURE_FILES = [
  "pastpaper_open.response.resume.json",
  "pastpaper_open.response.json",
  "midterm_open.response.json",
  "midterm_submit.response.json",
  "pastpaper_result.response.completed.json",
] as const;

type MutableSet = { -readonly [K in keyof IslandAnnotationSet]?: IslandAnnotation[] };

function savedAnnotations(list: unknown): Record<number, Partial<IslandAnnotationSet>> {
  const out: Record<number, MutableSet> = {};
  if (!Array.isArray(list)) return out;
  for (const row of list as Array<{ target_id: number; container: keyof IslandAnnotationSet; data: IslandAnnotation[] }>) {
    (out[row.target_id] ??= {})[row.container] = row.data;
  }
  return out;
}

function reviewFrom(result: Json | undefined): Record<number, IslandReviewInfo> {
  const out: Record<number, IslandReviewInfo> = {};
  const rows = (result?.questions ?? []) as Array<{ id: number; student_answer: string | null; correct_answers: string; is_correct: boolean }>;
  for (const r of rows) out[r.id] = { correct: r.correct_answers, studentAnswer: r.student_answer, isCorrect: r.is_correct };
  return out;
}

/** Every module with questions across the given fixture files. */
export function devModulesFrom(files: Record<string, Json>): DevModule[] {
  const result = files["pastpaper_result.response.completed.json"];
  const review = reviewFrom(result);
  const out: DevModule[] = [];
  const subjectOf = (qs: IslandQuestion[]) => (qs.every((q) => q.question_type === "MATH") ? "math" : "rw");
  for (const [file, json] of Object.entries(files)) {
    const attempt = json.attempt as { kind?: string } | undefined;
    const kind = file.startsWith("midterm") ? "midterm" : (attempt?.kind as "pastpaper" | "midterm" | undefined) ?? "pastpaper";
    const answersByModule = (json.answers ?? {}) as Record<string, Record<string, string>>;
    const flaggedByModule = (json.flagged ?? {}) as Record<string, number[]>;
    const annotations = savedAnnotations(json.annotations);
    const add = (source: string, m: AnyModule, label: string) => {
      const qs = m.questions ?? [];
      if (qs.length === 0) return;
      const id = m.id ?? 0;
      const answers: Record<number, string> = {};
      for (const [qid, a] of Object.entries(answersByModule[String(id)] ?? {})) answers[Number(qid)] = a;
      const own = new Set(qs.map((q) => q.id));
      out.push({
        source,
        label,
        kind,
        subject: subjectOf(qs),
        moduleId: id,
        questions: qs,
        answers,
        flagged: (flaggedByModule[String(id)] ?? []).filter((q) => own.has(q)),
        annotations: Object.fromEntries(Object.entries(annotations).filter(([qid]) => own.has(Number(qid)))),
        review,
      });
    };
    if (Array.isArray(json.modules)) {
      (json.modules as AnyModule[]).forEach((m, i) => add(`${file}#modules[${i}]`, m, `${file.replace(/\.json$/, "")} · M${m.order ?? i + 1}`));
    }
    if (json.next_module && typeof json.next_module === "object") add(`${file}#next_module`, json.next_module as AnyModule, `${file.replace(/\.json$/, "")} · next module`);
    if (file === "pastpaper_result.response.completed.json" && json.content && typeof json.content === "object") {
      for (const [mid, c] of Object.entries(json.content as Record<string, AnyModule>)) {
        const answers: Record<number, string> = {};
        for (const q of (json.questions ?? []) as Array<{ id: number; module_id: number; student_answer: string | null }>) {
          if (String(q.module_id) === mid && q.student_answer) answers[q.id] = q.student_answer;
        }
        const qs = c.questions ?? [];
        if (qs.length === 0) continue;
        out.push({ source: `${file}#content.${mid}`, label: `result review · module ${mid}`, kind: "pastpaper", subject: subjectOf(qs), moduleId: Number(mid), questions: qs, answers, flagged: [], annotations: {}, review });
      }
    }
  }
  // The same questions offered twice (e.g. the result's content = the open's modules) are kept:
  // the result copies carry the review answers.
  return out;
}

/** Media keys the modules name (question figures and option images). */
export function mediaKeysOf(modules: DevModule[]): string[] {
  const keys = new Set<string>();
  for (const m of modules) {
    for (const q of m.questions) {
      if (q.question_image_key) keys.add(q.question_image_key);
      for (const o of Object.values(q.options ?? {})) if (o.image_key) keys.add(o.image_key);
    }
  }
  return [...keys];
}
