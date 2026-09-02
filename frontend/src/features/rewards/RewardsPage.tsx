"use client";

import { useState } from "react";
import {
  Sparkles,
  CalendarCheck,
  ClipboardList,
  FileText,
  GraduationCap,
  LifeBuoy,
  MessageSquare,
  ArrowRightLeft,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button, HeroPage, Input, PageHero, Skeleton } from "@/components/ui";
// The house devices, so the wallet reads as part of the same product as the classroom.
import { Card, CardHeader, EmptyState, ErrorState } from "@/features/classroom/ui";
import { RewardCoin } from "@/components/RewardCoin";
import { useConvertPoints, useMyRewards, useMyWallet, useRewardRules } from "./rewardsHooks";
import type { RewardEvent, RewardRule } from "./rewardsApi";

/** One icon per family of earning, so the history reads at a glance.
 *
 *  The three retired homework bands keep their icon: they are no longer awarded, but every
 *  row already banked under them still comes back in the history and must not render bare. */
const EVENT_ICON: Record<RewardEvent, LucideIcon> = {
  ATTENDANCE_PRESENT: CalendarCheck,
  ATTENDANCE_LATE: CalendarCheck,
  SUPPORT_SESSION: LifeBuoy,
  SURVEY: MessageSquare,
  MIDTERM_PASS: FileText,
  MIDTERM_RETAKE_PASS: FileText,
  HOMEWORK: ClipboardList,
  CLASSWORK_MANUAL: GraduationCap,
  MANUAL: Sparkles,
  HOMEWORK_FULL: ClipboardList,
  HOMEWORK_HIGH: ClipboardList,
  HOMEWORK_MID: ClipboardList,
};

/** The bands were retired when homework started paying proportionally, but `/rewards/rules/`
 *  still serves their seeded rows. Left in, "How to earn" would tell a student to aim for a
 *  60–79% band that no longer exists — and would contradict the live homework rule sitting
 *  three lines above it. Filtered here, not from `EVENT_ICON`: history still needs those. */
const RETIRED_RULE_EVENTS: readonly RewardEvent[] = ["HOMEWORK_FULL", "HOMEWORK_HIGH", "HOMEWORK_MID"];

/** Events a person prices when they award them. Their rule row is seeded at 0, and "+0" in a
 *  list headed "How to earn" reads as "this is worth nothing", which is the opposite of true. */
const TEACHER_PRICED_EVENTS: readonly RewardEvent[] = ["CLASSWORK_MANUAL"];

/** What a student can actually do about a rule, where the amount alone does not say it.
 *  Homework is the one that matters: it stopped being a band and became a share. */
function ruleHint(rule: RewardRule): string | null {
  const lines: string[] = [];
  switch (rule.event) {
    case "HOMEWORK":
      lines.push(
        `Finish it all before the deadline and the full ${rule.points} lands right away. Otherwise you're paid at the deadline for the share you've finished — only what's done by then counts, so starting early is what pays.`,
      );
      break;
    case "CLASSWORK_MANUAL":
      lines.push("Your teacher decides this one, for the work you do in the lesson itself.");
      break;
    case "SUPPORT_SESSION": {
      // The amount beside this rule is what you earn ALONE, which is the smallest thing it
      // can be — and a student who reads only that has no reason to invite anybody. The rungs
      // come off the rule so they cannot drift from what the hour actually pays.
      const [alone, pair, trio] = rule.group_points ?? [];
      if (alone != null && pair != null && trio != null) {
        lines.push(
          `Bring a classmate and you both earn more: ${alone} on your own, ${pair} each if two of you go, ${trio} each if three do. You're paid once the teacher marks the session as held.`,
        );
      }
      break;
    }
  }
  // Said on the rule itself, not only in the XP tile. A student reading "+40" beside a survey
  // has no other way to learn that this one earning is the exception — and it is read off the
  // rule rather than matched on the event, because it is a checkbox the school can tick back.
  if (!rule.grants_xp) {
    lines.push("Points only — this one doesn't add to your XP.");
  }
  return lines.length > 0 ? lines.join(" ") : null;
}

/** The headline amount: a single figure, or `10–20` for a rule whose price climbs with the
 *  group. Reads the rungs off the rule so a retune moves both ends. */
