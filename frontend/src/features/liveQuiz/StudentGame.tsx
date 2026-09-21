"use client";

/**
 * What a student sees while the quiz is running.
 *
 * The answer widgets are the ones the assessment runner uses, so a grid-in here behaves
 * exactly as it does in homework — including the deliberately uncontrolled numeric input
 * that stops slow phones dropping characters.
 */

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Trophy, XCircle } from "lucide-react";

import { Button, Card, LoadingState } from "@/features/classroom/ui";
import { AnswerInput } from "@/features/assessments/components/QuestionInputs";
import { AssessmentText } from "@/lib/assessmentText";
import { cn } from "@/lib/cn";

import type { LiveQuestion } from "./api";
import { useLiveQuiz, useSecondsLeft } from "./useLiveQuiz";
import { ConnectionBanner, CountdownBar, LeaderboardList, ScoreCard } from "./ui";

function optionImages(question: LiveQuestion) {
  return {
    A: question.option_a_image,
    B: question.option_b_image,
    C: question.option_c_image,
    D: question.option_d_image,
  };
}

export function StudentGame({ sessionId }: { sessionId: number }) {
  const { room, actions } = useLiveQuiz(sessionId);
  const secondsLeft = useSecondsLeft(room.endsAt);
  const [draft, setDraft] = useState<unknown>(null);

  // A new question clears whatever was typed for the last one.
  useEffect(() => {
    setDraft(null);
  }, [room.question?.id]);

  const locked = room.myAnswer !== null && !room.config.allow_answer_change;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6">
      <ConnectionBanner connection={room.connection} refusedReason={room.refusedReason} />

      {room.status === "CONNECTING" && room.connection !== "refused" && (
        <LoadingState label="Joining the quiz…" />
      )}

      {room.status === "LOBBY" && (
        <Card className="text-center">
          <p className="text-lg font-semibold">You are in.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Waiting for your teacher to start — keep this page open.
          </p>
          <p className="mt-4 text-sm">
            <span className="font-medium">{room.participants.length}</span> in the room
          </p>
        </Card>
      )}

      {room.status === "STARTING" && (
        <Card className="py-12 text-center">
          <Clock className="mx-auto h-10 w-10 text-primary" aria-hidden />
          <p className="mt-3 text-xl font-bold">Get ready…</p>
        </Card>
      )}

      {room.status === "PAUSED" && (
        <Card className="py-10 text-center">
          <p className="text-lg font-semibold">Paused</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Your teacher has paused the quiz. The clock is stopped.
          </p>
        </Card>
      )}

      {room.status === "QUESTION_ACTIVE" && room.question && (
        <>
          <Card pad="sm">
            <CountdownBar
              secondsLeft={secondsLeft}
              total={room.question.time_limit_seconds}
              warning={room.timeWarning}
            />
          </Card>

          <Card>
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Question {room.question.index + 1} of {room.question.total}
            </p>

            {room.question.question_prompt && (
              <div className="mb-3 rounded-xl bg-surface-2 p-3 text-sm">
                <AssessmentText text={room.question.question_prompt} block preserveNewlines />
              </div>
            )}

            <div className="text-base font-medium">
              <AssessmentText text={room.question.prompt} block />
            </div>

            {room.question.question_image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={room.question.question_image}
                alt=""
                className="mt-3 max-h-72 w-auto rounded-xl border border-border"
              />
            )}

            <div className={cn("mt-4", locked && "pointer-events-none opacity-60")}>
              <AnswerInput
                type={room.question.question_type}
                choices={room.question.choices}
                value={draft}
                onChange={setDraft}
                optionImages={optionImages(room.question)}
              />
            </div>

            {!locked && (
              <Button
                block
                size="lg"
                className="mt-4"
                disabled={draft === null || draft === ""}
                onClick={() => room.question && actions.submitAnswer(room.question.id, draft)}
              >
                {room.myAnswer ? "Change my answer" : "Submit"}
              </Button>
            )}

            {room.myAnswer && (
              <p className="mt-3 text-center text-sm text-muted-foreground">
                Answer locked in. Waiting for the others…
              </p>
            )}

            {room.error && (
              <p className="mt-3 text-center text-sm text-rose-600 dark:text-rose-400">
                {room.error.detail}
              </p>
            )}
          </Card>
        </>
      )}

      {room.status === "QUESTION_RESULTS" && room.outcome && (
        <>
          <Card className="text-center">
            {room.myAnswer?.is_correct === true && (
              <>
                <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" aria-hidden />
                <p className="mt-2 text-lg font-bold text-emerald-600 dark:text-emerald-400">
                  Correct
                </p>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums">
                  +{room.myAnswer.points_awarded}
                </p>
              </>
            )}
            {room.myAnswer?.is_correct === false && (
              <>
                <XCircle className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden />
                <p className="mt-2 text-lg font-semibold">Not this time</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  The answer was{" "}
                  <span className="font-semibold text-foreground">
                    {String(room.outcome.correct_answer)}
                  </span>
                </p>
              </>
            )}
            {!room.myAnswer && (
              <>
                <Clock className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden />
                <p className="mt-2 text-lg font-semibold">Time ran out</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  The answer was{" "}
                  <span className="font-semibold text-foreground">
                    {String(room.outcome.correct_answer)}
                  </span>
                </p>
              </>
            )}
            {room.outcome.explanation && (
              <div className="mt-4 rounded-xl bg-surface-2 p-3 text-left text-sm">
                <AssessmentText text={room.outcome.explanation} block preserveNewlines />
              </div>
            )}
          </Card>

          {room.config.show_leaderboard_between && room.leaderboard.length > 0 && (
            <Card>
              <p className="mb-3 text-sm font-semibold">Standings</p>
              <LeaderboardList
                rows={room.leaderboard}
                highlightUserId={room.me?.user_id ?? null}
                limit={10}
              />
            </Card>
          )}
        </>
      )}

      {room.finished && (
        <>
          <Card className="text-center">
            <Trophy className="mx-auto h-12 w-12 text-amber-500" aria-hidden />
            <p className="mt-2 text-xl font-bold">That is the quiz</p>
            {room.me && (
              <div className="mt-4 grid grid-cols-3 gap-2">
                <ScoreCard label="Place" value={room.me.rank ?? "—"} />
                <ScoreCard label="Score" value={room.me.score} />
                <ScoreCard
                  label="Correct"
                  value={`${room.me.correct_count}/${room.questionTotal}`}
                />
              </div>
            )}
          </Card>

          <Card>
            <p className="mb-3 text-sm font-semibold">Final standings</p>
            <LeaderboardList rows={room.leaderboard} highlightUserId={room.me?.user_id ?? null} />
          </Card>
        </>
      )}

      {room.status === "TERMINATED" && (
        <Card className="py-10 text-center">
          <p className="text-lg font-semibold">The quiz was stopped</p>
          <p className="mt-1 text-sm text-muted-foreground">Your teacher ended this session.</p>
        </Card>
      )}
    </div>
  );
}
