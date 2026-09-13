import type { ReactNode } from "react";

/**
 * What XP, points and strikes actually are, in one place.
 *
 * Three numbers sit side by side on the dashboard and again on the profile, and none of
 * them explains itself: XP and points look interchangeable until you try to spend one,
 * and nothing on either page says that an *excused* absence wipes a run exactly as an
 * unexcused one does. These are the sentences behind the **!** on both pages.
 *
 * **The word is STRIKE, not streak** — the owner's correction, and the code agrees:
 * `StudentStrike`, `StrikeTransaction`, "Not enough strikes", and a Strike shop that
 * spends them. The *streak* is the run of lessons underneath; the *strikes* are what that
 * run has earned and not yet spent. They are different numbers the moment a student buys
 * anything, which is why showing the streak under the shop's own word was wrong.
 *
 * Shared rather than written twice, because the day a rule changes it must not be true in
 * one place and stale in the other. Every claim here is the behaviour in
 * `rewards/strikes.py`, not a paraphrase of the marketing:
 *
 * * `STREAK_STATUSES = ("PRESENT", "LATE")` — everything else, EXCUSED included, resets it;
 * * `balance = current_streak - spent_in_streak` — the `strikes` field on `/rewards/me/`,
 *   the same one `strikes.state` hands the storefront;
 * * a break zeroes both, so the strikes go with the run — no refund, and no debt carried
 *   into the next one;
 * * XP survives a bad score and is withdrawn only when the record behind it is corrected.
 *
 * Deliberately free of numbers that live in the database — the points-per-coin rate is a
 * setting, and a sentence naming it here would start lying the day it is changed. The
 * rewards page shows the live rate beside the button that does the conversion.
 */
export interface Explainer {
  title: string;
  body: ReactNode;
}

export const XP_EXPLAINER: Explainer = {
  title: "What XP is",
  body: (
    <>
      XP is the record of what you have done, and it is never spent — it only adds up. Most
      rules pay XP alongside points; the rewards page says which ones. Scoring badly never
      costs you XP. The only thing that takes it back is a corrected record, such as a lesson
      marked present and later changed to absent.
    </>
  ),
};

export const POINTS_EXPLAINER: Explainer = {
  title: "Points and coins",
  body: (
    <>
      Points are the half you spend. You turn them into coins yourself, on the rewards page —
      it does not happen on its own — and coins are what the coin shop takes. Unlike strikes,
      coins keep: missing a lesson does not touch them. XP keeps counting either way, so
      spending never costs you position.
    </>
  ),
};

export const STRIKE_EXPLAINER: Explainer = {
  title: "What a strike is",
  body: (
    <>
      Every lesson you attend in your current run earns one strike —{" "}
      <strong className="font-bold text-foreground">present or late</strong> both count. Strikes
      are what the Strike shop takes. They do not keep: one missed lesson ends the run, an
      excused absence included, and the strikes go with it. Coins are the half that keeps.
    </>
  ),
};
