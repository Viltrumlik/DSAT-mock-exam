"use client";

import { useEffect, useState } from "react";

import type { IconName } from "@/components/ui/Icon";
import api from "@/lib/api";

/** A verdict on a search hit — always a word, never colour alone (design handoff v0.3). */
export type HitBadge = { tone: "critical" | "attention" | "positive" | "info" | "frozen" | "neutral"; text: string };

/** One student, class or question ⌘K found on the server. */
export type EntityHit = {
  id: string;
  label: string;
  hint?: string;
  badge?: HitBadge;
  href: string;
  icon: IconName;
};

export type EntityKind = "Students" | "Classes" | "Questions";
export const ENTITY_KINDS: EntityKind[] = ["Students", "Classes", "Questions"];

export type EntityGroupState = {
  kind: EntityKind;
  status: "loading" | "error" | "done";
  hits: EntityHit[];
};

type MeLike = Record<string, unknown> | null | undefined;

/**
 * What ⌘K may search for this person, in this console. Each console searches only its own data:
 * the host guard refuses `/api/questionbank/` on admin.* and `/api/users/` on questions.*, so asking
 * would only collect 403s. Within a console the roles mirror the endpoints' permission classes:
 * people — super admin, admin, teacher (rows of their subject); classrooms — super admin and admin;
 * the question bank — every console role.
 */
export function entityScope(console: "admin" | "builder", me: MeLike): EntityKind[] {
  const role = String(me?.role ?? "").trim().toLowerCase();
  const admin = role === "super_admin" || role === "admin" || Boolean(me?.is_superuser);
  if (console === "builder") return role && role !== "student" && role !== "public_student" ? ["Questions"] : [];
  if (admin) return ["Students", "Classes"];
  if (role === "teacher") return ["Students"];
  return [];
}

/** "1 250 000 so'm" — money grouped by spaces, unit after (design handoff v0.3). */
export function formatSom(amount: number): string {
  return `${Math.round(amount).toLocaleString("en-US").replace(/,/g, " ")} so'm`;
}

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function plain(html: string, max = 70): string {
  const t = html.replace(/<[^>]*>/g, " ").replace(/\$[^$]*\$/g, "…").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

type StudentRow = {
  id: number;
  name?: string;
  username?: string;
  phone?: string;
  status?: string;
  groups?: { id: number; name: string }[];
  lcup?: { linked?: boolean; balance?: number | null } | null;
};
type ClassRow = { id: number; name: string; teacher: { name: string } | null; students?: number; is_active?: boolean };
type QuestionRow = { id: number; qb_id?: string; question_text?: string; status?: string; subject?: string };

const QUESTION_STATUS: Record<string, HitBadge> = {
  TRIAGE: { tone: "attention", text: "In review" },
  APPROVED: { tone: "positive", text: "Approved" },
  REJECTED: { tone: "critical", text: "Rejected" },
  ARCHIVED: { tone: "neutral", text: "Archived" },
  IMPORTED: { tone: "info", text: "Imported" },
};

const MAX = 5;

async function search(kind: EntityKind, q: string, signal: AbortSignal): Promise<EntityHit[]> {
  if (kind === "Students") {
    const { data } = await api.get<{ results: StudentRow[] }>("/users/admin/people/", {
      params: { section: "students", q, page_size: 25 },
      signal,
    });
    return data.results.slice(0, MAX).map((r) => {
      const balance = r.lcup?.balance ?? null;
      const badge: HitBadge | undefined =
        r.status === "frozen_debt"
          ? { tone: "frozen", text: "Frozen for debt" }
          : balance !== null && balance < 0
            ? { tone: "critical", text: `Owes ${formatSom(-balance)}` }
            : r.status === "frozen_admin"
              ? { tone: "frozen", text: "Frozen" }
              : undefined;
      return {
        id: `student:${r.id}`,
        label: text(r.name) || text(r.username) || `Student ${r.id}`,
        hint: [text(r.phone) || text(r.username), r.groups?.[0]?.name].filter(Boolean).join(" · ") || undefined,
        badge,
        href: `/ops/students/${r.id}`,
        icon: "user",
      };
    });
  }
  if (kind === "Classes") {
    const { data } = await api.get<{ results: ClassRow[] }>("/classes/admin/classrooms/", { params: { q, page_size: 25 }, signal });
    return data.results.slice(0, MAX).map((r) => ({
      id: `class:${r.id}`,
      label: r.name,
      hint: [r.teacher?.name, typeof r.students === "number" ? `${r.students} students` : ""].filter(Boolean).join(" · ") || undefined,
      badge:
        r.is_active === false
          ? { tone: "neutral", text: "Archived" }
          : !r.teacher
            ? { tone: "attention", text: "No teacher" }
            : undefined,
      href: `/ops/classrooms/${r.id}`,
      icon: "cap",
    }));
  }
  const { data } = await api.get<{ results: QuestionRow[] }>("/questionbank/questions/", { params: { search: q, limit: MAX }, signal });
  return data.results.slice(0, MAX).map((r) => ({
    id: `question:${r.id}`,
    label: text(r.qb_id) || `Question ${r.id}`,
    hint: plain(text(r.question_text)) || undefined,
    badge: r.status ? QUESTION_STATUS[r.status] : undefined,
    href: `/builder/question-bank/${r.id}`,
    icon: "ms-question",
  }));
}

/**
 * ⌘K's server search: once the query has 2+ characters and has rested 200 ms, each kind in `kinds`
 * is asked in parallel. Every group has its own state — a failed one says so (with `retry`), it
 * never looks like "no results" — and a newer query cancels the older requests.
 */
export function useEntitySearch(query: string, kinds: readonly EntityKind[]): { groups: EntityGroupState[]; retry: () => void } {
  const [groups, setGroups] = useState<EntityGroupState[]>([]);
  const [nonce, setNonce] = useState(0);
  const key = kinds.join(",");

  useEffect(() => {
    const q = query.trim();
    const list = (key ? key.split(",") : []) as EntityKind[];
    if (q.length < 2 || list.length === 0) {
      setGroups([]);
      return;
    }
    setGroups(list.map((kind) => ({ kind, status: "loading", hits: [] })));
    const controller = new AbortController();
    const timer = setTimeout(() => {
      for (const kind of list) {
        search(kind, q, controller.signal).then(
          (hits) => setGroups((gs) => gs.map((g) => (g.kind === kind ? { kind, status: "done", hits } : g))),
          (err: unknown) => {
            if (controller.signal.aborted || (err as { name?: string })?.name === "CanceledError") return;
            setGroups((gs) => gs.map((g) => (g.kind === kind ? { kind, status: "error", hits: [] } : g)));
          },
        );
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, key, nonce]);

  return { groups, retry: () => setNonce((n) => n + 1) };
}
