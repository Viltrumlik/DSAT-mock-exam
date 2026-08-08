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
  points: number;
  /** From the WALLET, not `points / rate`. Once coins are spendable the two diverge, and a
   *  derived figure keeps showing a student coins they have already spent. */
  coins: number;
  points_per_coin: number;
  points_to_next_coin: number;
  history: PointAward[];
}

export interface CoinTransaction {
  id: number;
  kind: "EARN" | "SPEND" | "ADMIN_GRANT" | "ADMIN_REVOKE";
  label: string;
  amount: number;
  balance_after: number;
  reference: string;
  created_at: string;
}

export interface MyWallet {
  coins: number;
  points: number;
  points_per_coin: number;
  points_to_next_coin: number;
  transactions: CoinTransaction[];
}

export const rewardsApi = {
  async me(): Promise<MyRewards> {
    const { data } = await api.get<MyRewards>("/rewards/me/");
    return data;
  },
  async wallet(): Promise<MyWallet> {
    const { data } = await api.get<MyWallet>("/rewards/wallet/");
    return data;
  },
  async rules(): Promise<RewardRule[]> {
    const { data } = await api.get<{ rules: RewardRule[] }>("/rewards/rules/");
    return data.rules;
  },
};
