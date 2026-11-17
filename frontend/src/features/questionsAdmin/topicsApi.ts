"use client";

import api from "@/lib/api";

/**
 * A level's own midterm topic list (junior / foundation math), managed by an admin from the
 * builder: "+ New topic" in a question's picker and the Topics page. Backend:
 * questionbank/views_topics.py — global staff only; the SAT skill list is out of reach.
 */

export type TopicRow = {
  id: number;
  name: string;
  /** Set once from the first name; a rename never changes it, so a CSV that uses codes keeps working. */
  code: string;
  order: number;
  retired: boolean;
  /** Questions tagged with it now. */
  questions: number;
  /** Graded midterm answers frozen on it. Either count above zero means retire, not delete. */
  graded: number;
};

export type TopicList = {
  id: number;
  name: string;
  subject: string;
  level: string;
  level_label: string;
  topics: TopicRow[];
};

export const topicListsKey = ["questionbank", "topic-lists"] as const;

export const topicsApi = {
  async lists(): Promise<TopicList[]> {
    const r = await api.get("/questionbank/topic-lists/");
    const results = (r.data as { results?: TopicList[] } | null)?.results;
    return Array.isArray(results) ? results : [];
  },
  async create(listId: number, name: string): Promise<TopicRow> {
    const r = await api.post(`/questionbank/topic-lists/${listId}/topics/`, { name });
    return r.data as TopicRow;
  },
  async update(topicId: number, patch: { name?: string; retired?: boolean }): Promise<TopicRow> {
    const r = await api.patch(`/questionbank/topics/${topicId}/`, patch);
    return r.data as TopicRow;
  },
  async reorder(listId: number, ids: number[]): Promise<void> {
    await api.post(`/questionbank/topic-lists/${listId}/reorder/`, { ids });
  },
  async remove(topicId: number): Promise<void> {
    await api.delete(`/questionbank/topics/${topicId}/`);
  },
};
