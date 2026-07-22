import api, { examsAdminApi } from "@/lib/api";
import { assessmentsAdminApi } from "@/features/assessmentsAdmin/api";
import { mocksAdminApi } from "@/features/mocksAdmin/api";
import type { AdminModuleQuestion } from "@/features/questionsAdmin/types";

import { normalizeAdminModuleQuestion, normalizeAssessmentQuestion } from "./normalize";
import type { ReviewBundle, ReviewCatalogItem, ReviewContentType, ReviewQuestion } from "./types";

/**
 * All calls hit existing STAFF/ADMIN content endpoints, which the backend gates with
 * `can_view_tests` / `can_manage_questions`. `test_auditor` satisfies both, and the main
 * domain host-guard lets these `/api/*` calls through, so no new backend endpoint is needed.
 */

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { results?: unknown }).results)) {
    return (data as { results: T[] }).results;
  }
  return [];
}

const byOrder = <T extends { order?: number | null }>(a: T, b: T) => (a.order ?? 0) - (b.order ?? 0);
const byModuleOrder = <T extends { module_order?: number | null }>(a: T, b: T) =>
  (a.module_order ?? 0) - (b.module_order ?? 0);

// ── Catalog listers ─────────────────────────────────────────────────────────
export async function listCatalog(type: ReviewContentType): Promise<ReviewCatalogItem[]> {
  switch (type) {
    case "assessment": {
      const page = await assessmentsAdminApi.listSets({ limit: 500 });
      return page.results.map((s) => ({
        id: s.id,
        title: s.title || `Set ${s.id}`,
        subject: s.subject,
        level: s.level ?? null,
        meta: s.category || undefined,
        reviewStatus: s.review_status ?? null,
        isPublished: s.is_active ?? null,
      }));
    }
    case "pastpaper": {
      const sections = await examsAdminApi.getStandaloneSections();
      return sections.map((s) => ({
        id: s.id,
        title: s.title || s.label || `Section ${s.id}`,
        subject: s.subject,
        meta: [s.collection_name, s.form_type].filter(Boolean).join(" · ") || undefined,
        isPublished: s.is_published ?? null,
      }));
    }
    case "mock": {
      const mocks = await mocksAdminApi.listMocks();
      return mocks.map((m) => ({
        id: m.id,
        title: m.title || `Mock ${m.id}`,
        meta: `${m.sections?.length ?? 0} sections`,
        questionCount: m.question_count ?? null,
        isPublished: m.is_published ?? null,
      }));
    }
    case "midterm": {
      const r = await api.get("/midterms/admin/midterms/");
      return asArray<Record<string, any>>(r.data).map((m) => ({
        id: m.id,
        title: m.title || `Midterm ${m.id}`,
        subject: m.subject ?? null,
        level: m.level || null,
        meta: m.scoring_scale || undefined,
        questionCount: m.question_count ?? null,
        isPublished: m.is_published ?? null,
      }));
    }
  }
}

// ── Question bundle with answer key (no attempt created) ─────────────────────
export async function getReviewBundle(
  type: ReviewContentType,
  id: number,
  fallbackTitle?: string,
): Promise<ReviewBundle> {
  switch (type) {
    case "assessment": {
      const set = await assessmentsAdminApi.getSet(id);
      const qs = (Array.isArray(set.questions) ? set.questions : [])
        .filter((q) => q.is_active !== false)
        .slice()
        .sort(byOrder);
      return {
        title: set.title || fallbackTitle || `Set ${id}`,
        questions: qs.map((q, i) => normalizeAssessmentQuestion(q, i)),
      };
    }
    case "pastpaper": {
      const modules = asArray<{ id: number; module_order?: number | null }>(
        await examsAdminApi.getModules(id),
      )
        .slice()
        .sort(byModuleOrder);
      const questions: ReviewQuestion[] = [];
      for (const m of modules) {
        const raw = asArray<AdminModuleQuestion>(await examsAdminApi.getQuestions(id, m.id))
          .slice()
          .sort(byOrder);
        raw.forEach((q) => questions.push(normalizeAdminModuleQuestion(q, questions.length)));
      }
      return { title: fallbackTitle || `Past paper ${id}`, questions };
    }
    case "mock": {
      const mock = await mocksAdminApi.getMock(id);
      const questions: ReviewQuestion[] = [];
      for (const section of mock.sections ?? []) {
        const modules = (section.modules ?? []).slice().sort(byModuleOrder);
        for (const m of modules) {
          const raw = (await mocksAdminApi.listModuleQuestions(id, m.id)).slice().sort(byOrder);
          raw.forEach((q) => questions.push(normalizeAdminModuleQuestion(q, questions.length)));
        }
      }
      return { title: mock.title || fallbackTitle || `Mock ${id}`, questions };
    }
    case "midterm": {
      const r = await api.get(`/midterms/admin/midterms/${id}/questions/`);
      const raw = asArray<AdminModuleQuestion>(r.data).slice().sort(byOrder);
      return {
        title: fallbackTitle || `Midterm ${id}`,
        questions: raw.map((q, i) => normalizeAdminModuleQuestion(q, i)),
      };
    }
  }
}
