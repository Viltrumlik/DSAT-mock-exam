import api from "@/lib/api";

export interface Region {
  id: number;
  name: string;
  code: string;
  is_active: boolean;
  branch_count: number | null;
}

export interface Branch {
  id: number;
  name: string;
  code: string;
  address: string;
  is_active: boolean;
  region: number;
  region_name: string;
  /** How many classrooms sit here — and therefore how many rosters are on this branch board. */
  classroom_count: number | null;
}

/** The slice of a classroom this page needs.
 *
 *  Read here rather than through `classesApi.list()`: that call zod-parses against the shared
 *  `Classroom` contract, which strips keys it does not declare — and `branch` is new, so it
 *  would arrive and be thrown away before this page ever saw it.
 */
export interface ClassroomBranchRow {
  id: number;
  name: string;
  subject?: string;
  branch: number | null;
  branch_name: string | null;
  region_name: string | null;
}

export const orgApi = {
  /**
   * EVERY classroom in the school, not the caller's own.
   *
   * `/classes/` is membership-scoped for **everyone, super_admin included** — a deliberate
   * privacy boundary that a previous change tried to lift and the school reverted. Using it
   * here meant this page silently showed each administrator only the classes they happened
   * to belong to: on production that was 2 of 34 for one super_admin, 10 of 34 for the other,
   * and **0 of 34** for both plain admins, who are members of nothing. Since creating a
   * classroom also creates an admin membership, it looked like "I only see the ones I made".
   *
   * `/classes/directory/` is the org-wide governance list `/ops/classrooms` already uses. It
   * is admin-gated server-side and comes back unpaginated, so every classroom is here whether
   * or not it has a branch — which matters, because the ones with NO branch are exactly the
   * ones this page exists to fix.
   */
  async classrooms(): Promise<ClassroomBranchRow[]> {
    const { data } = await api.get("/classes/directory/");
    const rows = Array.isArray(data) ? data : (data?.results ?? data?.items ?? []);
    return rows as ClassroomBranchRow[];
  },
  async regions(): Promise<Region[]> {
    const { data } = await api.get<{ regions: Region[] }>("/classes/org/regions/");
    return data.regions;
  },
  async createRegion(body: { name: string; code?: string }): Promise<Region> {
    const { data } = await api.post<Region>("/classes/org/regions/", body);
    return data;
  },
  async branches(): Promise<Branch[]> {
    const { data } = await api.get<{ branches: Branch[] }>("/classes/org/branches/");
    return data.branches;
  },
  async createBranch(body: {
    name: string;
    region: number;
    code?: string;
    address?: string;
  }): Promise<Branch> {
    const { data } = await api.post<Branch>("/classes/org/branches/", body);
    return data;
  },
  /** Put a classroom in a branch — pass null to clear it. Returns how many students moved. */
  async setClassroomBranch(
    classroomId: number,
    branchId: number | null,
  ): Promise<{ detail: string; students_affected?: number }> {
    const { data } = await api.post(`/classes/${classroomId}/branch/`, { branch: branchId });
    return data;
  },
};
