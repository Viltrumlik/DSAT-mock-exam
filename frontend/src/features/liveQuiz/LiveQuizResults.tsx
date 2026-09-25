"use client";

/**
 * What the class actually did, after the game.
 *
 * Two questions a teacher has once the noise dies down: who was where, and which questions
 * the room did not understand. The second is the one worth acting on, so it comes first and
 * the weakest question is called out by name rather than left to be spotted in a table.
 */

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Minus, X } from "lucide-react";

import { Button, Card, ErrorState, LoadingState } from "@/features/classroom/ui";
import { AssessmentText } from "@/lib/assessmentText";
import { cn } from "@/lib/cn";

import { liveQuizApi } from "./api";

/** Podium colours, the same three the school leaderboard uses. */
const MEDAL = ["#d4a017", "#9aa4b2", "#b4703a"];

function percent(correct: number, answered: number): number | null {
  // Nobody answered: that is not 0% understood, it is no information. Say so with a dash
  // rather than painting the question red.
  if (answered <= 0) return null;
  return Math.round((correct / answered) * 100);
}

export function LiveQuizResults({ sessionId }: { sessionId: number }) {
  const router = useRouter();
  const results = useQuery({
    queryKey: ["livequiz", "results", sessionId],
    queryFn: () => liveQuizApi.results(sessionId),
  });

  if (results.isLoading) return <LoadingState label="Loading the results…" />;
  if (results.isError) {
    return (
      <ErrorState
        message="These results could not be loaded."
        onRetry={() => results.refetch()}
      />
    );
  }
  if (!results.data) return null;

  const { session, report } = results.data;
  const questions = report.questions;
  const players = report.participants;

  // The question the room did worst on, ignoring any nobody reached.
  const attempted = questions.filter((q) => q.answered > 0);
  const weakest = attempted.length
    ? attempted.reduce((worst, q) =>
        q.correct / q.answered < worst.correct / worst.answered ? q : worst,
      )
    : null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button
            variant="ghost"
            size="sm"
            icon={ArrowLeft}
            className="-ml-2 mb-1"
            onClick={() => router.push("/teacher/live")}
          >
            Live quiz
          </Button>
          <h1 className="truncate text-xl font-bold">{session.title}</h1>
          <p className="text-sm text-muted-foreground">
            {session.classroom_name} · {players.length}{" "}
            {players.length === 1 ? "player" : "players"} · {questions.length} questions
          </p>
        </div>
      </div>

      {weakest && percent(weakest.correct, weakest.answered) !== null && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Worth going over again
          </p>
          <div className="mt-1.5 text-sm font-medium">
            <AssessmentText text={weakest.prompt} />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {percent(weakest.correct, weakest.answered)}% got it right
            {" — "}
            the answer was{" "}
            <span className="font-semibold text-foreground">
              {String(weakest.correct_answer)}
            </span>
          </p>
        </Card>
      )}

      <Card>
        <p className="mb-3 text-sm font-semibold">Question by question</p>
        <ul className="space-y-2">
          {questions.map((question) => {
            const share = percent(question.correct, question.answered);
            return (
              <li key={question.question_id} className="flex items-center gap-3">
                <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground">
                  {question.order + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">
                    <AssessmentText text={question.prompt} />
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        share === null
                          ? "bg-border"
                          : share >= 70
                            ? "bg-emerald-500"
                            : share >= 40
                              ? "bg-amber-500"
                              : "bg-rose-500",
                      )}
                      style={{ width: `${share ?? 0}%` }}
                    />
                  </div>
                </div>
                <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {share === null ? "not reached" : `${share}% · ${question.answered}`}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card pad="none" className="overflow-hidden">
        <p className="border-b border-border px-5 py-4 text-sm font-semibold sm:px-6">
          Everyone
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 text-right font-medium">Score</th>
                <th className="px-3 py-2 text-right font-medium">Right</th>
                <th className="px-3 py-2 font-medium">Answers</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player, index) => {
                const place = player.rank ?? index + 1;
                return (
                  <tr key={player.participant_id} className="border-b border-border last:border-0">
                    <td
                      className="px-3 py-2 font-bold tabular-nums"
                      style={{ color: place <= 3 ? MEDAL[place - 1] : undefined }}
                    >
                      {place}
                    </td>
                    <td className="max-w-[12rem] truncate px-3 py-2 font-medium">
                      {player.display_name}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{player.score}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground tabular-nums">
                      {player.correct_count}/{questions.length}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        {player.answers.map((answer) => (
                          <span
                            key={answer.question_id}
                            title={`Question ${answer.order + 1}`}
                            className={cn(
                              "flex h-5 w-5 items-center justify-center rounded",
                              !answer.answered
                                ? "bg-surface-2 text-muted-foreground"
                                : answer.is_correct
                                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                  : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                            )}
                          >
                            {!answer.answered ? (
                              <Minus className="h-3 w-3" aria-hidden />
                            ) : answer.is_correct ? (
                              <Check className="h-3 w-3" aria-hidden />
                            ) : (
                              <X className="h-3 w-3" aria-hidden />
                            )}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
