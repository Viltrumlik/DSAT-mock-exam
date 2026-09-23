"use client";

/**
 * The host's screen — usually a projector, with the teacher's laptop driving it.
 *
 * It shows the room what it needs at each moment and gives the teacher the controls. Every
 * control sends a command and waits for the server's answer; none of them changes what is
 * on screen by itself, so the projector and thirty phones never disagree.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Pause, Play, Square, Trophy, Users } from "lucide-react";

import { Button, Card, ConfirmDialog, LoadingState } from "@/features/classroom/ui";
import { AssessmentText } from "@/lib/assessmentText";

import { useLiveQuiz, useSecondsLeft } from "./useLiveQuiz";
import {
  ConnectionBanner,
  CountdownBar,
  JoinCode,
  LeaderboardList,
  LobbyGrid,
  ScoreCard,
  StatusPill,
  TallyBars,
} from "./ui";

export function HostGame({ sessionId }: { sessionId: number }) {
  const router = useRouter();
  const { room, actions } = useLiveQuiz(sessionId);
  const secondsLeft = useSecondsLeft(room.endsAt);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const playing = room.participants.filter((p) => p.status === "JOINED");
  const isLast = room.currentIndex + 1 >= room.questionTotal;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6">
      <ConnectionBanner connection={room.connection} refusedReason={room.refusedReason} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <StatusPill status={room.status === "CONNECTING" ? "LOBBY" : room.status} />
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users className="h-4 w-4" aria-hidden />
            {playing.length}
          </span>
        </div>

        {!room.finished && room.status !== "TERMINATED" && (
          <div className="flex gap-2">
            {room.status === "PAUSED" ? (
              <Button variant="secondary" size="sm" icon={Play} onClick={actions.resume}>
                Resume
              </Button>
            ) : (
              room.status !== "LOBBY" && (
                <Button variant="secondary" size="sm" icon={Pause} onClick={actions.pause}>
                  Pause
                </Button>
              )
            )}
            <Button variant="danger" size="sm" icon={Square} onClick={() => setConfirmEnd(true)}>
              End
            </Button>
          </div>
        )}
      </div>

      {room.status === "CONNECTING" && room.connection !== "refused" && (
        <LoadingState label="Opening the room…" />
      )}

      {room.status === "LOBBY" && (
        <Card pad="lg" className="space-y-6">
          <JoinCode code={room.joinCode} />
          <LobbyGrid participants={room.participants} onRemove={(p) => actions.removePlayer(p.id)} />
          <Button block size="lg" disabled={playing.length === 0} onClick={actions.startGame}>
            {playing.length === 0 ? "Waiting for players…" : `Start with ${playing.length}`}
          </Button>
        </Card>
      )}

      {room.status === "STARTING" && (
        <Card pad="lg" className="py-16 text-center">
          <p className="text-4xl font-bold">Get ready…</p>
        </Card>
      )}

      {room.status === "PAUSED" && (
        <Card pad="lg" className="py-12 text-center">
          <p className="text-2xl font-bold">Paused</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The clock is stopped. Resuming gives back the time this took.
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

          <Card pad="lg">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Question {room.question.index + 1} of {room.question.total}
            </p>
            {room.question.question_prompt && (
              <div className="mb-4 rounded-xl bg-surface-2 p-4">
                <AssessmentText text={room.question.question_prompt} block preserveNewlines />
              </div>
            )}
            <div className="text-xl font-semibold sm:text-2xl">
              <AssessmentText text={room.question.prompt} block />
            </div>

            {room.question.question_image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={room.question.question_image}
                alt=""
                className="mt-4 max-h-80 w-auto rounded-xl border border-border"
              />
            )}

            {room.question.choices.length > 0 && (
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {room.question.choices.map((choice) => (
                  <div
                    key={choice.id}
                    className="flex items-start gap-3 rounded-xl border border-border p-3"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-bold">
                      {choice.id}
                    </span>
                    <div className="min-w-0 pt-0.5 text-sm">
                      <AssessmentText text={choice.text} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card pad="sm" className="flex items-center justify-between gap-4">
            <p className="text-sm">
              <span className="font-mono text-xl font-bold tabular-nums">
                {room.tally?.answered ?? 0}
              </span>
              <span className="text-muted-foreground"> of {playing.length} answered</span>
            </p>
            <Button variant="secondary" size="sm" onClick={actions.endQuestion}>
              Skip to the answer
            </Button>
          </Card>
        </>
      )}

      {room.status === "QUESTION_RESULTS" && room.outcome && (
        <>
          <Card pad="lg">
            <p className="text-sm font-semibold">
              The answer:{" "}
              <span className="text-emerald-600 dark:text-emerald-400">
                {String(room.outcome.correct_answer)}
              </span>
            </p>
            {room.question && room.question.choices.length > 0 && (
              <div className="mt-4">
                <TallyBars
                  byChoice={room.outcome.tally.by_choice}
                  choices={room.question.choices}
                  correctAnswer={room.outcome.correct_answer}
                  answered={room.outcome.tally.answered}
                />
              </div>
            )}
            {room.outcome.explanation && (
              <div className="mt-4 rounded-xl bg-surface-2 p-4 text-sm">
                <AssessmentText text={room.outcome.explanation} block preserveNewlines />
              </div>
            )}
          </Card>

          <Card>
            <p className="mb-3 text-sm font-semibold">Standings</p>
            <LeaderboardList rows={room.leaderboard} limit={10} />
          </Card>

          <Button block size="lg" iconRight={ChevronRight} onClick={actions.nextQuestion}>
            {isLast ? "Finish and show the results" : "Next question"}
          </Button>
        </>
      )}

      {room.finished && (
        <>
          <Card pad="lg" className="text-center">
            <Trophy className="mx-auto h-12 w-12 text-amber-500" aria-hidden />
            <p className="mt-2 text-2xl font-bold">That is the quiz</p>
            <div className="mx-auto mt-5 grid max-w-md grid-cols-3 gap-2">
              <ScoreCard label="Players" value={playing.length} />
              <ScoreCard label="Questions" value={room.questionTotal} />
              <ScoreCard label="Top score" value={room.leaderboard[0]?.score ?? 0} />
            </div>
          </Card>
          <Card>
            <p className="mb-3 text-sm font-semibold">Final standings</p>
            <LeaderboardList rows={room.leaderboard} />
          </Card>

          <Button
            block
            variant="secondary"
            size="lg"
            onClick={() => router.push(`/teacher/live/${sessionId}/results`)}
          >
            See which questions to go over
          </Button>
        </>
      )}

      {room.status === "TERMINATED" && (
        <Card pad="lg" className="py-12 text-center">
          <p className="text-xl font-bold">This quiz was stopped</p>
        </Card>
      )}

      <ConfirmDialog
        open={confirmEnd}
        onCancel={() => setConfirmEnd(false)}
        onConfirm={() => {
          actions.endGame();
          setConfirmEnd(false);
        }}
        tone="danger"
        title="End the quiz now?"
        description="The class sees the final standings straight away. Any question still open is closed and cannot be reopened."
        confirmLabel="End the quiz"
      />
    </div>
  );
}
