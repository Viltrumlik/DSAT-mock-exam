"use client";

/**
 * The past-paper library, and one paper's questions, for the teacher host.
 *
 * Both reads were already permitted here; what was missing was a caller.
 *   GET /api/exams/                                     — the library. The backend narrows it
 *                                                         to the caller's own subject, so a
 *                                                         teacher never has to filter by one.
 *   GET /api/exams/admin/tests/:id/modules/:m/questions/ — a module's questions.
 *
 * The admin questions endpoint is the only path to a paper's items that opens no attempt: the
 * runner's payload comes into existence when a sitting starts, and a teacher reading a paper
 * must not start one. It answers with the answer key attached, which a teacher is allowed to
 * see — this surface simply does not show it yet.
 */

import { teacherApi } from "@/features/teacher/api";
import type { AdminModuleQuestion } from "@/features/questionsAdmin/types";
import { normalizeAdminModuleQuestion } from "@/features/reviewCenter/normalize";
import type { ReviewQuestion } from "@/features/reviewCenter/types";
import type { PastpaperSection } from "@/lib/api";

/** One row in the library. `region` and `sitting` are what a teacher searches a paper by. */
export type TeacherPaper = {
  id: number;
  title: string;
  /** Platform subject, "MATH" or "READING_WRITING". */
  subject: string;
  isUS: boolean;
  /** The sitting date, or null for the older rows that were imported without one. */
  sittingDate: string | null;
  collection: string;
  label: string;
  moduleCount: number;
};

/**
 * A question as this surface reads it: the shared read-only shape, plus which module it came
 * from. A past paper is two modules, and a teacher reading question 24 wants to know which.
 */
export type TeacherPaperQuestion = ReviewQuestion & { moduleOrder: number };

export type TeacherPaperDetail = { paper: TeacherPaper; questions: TeacherPaperQuestion[] };

/** DRF answers either a bare list or a paginated envelope depending on the endpoint's page size. */
function asList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  const d = data as { results?: unknown } | null;
  return Array.isArray(d?.results) ? (d!.results as T[]) : [];
}

function toPaper(s: PastpaperSection): TeacherPaper {
  return {
    id: s.id,
    title: (s.title || "").trim(),
    subject: s.subject || "",
    isUS: s.form_type === "US",
    sittingDate: s.practice_date ?? null,
    collection: (s.collection_name || "").trim(),
    label: (s.label || "").trim(),
    moduleCount: Array.isArray(s.modules) ? s.modules.length : 0,
  };
}

export async function listTeacherPapers(): Promise<TeacherPaper[]> {
  const sections = await teacherApi.examsPublic.getPastpaperSections();
  return sections.map(toPaper);
}

export async function loadTeacherPaper(paperId: number): Promise<TeacherPaperDetail> {
  const section = await teacherApi.examsPublic.getPastpaperSection(paperId);
  const modules = [...(section.modules ?? [])].sort(
    (a, b) => (a.module_order ?? 0) - (b.module_order ?? 0),
  );

  // Sequential on purpose: a paper has two modules, and reading them in order keeps the
  // question numbering the paper's own rather than whichever request answered first.
  const questions: TeacherPaperQuestion[] = [];
  for (let i = 0; i < modules.length; i += 1) {
    const m = modules[i];
    const rows = asList<AdminModuleQuestion>(await teacherApi.examsAdmin.getQuestions(paperId, m.id))
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const moduleOrder = m.module_order ?? i + 1;
    rows.forEach((row) => {
      questions.push({ ...normalizeAdminModuleQuestion(row, questions.length), moduleOrder });
    });
  }

  return { paper: toPaper(section), questions };
}
