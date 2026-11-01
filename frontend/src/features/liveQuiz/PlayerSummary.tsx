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

import { liveQuizApi, type LiveParticipant } from "./api";
import { Confetti, FinalStandings, GamePanel, Podium, TrophyHeading } from "./game";
import { ordinal } from "./theme";

export function PlayerSummary({
  sessionId,
  me,
  leaderboard,
  questionTotal,
}: {
  sessionId: number;
  me: LiveParticipant | null;
  leaderboard: LiveParticipant[];
  questionTotal: number;
}) {
  const results = useQuery({
    queryKey: ["livequiz", "results", sessionId, "mine"],
    queryFn: () => liveQuizApi.results(sessionId),
    retry: 1,
  });

  const myRow = results.data?.report.participants[0];
  const questions = results.data?.report.questions ?? [];
  const place = me?.rank ?? myRow?.rank ?? null;
  const missed = myRow ? myRow.answers.filter((a) => a.timed_out).length : 0;
  const wrong = myRow ? myRow.answers.filter((a) => a.answered && !a.is_correct).length : 0;
  const accuracy =
    myRow?.accuracy ??
    (me && questionTotal > 0 ? Math.round((100 * me.correct_count) / questionTotal) : null);

  return (
    <div className="relative mx-auto w-full max-w-3xl space-y-6 px-4 pb-16 pt-4">
      {place !== null && place <= 3 && <Confetti />}
      <TrophyHeading
        title={place ? `You finished ${ordinal(place)}` : "That is the quiz"}
        subtitle={leaderboard.length > 1 ? `out of ${leaderboard.length} players` : undefined}
      />

      {me && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Score" value={me.score.toLocaleString()} />
          <Stat label="Accuracy" value={accuracy !== null ? `${accuracy}%` : "—"} />
          <Stat
            label="Correct"
            value={`${myRow?.correct_count ?? me.correct_count}/${questionTotal || me.correct_count}`}
          />
          <Stat
            label="Best streak"
            value={
              <span className="inline-flex items-center gap-1">
                <Flame className="h-5 w-5 text-orange-400" aria-hidden />
                {me.best_streak ?? 0}
              </span>
            }
          />
        </div>
      )}

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

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <GamePanel className="px-3 py-4 text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-white/60">{label}</p>
      <p className="mt-1 font-mono text-2xl font-black tabular-nums">{value}</p>
    </GamePanel>
  );
}
