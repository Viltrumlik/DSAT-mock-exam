"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { classesApi } from "@/lib/api";
import { classroomKeys } from "./queryKeys";
import type {
  ClassroomWithRole,
  Interventions,
  Member,
  StudentWorkspace,
} from "./types";

const enabledId = (id: number) => Number.isFinite(id) && id > 0;

export function useClassrooms() {
  return useQuery({
    queryKey: classroomKeys.list(),
    queryFn: () => classesApi.list(),
  });
}

export function useClassroom(id: number) {
  return useQuery<ClassroomWithRole>({
    queryKey: classroomKeys.detail(id),
    queryFn: () => classesApi.get(id),
    enabled: enabledId(id),
  });
}

export function useClassMembers(id: number) {
  return useQuery<{ members?: Member[] } | Member[]>({
    queryKey: classroomKeys.members(id),
    queryFn: () => classesApi.people(id),
    enabled: enabledId(id),
  });
}

export function useStudentWorkspace(id: number) {
  return useQuery<StudentWorkspace>({
    queryKey: classroomKeys.workspace(id),
    queryFn: () => classesApi.getStudentWorkspace(id),
    enabled: enabledId(id),
    staleTime: 15_000,
  });
}

export function useInterventions(id: number) {
  return useQuery<Interventions>({
    queryKey: classroomKeys.interventions(id),
    queryFn: () => classesApi.getInterventions(id),
    enabled: enabledId(id),
    staleTime: 15_000,
  });
}

export function useAssignments(id: number) {
  return useQuery({
    queryKey: classroomKeys.assignments(id),
    queryFn: () => classesApi.listAssignments(id),
    enabled: enabledId(id),
  });
}

export function useStream(id: number, params?: { page?: number; page_size?: number }) {
  return useQuery({
    queryKey: [...classroomKeys.stream(id), params ?? {}],
    queryFn: () => classesApi.getStream(id, params),
    enabled: enabledId(id),
  });
}

export function useJoinClass() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (joinCode: string) => classesApi.join(joinCode.trim()),
    onSuccess: () => qc.invalidateQueries({ queryKey: classroomKeys.list() }),
  });
}

export interface CreateClassInput {
  name: string;
  subject: "ENGLISH" | "MATH";
  lesson_days: "ODD" | "EVEN";
  lesson_time?: string;
  lesson_hours?: number;
  start_date?: string;
  room_number?: string;
  telegram_chat_id?: string;
  teacher?: number;
  max_students?: number;
}

export function useCreateClass() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateClassInput) => classesApi.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: classroomKeys.list() }),
  });
}

export function useUpdateClass(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => classesApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: classroomKeys.detail(id) });
      qc.invalidateQueries({ queryKey: classroomKeys.list() });
    },
  });
}

export function useRegenerateCode(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => classesApi.regenerateCode(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: classroomKeys.detail(id) });
      qc.invalidateQueries({ queryKey: classroomKeys.list() });
    },
  });
}

export function useArchiveClass() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      classesApi.setArchived(id, archived),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: classroomKeys.detail(id) });
      qc.invalidateQueries({ queryKey: classroomKeys.list() });
    },
  });
}

// ── Materials (downloadable PDF/DOCX) ──────────────────────────────────────
export interface ClassroomMaterial {
  id: number;
  title: string;
  description: string;
  file_url: string | null;
  teacher_name: string | null;
  created_at: string;
}

export function useMaterials(id: number) {
  return useQuery<{ results: ClassroomMaterial[] }>({
    queryKey: classroomKeys.materials(id),
    queryFn: () => classesApi.listMaterials(id),
    enabled: enabledId(id),
  });
}

export function useUploadMaterial(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (formData: FormData) => classesApi.uploadMaterial(id, formData),
    onSuccess: () => qc.invalidateQueries({ queryKey: classroomKeys.materials(id) }),
  });
}

export function useDeleteMaterial(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (materialId: number) => classesApi.deleteMaterial(id, materialId),
    onSuccess: () => qc.invalidateQueries({ queryKey: classroomKeys.materials(id) }),
  });
}

// ── Assignment options (assessments / past papers / midterms a teacher can assign) ──
export function useAssignmentOptions(id: number) {
  return useQuery({
    queryKey: classroomKeys.assignmentOptions(id),
    queryFn: () => classesApi.getAssignmentOptions(id),
    enabled: enabledId(id),
  });
}

export function useAssignMidterm(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mockExamId: number) => classesApi.assignMidterm(id, mockExamId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: classroomKeys.assignments(id) });
      qc.invalidateQueries({ queryKey: classroomKeys.detail(id) });
      qc.invalidateQueries({ queryKey: classroomKeys.midtermResults(id) });
    },
  });
}

// ── Results (read-only aggregation) ─────────────────────────────────────────
export interface MidtermResult {
  midterm_id: number; title: string; subject: string;
  assigned: number; started: number; completed: number;
  average: number | null; highest: number | null; lowest: number | null;
  students: { student_id: number; student: string; state: string; score: number | null; attempt_date: string | null; attempt_count: number }[];
}
export interface UnifiedRow {
  student_id: number; student: string; content_name: string; type: string;
  score: number | null; status: string; submission_date: string | null;
}
export interface UnifiedResults {
  summary: { average_score: number | null; completion_rate: number | null; total_attempts: number; pending_work: number };
  rows: UnifiedRow[];
}

export function useMidtermResults(id: number) {
  return useQuery<{ midterms: MidtermResult[] }>({
    queryKey: classroomKeys.midtermResults(id),
    queryFn: () => classesApi.midtermResults(id),
    enabled: enabledId(id),
  });
}

export function useUnifiedResults(id: number, filters: { student?: number; type?: string; date_from?: string; date_to?: string }) {
  return useQuery<UnifiedResults>({
    queryKey: classroomKeys.results(id, filters),
    queryFn: () => classesApi.unifiedResults(id, filters),
    enabled: enabledId(id),
  });
}
