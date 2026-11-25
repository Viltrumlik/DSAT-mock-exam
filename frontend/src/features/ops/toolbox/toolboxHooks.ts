"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { toolboxApi, type MessageQuery } from "./toolboxApi";

/**
 * React Query over toolboxApi. Every key sits under `["staging"]`; a tool that changes something refreshes the action
 * log and the people it touched. No mutation is retried: each one changes the copy.
 */

/** How often the panel asks the time machine whether it has finished. */
export const TIME_POLL_MS = 3_000;
/** How long the panel waits for the time machine before it says the machine may be stopped. */
export const TIME_WAIT_LIMIT_MS = 10 * 60_000;
/** Wait for whatever the time machine is doing, not for one particular request (someone else's). */
export const ANY_REQUEST = "*";

export const toolboxKeys = {
  all: ["staging"] as const,
  status: ["staging", "status"] as const,
  time: ["staging", "time"] as const,
  actions: ["staging", "actions"] as const,
  groups: ["staging", "groups"] as const,
  people: (q: string) => ["staging", "people", q] as const,
  tasks: ["staging", "tasks"] as const,
  messages: (query: MessageQuery) => ["staging", "messages", query.channel ?? "", query.q ?? "", query.page ?? 1] as const,
};

const MUTATION = { retry: false } as const;

export function useToolboxStatus() {
  return useQuery({ queryKey: toolboxKeys.status, queryFn: toolboxApi.status });
}

export function useTimeState() {
  return useQuery({ queryKey: toolboxKeys.time, queryFn: toolboxApi.time, retry: false });
}

export function useAskTime() {
  const client = useQueryClient();
  return useMutation({
    ...MUTATION,
    mutationFn: toolboxApi.ask,
    // A refusal (409: busy, or another request waits) means the panel's picture is old: read the machine again, so
    // the other person's request shows as working.
    onError: () => client.invalidateQueries({ queryKey: toolboxKeys.time }),
    onSettled: () => client.invalidateQueries({ queryKey: toolboxKeys.actions }),
  });
}

/** A failed ask while the copy restarts: no answer at all, or the proxy's 502/503/504. */
export function stillWorking(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status === undefined || status >= 500;
}

/**
 * While `request` runs (an id, or `ANY_REQUEST`), ask the time machine every `TIME_POLL_MS` until it is free and, for an
 * id, its last request is that one; then `onDone()`. The copy stops and restarts meanwhile, so an ask that fails that
 * way (`stillWorking`) is only asked again. Any other failure stops the wait and is returned as `failed`; after
 * `TIME_WAIT_LIMIT_MS` the wait stops too (`gaveUp`): the machine may be stopped.
 */
export function useTimeMachineWait(request: string | null, onDone: () => void): { failed: unknown; gaveUp: boolean } {
  const done = useRef(onDone);
  const [failed, setFailed] = useState<unknown>(null);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (!request) return undefined;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const poll = async () => {
      try {
        const state = await toolboxApi.time();
        if (stopped) return;
        const free = !state.busy && !state.pending;
        if (free && (request === ANY_REQUEST || state.last?.id === request)) {
          done.current();
          return;
        }
      } catch (error) {
        if (stopped) return;
        if (!stillWorking(error)) {
          setFailed(error);
          return;
        }
      }
      if (Date.now() - startedAt >= TIME_WAIT_LIMIT_MS) {
        setGaveUp(true);
        return;
      }
      timer = setTimeout(poll, TIME_POLL_MS);
    };
    timer = setTimeout(poll, TIME_POLL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [request]);

  return { failed, gaveUp };
}

export function useToolboxActions() {
  return useQuery({ queryKey: toolboxKeys.actions, queryFn: toolboxApi.actions });
}

export function useToolboxGroups() {
  return useQuery({ queryKey: toolboxKeys.groups, queryFn: toolboxApi.groups });
}

export function useToolboxPeople(q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: toolboxKeys.people(query),
    queryFn: () => toolboxApi.people(query),
    enabled: query.length >= 2,
    placeholderData: keepPreviousData,
  });
}

/** After a tool ran: the log, and anyone it may have touched. */
function useRefreshAfter() {
  const client = useQueryClient();
  return () => {
    client.invalidateQueries({ queryKey: toolboxKeys.actions });
    client.invalidateQueries({ queryKey: ["staging", "people"] });
  };
}

export function useMakeStudents() {
  const refresh = useRefreshAfter();
  return useMutation({ ...MUTATION, mutationFn: toolboxApi.makeStudents, onSettled: refresh });
}

export function useSetBalance() {
  const refresh = useRefreshAfter();
  return useMutation({ ...MUTATION, mutationFn: toolboxApi.setBalance, onSettled: refresh });
}

export function useFillRegister() {
  const refresh = useRefreshAfter();
  return useMutation({ ...MUTATION, mutationFn: toolboxApi.fillRegister, onSettled: refresh });
}

export function useSignInLink() {
  const refresh = useRefreshAfter();
  return useMutation({ ...MUTATION, mutationFn: toolboxApi.signInLink, onSettled: refresh });
}

export function useBeatTasks() {
  return useQuery({ queryKey: toolboxKeys.tasks, queryFn: toolboxApi.tasks });
}

export function useRunTask() {
  const refresh = useRefreshAfter();
  return useMutation({ ...MUTATION, mutationFn: toolboxApi.runTask, onSettled: refresh });
}

export function useCapturedMessages(query: MessageQuery) {
  return useQuery({
    queryKey: toolboxKeys.messages(query),
    queryFn: () => toolboxApi.messages(query),
    placeholderData: keepPreviousData,
  });
}

export function useClearMessages() {
  const client = useQueryClient();
  return useMutation({
    ...MUTATION,
    mutationFn: toolboxApi.clearMessages,
    onSettled: () => {
      client.invalidateQueries({ queryKey: ["staging", "messages"] });
      client.invalidateQueries({ queryKey: toolboxKeys.actions });
    },
  });
}