function ruleRange(rule: RewardRule): string {
  const ladder = rule.group_points;
  if (!ladder || ladder.length === 0) return String(rule.points);
  const low = ladder[0];
  const high = ladder[ladder.length - 1];
  return low === high ? String(low) : `${low}\u2013${high}`;
}

const PAGE_DESCRIPTION = "What you've earned for showing up and doing the work.";

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * A figure inside the blue. The coins are the school's own minted art, so they get the room
 * a plain icon would not earn — this is the one place on the platform a student sees them
 * full size.
 */
function WalletTile({
  media, label, value, sub,
}: {
  media?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  // A DARK scrim, not a lighter one. Measured: an 11px label at 72% white on a white/14 panel
  // over the hero gradient is 2.95:1 in light and 2.09:1 in dark — well under the 4.5:1 body
  // text needs, and these labels are the only thing naming which figure is which. Darkening
  // the panel and taking the text to full white gives 7.8:1 and 5.0:1.
  return (
    <div className="flex min-w-[150px] flex-1 items-center gap-3 rounded-2xl bg-black/[0.22] px-4 py-3.5">
      {media ? <span className="shrink-0">{media}</span> : null}
      <div className="min-w-0">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.06em]">{label}</p>
        <p className="ds-num text-[28px] font-extrabold leading-none">{value}</p>
        {/* Wraps rather than truncates: the XP rule takes a sentence to state honestly, and a
            half-sentence about what does and does not take XP away is worse than none. */}
        {sub ? <p className="mt-1 text-[11px] font-bold leading-snug">{sub}</p> : null}
      </div>
    </div>
  );
}

