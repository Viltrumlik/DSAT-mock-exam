"use client";

/**
 * Where a teacher starts a live quiz and picks up one already running.
 *
 * Three ways to run it, as cards: student-paced (each student at their own speed, with
 * instant feedback and power-ups — the default), teacher-paced (one question at a time for
 * the whole class), and a test (student-paced with no clock, no leaderboard and nothing
 * revealed until the end). The settings below the cards are the same knobs every way; the
 * cards are only presets for them.
 *
 * The sets are the vocabulary bank's own — the same word sets a teacher already assigns as
 * vocabulary homework. A student's private custom set is never offered: it is theirs to
 * study, not something to put on the board.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Gauge, Radio, Users } from "lucide-react";

import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Select,
} from "@/features/classroom/ui";
import { useClassrooms } from "@/features/classroom/hooks";
import { normalizeApiError } from "@/lib/apiError";
import { cn } from "@/lib/cn";

import { liveQuizApi, type LiveQuizConfig } from "./api";
import { StatusPill } from "./ui";

type Preset = "student" | "teacher" | "test";

const SPEED_BONUS = 0.6667;

const PRESETS: Record<Preset, { title: string; blurb: string; icon: React.ElementType; config: Partial<LiveQuizConfig> }> = {
  student: {
    title: "Student-paced",
    blurb: "Everyone starts together, then each student answers at their own speed, sees right away how they did, and earns power-ups.",
    icon: Users,
    config: {
      mode: "student_paced",
      question_seconds: 30,
      speed_bonus_ratio: SPEED_BONUS,
      show_leaderboard_between: true,
      reveal_correctness: true,
      show_answers: true,
      shuffle_questions: true,
      shuffle_answers: true,
      powerups: true,
    },
  },
  teacher: {
    title: "Teacher-paced",
    blurb: "One question at a time for the whole class. You reveal the answer and move everyone on together.",
    icon: Gauge,
    config: {
      mode: "instructor_paced",
      question_seconds: 20,
      speed_bonus_ratio: SPEED_BONUS,
      show_leaderboard_between: true,
      reveal_correctness: true,
      show_answers: true,
      shuffle_questions: false,
      shuffle_answers: false,
      powerups: false,
    },
  },
  test: {
    title: "Test",
    blurb: "Student-paced with no clock, no leaderboard and no answers shown until the end. Accuracy is what counts.",
    icon: ClipboardCheck,
    config: {
      mode: "student_paced",
      question_seconds: 0,
      speed_bonus_ratio: 0,
      show_leaderboard_between: false,
      reveal_correctness: false,
      show_answers: false,
      shuffle_questions: true,
      shuffle_answers: true,
      powerups: false,
    },
  },
};

const SECONDS_CHOICES = [10, 15, 20, 30, 45, 60, 90, 120];

export function HostConsole() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const classrooms = useClassrooms();
  const [classroomId, setClassroomId] = useState<number | null>(null);
  const [setId, setSetId] = useState<number | null>(null);
  const [preset, setPreset] = useState<Preset>("student");
  const [config, setConfig] = useState<Partial<LiveQuizConfig>>(PRESETS.student.config);

  // `classesApi.list()` has already flattened whatever the server sent — a bare array or
  // DRF's `{ results }` — into one envelope, so `items` is the only shape there is. Read it
  // as itself: casting to `unknown` first, as this once did, throws away the type that keeps
  // the two ends agreeing, and the list came back empty however many classes a teacher had.
  const rows = useMemo(() => classrooms.data?.items ?? [], [classrooms.data]);

  const sessions = useQuery({
    queryKey: ["livequiz", "sessions"],
    queryFn: () => liveQuizApi.listSessions({ live: true }),
    refetchInterval: 20_000,
  });

  const options = useQuery({
    queryKey: ["livequiz", "options", classroomId],
    queryFn: () => liveQuizApi.options(classroomId as number),
    enabled: !!classroomId,
  });

  const create = useMutation({
    mutationFn: () =>
      liveQuizApi.createSession({
        classroom_id: classroomId as number,
        vocab_set_id: setId as number,
        config,
      }),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ["livequiz", "sessions"] });
      router.push(`/teacher/live/${session.id}`);
    },
  });

  const paced = config.mode === "student_paced";
  const set = <K extends keyof LiveQuizConfig>(key: K, value: LiveQuizConfig[K]) =>
    setConfig((prev) => ({ ...prev, [key]: value }));

  const choosePreset = (next: Preset) => {
    setPreset(next);
    setConfig(PRESETS[next].config);
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6">
      <div>
        <h1 className="text-xl font-bold">Live quiz</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Put a word set on the board and let the class play it together.
        </p>
      </div>

      {sessions.data && sessions.data.length > 0 && (
        <Card>
          <p className="mb-3 text-sm font-semibold">Running now</p>
          <ul className="space-y-2">
            {sessions.data.map((session) => (
              <li
                key={session.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{session.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {session.classroom_name} · {session.counts?.participants ?? 0} joined ·{" "}
                    {session.config?.mode === "student_paced" ? "student-paced" : "teacher-paced"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status={session.status} />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => router.push(`/teacher/live/${session.id}`)}
                  >
                    Open
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="space-y-5">
        <p className="text-sm font-semibold">Start a new one</p>

        {classrooms.isLoading && <LoadingState label="Loading your classes…" />}
        {classrooms.isError && (
          <ErrorState
            message="Your classes could not be loaded."
            onRetry={() => classrooms.refetch()}
          />
        )}

        {!classrooms.isLoading && !classrooms.isError && rows.length === 0 && (
          <EmptyState
            icon={Radio}
            title="No classes yet"
            description="A live quiz is played by one class, so you need a class first."
          />
        )}

        {rows.length > 0 && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Class">
                <Select
                  value={classroomId ?? ""}
                  onChange={(event) => {
                    setClassroomId(Number(event.target.value) || null);
                    setSetId(null);
                  }}
                >
                  <option value="">Choose a class…</option>
                  {rows.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </Select>
              </Field>

              {options.data && options.data.vocab_sets.length > 0 ? (
                <Field label="Word set">
                  <Select
                    value={setId ?? ""}
                    onChange={(event) => setSetId(Number(event.target.value) || null)}
                  >
                    <option value="">Choose a word set…</option>
                    {options.data.vocab_sets.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.section ? `${row.section} — ` : ""}
                        {row.title} · {row.word_count} words
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <div />
              )}
            </div>

            {classroomId && options.isLoading && <LoadingState label="Loading word sets…" />}
            {classroomId && options.isError && (
              <ErrorState
                message="The word sets for this class could not be loaded."
                onRetry={() => options.refetch()}
              />
            )}
            {options.data && options.data.vocab_sets.length === 0 && (
              <EmptyState
                icon={Radio}
                title="Nothing to play yet"
                description="A live quiz needs a word set with at least four words, so every question can have four options."
              />
            )}

            <div>
              <p className="mb-2 text-sm font-medium">How to play</p>
              <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="How to play">
                {(Object.keys(PRESETS) as Preset[]).map((key) => {
                  const item = PRESETS[key];
                  const Icon = item.icon;
                  const chosen = preset === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={chosen}
                      onClick={() => choosePreset(key)}
                      className={cn(
                        "rounded-2xl border p-4 text-left transition",
                        chosen
                          ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                          : "border-border hover:border-primary/40 hover:bg-surface-2",
                      )}
                    >
                      <span className="flex items-center gap-2 font-semibold">
                        <Icon className={cn("h-5 w-5", chosen ? "text-primary" : "text-muted-foreground")} aria-hidden />
                        {item.title}
                      </span>
                      <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">{item.blurb}</span>
                      {key === "student" && (
                        <span className="mt-2 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                          Recommended
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Time per question">
                <Select
                  value={config.question_seconds ?? 30}
                  onChange={(event) => set("question_seconds", Number(event.target.value))}
                >
                  {paced && <option value={0}>No timer</option>}
                  {SECONDS_CHOICES.map((value) => (
                    <option key={value} value={value}>
                      {value} seconds
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Scoring">
                <Select
                  value={(config.speed_bonus_ratio ?? 0) > 0 && (config.question_seconds ?? 0) > 0 ? "speed" : "flat"}
                  disabled={(config.question_seconds ?? 0) === 0}
                  onChange={(event) => set("speed_bonus_ratio", event.target.value === "speed" ? SPEED_BONUS : 0)}
                >
                  <option value="speed">Faster right answers score more (600–1000)</option>
                  <option value="flat">Every right answer scores 600</option>
                </Select>
              </Field>
            </div>

            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Toggle
                label="Show the right answer after each question"
                checked={Boolean(config.show_answers)}
                onChange={(v) => setConfig((prev) => ({ ...prev, show_answers: v, reveal_correctness: v ? true : prev.reveal_correctness }))}
              />
              <Toggle
                label="Tell students if they were right"
                checked={config.reveal_correctness !== false}
                onChange={(v) => setConfig((prev) => ({ ...prev, reveal_correctness: v, show_answers: v ? prev.show_answers : false, show_leaderboard_between: v ? prev.show_leaderboard_between : false }))}
              />
              <Toggle
                label="Show the leaderboard during the game"
                checked={config.show_leaderboard_between !== false}
                onChange={(v) => set("show_leaderboard_between", v)}
              />
              <Toggle
                label={paced ? "Shuffle the questions for each student" : "Shuffle the order of the words"}
                checked={Boolean(config.shuffle_questions)}
                onChange={(v) => set("shuffle_questions", v)}
              />
              {paced && (
                <Toggle
                  label="Shuffle the options for each student"
                  checked={Boolean(config.shuffle_answers)}
                  onChange={(v) => set("shuffle_answers", v)}
                />
              )}
              {paced && (
                <Toggle
                  label="Power-ups (earned with 3 right in a row)"
                  checked={Boolean(config.powerups)}
                  onChange={(v) => set("powerups", v)}
                />
              )}
            </div>

            {create.isError && (
              <p className="text-sm text-rose-600 dark:text-rose-400">
                {normalizeApiError(create.error).message}
              </p>
            )}

            <Button
              block
              size="lg"
              icon={Radio}
              loading={create.isPending}
              disabled={!classroomId || !setId}
              onClick={() => create.mutate()}
            >
              Open the lobby
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-border",
        )}
      >
        <span
          className={cn(
            "absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </button>
    </label>
  );
}
