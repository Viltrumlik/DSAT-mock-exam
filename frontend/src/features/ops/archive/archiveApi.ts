"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

/**
 * The /ops Archive (backend `classes/ops_archive.py`): the students who left a group and the archived groups.
 * Read-only, `view_people`'s; the balance in a student's row comes only to `view_money` holders (`money`).
 */

export interface ArchiveFilterOption {
  value: string;
  label: string;
  count: number;
}

export interface ArchiveFilter {
  key: string;
  label: string;
  options: ArchiveFilterOption[];
  selected: string | null;
}

export interface ArchiveTotals {
  students: number;
  groups: number;
}

export interface LeftStudentRow {
  /** The seat (a classroom membership). */
  id: number;
  student: { id: number; name: string; section: string; phone: string };
  group: { id: number; name: string; level: string; subject: string; is_active: boolean; teacher: string };
  /** The seat's first day, else the day it was made. */
  started_on: string | null;
  /** The day the seat ended; null when no day was ever kept. */
  left_on: string | null;
  /** Who removed them, "" when nobody clicked (lc-up's sync, a command). */
  removed_by: string;
  /** The lc-up balance NOW (not on the day they left); only with `money`, null when lc-up has none. */
  balance?: number | null;
}

interface Page<T> {
  count: number;
  page: number;
  page_size: number;
  pages: number;
  results: T[];
  totals: ArchiveTotals;
}

export interface ArchiveStudentsPage extends Page<LeftStudentRow> {
  filters: ArchiveFilter[];
  money: boolean;
  /** Whether a seat can be taken here at all (lc-up runs seats until the cutover): the Return button's gate. */
  seats_open: boolean;
}

export interface ArchivedGroupRow {
  id: number;
  name: string;
  level: string;
  subject: string;
  teacher: string;
  start_date: string | null;
  created_at: string | null;
  /** The day lc-up's deletion archived it; null when an admin archived it by hand (no day is kept). */
  archived_on: string | null;
  /** Student seats that ended in this group. */
  left: number;
}

export type ArchiveGroupsPage = Page<ArchivedGroupRow>;

export interface StudentQuery {
  q: string;
  classroom: string;
  teacher: string;
  owing: boolean;
  page: number;
  pageSize: number;
}

export interface GroupQuery {
  q: string;
  page: number;
  pageSize: number;
}

/** Only what is set goes in the address, so the server's defaults hold for the rest. */
function studentParams(query: StudentQuery): Record<string, string | number> {
  const params: Record<string, string | number> = { page: query.page, page_size: query.pageSize };
  if (query.q.trim()) params.q = query.q.trim();
  if (query.classroom) params.classroom = query.classroom;
  if (query.teacher) params.teacher = query.teacher;
  if (query.owing) params.owing = "1";
  return params;
}

export const archiveApi = {
  async students(query: StudentQuery): Promise<ArchiveStudentsPage> {
    return (await api.get<ArchiveStudentsPage>("/classes/admin/archive/students/", { params: studentParams(query) })).data;
  },
  async groups(query: GroupQuery): Promise<ArchiveGroupsPage> {
    const params: Record<string, string | number> = { page: query.page, page_size: query.pageSize };
    if (query.q.trim()) params.q = query.q.trim();
    return (await api.get<ArchiveGroupsPage>("/classes/admin/archive/groups/", { params })).data;
  },
};

export const archiveKeys = {
  all: ["ops-archive"] as const,
  students: (query: StudentQuery) => ["ops-archive", "students", query] as const,
  groups: (query: GroupQuery) => ["ops-archive", "groups", query] as const,
};

export function useArchiveStudents(query: StudentQuery, enabled = true) {
  // The last page stays on screen while the next one loads, so a filter never blanks the table.
  return useQuery({ queryKey: archiveKeys.students(query), queryFn: () => archiveApi.students(query), placeholderData: keepPreviousData, enabled });
}

export function useArchiveGroups(query: GroupQuery, enabled = true) {
  return useQuery({ queryKey: archiveKeys.groups(query), queryFn: () => archiveApi.groups(query), placeholderData: keepPreviousData, enabled });
}
