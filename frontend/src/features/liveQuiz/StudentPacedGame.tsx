"use client";

/**
 * A student's screen in a student-paced game: their own question, their own clock, and
 * straight after each answer a screen telling them how it went — then the next one.
 *
 * The server opens the next question behind the feedback screen (`opensAt`), so the
 * screen simply shows the feedback until that instant and the question after it. A refresh
 * lands on whatever the server says is in front of them now.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Hourglass, Pause, Rocket } from "lucide-react";

import { AnswerInput } from "@/features/assessments/components/QuestionInputs";

import { PlayerSummary } from "./PlayerSummary";
import {
  AnswerTiles,
  CenterMessage,
  FeedbackSplash,
  FinalStandings,
  GameCanvas,
  GamePanel,
  GameTopBar,
  PlayerLobby,
  PowerUpBar,
  QuestionCard,
  TimerBar,
} from "./game";
import { useGameSounds } from "./sounds";
import { POWERUPS, ordinal, seedFor, shuffledChoices } from "./theme";
import { useHasPassed, useSecondsUntil, type LiveQuizRoom, type useLiveQuiz } from "./useLiveQuiz";
import { ConnectionBanner } from "./ui";

type Actions = ReturnType<typeof useLiveQuiz>["actions"];

const FINISH_SPLASH_MS = 3000;

export function StudentPacedGame({ room, actions }: { room: LiveQuizRoom; actions: Actions }) {
  const router = useRouter();
  const sounds = useGameSounds();
  const secondsLeft = useSecondsUntil(room.deadline);
  const opened = useHasPassed(room.opensAt);
  const [picked, setPicked] = useState<string | null>(null);
  const [draft, setDraft] = useState<unknown>(null);

  const question = room.question;
  const feedback = room.feedback;
  const finished = Boolean(room.me?.finished);
  const lastSplashOver = useHasPassed(feedback && finished ? feedback.receivedAt + FINISH_SPLASH_MS : null);

  // A new question clears the last tap.
  useEffect(() => {
    setPicked(null);
    setDraft(null);
  }, [question?.id]);

  // An error (too late, moved on) frees the tiles again rather than leaving them locked.
  useEffect(() => {
    if (room.error) setPicked(null);
  }, [room.error]);

  // Sounds follow the server's verdicts, never the tap.
  const lastFeedback = useRef<number | null>(null);
  useEffect(() => {
    if (!feedback || lastFeedback.current === feedback.receivedAt) return;
    lastFeedback.current = feedback.receivedAt;
    sounds.play(feedback.is_correct ? "correct" : "wrong");
  }, [feedback, sounds]);

  const lastAward = useRef<number | null>(null);
  useEffect(() => {
    if (!room.awarded || lastAward.current === room.awarded.at) return;
    lastAward.current = room.awarded.at;
    sounds.play("powerup");
  }, [room.awarded, sounds]);

  const lastTick = useRef<number | null>(null);
  useEffect(() => {
    if (secondsLeft === null || !opened) return;
    const whole = Math.ceil(secondsLeft);
    if (whole <= 5 && whole > 0 && lastTick.current !== whole) {
      lastTick.current = whole;
      sounds.play("tick");
    }
  }, [secondsLeft, opened, sounds]);

  useEffect(() => {
    if (room.status === "STARTING") sounds.play("start");
    if (room.status === "FINISHED") sounds.play("finish");
    // Only on the change of status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.status]);

  const choices = useMemo(() => {
    if (!question) return [];
    return room.config.shuffle_answers
      ? shuffledChoices(question.choices, seedFor(room.me?.id, question.id))
      : question.choices;
  }, [question, room.config.shuffle_answers, room.me?.id]);

  // The splash stays up for the question it is about, and over the next one until it opens.
  const showSplash =
    feedback !== null &&
    (finished ? !lastSplashOver : feedback.question_id === question?.id || !opened);

  const pick = (choiceId: string) => {
    if (!question || picked) return;
    setPicked(choiceId);
    actions.submitAnswer(question.id, choiceId);
  };

  const exit = () => router.push("/live");
  const blind = room.config.reveal_correctness === false;
  const totalSeconds = question?.time_limit_seconds ?? 0;
  const rank = feedback?.rank ?? null;

  return (
    <GameCanvas>
      <GameTopBar
        index={room.finished ? undefined : question?.index}
        total={room.questionTotal}
        // A room that hides correctness hides the score too — it is the same information.
        score={blind ? undefined : room.me?.score}
        streak={blind ? undefined : room.me?.streak}
        rank={blind ? null : rank}
        muted={sounds.muted}
        onToggleMute={sounds.toggle}
        onExit={exit}
      >
        {room.status === "QUESTION_ACTIVE" && opened && !showSplash && !finished && (
          <TimerBar secondsLeft={secondsLeft} totalSeconds={totalSeconds} frozen={room.frozen} />
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
          subtitle="Answer at your own pace. Faster right answers score more."
          icon={<Rocket className="h-14 w-14 text-amber-300" aria-hidden />}
        />
      )}

      {room.status === "PAUSED" && (
        <CenterMessage
          title="Paused"
          subtitle="Your teacher paused the game. Your clock is stopped too."
          icon={<Pause className="h-14 w-14 text-white/80" aria-hidden />}
        />
      )}

      {room.status === "QUESTION_ACTIVE" && showSplash && feedback && (
        <div className="flex flex-1 items-center justify-center px-4 py-8">
          <FeedbackSplash feedback={feedback} opensAt={finished ? null : room.opensAt} />
        </div>
      )}

      {room.status === "QUESTION_ACTIVE" && finished && !showSplash && (
        <div className="mx-auto w-full max-w-xl space-y-5 px-4 py-8">
          <CenterMessage
            title="You finished!"
            subtitle="Waiting for your teacher to end the game. Standings are still moving."
          />
          {room.config.show_leaderboard_between !== false && (
            <GamePanel className="p-4">
              <FinalStandings rows={room.leaderboard} highlightUserId={room.me?.user_id ?? null} limit={10} />
            </GamePanel>
          )}
        </div>
      )}

      {room.status === "QUESTION_ACTIVE" && question && opened && !showSplash && !finished && (
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 pb-8 pt-2 sm:px-6">
          <QuestionCard prompt={question.prompt} questionPrompt={question.question_prompt} />

          {question.question_type === "multiple_choice" && choices.length > 0 ? (
            <AnswerTiles
              choices={choices}
              onPick={pick}
              picked={picked}
              hidden={room.hidden}
              disabled={picked !== null}
            />
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
              <button
                type="button"
                disabled={draft === null || draft === "" || picked !== null}
                onClick={() => {
                  setPicked("typed");
                  actions.submitAnswer(question.id, draft);
                }}
                className="w-full rounded-xl bg-white py-3 font-bold text-violet-700 disabled:opacity-50"
              >
                Submit
              </button>
            </GamePanel>
          )}

          {room.config.powerups && (
            <PowerUpBar
              inventory={room.inventory}
              armed={room.armed}
              onUse={actions.usePowerUp}
              disabled={picked !== null}
            />
          )}

          {room.error && (
            <p className="text-center text-sm font-semibold text-rose-200">{room.error.detail}</p>
          )}
          {room.awarded && Date.now() - room.awarded.at < 4000 && (
            <p className="text-center text-sm text-white/70">
              New power-up: {POWERUPS[room.awarded.key].label} — {POWERUPS[room.awarded.key].help}
            </p>
          )}
          {rank !== null && (
            <p className="text-center text-xs text-white/50 sm:hidden">You are {ordinal(rank)}</p>
          )}
        </div>
      )}

      {room.finished && (
        <PlayerSummary
          sessionId={room.sessionId}
          me={room.me}
          leaderboard={room.leaderboard}
          questionTotal={room.questionTotal}
          gems={room.gems}
        />
      )}

      {room.removed && (
        <CenterMessage
          title="You are no longer in this game"
          subtitle="Your teacher removed you from the room. Ask them if this was a mistake."
        />
      )}

      {room.status === "TERMINATED" && !room.removed && (
        <CenterMessage title="The game was stopped" subtitle="Your teacher ended this session." />
      )}
    </GameCanvas>
  );
}
