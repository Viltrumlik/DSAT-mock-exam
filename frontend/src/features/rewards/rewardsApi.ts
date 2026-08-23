import api from "@/lib/api";

/** Mirrors `rewards.constants.EVENT_CHOICES`. It is a closed union and it keys
 *  `Record<RewardEvent, LucideIcon>`, so an event the backend can award but this list omits
 *  is a row the history renders without an icon — add here first, then to `EVENT_ICON`. */
export type RewardEvent =
  | "ATTENDANCE_PRESENT"
  | "ATTENDANCE_LATE"
  | "SUPPORT_SESSION"
  | "SURVEY"
  | "MIDTERM_PASS"
  | "MIDTERM_RETAKE_PASS"
  /** Proportional: the rule's points are the *maximum*, scaled by the bundle percentage. */
  | "HOMEWORK"
  /** Classwork, priced by the teacher who awards it. Never automatic. */
  | "CLASSWORK_MANUAL"
  | "MANUAL"
  // Retired bands. Nothing new is awarded with these, but thousands of ledger rows carry
  // them, so a student's history still serves them and they must still parse and render.
  | "HOMEWORK_FULL"
  | "HOMEWORK_HIGH"
  | "HOMEWORK_MID";

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
  /** Lifetime. Every event now earns XP equal to its points, so this no longer trails
   *  `points` for lateness or surveys — the old exclusion list moved into `RewardRule`.
   *
   *  It is a high-water mark against a *smaller* fact only: a re-grade that drops a homework
   *  percent leaves it standing (`award` keeps `max(previous_xp, …)`). A *withdrawn* fact
   *  takes its XP with it — `revoke` zeroes XP alongside points, which is what lets
   *  attendance pay the moment a teacher saves and still be correctable to ABSENT. So this
   *  number can fall, and a UI that promises "never goes down" is lying. */
  xp: number;
  points_per_coin: number;
  points_to_next_coin: number;
  /** What Convert would mint right now. Points are no longer converted automatically, so
   *  without this number a student has no way to know there is anything to press for. */
  convertible_coins: number;
  /** What Max would SPEND — always a whole number of coins' worth, so it is `points` minus
   *  the remainder that does not add up to a coin. The two differ whenever a student has
   *  change in hand, and the Max button must fill in this one. */
  max_convertible_points: number;
  /** Strike balance and attendance streak, folded in so the dashboard needs one request
   *  rather than also fetching the whole shop catalogue for a single number. */
  strikes: number;
  current_streak: number;
  best_streak: number;
  history: PointAward[];
}

export interface CoinTransaction {
  id: number;
  kind: "EARN" | "SPEND" | "ADMIN_GRANT" | "ADMIN_REVOKE";
  label: string;
  amount: number;
  balance_after: number;
  /** Points this mint cost. Zero on a spend or an admin grant, which consume no points. */
  points_spent: number;
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
  /** What Max would spend — see `MyRewards.max_convertible_points`. */
  max_convertible_points: number;
  transactions: CoinTransaction[];
}

/** The convert response is the wallet *state* — balances only, no transaction list. */
export interface ConvertResult extends Omit<MyWallet, "transactions"> {
  /** How many coins this press actually minted. Zero is an ordinary answer — it means they
   *  have not reached the rate yet — so `detail` carries the wording either way. */
  minted: number;
  /** What the coins cost. Never more than `minted * points_per_coin`, and the number the
   *  student's balance actually fell by. */
  points_spent: number;
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
  /** Buy coins with points.
   *
   *  Omitting `points` means Max — spend everything that buys a whole coin. NOT safe to call
   *  twice: converting now SPENDS the points, so a retry is a second purchase rather than a
   *  no-op. The server takes a row lock and re-reads the balance, so a double-tap can never
   *  spend the same points twice — but the caller must not fire this speculatively. */
  async convert(points?: number): Promise<ConvertResult> {
    const { data } = await api.post<ConvertResult>(
      "/rewards/wallet/convert/",
      points === undefined ? {} : { points },
    );
    return data;
  },
};
