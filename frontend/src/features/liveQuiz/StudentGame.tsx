"use client";

/**
 * What a student sees while the quiz is running.
 *
 * One socket, two games. A student-paced room hands over to `StudentPacedGame`; a
 * teacher-paced one is played here — the same question for the whole room, the server's
 * clock, and the answer revealed for everybody at once when the question closes.
 *
 * Questions that are not multiple choice fall back to the assessment runner's own widgets,
 * so a grid-in behaves exactly as it does in homework.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Hourglass, Pause, Rocket } from "lucide-react";

import { AnswerInput } from "@/features/assessments/components/QuestionInputs";

import { PlayerSummary } from "./PlayerSummary";
import { StudentPacedGame } from "./StudentPacedGame";
import {
  AnswerTiles,
  CenterMessage,
  FeedbackSplash,
  FinalStandings,
  GameCanvas,
  GamePanel,
  GameTopBar,
  PlayerLobby,
  QuestionCard,
  TimerBar,
} from "./game";
import { useGameSounds } from "./sounds";
import { useLiveQuiz, useSecondsLeft, type LiveQuizRoom, type OwnFeedback } from "./useLiveQuiz";
import { ConnectionBanner } from "./ui";

export function StudentGame({ sessionId }: { sessionId: number }) {
  const { room, actions } = useLiveQuiz(sessionId);
  if (room.mode === "student_paced") return <StudentPacedGame room={room} actions={actions} />;
  return <TeacherPacedPlayer room={room} actions={actions} />;
}

type Actions = ReturnType<typeof useLiveQuiz>["actions"];

function TeacherPacedPlayer({ room, actions }: { room: LiveQuizRoom; actions: Actions }) {
  const router = useRouter();
  const sounds = useGameSounds();
  const secondsLeft = useSecondsLeft(room.endsAt);
  const [picked, setPicked] = useState<string | null>(null);
  const [draft, setDraft] = useState<unknown>(null);

  const question = room.question;
  const mine = room.leaderboard.find((row) => row.user_id === room.me?.user_id) ?? room.me;
  const place = mine ? room.leaderboard.findIndex((row) => row.id === mine.id) + 1 : 0;
  const canChange = Boolean(room.config.allow_answer_change);
  const locked = room.myAnswer !== null && !canChange;

  // A new question clears whatever was chosen for the last one.
  useEffect(() => {
    setPicked(null);
    setDraft(null);
  }, [question?.id]);

  useEffect(() => {
    if (room.error) setPicked(room.myAnswer ? picked : null);
    // Only when a refusal arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.error]);

  useEffect(() => {
    if (room.status === "QUESTION_RESULTS" && room.outcome) {
      sounds.play(room.myAnswer?.is_correct ? "correct" : "wrong");
    }
    if (room.status === "STARTING") sounds.play("start");
    if (room.status === "FINISHED") sounds.play("finish");
    // Only on the change of status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.status]);

  const pick = (choiceId: string) => {
    if (!question || locked) return;
    setPicked(choiceId);
    actions.submitAnswer(question.id, choiceId);
  };

  // The room-wide reveal, drawn with the same splash a student-paced game uses.
  const reveal: OwnFeedback | null =
    room.status === "QUESTION_RESULTS" && room.outcome && question
      ? {
          question_id: question.id,
          accepted: room.myAnswer !== null,
          response_time_ms: room.myAnswer?.response_time_ms ?? 0,
          timed_out: room.myAnswer === null,
          is_correct: room.myAnswer ? room.myAnswer.is_correct : false,
          points_awarded: room.myAnswer?.points_awarded,
          correct_answer: room.outcome.correct_answer,
          explanation: room.outcome.explanation,
          streak: mine?.streak,
          score: mine?.score,
          rank: room.config.show_leaderboard_between && place > 0 ? place : undefined,
          player_count: room.leaderboard.length || undefined,
          receivedAt: 0,
          question,
        }
      : null;

  return (
    <GameCanvas>
      <GameTopBar
        index={room.finished ? undefined : question?.index}
        total={room.questionTotal}
        score={mine?.score}
        streak={mine?.streak}
        rank={room.config.show_leaderboard_between && place > 0 ? place : null}
        muted={sounds.muted}
        onToggleMute={sounds.toggle}
        onExit={() => router.push("/live")}
      >
        {room.status === "QUESTION_ACTIVE" && question && (
          <TimerBar secondsLeft={secondsLeft} totalSeconds={question.time_limit_seconds} />
        )}
      </GameTopBar>

      {room.connection !== "open" && (
        <div className="mx-auto w-full max-w-xl px-4">
          <ConnectionBanner connection={room.connection} refusedReason={room.refusedReason} />
        </div>
      )}

      {room.status === "CONNECTING" && room.connection !== "refused" && (
        <CenterMessage title="Joining…" icon={<Hourglass className="h-12 w-12 text-white/70" aria-hidden />} />
      )}

      {room.status === "LOBBY" && <PlayerLobby me={room.me} participants={room.participants} />}

      {room.status === "STARTING" && (
        <CenterMessage
          title="Get ready…"
          subtitle="Your teacher moves the class from one question to the next."
          icon={<Rocket className="h-14 w-14 text-amber-300" aria-hidden />}
        />
      )}

      {room.status === "PAUSED" && (
        <CenterMessage
          title="Paused"
          subtitle="Your teacher has paused the quiz. The clock is stopped."
          icon={<Pause className="h-14 w-14 text-white/80" aria-hidden />}
        />
      )}

      {room.status === "QUESTION_ACTIVE" && question && (
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 pb-8 pt-2 sm:px-6">
          <QuestionCard prompt={question.prompt} questionPrompt={question.question_prompt} />

          {question.question_type === "multiple_choice" && question.choices.length > 0 ? (
            <AnswerTiles choices={question.choices} onPick={pick} picked={picked} disabled={locked} />
          ) : (
            <GamePanel className="space-y-3 p-4 text-slate-900">
              <div className="rounded-xl bg-white p-3">
                <AnswerInput
                  type={question.question_type}
                  choices={question.choices}
                  value={draft}
                  onChange={setDraft}
                />
              </div>
              {!locked && (
                <button
                  type="button"
                  disabled={draft === null || draft === ""}
                  onClick={() => actions.submitAnswer(question.id, draft)}
                  className="w-full rounded-xl bg-white py-3 font-bold text-violet-700 disabled:opacity-50"
                >
                  {room.myAnswer ? "Change my answer" : "Submit"}
                </button>
              )}
            </GamePanel>
          )}

          {room.myAnswer && (
            <p className="text-center text-sm font-semibold text-white/80">
              {canChange ? "Answer saved — you can still change it." : "Locked in. Waiting for the others…"}
            </p>
          )}
          {room.error && (
            <p className="text-center text-sm font-semibold text-rose-200">{room.error.detail}</p>
          )}
        </div>
      )}

      {reveal && (
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-5 px-4 py-8">
          <FeedbackSplash feedback={reveal} opensAt={null} />
          {room.config.show_leaderboard_between && room.leaderboard.length > 0 && (
            <GamePanel className="p-4">
              <FinalStandings rows={room.leaderboard} highlightUserId={room.me?.user_id ?? null} limit={5} />
            </GamePanel>
          )}
          <p className="text-center text-xs text-white/50">Your teacher will move on in a moment.</p>
        </div>
      )}

      {room.finished && (
        <PlayerSummary
          sessionId={room.sessionId}
          me={mine ?? null}
          leaderboard={room.leaderboard}
          questionTotal={room.questionTotal}
          gems={room.gems}
        />
      )}

      {room.removed && (
        <CenterMessage
          title="You are no longer in this quiz"
          subtitle="Your teacher removed you from the room. Ask them if this was a mistake."
        />
      )}

      {room.status === "TERMINATED" && !room.removed && (
        <CenterMessage title="The quiz was stopped" subtitle="Your teacher ended this session." />
      )}
    </GameCanvas>
  );
}
