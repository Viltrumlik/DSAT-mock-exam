import api from "@/lib/api";

export type LeaderboardScope = "GLOBAL" | "BRANCH" | "GROUP";
/** Two windows. "WEEK" and "TERM" were withdrawn — a week ranked whoever had a lesson
 *  yesterday, and "term" meant nothing anybody could point at. The chips themselves come
 *  from the server (`LeaderboardFilters.windows`), so this union exists to stop the client
 *  inventing a value the board will silently coerce back to "ALL". */
export type LeaderboardWindow = "ALL" | "MONTH";

export interface LeaderboardRow {
  rank: number;
  student_id: number;
  name: string;
  profile_image_url: string | null;
  xp: number;
  /** How many earnings are behind the total — the tie-break, and an answer to "from what?". */
  awards: number;
  branch: string | null;
  region: string | null;
  is_me: boolean;
}

export interface LeaderboardResponse {
  scope: LeaderboardScope;
  window: LeaderboardWindow;
  branch_id: number | null;
  classroom_id: number | null;
  subject: string | null;
  level: string | null;
  count: number;
  /** One sentence saying what this board counts. It changes with the filters, because the
   *  filters change the answer — a narrowed board drops midterm XP, which has no classroom. */
  scope_note: string;
  rows: LeaderboardRow[];
  /** The viewer's own standing, present even when they are far below the visible limit.
   *  Null when they have earned no XP at all. */
  my: LeaderboardRow | null;
}

export interface LeaderboardFilters {
  regions: { id: number; name: string; code: string }[];
  branches: { id: number; name: string; code: string; region_id: number }[];
  subjects: { value: string; label: string }[];
  levels: { value: string; label: string }[];
  windows: { value: LeaderboardWindow; label: string }[];
  /** Null when the viewer's classroom has no branch — the "My Branch" tab is hidden then,
   *  rather than shown over an empty board. */
  my_branch: { id: number; name: string; region: string } | null;
}

export interface LeaderboardQuery {
  scope?: LeaderboardScope;
  window?: LeaderboardWindow;
  branch?: number | null;
  subject?: string | null;
  level?: string | null;
  limit?: number;
}

export const leaderboardApi = {
  async board(query: LeaderboardQuery = {}): Promise<LeaderboardResponse> {
    const params: Record<string, string> = {};
    if (query.scope) params.scope = query.scope;
    if (query.window) params.window = query.window;
    if (query.branch) params.branch = String(query.branch);
    if (query.subject) params.subject = query.subject;
    if (query.level) params.level = query.level;
    if (query.limit) params.limit = String(query.limit);
    const { data } = await api.get<LeaderboardResponse>("/rewards/leaderboard/", { params });
    return data;
  },
  async filters(): Promise<LeaderboardFilters> {
    const { data } = await api.get<LeaderboardFilters>("/rewards/leaderboard/filters/");
    return data;
  },
};
