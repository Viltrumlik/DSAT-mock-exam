import api from "@/lib/api";

/** How the admin console groups a learner (mirrors `users.audience.kind_of`). */
export type LearnerKind = "centre" | "public" | "frozen_debt" | "frozen_admin";

/** `GET /users/admin/population/` — the /ops Learners card. */
export interface Population {
  centre: number;
  public: number;
  frozen_debt: number;
  frozen_admin: number;
  signups_7d: number;
  signups_30d: number;
  joined_30d: number;
  left_30d: number;
}

export const usersAdminApi = {
  async population(): Promise<Population> {
    const { data } = await api.get<Population>("/users/admin/population/");
    return data;
  },
};
