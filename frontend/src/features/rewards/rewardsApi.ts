import api from "@/lib/api";

export type RewardEvent =
  | "ATTENDANCE_PRESENT"
  | "ATTENDANCE_LATE"
  | "SUPPORT_SESSION"
  | "SURVEY"
  | "MIDTERM_PASS"
  | "MIDTERM_RETAKE_PASS"
  | "HOMEWORK_FULL"
  | "HOMEWORK_HIGH"
  | "HOMEWORK_MID"
  | "MANUAL";

export interface RewardRule {
  event: RewardEvent;
  label: string;
  points: number;
}

export interface PointAward {
  id: number;
  event: RewardEvent;
  label: string;
  points: number;
  classroom: number | null;
  classroom_name: string | null;
  awarded_at: string;
  note: string;
}

export interface MyRewards {
  season: { id: number; name: string; started_at: string };
  points: number;
  /** Points needed for one coin. Coins themselves land in a later release. */
  points_per_coin: number;
  history: PointAward[];
}

export const rewardsApi = {
  async me(): Promise<MyRewards> {
    const { data } = await api.get<MyRewards>("/rewards/me/");
    return data;
  },
  async rules(): Promise<RewardRule[]> {
    const { data } = await api.get<{ rules: RewardRule[] }>("/rewards/rules/");
    return data.rules;
  },
};
