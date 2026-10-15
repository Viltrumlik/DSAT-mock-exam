"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import type { ChangeListData } from "@/features/ops/changelist/ChangeList";
import type { ChangeListParams } from "@/features/ops/changelist/useChangeListParams";
import { qbKeys } from "./queryKeys";
import type { QbQuestionListItem } from "./types";

/**
 * `GET /questionbank/questions/changelist/` — the builder's Question Bank as the /ops console's
 * changelist (backend/questionbank/views_changelist.py). Search, filters with counts, ordering and
 * pages are the server's; this only names the shapes and asks.
 */

export interface QbChangeListPage extends ChangeListData<QbQuestionListItem> {
  ordering: string;
}

/** The filter keys the endpoint understands (anything else in the address is not sent). */
export const QB_FILTER_KEYS = ["subject", "status", "difficulty", "classified", "source"] as const;

/** The query string the endpoint takes, from the list's address state. */
export function qbChangeListQuery(params: ChangeListParams): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const key of QB_FILTER_KEYS) {
    const value = params.filters[key];
    if (value) out[key] = value;
  }
  if (params.q) out.q = params.q;
  if (params.o) out.o = params.o;
  if (params.page > 1) out.page = params.page;
  out.page_size = params.pageSize;
  return out;
}

export async function fetchQbChangeList(params: ChangeListParams): Promise<QbChangeListPage> {
  const { data } = await api.get<QbChangeListPage>("/questionbank/questions/changelist/", {
    params: qbChangeListQuery(params),
  });
  return data;
}

/**
 * One page of the Question Bank. Keyed under `questions`, so every edit, approve or archive that
 * refreshes the question lists refreshes this one too. The previous page stays on screen while the
 * next loads.
 */
export function useQbChangeList(params: ChangeListParams) {
  const query = qbChangeListQuery(params);
  return useQuery({
    queryKey: [...qbKeys.all, "questions", "changelist", query] as const,
    queryFn: () => fetchQbChangeList(params),
    placeholderData: keepPreviousData,
  });
}
