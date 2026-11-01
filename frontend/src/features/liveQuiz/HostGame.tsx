"use client";

/**
 * The host's side of a live quiz.
 *
 * The lobby, the countdown and the podium are full-screen — they are what goes on the
 * projector. In between it depends on the mode: a student-paced game hands over to the live
 * dashboard (the teacher's laptop: it names who is getting what wrong), and a teacher-paced
 * game stays on the projector with the question, the tiles and the host's controls.
 *
 * Every control sends a command and waits for the server's answer; none of them changes what
 * is on screen by itself, so the projector and thirty phones never disagree.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, Pause, Play, Rocket, SkipForward, Square, Users, X } from "lucide-react";

import { HostDashboard } from "./HostDashboard";
import {
  AnswerTiles,
  CenterMessage,
  Confetti,
  FinalStandings,
  GameCanvas,
  GameConfirm,
  GamePanel,
  GameTopBar,
  Podium,
  QuestionCard,
  TimerBar,
  TrophyHeading,
} from "./game";
import type { LiveParticipant } from "./api";
import { useGameSounds } from "./sounds";
import { PlayerAvatar } from "./avatars";
import { useLiveQuiz, useSecondsLeft, type LiveQuizRoom } from "./useLiveQuiz";
import { ConnectionBanner } from "./ui";

type Actions = ReturnType<typeof useLiveQuiz>["actions"];

export function HostGame({ sessionId }: { sessionId: number }) {
  const { room, actions } = useLiveQuiz(sessionId);
  const paced = room.mode === "student_paced";

  if (paced && (room.status === "QUESTION_ACTIVE" || room.status === "PAUSED")) {
    return <HostDashboard room={room} actions={actions} />;
  }
  return <HostScreen room={room} actions={actions} />;
}

function settingsLine(room: LiveQuizRoom): string {
  const c = room.config;
  const parts = [
    room.mode === "student_paced" ? "Student-paced" : "Teacher-paced",
    c.question_seconds ? `${c.question_seconds}s per question` : "no timer",
  ];
  if (room.mode === "student_paced" && c.powerups) parts.push("power-ups on");
  if (c.show_answers) parts.push("answers shown");
  if (!c.show_leaderboard_between) parts.push("no leaderboard");
  return parts.join(" · ");
}

function HostScreen({ room, actions }: { room: LiveQuizRoom; actions: Actions }) {
  const router = useRouter();
  const sounds = useGameSounds();
  const secondsLeft = useSecondsLeft(room.endsAt);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [removing, setRemoving] = useState<LiveParticipant | null>(null);

  const playing = room.participants.filter((p) => p.status === "JOINED");
  const isLast = room.currentIndex + 1 >= room.questionTotal;
  const question = room.question;
  const inGame = !room.finished && !["LOBBY", "CONNECTING", "TERMINATED"].includes(room.status);

  useEffect(() => {
    if (room.status === "STARTING") sounds.play("start");
    if (room.status === "FINISHED") sounds.play("finish");
    // Only on the change of status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.status]);

  return (
    <GameCanvas>
      <GameTopBar
        index={inGame && question ? question.index : undefined}
        total={inGame ? room.questionTotal : undefined}
        muted={sounds.muted}
        onToggleMute={sounds.toggle}
      >
        <div className="flex w-full items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/teacher/live")}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-white/70 hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Live quizzes
          </button>
          {room.status === "QUESTION_ACTIVE" && question && (
            <TimerBar secondsLeft={secondsLeft} totalSeconds={question.time_limit_seconds} />
          )}
          <span className="ml-auto inline-flex items-center gap-1.5 text-sm text-white/80">
            <Users className="h-4 w-4" aria-hidden /> {playing.length}
          </span>
          {inGame && (
            <>
              {room.status === "PAUSED" ? (
                <HostButton icon={Play} onClick={actions.resume}>Resume</HostButton>
              ) : (
                <HostButton icon={Pause} onClick={actions.pause}>Pause</HostButton>
              )}
              <HostButton icon={Square} tone="danger" onClick={() => setConfirmEnd(true)}>End</HostButton>
            </>
          )}
        </div>
      </GameTopBar>

      {room.connection !== "open" && (
        <div className="mx-auto w-full max-w-xl px-4">
          <ConnectionBanner connection={room.connection} refusedReason={room.refusedReason} />
        </div>
      )}

      {room.status === "CONNECTING" && room.connection !== "refused" && <CenterMessage title="Opening the room…" />}

      {room.status === "LOBBY" && (
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center gap-8 px-4 pb-10 pt-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white px-6 py-6 text-center text-slate-900 shadow-2xl sm:py-8">
            <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">
              Join at <span className="text-violet-700">mastersat.uz/live</span>
            </p>
            <p className="mt-2 font-mono text-6xl font-black tracking-[0.18em] sm:text-8xl">{room.joinCode}</p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4">
            <span className="rounded-full bg-white/10 px-4 py-2 text-lg font-bold">
              {playing.length} {playing.length === 1 ? "player" : "players"}
            </span>
            <button
              type="button"
              disabled={playing.length === 0}
              onClick={actions.startGame}
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-8 py-3.5 text-lg font-extrabold text-violet-700 shadow-[inset_0_-5px_0_rgba(0,0,0,0.15)] transition hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0"
            >
              <Rocket className="h-5 w-5" aria-hidden />
              {playing.length === 0 ? "Waiting for players…" : "Start"}
            </button>
          </div>
          <p className="text-sm text-white/60">{settingsLine(room)}</p>

          <div className="flex w-full flex-wrap justify-center gap-2.5">
            {playing.length === 0 && (
              <p className="py-8 text-white/60">Names appear here as students join.</p>
            )}
            {playing.map((person, i) => (
              <span
                key={person.id}
                className="group inline-flex items-center gap-2 rounded-full bg-white/10 py-1.5 pl-1.5 pr-2 text-sm font-semibold"
                style={{ opacity: person.present ? 1 : 0.5 }}
              >
                <PlayerAvatar avatar={person.avatar} name={person.display_name} size={30} colorIndex={i} />
                {person.display_name}
                <button
                  type="button"
                  onClick={() => setRemoving(person)}
                  aria-label={`Remove ${person.display_name}`}
                  className="rounded-full p-0.5 text-white/50 hover:bg-white/15 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {room.status === "STARTING" && (
        <CenterMessage title="Get ready…" icon={<Rocket className="h-16 w-16 text-amber-300" aria-hidden />} />
      )}

      {room.status === "PAUSED" && (
        <CenterMessage
          title="Paused"
          subtitle="The clock is stopped. Resuming gives back the time this took."
          icon={<Pause className="h-16 w-16 text-white/80" aria-hidden />}
        />
      )}

      {room.status === "QUESTION_ACTIVE" && question && (
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 pb-8 pt-2 sm:px-6">
          <QuestionCard prompt={question.prompt} questionPrompt={question.question_prompt} large />
          {question.choices.length > 0 && <AnswerTiles choices={question.choices} large />}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-lg">
              <span className="font-mono text-3xl font-black tabular-nums">{room.tally?.answered ?? 0}</span>
              <span className="text-white/70"> of {playing.length} answered</span>
            </p>
            <HostButton icon={SkipForward} onClick={actions.endQuestion}>Skip to the answer</HostButton>
          </div>
        </div>
      )}

      {room.status === "QUESTION_RESULTS" && room.outcome && (
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 pb-8 pt-2 sm:px-6">
          {question && <QuestionCard prompt={question.prompt} questionPrompt={question.question_prompt} />}
          {question && question.choices.length > 0 && (
            <AnswerTiles
              choices={question.choices}
              correctId={String(room.outcome.correct_answer ?? "")}
              counts={room.outcome.tally.by_choice}
              large
            />
          )}
          <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
            {room.config.show_leaderboard_between !== false && room.leaderboard.length > 0 ? (
              <GamePanel className="p-4">
                <p className="mb-3 text-sm font-semibold text-white/80">Standings</p>
                <FinalStandings rows={room.leaderboard} limit={5} />
              </GamePanel>
            ) : (
              <div />
            )}
            <div className="flex items-end">
              <button
                type="button"
                onClick={actions.nextQuestion}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-8 py-4 text-lg font-extrabold text-violet-700 shadow-[inset_0_-5px_0_rgba(0,0,0,0.15)] transition hover:-translate-y-0.5 lg:w-auto"
              >
                {isLast ? "Finish and show the podium" : "Next question"}
                <ChevronRight className="h-5 w-5" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      )}

      {room.finished && (
        <div className="relative mx-auto w-full max-w-4xl flex-1 space-y-8 px-4 pb-12 pt-4">
          <Confetti />
          <TrophyHeading
            title="Game over"
            subtitle={`${playing.length} players · ${room.questionTotal} questions`}
          />
          {room.leaderboard.length > 0 && <Podium rows={room.leaderboard} />}
          {room.leaderboard.length > 3 && (
            <GamePanel className="p-4">
              <FinalStandings rows={room.leaderboard.slice(3)} limit={20} />
            </GamePanel>
          )}
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => router.push(`/teacher/live/${room.sessionId}/results`)}
              className="rounded-2xl bg-white px-6 py-3 font-extrabold text-violet-700"
            >
              Open the report
            </button>
            <button
              type="button"
              onClick={() => router.push("/teacher/live")}
              className="rounded-2xl bg-white/10 px-6 py-3 font-bold text-white hover:bg-white/20"
            >
              Back to live quizzes
            </button>
          </div>
        </div>
      )}

      {room.status === "TERMINATED" && (
        <CenterMessage title="This game was stopped">
          <button
            type="button"
            onClick={() => router.push("/teacher/live")}
            className="mt-6 rounded-2xl bg-white px-6 py-3 font-extrabold text-violet-700"
          >
            Back to live quizzes
          </button>
        </CenterMessage>
      )}

      <GameConfirm
        open={confirmEnd}
        title="End the game now?"
        description="The class sees the podium straight away. Any question still open is closed and cannot be reopened."
        confirmLabel="End the game"
        onCancel={() => setConfirmEnd(false)}
        onConfirm={() => {
          actions.endGame();
          setConfirmEnd(false);
        }}
      />
      <GameConfirm
        open={removing !== null}
        title={`Remove ${removing?.display_name ?? "this student"}?`}
        description="They leave the room and cannot rejoin this game."
        confirmLabel="Remove"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) actions.removePlayer(removing.id);
          setRemoving(null);
        }}
      />
    </GameCanvas>
  );
}

function HostButton({
  icon: Icon,
  onClick,
  tone,
  children,
}: {
  icon: React.ElementType;
  onClick: () => void;
  tone?: "danger";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        tone === "danger"
          ? "inline-flex items-center gap-1.5 rounded-full bg-rose-500/90 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-rose-500"
          : "inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-white/20"
      }
    >
      <Icon className="h-4 w-4" aria-hidden />
      {children}
    </button>
  );
}
