"use client";

/**
 * Where a student gets into a game: type the code, or tap one already running in their class.
 *
 * The code is only ever sent here, over HTTPS, and exchanged for a session id. The socket
 * never carries it, so it stays out of URLs and out of the browser's history.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Radio } from "lucide-react";

import { Button, Card, EmptyState, Field, Input } from "@/features/classroom/ui";
import { normalizeApiError } from "@/lib/apiError";

import { liveQuizApi } from "./api";

const CODE_LENGTH = 6;

export function JoinLiveQuiz() {
  const router = useRouter();
  const [code, setCode] = useState("");

  const running = useQuery({
    queryKey: ["livequiz", "mine"],
    queryFn: () => liveQuizApi.mine(),
    refetchInterval: 15_000,
  });

  const join = useMutation({
    mutationFn: (value: string) => liveQuizApi.join(value),
    onSuccess: ({ session }) => router.push(`/live/${session.id}`),
  });

  return (
    <div className="mx-auto w-full max-w-md space-y-5 px-4 py-8">
      <div className="text-center">
        <h1 className="text-xl font-bold">Live quiz</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter the code your teacher is showing.
        </p>
      </div>

      <Card className="space-y-4">
        <Field label="Game code">
          <Input
            value={code}
            // Uppercased as it is typed, because the code on the board is uppercase and
            // nobody should have to think about it.
            onChange={(event) =>
              setCode(
                event.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, "")
                  .slice(0, CODE_LENGTH),
              )
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" && code.length === CODE_LENGTH) join.mutate(code);
            }}
            placeholder="ABC234"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            className="text-center font-mono text-2xl tracking-[0.3em]"
          />
        </Field>

        {join.isError && (
          <p className="text-sm text-rose-600 dark:text-rose-400">
            {normalizeApiError(join.error).message}
          </p>
        )}

        <Button
          block
          size="lg"
          loading={join.isPending}
          disabled={code.length !== CODE_LENGTH}
          onClick={() => join.mutate(code)}
        >
          Join
        </Button>
      </Card>

      {running.data && running.data.length > 0 && (
        <Card>
          <p className="mb-3 text-sm font-semibold">Running in your classes</p>
          <ul className="space-y-2">
            {running.data.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/live/${session.id}`)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5 text-left transition-colors hover:bg-border"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{session.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {session.classroom_name}
                    </span>
                  </span>
                  <Radio className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {running.data && running.data.length === 0 && (
        <EmptyState
          icon={Radio}
          title="Nothing running right now"
          description="When your teacher starts a live quiz, it will appear here."
        />
      )}
    </div>
  );
}
