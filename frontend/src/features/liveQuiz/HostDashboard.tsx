"use client";

/**
 * The teacher's live dashboard for a student-paced game — on the teacher's laptop, not the
 * projector, because it names who is getting what wrong.
 *
 * Every student's row fills in square by square as they answer: green right, red not this
 * time, amber ran out. Columns are questions in the paper's order, so a column reads the same
 * for everyone however shuffled their own order was. The Questions tab ranks the paper by how
 * the class did, hardest first — what to go over once the game ends.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Flame, Pause, Play, Square, Users, X } from "lucide-react";

import { Button, Card, ConfirmDialog, Pill, StatCard, Tabs } from "@/features/classroom/ui";
import { AssessmentText } from "@/lib/assessmentText";
import { cn } from "@/lib/cn";

import { liveQuizApi, type BoardCell, type LiveParticipant } from "./api";
import { ConnectionBanner } from "./ui";
import type { LiveQuizRoom, useLiveQuiz } from "./useLiveQuiz";

type Actions = ReturnType<typeof useLiveQuiz>["actions"];

function cellClass(cell: BoardCell | undefined): string {
  if (!cell) return "bg-surface-2";
  if (cell.timed_out) return "bg-amber-400";
  return cell.correct ? "bg-emerald-500" : "bg-rose-500";
}

function accuracyOf(cells: BoardCell[]): number | null {
  if (cells.length === 0) return null;
  return Math.round((100 * cells.filter((c) => c.correct).length) / cells.length);
}

export function HostDashboard({ room, actions }: { room: LiveQuizRoom; actions: Actions }) {
  const router = useRouter();
  const [tab, setTab] = useState("players");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [removing, setRemoving] = useState<LiveParticipant | null>(null);

  const total = room.questionTotal;
  const players = useMemo(
    () =>
      room.participants
        .filter((p) => p.status === "JOINED")
        .sort((a, b) => b.score - a.score || a.id - b.id),
    [room.participants],
  );

  const allCells = players.flatMap((p) => room.board[p.id] ?? []);
  const classAccuracy = accuracyOf(allCells);
  const answeredSquares = allCells.length;
  const progress = total > 0 && players.length > 0 ? Math.round((100 * answeredSquares) / (total * players.length)) : 0;
  const finishedCount = players.filter((p) => p.finished).length;
  const present = players.filter((p) => p.present).length;

  // The paper itself, for the Questions tab. The host may read the report mid-game.
  const report = useQuery({
    queryKey: ["livequiz", "results", room.sessionId, "live"],
    queryFn: () => liveQuizApi.results(room.sessionId),
    enabled: tab === "questions",
    refetchInterval: tab === "questions" ? 8_000 : false,
  });

  const questions = useMemo(() => {
    const rows = report.data?.report.questions ?? [];
    return [...rows].sort((a, b) => {
      const accA = a.answered + (a.missed ?? 0) > 0 ? a.correct / (a.answered + (a.missed ?? 0)) : 2;
      const accB = b.answered + (b.missed ?? 0) > 0 ? b.correct / (b.answered + (b.missed ?? 0)) : 2;
      return accA - accB;
    });
  }, [report.data]);

  const paused = room.status === "PAUSED";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6">
      <ConnectionBanner connection={room.connection} refusedReason={room.refusedReason} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">Live game</h1>
            <Pill tone={paused ? "warning" : "success"} dot={!paused}>
              {paused ? "Paused" : "In play"}
            </Pill>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Students move at their own pace. Latecomers can still join with code{" "}
            <span className="font-mono font-bold tracking-widest text-foreground">{room.joinCode}</span>
          </p>
        </div>
        <div className="flex gap-2">
          {paused ? (
            <Button variant="secondary" size="sm" icon={Play} onClick={actions.resume}>
              Resume
            </Button>
          ) : (
            <Button variant="secondary" size="sm" icon={Pause} onClick={actions.pause}>
              Pause
            </Button>
          )}
          <Button variant="danger" size="sm" icon={Square} onClick={() => setConfirmEnd(true)}>
            End game
          </Button>
        </div>
      </div>

      <Card pad="sm" className="space-y-2">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-semibold">Class accuracy</p>
          <p className="font-mono text-2xl font-bold tabular-nums">
            {classAccuracy === null ? "—" : `${classAccuracy}%`}
          </p>
        </div>
        <div className="flex h-3 overflow-hidden rounded-full bg-surface-2">
          {classAccuracy !== null && (
            <>
              <div className="h-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${classAccuracy}%` }} />
              <div className="h-full bg-rose-500/80 transition-[width] duration-500" style={{ width: `${100 - classAccuracy}%` }} />
            </>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Players" value={players.length} sub={`${present} connected`} icon={Users} />
        <StatCard label="Progress" value={`${progress}%`} sub={`${answeredSquares} of ${total * players.length} answers`} />
        <StatCard label="Finished" value={`${finishedCount}/${players.length}`} />
        <StatCard label="Top score" value={(players[0]?.score ?? 0).toLocaleString()} sub={players[0]?.display_name} />
      </div>

      {players.length > 0 && finishedCount === players.length && (
        <Card pad="sm" className="flex flex-wrap items-center justify-between gap-3 bg-emerald-500/10">
          <p className="text-sm font-semibold">Everyone has finished — the podium goes up in a moment.</p>
          <Button size="sm" onClick={actions.endGame}>
            Show the podium
          </Button>
        </Card>
      )}

      <Tabs
        items={[
          { id: "players", label: "Leaderboard", count: players.length },
          { id: "questions", label: "Questions", count: total },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "players" && (
        <Card pad="sm" className="overflow-x-auto">
          {players.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nobody is playing yet.</p>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="w-10 px-2 py-2">#</th>
                  <th className="px-2 py-2">Student</th>
                  <th className="px-2 py-2">Answers</th>
                  <th className="w-20 px-2 py-2 text-right">Accuracy</th>
                  <th className="w-14 px-2 py-2 text-right">Streak</th>
                  <th className="w-24 px-2 py-2 text-right">Score</th>
                  <th className="w-10 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {players.map((player, index) => {
                  const cells = room.board[player.id] ?? [];
                  const byOrder = new Map(cells.map((c) => [c.order, c]));
                  const accuracy = accuracyOf(cells);
                  return (
                    <tr key={player.id} className="border-t border-border">
                      <td className="px-2 py-2.5 font-bold tabular-nums text-muted-foreground">{index + 1}</td>
                      <td className="px-2 py-2.5">
                        <span className="flex items-center gap-2 font-medium">
                          <span
                            className={cn("h-2 w-2 shrink-0 rounded-full", player.present ? "bg-emerald-500" : "bg-slate-300")}
                            title={player.present ? "Connected" : "Not connected"}
                          />
                          <span className="truncate">{player.display_name}</span>
                          {player.finished && <Pill tone="success">done</Pill>}
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex flex-wrap gap-1" aria-label={`${cells.length} of ${total} answered`}>
                          {Array.from({ length: total }, (_, order) => (
                            <span
                              key={order}
                              className={cn("h-3.5 w-3.5 rounded-[4px]", cellClass(byOrder.get(order)))}
                              title={`Question ${order + 1}`}
                            />
                          ))}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                        {accuracy === null ? "—" : `${accuracy}%`}
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        {(player.streak ?? 0) >= 2 ? (
                          <span className="inline-flex items-center gap-0.5 font-semibold text-orange-600">
                            <Flame className="h-3.5 w-3.5" aria-hidden />
                            {player.streak}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{player.streak ?? 0}</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono font-bold tabular-nums">
                        {player.score.toLocaleString()}
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => setRemoving(player)}
                          aria-label={`Remove ${player.display_name}`}
                          className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-600"
                        >
                          <X className="h-4 w-4" aria-hidden />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="mt-3 flex flex-wrap gap-4 px-2 pb-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-[3px] bg-emerald-500" /> right</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-[3px] bg-rose-500" /> not this time</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-[3px] bg-amber-400" /> ran out of time</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-[3px] bg-surface-2 ring-1 ring-border" /> not yet</span>
          </div>
        </Card>
      )}

      {tab === "questions" && (
        <Card pad="sm">
          {report.isLoading && <p className="py-8 text-center text-sm text-muted-foreground">Loading the questions…</p>}
          {report.isError && (
            <p className="py-8 text-center text-sm text-rose-600">The questions could not be loaded just now.</p>
          )}
          <ol className="divide-y divide-border">
            {questions.map((q) => {
              const seen = q.answered + (q.missed ?? 0);
              const pct = seen > 0 ? Math.round((100 * q.correct) / seen) : null;
              const right = (q.choices ?? []).find(
                (c) => c.id.toUpperCase() === String(q.correct_answer ?? "").toUpperCase(),
              );
              return (
                <li key={q.question_id} className="flex items-start gap-3 px-2 py-3">
                  <span className="mt-0.5 w-8 shrink-0 text-xs font-bold text-muted-foreground">Q{q.order + 1}</span>
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-medium">
                      <AssessmentText text={q.prompt} />
                    </div>
                    {right && (
                      <p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-400">
                        <AssessmentText text={right.text} />
                      </p>
                    )}
                  </div>
                  <div className="w-40 shrink-0">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-muted-foreground">{seen} seen</span>
                      <span className="font-mono font-bold tabular-nums">{pct === null ? "—" : `${pct}%`}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className={cn("h-full rounded-full", pct === null ? "" : pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-400" : "bg-rose-500")}
                        style={{ width: `${pct ?? 0}%` }}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
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
        title="End the game now?"
        description={
          finishedCount < players.length
            ? `${players.length - finishedCount} still playing. Their answers so far count; the podium goes up straight away.`
            : "The podium goes up straight away."
        }
        confirmLabel="End the game"
      />
      <ConfirmDialog
        open={removing !== null}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) actions.removePlayer(removing.id);
          setRemoving(null);
        }}
        tone="danger"
        title={`Remove ${removing?.display_name ?? "this student"}?`}
        description="They leave the leaderboard and cannot rejoin this game."
        confirmLabel="Remove"
      />

      <div className="pt-2 text-center">
        <button
          type="button"
          onClick={() => router.push("/teacher/live")}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Back to live quizzes (the game keeps running)
        </button>
      </div>
    </div>
  );
}
