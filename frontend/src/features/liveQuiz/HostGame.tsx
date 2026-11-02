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

import { useEffect, useRef, useState } from "react";
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
  RestChips,
  TeamColumns,
  TimerBar,
  TrophyHeading,
  teamRows,
} from "./game";
import type { LiveParticipant } from "./api";
import { useGameSounds } from "./sounds";
import { AvatarDisc } from "./avatars";
import { useLiveQuiz, useSecondsLeft, type LiveQuizRoom } from "./useLiveQuiz";
import { ConnectionBanner } from "./ui";

type Actions = ReturnType<typeof useLiveQuiz>["actions"];

const JUST_JOINED_MS = 5000;

/** The newest arrival's id, for a few seconds after they arrive. */
function useJustJoined(newest: number | null): number | null {
  const [fresh, setFresh] = useState<number | null>(null);
  const highest = useRef(0);

  useEffect(() => {
    if (newest === null || newest <= highest.current) return;
    highest.current = newest;
    setFresh(newest);
    const id = setTimeout(() => setFresh(null), JUST_JOINED_MS);
    return () => clearTimeout(id);
  }, [newest]);

  return fresh;
}

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
  // Ids rise as students join, so the newest arrival is the one to look for.
  const newestFirst = [...playing].sort((a, b) => b.id - a.id);
  const justJoined = useJustJoined(newestFirst[0]?.id ?? null);
  const teamCount = room.config.teams ?? 0;
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
        <div className="mx-auto flex w-full max-w-[1360px] flex-1 flex-col gap-5 px-4 pb-10 pt-2 sm:px-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-stretch lg:gap-7">
            <div className="rounded-3xl bg-white px-6 py-5 text-[#120d26] sm:px-8 lg:w-[620px] lg:shrink-0">
              <p className="text-sm font-bold uppercase tracking-[0.12em] text-slate-600">
                Join at <span className="text-violet-700">mastersat.uz/live</span>
              </p>
              <p className="mt-1.5 font-mono text-5xl font-extrabold leading-none tracking-[0.14em] sm:text-8xl">{room.joinCode}</p>
            </div>
            <div className="flex flex-1 flex-col justify-center gap-4">
              <div className="flex items-center gap-3.5">
                <span className="font-mono text-[64px] font-extrabold leading-none tabular-nums">{playing.length}</span>
                <span className="text-base leading-snug text-white/70">
                  {playing.length === 1 ? "player" : "players"}
                  <br />
                  in the room
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  disabled={playing.length === 0}
                  onClick={actions.startGame}
                  className="inline-flex h-[60px] items-center gap-2 rounded-[14px] bg-white px-6 text-xl font-extrabold text-violet-700 shadow-[inset_0_-4px_0_rgba(109,40,217,0.16)] transition hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0"
                >
                  <Rocket className="h-5 w-5" aria-hidden />
                  {playing.length === 0 ? "Waiting for players…" : "Start"}
                </button>
                <span className="text-sm text-white/70">{settingsLine(room)}</span>
              </div>
            </div>
          </div>

          {teamCount > 0 ? (
            <TeamColumns
              participants={playing}
              teams={teamCount}
              onMove={(p) => actions.moveTeam(p.id, ((p.team ?? 0) + 1) % teamCount)}
              onRemove={setRemoving}
            />
          ) : (
            <>
              <h2 className="mt-1 text-[13px] font-bold uppercase tracking-[0.14em] text-white/70">
                In the room · newest first
              </h2>
              {playing.length === 0 && <p className="py-8 text-center text-white/70">Names appear here as students join.</p>}
              <ul className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {newestFirst.map((person, i) => {
                  const fresh = person.id === justJoined;
                  return (
                    <li
                      key={person.id}
                      className={
                        "relative flex min-w-0 flex-col items-center gap-2.5 rounded-[20px] px-2.5 pb-3.5 pt-[18px] " +
                        (fresh
                          ? "border-2 border-[#a78bfa] shadow-[0_0_0_4px_rgba(167,139,250,0.22)]"
                          : "border border-white/10 bg-white/[0.07]")
                      }
                      style={{ opacity: person.present ? 1 : 0.5 }}
                    >
                      {fresh && (
                        <span className="absolute left-2.5 top-2.5 rounded-full bg-[#a78bfa] px-[9px] py-[3px] text-[11px] font-extrabold text-[#120d26]">
                          Just joined
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setRemoving(person)}
                        aria-label={`Remove ${person.display_name}`}
                        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.08] text-white/70 hover:bg-white/15 hover:text-white"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <AvatarDisc avatar={person.avatar} name={person.display_name} size={112} colorIndex={i} />
                      <p className="max-w-full truncate text-[15px] font-bold">{person.display_name}</p>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
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
          <QuestionCard prompt={question.prompt} questionPrompt={question.question_prompt} image={question.question_image} large />
          {question.choices.length > 0 && (
            <AnswerTiles choices={question.choices} optionImages={question.option_images} large />
          )}
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
          {question && (
            <QuestionCard prompt={question.prompt} questionPrompt={question.question_prompt} image={question.question_image} />
          )}
          {question && question.choices.length > 0 && (
            <AnswerTiles
              choices={question.choices}
              optionImages={question.option_images}
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
        <div className="relative mx-auto flex w-full max-w-[1360px] flex-1 flex-col gap-5 px-4 pb-8 pt-2 sm:px-6">
          <Confetti />
          <TrophyHeading
            title="Game over"
            subtitle={[
              `${playing.length} players`,
              room.teams.length > 0 ? `${room.teams.length} teams` : null,
              `${room.questionTotal} questions`,
            ]
              .filter(Boolean)
              .join(" · ")}
          />
          {room.teams.length > 0 ? (
            <div className="grid flex-1 gap-5 lg:grid-cols-2 lg:gap-7">
              <PodiumPanel title="Teams">
                <Podium rows={teamRows(room.teams)} size="panel" />
              </PodiumPanel>
              <PodiumPanel title="Top players">
                <Podium rows={room.leaderboard} size="panel" />
              </PodiumPanel>
            </div>
          ) : (
            room.leaderboard.length > 0 && (
              <div className="flex flex-1 items-end justify-center">
                <Podium rows={room.leaderboard} size="stage" />
              </div>
            )
          )}
          <RestChips rows={room.leaderboard.slice(3)} />
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => router.push(`/teacher/live/${room.sessionId}/results`)}
              className="h-[52px] rounded-[14px] bg-white px-6 font-extrabold text-violet-700 shadow-[inset_0_-4px_0_rgba(109,40,217,0.16)]"
            >
              Open the report
            </button>
            <button
              type="button"
              onClick={() => router.push("/teacher/live")}
              className="h-[52px] rounded-[14px] border border-white/20 bg-white/[0.08] px-6 font-bold text-white hover:bg-white/15"
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

function PodiumPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <GamePanel className="flex min-w-0 flex-col gap-3.5 overflow-hidden px-4 pt-[22px] sm:px-7">
      <h2 className="text-center text-[13px] font-bold uppercase tracking-[0.14em] text-white/70">{title}</h2>
      <div className="flex flex-1 items-end justify-center">{children}</div>
    </GamePanel>
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
