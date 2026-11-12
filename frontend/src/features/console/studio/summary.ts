"use client";

import { useQuery } from "@tanstack/react-query";

import api from "@/lib/api";
import { useRecent, type RecentItem } from "../recent";

/**
 * Studio home's numbers (`GET /api/questionbank/studio/summary/`, backend `questionbank/studio.py`): what
 * needs the content team, what the team did today, coverage by skill, the library's live counts, and the
 * state of the builder items this browser opened last. Studio home and the Builder's bell read the same
 * query (same key), so the page costs one request.
 */
export type MockGap = { module: string; have: number; need: number };
export type MockState = {
  id: number;
  title: string;
  live: boolean;
  ready: boolean;
  block_reason: string;
  short: number;
  gaps: MockGap[];
};

export type TeamLine = {
  /** null when nothing records who did it (publishing). */
  who: string | null;
  mine: boolean;
  what: string;
  detail: string;
  at: string;
  kind: string;
};

export type CoverageSkill = { id: number; name: string; domain: string; subject: "ENGLISH" | "MATH" | string; approved: number };

export type RecentQuestion = {
  kind: "question";
  id: number;
  title: string;
  text: string;
  status: string;
  subject: string;
  skill: string | null;
  needs_skill: boolean;
  imported: boolean;
  updated_at: string;
  created_at: string;
};
export type RecentSet = {
  kind: "set";
  id: number;
  title: string;
  subject: string;
  category: string;
  live: boolean;
  review_status: string;
  classes: number;
  done: number;
  questions: number;
  updated_at: string;
};
export type RecentMock = { kind: "mock" } & MockState & { updated_at: string };
export type RecentPaper = {
  kind: "pastpaper";
  id: number;
  title: string;
  subject: string;
  live: boolean;
  practice: boolean;
  questions: number;
  updated_at: string;
};
export type RecentState = RecentQuestion | RecentSet | RecentMock | RecentPaper;

export type StudioSummary = {
  review: { count: number; oldest_at: string | null; with_suggestion: number };
  no_key: { count: number; live: number };
  no_skill: { count: number };
  imports: {
    batches: number;
    with_errors: number;
    failed: { id: number; filename: string; errors: number; duplicates: number; at: string; by: string | null }[];
  };
  mocks: {
    total: number;
    live: number;
    incomplete: number;
    not_ready: MockState[];
    not_ready_count: number;
    mid_attempt: { id: number; title: string; students: number }[];
  };
  team_today: TeamLine[];
  coverage: { target: number; thin_below: number; skills: CoverageSkill[] };
  library: {
    questions: { total: number; review: number; english: number; math: number };
    sets: { total: number; live: number; english: number; math: number; categories: number };
    midterms: { total: number; live: number; english: number; math: number };
    vocabulary: { sections: number; names: string[] };
    imports: { batches: number; with_errors: number };
    pastpapers: { total: number; live: number };
    practice_tests: { total: number; live: number };
    mocks: { total: number; live: number; incomplete: number };
  };
  recent: RecentState[];
};

/** The builder items this browser opened last, as the endpoint's `recent` parameter. */
export function recentParam(items: readonly Pick<RecentItem, "kind" | "id">[]): string {
  return items
    .filter((r) => r.kind === "question" || r.kind === "set" || r.kind === "mock" || r.kind === "pastpaper")
    .slice(0, 8)
    .map((r) => `${r.kind}:${r.id}`)
    .join(",");
}

export const studioSummaryKey = (recent: string) => ["console", "studio", "summary", recent] as const;

export async function fetchStudioSummary(recent: string): Promise<StudioSummary> {
  return (await api.get<StudioSummary>("/questionbank/studio/summary/", { params: recent ? { recent } : {} })).data;
}

/**
 * One request for Studio home and the Builder's bell. Only Studio home asks for the recent items' state
 * (`withRecent`): elsewhere the bell keeps one stable key, so opening an editor (which records a visit)
 * never refetches the summary. On `/builder` the bell passes `withRecent` too, so page and bell share it.
 */
export function useStudioSummary(enabled: boolean, withRecent = false) {
  const local = useRecent("builder");
  const recent = withRecent ? recentParam(local) : "";
  return useQuery({
    queryKey: studioSummaryKey(recent),
    queryFn: () => fetchStudioSummary(recent),
    enabled,
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
}