export function RewardsPage() {
  const rewards = useMyRewards();
  const rules = useRewardRules();
  const wallet = useMyWallet();
  const convert = useConvertPoints();

  const points = rewards.data?.points ?? 0;
  const perCoin = rewards.data?.points_per_coin ?? 10;
  // Both figures come from the wallet. Deriving coins as `points / rate` here would keep
  // showing a student coins they have already spent — points are a score, coins are a
  // balance, and once coins are spendable the two stop agreeing.
  const coins = rewards.data?.coins ?? 0;
  const xp = rewards.data?.xp ?? 0;
  const toNextCoin = rewards.data?.points_to_next_coin ?? perCoin;
  const convertible = rewards.data?.convertible_coins ?? 0;
  // What Max would spend: `points` minus the change that does not add up to a whole coin.
  const maxPoints = rewards.data?.max_convertible_points ?? 0;
  // The amount box is a STRING while it is being typed. Storing a number would make an empty
  // box read as 0 and a half-typed "3" jump to 3 the moment the student meant to type 30.
  const [amount, setAmount] = useState("");
  const asked = Number(amount);
  const amountValid = amount !== "" && Number.isFinite(asked) && asked > 0 && asked <= points;
  // What pressing Convert would actually buy, so the button can say it before it is pressed.
  const wouldBuy = amountValid ? Math.floor(asked / perCoin) : 0;
  const earnableRules = (rules.data ?? []).filter((r) => !RETIRED_RULE_EVENTS.includes(r.event));

  if (rewards.isError) {
    return (
      <HeroPage>
        <Card className="cr-card">
          <ErrorState
            title="Points aren't loading right now."
            message="Nothing has been lost — the page just couldn't fetch your total."
            onRetry={() => void rewards.refetch()}
          />
        </Card>
      </HeroPage>
    );
  }

  return (
    <HeroPage className="space-y-5">
      <Card pad="none" className="cr-card overflow-hidden">
        <PageHero badge="Rewards" title="Points" description={PAGE_DESCRIPTION}>
          {rewards.isPending ? (
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[86px] animate-pulse rounded-2xl bg-white/[0.14]" />
              ))}
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              <div className="flex flex-wrap gap-3">
                <WalletTile
                  media={<RewardCoin kind="point" size="lg" />}
                  label="Points"
                  value={points}
                />
                <WalletTile
                  media={<RewardCoin kind="coin" size="lg" />}
                  label="Coins"
                  value={coins}
                  sub={`${perCoin} points = 1 coin`}
                />
                {/* XP sits beside points rather than replacing them, because they answer
                    different questions and a student will notice the two disagree. The `sub`
                    says why before they have to ask.
                    It no longer says "learning only — never goes down", and neither half of
                    that was still true: `revoke` zeroes XP when a fact is withdrawn (a PRESENT
                    corrected to ABSENT). What survives is the narrower promise the school
                    actually makes — doing worse never costs XP.
                    Nor does it still say "Every point earns XP": a survey pays points and no
                    XP since 2026-09-01. Rather than name the exception here — it is a
                    `grants_xp` checkbox, so a sentence in this tile would start lying the day
                    somebody ticks it — the tile points at the rules list, which reads the flag
                    off each rule and cannot drift. */}
                <WalletTile
                  media={
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-white/20">
                      <Zap className="h-5 w-5" aria-hidden />
                    </span>
                  }
                  label="XP"
                  value={xp}
                  sub="Most of what you earn adds XP too — each rule below says. A lower score never takes it away, only a corrected record does."
                />
              </div>

              {/* The conversion strip. Points no longer become coins on their own, so this is
                  the only thing standing between a student and their coins — it has to be
                  visible, and it has to say what it will do. When there is nothing to convert
                  it keeps its place and reports the distance instead of vanishing, so the
                  student learns where the button lives before they need it. */}
              <div className="space-y-2 rounded-2xl bg-black/[0.22] px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-extrabold uppercase tracking-[0.06em]">
                      {convertible > 0 ? "Ready to convert" : "To your next coin"}
                    </p>
                    <p className="mt-0.5 text-sm font-bold">
                      {convertible > 0
                        ? `Your points are worth ${convertible} coin${convertible === 1 ? "" : "s"}.`
                        : `${toNextCoin} more point${toNextCoin === 1 ? "" : "s"} and you can convert.`}
                    </p>
                  </div>

                  {/* How many points to spend, and Max for all of them. The box exists at all
                      because converting now COSTS points — when conversion was a derivation
                      there was only ever one sensible amount, so a bare button was honest.
                      Now that the points leave the balance, choosing to cash in 30 of 340 is
                      a thing a student can reasonably want, and a single button would take
                      the lot without asking. */}
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={points}
                      aria-label="Points to convert"
                      placeholder="Points"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-28 bg-white/95 text-foreground"
                      disabled={convertible === 0 || convert.isPending}
                    />
                    <Button
                      variant="secondary"
                      // Fills the box rather than converting on the spot. Max is a shortcut
                      // for typing a number, not a second way to spend — one press should
                      // never be the difference between 0 and 340 points gone.
                      onClick={() => setAmount(String(maxPoints))}
                      disabled={maxPoints === 0 || convert.isPending}
                    >
                      Max
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        convert.mutate(asked, {
                          // Clear the box on success only. Leaving a spent amount sitting
                          // there invites a second press that would spend it again; clearing
                          // it on failure would throw away what the student typed.
                          onSuccess: () => setAmount(""),
                        })
                      }
                      disabled={!amountValid || wouldBuy === 0 || convert.isPending}
                    >
                      <ArrowRightLeft className="mr-1.5 h-4 w-4" aria-hidden />
                      {convert.isPending ? "Converting…" : "Convert"}
                    </Button>
                  </div>
                </div>

                {/* Say what the press will do BEFORE it happens. Points do not come back, so
                    the one number a student must see in advance is how many they are giving
                    up — including the change that stays behind, which is otherwise read as
                    points going missing. */}
                {amount !== "" ? (
                  <p className="text-xs font-bold">
                    {!amountValid
                      ? asked > points
                        ? `You only have ${points} point${points === 1 ? "" : "s"}.`
                        : "Enter how many points to convert."
                      : wouldBuy === 0
                        ? `${perCoin} points buy a coin — ${asked} isn't enough for one yet.`
                        : `${wouldBuy * perCoin} points buy ${wouldBuy} coin${wouldBuy === 1 ? "" : "s"}` +
                          (asked - wouldBuy * perCoin > 0
                            ? `, and you keep the other ${asked - wouldBuy * perCoin}.`
                            : ".")}
                  </p>
                ) : null}
              </div>

              {convert.isError ? (
                <p className="text-sm font-bold">
                  That didn&apos;t go through — your points are untouched. Try again.
                </p>
              ) : convert.data && convert.data.minted > 0 ? (
                <p className="text-sm font-bold">{convert.data.detail}</p>
              ) : null}
            </div>
          )}
        </PageHero>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="cr-card space-y-3 lg:col-span-2">
          <CardHeader title="Your earnings" description="Every point you've picked up so far" />
          {rewards.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
            </div>
          ) : (rewards.data?.history.length ?? 0) === 0 ? (
            <EmptyState
              media={<RewardCoin kind="point" size="xl" />}
              title="Nothing yet — but everything counts"
              description="Attend a lesson, finish your homework or sit a midterm, and your points will show up here."
            />
          ) : (
            <ul className="divide-y divide-border">
              {rewards.data?.history.map((row, i) => {
                const Icon = EVENT_ICON[row.event] ?? Sparkles;
                return (
                  <li
                    key={row.id}
                    style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                    className="cr-rowin flex items-center gap-3 py-3"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-foreground">{row.label}</p>
                      <p className="truncate text-xs font-semibold text-muted-foreground">
                        {row.classroom_name ? `${row.classroom_name} · ` : ""}
                        {fmtDate(row.awarded_at)}
                      </p>
                    </div>
                    {/* A conversion is the one row in this feed that SPENDS, so it is the
                        one that must not wear a green plus. Signed and neutral-coloured: the
                        feed is a record of what happened to a student's points, and a
                        withdrawal dressed as an earning is the kind of small lie that makes
                        somebody stop trusting the whole screen. */}
                    <span
                      className={
                        row.points < 0
                          ? "ds-num shrink-0 text-sm font-extrabold text-muted-foreground"
                          : "ds-num shrink-0 text-sm font-extrabold text-emerald-600"
                      }
                    >
                      {row.points < 0 ? row.points : `+${row.points}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="cr-card space-y-3">
          <CardHeader title="How to earn" description="Served from the learning center's live rules" />
          {rules.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-8 rounded-lg" />
              <Skeleton className="h-8 rounded-lg" />
              <Skeleton className="h-8 rounded-lg" />
            </div>
          ) : rules.isError ? (
            <ErrorState
              title="The rules aren't loading right now."
              message="Your points are unaffected — only this list failed to load."
              onRetry={() => void rules.refetch()}
            />
          ) : earnableRules.length === 0 ? (
            // A blank card reads as "there is nothing to earn", which is the opposite of true.
            <EmptyState
              icon={Sparkles}
              title="No earning rules yet"
              description="Your learning center is still tuning how points are awarded — they'll show up here."
            />
          ) : (
            <ul className="space-y-1">
              {earnableRules.map((rule) => {
                const hint = ruleHint(rule);
                return (
                  <li
                    key={rule.event}
                    className="rounded-xl px-2.5 py-2 text-sm hover:bg-surface-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate font-semibold text-muted-foreground">
                        {rule.label}
                      </span>
                      {TEACHER_PRICED_EVENTS.includes(rule.event) ? (
                        <span className="shrink-0 text-xs font-bold text-muted-foreground">
                          Set by your teacher
                        </span>
                      ) : (
                        <span className="ds-num shrink-0 font-extrabold text-foreground">
                          {/* A range, not a figure, where the rule has a ladder. A support
                              hour's `points` is what it pays a student sitting it ALONE —
                              the smallest thing it can be — and printing that as the headline
                              undersells the earning the invite button exists to create. */}
                          +{ruleRange(rule)}
                        </span>
                      )}
                    </div>
                    {/* The amount alone used to be the whole rule. Homework is now a share of
                        its maximum, settled at the deadline, so "+15" on its own is a figure
                        almost nobody will actually see and no guide to what to do about it. */}
                    {hint ? (
                      <p className="mt-0.5 text-xs font-semibold leading-snug text-muted-foreground">
                        {hint}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {(wallet.data?.transactions.length ?? 0) > 0 && (
        <Card className="cr-card space-y-3">
          <CardHeader title="Coin history" description="Coins you've earned and spent" />
          <ul className="divide-y divide-border">
            {wallet.data?.transactions.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-foreground">
                    {t.reference || t.label}
                  </p>
                  <p className="truncate text-xs font-semibold text-muted-foreground">
                    {fmtDate(t.created_at)}
                  </p>
                </div>
                <span
                  className={
                    t.amount >= 0
                      ? "ds-num shrink-0 text-sm font-extrabold text-emerald-600"
                      : "ds-num shrink-0 text-sm font-extrabold text-muted-foreground"
                  }
                >
                  {t.amount >= 0 ? `+${t.amount}` : t.amount}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </HeroPage>
  );
}
