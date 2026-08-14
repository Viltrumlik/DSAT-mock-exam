import api from "@/lib/api";

export type RankingKind = "SAT" | "ACADEMIC";
export type LeaderboardMode = "FULL" | "ANONYMOUS" | "HIDDEN";
export type Trend = "IMPROVING" | "STABLE" | "DECLINING";

export interface RankingRow {
  rank: number;
  is_me: boolean;
  name: string;
  /** Profile photo. Null when unset, and also when the board is anonymous — a face
   *  identifies a student more directly than a name, so it hides with the name. */
  profile_image_url?: string | null;
  /** null means EITHER hidden by config OR no result yet — `has_result` tells them apart. */
  score: number | null;
  /** False for a student who has not sat one of this class's pastpapers yet. */
  has_result?: boolean;
  previous_rank: number | null;
  rank_change: number | null;
  trend: Trend | null;
  percentile: number | null;
  confidence: "LOW" | "MEDIUM" | "HIGH" | null;
  components: Record<string, unknown> | null;
}

export interface RankingResponse {
  kind: RankingKind;
  period_key: string | null;
  config: { leaderboard_mode: LeaderboardMode; hide_score_values: boolean };
  can_configure: boolean;
  can_recompute: boolean;
  /** @deprecated Always false — the SAT board was removed from the classroom. The server
   *  still sends it so a browser tab open across the deploy keeps its SAT tab hidden. */
  sat_available?: boolean;
  my: RankingRow | null;
  rows: RankingRow[];
}

export interface RankingHistoryPoint {
  period_key: string;
  rank: number;
  score: number;
  percentile: number | null;
  trend: Trend | null;
  computed_at: string;
}

const base = (classId: number) => `/classes/${classId}/rankings`;

export const rankingsApi = {
  get: async (classId: number, kind: RankingKind): Promise<RankingResponse> =>
    (await api.get(`${base(classId)}/${kind.toLowerCase()}/`)).data,
  history: async (classId: number, kind: RankingKind, studentId?: number): Promise<{ history: RankingHistoryPoint[] }> =>
    (await api.get(`${base(classId)}/${kind.toLowerCase()}/history/`, { params: studentId ? { student: studentId } : {} })).data,
  recompute: async (classId: number, kinds?: RankingKind[]) =>
    (await api.post(`${base(classId)}/recompute/`, kinds ? { kinds } : {})).data,
  updateConfig: async (classId: number, data: { leaderboard_mode?: LeaderboardMode; hide_score_values?: boolean }) =>
    (await api.patch(`${base(classId)}/config/`, data)).data,
};
