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
  /** Lifetime, and it only ever climbs. Lower than `points` for anyone who has been late to
   *  a lesson or filled in a survey — neither earns XP. */
  xp: number;
  points_per_coin: number;
  points_to_next_coin: number;
  /** What Convert would mint right now. Points are no longer converted automatically, so
   *  without this number a student has no way to know there is anything to press for. */
  convertible_coins: number;
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
  xp: number;
  points_per_coin: number;
  points_to_next_coin: number;
  convertible_coins: number;
  transactions: CoinTransaction[];
}

/** The convert response is the wallet *state* — balances only, no transaction list. */
export interface ConvertResult extends Omit<MyWallet, "transactions"> {
  /** How many coins this press actually minted. Zero is an ordinary answer — it means they
   *  have not reached the rate yet — so `detail` carries the wording either way. */
  minted: number;
  detail: string;
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
  /** Turn earned points into coins. Safe to call twice — the amount owed is derived from
   *  what has already been minted, so a retry mints nothing rather than paying twice. */
  async convert(): Promise<ConvertResult> {
    const { data } = await api.post<ConvertResult>("/rewards/wallet/convert/");
    return data;
  },
};
