"use client";

/**
 * A student's end of the game: where they finished, how accurate they were, and every
 * question with what they chose and what was right.
 *
 * The review comes from the results endpoint, which opens only once the room has ended —
 * mid-game it would be the answer sheet for questions a classmate has not reached yet.
 */

import { useQuery } from "@tanstack/react-query";
import { Check, Clock, Flame, X } from "lucide-react";

import { AssessmentText } from "@/lib/assessmentText";
import { cn } from "@/lib/cn";

import Link from "next/link";

import { SHOP_KEY, liveQuizApi, type AvatarSkin, type LiveParticipant, type ShopState, type TeamStanding } from "./api";
import { AvatarDisc, GemIcon } from "./avatars";
import { Confetti, FinalStandings, GamePanel, Podium, TrophyHeading } from "./game";
import { gamesToGo, nextGoal, ordinal, tileColor } from "./theme";
import type { GemsAwarded } from "./useLiveQuiz";

export function PlayerSummary({
  sessionId,
  me,
  leaderboard,
  questionTotal,
  gems = null,
  teams = [],
}: {
  sessionId: number;
  me: LiveParticipant | null;
  leaderboard: LiveParticipant[];
  questionTotal: number;
  /** From the `gems_awarded` frame; after a refresh the report row says the same. */
  gems?: GemsAwarded | null;
  /** Team mode: the teams' final standings, so the student sees how their team did. */
  teams?: TeamStanding[];
}) {
  const results = useQuery({
    queryKey: ["livequiz", "results", sessionId, "mine"],
    queryFn: () => liveQuizApi.results(sessionId),
    retry: 1,
  });

  // The balance has just moved, so this reads after the payout, not before it.
  const shop = useQuery({
    queryKey: [...SHOP_KEY, "after-game", gems?.balance ?? null],
    queryFn: () => liveQuizApi.shop(),
    retry: 1,
  });

  const myRow = results.data?.report.participants[0];
  const earned = gems?.earned ?? myRow?.gems ?? null;
  const questions = results.data?.report.questions ?? [];
  const place = me?.rank ?? myRow?.rank ?? null;
  const myTeam = typeof me?.team === "number" ? teams.find((t) => t.team === me.team) : undefined;
  const missed = myRow ? myRow.answers.filter((a) => a.timed_out).length : 0;
  const wrong = myRow ? myRow.answers.filter((a) => a.answered && !a.is_correct).length : 0;
  // The same count the server's accuracy is out of: every question that was in front of them.
  const seen = myRow ? myRow.answers.filter((a) => a.answered || a.timed_out).length : me?.answered_count ?? 0;
  const correct = myRow?.correct_count ?? me?.correct_count ?? 0;
  const accuracy = myRow?.accuracy ?? (seen > 0 ? Math.round((100 * correct) / seen) : null);

  return (
    <div className="relative mx-auto w-full max-w-3xl space-y-3.5 px-4 pb-16 pt-1">
      {place !== null && place <= 3 && <Confetti />}
      <TrophyHeading
        title={place ? `You finished ${ordinal(place)}` : "That is the quiz"}
        subtitle={leaderboard.length > 1 ? `out of ${leaderboard.length} players` : undefined}
      />

      {me && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat label="Score" value={me.score.toLocaleString()} />
          <Stat label="Correct" value={`${correct} / ${questionTotal || correct}`} />
          <Stat
            label="Accuracy"
            value={accuracy !== null ? `${accuracy}%` : "—"}
            note={accuracy !== null && seen > 0 ? `of the ${seen} you saw` : undefined}
          />
          <Stat
            label="Best streak"
            value={
              <>
                <Flame className="h-[22px] w-[22px] text-orange-400" aria-hidden />
                {me.best_streak ?? 0}
              </>
            }
          />
        </div>
      )}

      {myTeam && (
        <GamePanel className="flex items-center gap-3 px-4 py-3">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: tileColor(myTeam.team) }} aria-hidden />
          <p className="font-bold">
            Team {myTeam.name} finished {ordinal(myTeam.rank)}
            <span className="font-normal text-white/60"> of {teams.length} teams</span>
          </p>
          <span className="ml-auto font-mono font-bold tabular-nums">{myTeam.score.toLocaleString()}</span>
        </GamePanel>
      )}

      {earned !== null && (
        <GemsCard earned={earned} gems={gems} correct={correct} place={place} shop={shop.data} />
      )}

      {shop.data && <NextLookCard shop={shop.data} />}

      {leaderboard.length >= 2 && (
        <GamePanel className="px-4 pb-0 pt-6">
          <Podium rows={leaderboard} />
        </GamePanel>
      )}

      {leaderboard.length > 0 && (
        <GamePanel className="p-4">
          <p className="mb-3 text-sm font-semibold text-white/80">Final standings</p>
          <FinalStandings rows={leaderboard} highlightUserId={me?.user_id ?? null} limit={10} />
        </GamePanel>
      )}

      {myRow && questions.length > 0 && (
        <GamePanel className="p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-white/80">Your answers</p>
            <p className="text-xs text-white/60">
              {myRow.correct_count} right · {wrong} not this time{missed ? ` · ${missed} ran out` : ""}
            </p>
          </div>
          <ol className="space-y-2">
            {questions.map((question) => {
              const mine = myRow.answers.find((a) => a.question_id === question.question_id);
              const choices = question.choices ?? [];
              const textOf = (id: unknown) =>
                choices.find((c) => c.id.toUpperCase() === String(id ?? "").toUpperCase())?.text ??
                (id == null ? "" : String(id));
              const state = !mine || (!mine.answered && !mine.timed_out)
                ? "unseen"
                : mine.timed_out
                  ? "missed"
                  : mine.is_correct
                    ? "right"
                    : "wrong";
              return (
                <li key={question.question_id} className="rounded-xl bg-white/[0.06] p-3">
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                        state === "right" && "bg-emerald-400 text-emerald-950",
                        state === "wrong" && "bg-rose-400 text-rose-950",
                        state === "missed" && "bg-amber-400 text-amber-950",
                        state === "unseen" && "bg-white/20 text-white/70",
                      )}
                      aria-label={state}
                    >
                      {state === "right" ? (
                        <Check className="h-4 w-4" aria-hidden />
                      ) : state === "missed" ? (
                        <Clock className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <X className="h-4 w-4" aria-hidden />
                      )}
                    </span>
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="font-medium">
                        <AssessmentText text={question.prompt} />
                      </div>
                      {mine?.second_try != null && (
                        <p className="mt-0.5 text-xs font-semibold text-cyan-200">
                          Second chance: {mine.second_try ? "got it" : "not this time"}
                        </p>
                      )}
                      <p className="mt-1 text-emerald-300">
                        <AssessmentText text={textOf(question.correct_answer)} />
                      </p>
                      {question.explanation && (
                        <p className="mt-1 text-xs leading-relaxed text-white/60">
                          <AssessmentText text={question.explanation} />
                        </p>
                      )}
                      {state === "wrong" && (
                        <p className="mt-0.5 text-rose-300 line-through decoration-rose-300/60">
                          <AssessmentText text={textOf(mine?.answer)} />
                        </p>
                      )}
                    </div>
                    {mine && mine.points_awarded > 0 && (
                      <span className="shrink-0 font-mono text-xs tabular-nums text-white/70">
                        +{mine.points_awarded}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </GamePanel>
      )}

      {results.isError && (
        <p className="text-center text-sm text-white/60">Your answers could not be loaded just now.</p>
      )}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <GamePanel className="px-4 py-3.5">
      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-white/70">{label}</p>
      <p className="mt-1 flex items-center gap-1.5 font-mono text-[26px] font-extrabold tabular-nums">{value}</p>
      {note && <p className="mt-0.5 text-xs text-white/70">{note}</p>}
    </GamePanel>
  );
}

function GemsCard({
  earned,
  gems,
  correct,
  place,
  shop,
}: {
  earned: number;
  gems: GemsAwarded | null;
  correct: number;
  place: number | null;
  shop?: ShopState;
}) {
  const parts = gems?.breakdown;
  // Only what this game actually paid: a line of +0 is noise.
  const lines: Array<[string, number]> = parts
    ? [
        [`${correct} right ${correct === 1 ? "answer" : "answers"}`, parts.correct ?? 0],
        ["Played to the end", parts.finish ?? 0],
        [place ? `${ordinal(place)} place` : "Podium", parts.podium ?? 0],
      ]
    : [];
  return (
    <GamePanel className="flex flex-col gap-2 px-4 py-3.5">
      <div className="flex items-center gap-2.5">
        <GemIcon size={26} />
        <span className="text-xl font-extrabold">+{earned} gems</span>
        {shop && (
          <span className="ml-auto text-xs text-white/70">
            {shop.today_earned} of {shop.daily_cap} today
          </span>
        )}
      </div>
      {lines
        .filter(([, amount]) => amount > 0)
        .map(([label, amount]) => (
          <div key={label} className="flex justify-between text-[13px] text-white/80">
            <span>{label}</span>
            <span className="font-mono tabular-nums">+{amount}</span>
          </div>
        ))}
      {gems?.capped && <p className="text-[13px] text-amber-200">Today&apos;s limit took the rest. It starts again tomorrow.</p>}
    </GamePanel>
  );
}

/** What their gems are getting them closer to, with the real distance. */
function NextLookCard({ shop }: { shop: ShopState }) {
  const goal = nextGoal(shop);
  const button = (label: string) => (
    <Link
      href="/live/shop"
      className="inline-flex h-12 w-full items-center justify-center rounded-[14px] bg-white text-base font-extrabold text-violet-700 shadow-[inset_0_-4px_0_rgba(109,40,217,0.16)]"
    >
      {label}
    </Link>
  );

  if (shop.can_claim_starter || !goal) {
    return (
      <GamePanel className="flex flex-col gap-3 px-4 py-3.5">
        <p className="text-[15px] font-bold">
          {shop.can_claim_starter ? "Pick your free character" : "You own the whole shop"}
        </p>
        {button(shop.can_claim_starter ? "Choose one" : "Open the shop")}
      </GamePanel>
    );
  }

  const short = Math.max(0, goal.price - shop.balance);
  const percent = Math.min(100, Math.round((100 * shop.balance) / goal.price));
  return (
    <GamePanel className="flex flex-col gap-3 px-4 py-3.5">
      <div className="flex items-center gap-3.5">
        <AvatarDisc
          avatar={{ character: goal.character, skin: goal.kind === "skin" ? (goal.tier as AvatarSkin) : null }}
          name={goal.name}
          size={62}
          still
        />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold">Next: {goal.name}</p>
          <div
            className="mt-2 h-2 rounded-full bg-white/[0.12]"
            role="progressbar"
            aria-label={`Gems towards ${goal.name}`}
            aria-valuemin={0}
            aria-valuemax={goal.price}
            aria-valuenow={Math.min(shop.balance, goal.price)}
          >
            <div className="h-2 rounded-full bg-gradient-to-r from-cyan-300 to-violet-600" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-white/70">
            {short > 0
              ? `${shop.balance} of ${goal.price} · ${short} more, ${gamesToGo(short)}`
              : `You have enough for it: ${goal.price}`}
          </p>
        </div>
      </div>
      {button("Open the shop")}
    </GamePanel>
  );
}
