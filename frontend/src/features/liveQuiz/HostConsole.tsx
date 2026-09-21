"use client";

/**
 * Where a teacher starts a live quiz and picks up one already running.
 *
 * The set list comes from the same rules the homework builder uses — active, this class's
 * subject, this class's level — so a teacher is offered the same content in both places.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Radio } from "lucide-react";

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

import { liveQuizApi, type LiveQuizConfig } from "./api";
import { StatusPill } from "./ui";

const SECONDS_CHOICES = [10, 15, 20, 30, 45, 60, 90];

export function HostConsole() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const classrooms = useClassrooms();
  const [classroomId, setClassroomId] = useState<number | null>(null);
  const [setId, setSetId] = useState<number | null>(null);
  const [config, setConfig] = useState<Partial<LiveQuizConfig>>({
    question_seconds: 20,
    speed_bonus_ratio: 0.5,
    show_leaderboard_between: true,
    shuffle_questions: false,
  });

  const rows = useMemo(() => {
    const raw = classrooms.data as unknown;
    if (Array.isArray(raw)) return raw as Array<{ id: number; name: string }>;
    const results = (raw as { results?: unknown })?.results;
    return Array.isArray(results) ? (results as Array<{ id: number; name: string }>) : [];
  }, [classrooms.data]);

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
        assessment_set_id: setId as number,
        config,
      }),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ["livequiz", "sessions"] });
      router.push(`/teacher/live/${session.id}`);
    },
  });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      <div>
        <h1 className="text-xl font-bold">Live quiz</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Put a quiz on the board and let the class play it together.
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
                    {session.classroom_name} · {session.counts?.participants ?? 0} joined
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

      <Card className="space-y-4">
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

            {classroomId && options.isLoading && <LoadingState label="Loading quizzes…" />}
            {classroomId && options.isError && (
              <ErrorState
                message="The quizzes for this class could not be loaded."
                onRetry={() => options.refetch()}
              />
            )}

            {options.data && options.data.assessment_sets.length === 0 && (
              <EmptyState
                icon={Radio}
                title="Nothing to play yet"
                description="This class has no question sets at its level and subject."
              />
            )}

            {options.data && options.data.assessment_sets.length > 0 && (
              <Field label="Quiz">
                <Select
                  value={setId ?? ""}
                  onChange={(event) => setSetId(Number(event.target.value) || null)}
                >
                  <option value="">Choose a quiz…</option>
                  {options.data.assessment_sets.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.title} · {row.question_count} questions
                      {row.is_approved ? "" : " (not approved)"}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Seconds per question">
                <Select
                  value={config.question_seconds ?? 20}
                  onChange={(event) =>
                    setConfig((prev) => ({
                      ...prev,
                      question_seconds: Number(event.target.value),
                    }))
                  }
                >
                  {SECONDS_CHOICES.map((value) => (
                    <option key={value} value={value}>
                      {value}s
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Speed bonus">
                <Select
                  value={String(config.speed_bonus_ratio ?? 0.5)}
                  onChange={(event) =>
                    setConfig((prev) => ({
                      ...prev,
                      speed_bonus_ratio: Number(event.target.value),
                    }))
                  }
                >
                  <option value="0">None — every right answer scores the same</option>
                  <option value="0.5">Normal — faster answers score more</option>
                  <option value="1">Big — speed matters a lot</option>
                </Select>
              </Field>
            </div>

            <label className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={config.show_leaderboard_between ?? true}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    show_leaderboard_between: event.target.checked,
                  }))
                }
                className="h-4 w-4 rounded border-border"
              />
              Show the standings after each question
            </label>

            <label className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={config.shuffle_questions ?? false}
                onChange={(event) =>
                  setConfig((prev) => ({ ...prev, shuffle_questions: event.target.checked }))
                }
                className="h-4 w-4 rounded border-border"
              />
              Shuffle the order of the questions
            </label>

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
              Create the room
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}
