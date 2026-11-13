"use client";

import { useState } from "react";
import Link from "next/link";

import { Icon, type IconName } from "@/components/ui/Icon";
import { clockOrDay } from "../attention";
import { useRecent, type RecentItem } from "../recent";
import { RollNumber } from "../RollNumber";
import { Failed, Skeleton, sectionMark } from "../today/parts";
import { Avatar, Badge, buttonClass, type BadgeTone } from "../ui";
import type { CoverageSkill, RecentState, StudioSummary, TeamLine } from "./summary";

/**
 * Studio home's cards (design handoff v0.3, BuilderHome board), all drawn from one Studio summary
 * (`summary.ts`). Each has its four states: skeleton, content, empty with why, an error that never
 * looks like zero.
 */
type Q = { data: StudioSummary | undefined; isPending: boolean; isError: boolean; refetch: () => unknown };

// ─── Pure helpers (unit-tested) ──────────────────────────────────────────────

/** Question text as one plain line: tags gone, math shown as "…", at most `max` characters. */
export function plain(html = "", max = 110): string {
  const t = html.replace(/<[^>]*>/g, " ").replace(/\$[^$]*\$/g, "…").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** "40 min ago", "3 h ago", "yesterday", "4 days ago". */
export function ago(at: string | number, now = Date.now()): string {
  const min = Math.round((now - new Date(at).getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** The greeting's second line: the review queue and the draft mock closest to ready. */
export function headerLine(s: StudioSummary | undefined): string {
  if (!s) return "Content studio";
  // The mock closest to ready; the review count left with the Review queue (2026-11-12).
  const mock = [...s.mocks.not_ready].filter((m) => m.short > 0).sort((a, b) => a.short - b.short)[0];
  return mock ? `${mock.title} is ${mock.short} ${mock.short === 1 ? "question" : "questions"} from ready` : "Content studio";
}

/** The thinnest skills first (where the writing is needed), then A–Z. */
export function coverageRows(skills: readonly CoverageSkill[], all: boolean, first = 8): CoverageSkill[] {
  const sorted = [...skills].sort((a, b) => a.approved - b.approved || a.name.localeCompare(b.name));
  return all ? sorted : sorted.slice(0, first);
}

/** What the bars say that the numbers alone do not. */
export function coverageFinding(skills: readonly CoverageSkill[], thinBelow: number): string {
  if (!skills.length) return "";
  const thin = skills.filter((s) => s.approved < thinBelow).length;
  const empty = skills.filter((s) => s.approved === 0).length;
  if (!thin) return `Every skill has at least ${thinBelow} approved questions.`;
  const head = `${thin} ${thin === 1 ? "skill has" : "skills have"} fewer than ${thinBelow} approved questions.`;
  return empty ? `${head} ${empty} ${empty === 1 ? "has" : "have"} none yet.` : head;
}

/** The Continue row, in this browser's order, each with its live state; deleted items drop out. */
export function continueItems(local: readonly RecentItem[], states: readonly RecentState[]): { local: RecentItem; state: RecentState }[] {
  const byKey = new Map(states.map((s) => [`${s.kind}:${s.id}`, s]));
  return local.flatMap((r) => {
    const state = byKey.get(`${r.kind}:${r.id}`);
    return state ? [{ local: r, state }] : [];
  });
}

const SUBJECT: Record<string, string> = { ENGLISH: "R&W", READING_WRITING: "R&W", english: "English", MATH: "Math", math: "Math" };

// ─── Continue where you left off ─────────────────────────────────────────────

function ContinueCard({ local, state, delay }: { local: RecentItem; state: RecentState; delay: number }) {
  let eyebrow = "";
  let title = local.name;
  let lines: string[] = [];
  let badge: { tone: BadgeTone; text: string } | null = null;
  let progress: { have: number; need: number } | null = null;
  let icon: IconName = "ms-question";
  if (state.kind === "mock") {
    icon = "ms-fullmock";
    title = state.title;
    const gap = state.gaps[0];
    if (gap) {
      eyebrow = `${gap.module} · ${gap.have} / ${gap.need}`;
      progress = { have: gap.have, need: gap.need };
    } else eyebrow = "Full mock";
    lines = [`Opened ${ago(local.at)}`, state.gaps.length ? `${state.gaps.map((g) => g.need - g.have).join(" + ")} questions to add` : ""];
    badge = state.live ? { tone: "positive", text: "Live" } : state.gaps.length || !state.ready ? { tone: "attention", text: "Incomplete" } : { tone: "neutral", text: "Draft" };
  } else if (state.kind === "question") {
    eyebrow = state.title;
    title = plain(state.text) || "Untitled question";
    lines = [state.needs_skill ? `${state.imported ? "Imported" : "Written"} ${ago(state.created_at)} · needs a skill` : (state.skill ?? ""), `Opened ${ago(local.at)}`];
    badge =
      state.status === "TRIAGE" ? { tone: "attention", text: "In review" }
      : state.status === "APPROVED" ? { tone: "positive", text: "Approved" }
      : state.status === "REJECTED" ? { tone: "critical", text: "Rejected" }
      : { tone: "neutral", text: state.status.charAt(0) + state.status.slice(1).toLowerCase() };
  } else if (state.kind === "set") {
    icon = "layers";
    eyebrow = `${state.questions} ${state.questions === 1 ? "question" : "questions"}`;
    title = state.title || "Untitled set";
    lines = [
      ["Assessment", SUBJECT[state.subject] ?? state.subject, state.category].filter(Boolean).join(" · ") +
        (state.classes ? ` · assigned to ${state.classes} ${state.classes === 1 ? "class" : "classes"}` : ""),
      state.done ? `${state.done} ${state.done === 1 ? "student" : "students"} done` : `Opened ${ago(local.at)}`,
    ];
    badge = state.live ? { tone: "positive", text: "Live" } : state.review_status === "needs_review" ? { tone: "attention", text: "In review" } : { tone: "neutral", text: "Draft" };
  } else {
    icon = state.practice ? "pencil" : "ms-pastpaper";
    eyebrow = `${state.practice ? "Practice test" : "Past paper"} · ${SUBJECT[state.subject] ?? state.subject}`;
    title = state.title || local.name;
    lines = [`${state.questions} ${state.questions === 1 ? "question" : "questions"}`, `Opened ${ago(local.at)}`];
    badge = state.live ? { tone: "positive", text: "Live" } : { tone: "neutral", text: "Draft" };
  }
  return (
    <Link
      href={local.href}
      style={{ animationDelay: `${delay}ms` }}
      className="animate-ms-card-in ms-hover-lift flex w-[288px] shrink-0 snap-start flex-col gap-2.5 rounded-ms-card bg-ms-card p-4 shadow-ms-1"
    >
      <span className="flex items-center gap-2 text-[13px] font-medium text-ms-fg-3">
        <Icon name={icon} size="sm" className="text-ms-fg-2" />
        <span className="truncate tabular-nums">{eyebrow}</span>
        {badge ? <Badge tone={badge.tone} className="ml-auto shrink-0">{badge.text}</Badge> : null}
      </span>
      {progress ? (
        <span className="h-1.5 overflow-hidden rounded-full bg-ms-surface-2" aria-hidden="true">
          <span className="animate-ms-wipe-in block h-full rounded-full bg-ms-primary" style={{ width: `${Math.min(100, (progress.have / progress.need) * 100)}%`, animationDelay: `${delay + 120}ms` }} />
        </span>
      ) : null}
      <span className="line-clamp-2 text-[15px] font-semibold leading-5 text-ms-fg">{title}</span>
      <span className="mt-auto flex flex-col text-[13px] text-ms-fg-3">
        {lines.filter(Boolean).map((l) => (
          <span key={l} className="truncate">{l}</span>
        ))}
      </span>
    </Link>
  );
}

export function ContinueRow({ q, delay }: { q: Q; delay: number }) {
  const local = useRecent("builder");
  const items = continueItems(local, q.data?.recent ?? []);
  if (!local.length) return null; // nothing opened in this browser yet: the row would only be empty
  return (
    <section {...sectionMark("Continue where you left off")} className="animate-ms-fade-in flex flex-col gap-3" style={{ animationDelay: `${delay}ms` }}>
      <h2 className="text-ms-h text-ms-fg">Continue where you left off</h2>
      {q.isError ? (
        <Failed what="where you left off" retry={() => void q.refetch()} />
      ) : q.isPending && !q.data ? (
        <div className="flex gap-3 overflow-hidden">
          {local.slice(0, 3).map((r) => (
            <span key={`${r.kind}${r.id}`} className="animate-ms-shimmer h-[132px] w-[288px] shrink-0 rounded-ms-card" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-[14px] text-ms-fg-2">What you opened last was deleted or archived.</p>
      ) : (
        <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
          {items.map((it, i) => (
            <ContinueCard key={`${it.local.kind}-${it.local.id}`} {...it} delay={delay + 40 + i * 50} />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Team today ──────────────────────────────────────────────────────────────

function TeamRow({ line, i, delay }: { line: TeamLine; i: number; delay: number }) {
  const sub = [line.detail && line.kind !== "publish" ? line.detail : "", clockOrDay(line.at)].filter(Boolean).join(" · ");
  return (
    <li className="animate-ms-fade-in flex items-center gap-3 py-2" style={{ animationDelay: `${delay + i * 45}ms` }}>
      {line.who && !line.mine ? (
        <Avatar name={line.who} className="size-9 text-[14px]" />
      ) : (
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ms-surface-2 text-ms-fg-2">
          <Icon name={line.mine ? "user" : "send"} size="sm" />
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[14.5px] text-ms-fg">
          {line.who ? <b className="font-semibold">{line.who} </b> : null}
          {line.what}
        </span>
        <span className="text-[13px] tabular-nums text-ms-fg-3">{sub}</span>
      </span>
    </li>
  );
}

export function TeamToday({ q, delay }: { q: Q; delay: number }) {
  const rows = q.data?.team_today ?? [];
  return (
    <section {...sectionMark("Team today")} className="animate-ms-card-in flex min-w-0 flex-col gap-3 rounded-ms-card bg-ms-card px-[22px] py-5 shadow-ms-1" style={{ animationDelay: `${delay}ms` }}>
      <h2 className="text-ms-h text-ms-fg">Team today</h2>
      {q.isError ? <Failed what="today’s activity" retry={() => void q.refetch()} /> : q.isPending && !q.data ? <Skeleton rows={3} /> : rows.length === 0 ? (
        <p className="text-[14px] text-ms-fg-2">Nothing yet today. Approvals and publishing show up here as they happen.</p>
      ) : (
        <ul className="-my-1 flex flex-col divide-y divide-ms-line">
          {rows.map((l, i) => (
            <TeamRow key={`${l.kind}-${l.who}-${l.at}-${i}`} line={l} i={i} delay={delay + 60} />
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Coverage by skill ───────────────────────────────────────────────────────

export function Coverage({ q, delay }: { q: Q; delay: number }) {
  const [all, setAll] = useState(false);
  const c = q.data?.coverage;
  const skills = c?.skills ?? [];
  const rows = coverageRows(skills, all);
  const max = Math.max(c?.target ?? 10, ...rows.map((r) => r.approved), 1);
  return (
    <section {...sectionMark("Coverage by skill")} className="animate-ms-card-in flex min-w-0 flex-col gap-3 rounded-ms-card bg-ms-card px-[22px] py-5 shadow-ms-1" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex flex-wrap items-baseline gap-x-2.5">
        <h2 className="text-ms-h text-ms-fg">Coverage by skill</h2>
        {c ? <span className="text-[13px] text-ms-fg-3">approved questions · line = target of {c.target}</span> : null}
      </div>
      {q.isError ? <Failed what="coverage" retry={() => void q.refetch()} /> : q.isPending && !q.data ? <Skeleton rows={5} /> : skills.length === 0 ? (
        <p className="text-[14px] text-ms-fg-2">No SAT skills are set up yet, so there is nothing to count against.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((s, i) => (
            <div key={s.id} className="grid grid-cols-[minmax(0,170px)_2.25rem_minmax(0,1fr)_2.5rem] items-center gap-2.5 text-[13.5px]">
              <span className="truncate text-ms-fg" title={`${s.name} · ${s.domain}`}>{s.name}</span>
              <span className="text-[12px] text-ms-fg-3">{SUBJECT[s.subject] ?? s.subject}</span>
              <span className="relative h-2.5 rounded-full bg-ms-surface-2">
                <span
                  className={`animate-ms-wipe-in block h-full rounded-full ${s.approved < (c?.thin_below ?? 5) ? "bg-ms-attention" : "bg-ms-primary"}`}
                  style={{ width: `${(s.approved / max) * 100}%`, animationDelay: `${delay + 100 + i * 40}ms` }}
                />
                <span aria-hidden="true" className="absolute -inset-y-1 w-px bg-ms-fg-3" style={{ left: `${((c?.target ?? 10) / max) * 100}%` }} />
              </span>
              <span className="text-right font-semibold tabular-nums text-ms-fg">{s.approved}</span>
            </div>
          ))}
          <p className="pt-1 text-[14px] font-medium text-ms-fg-2">{coverageFinding(skills, c?.thin_below ?? 5)}</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/builder/question-bank/new" className={buttonClass({ size: "sm" })}>
              <Icon name="plus" size="sm" />
              Write a question
            </Link>
            {skills.length > rows.length || all ? (
              <button type="button" onClick={() => setAll((v) => !v)} className={buttonClass({ variant: "ghost", size: "sm" })} aria-expanded={all}>
                {all ? "Show the thinnest 8" : `Show all ${skills.length}`}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Library ─────────────────────────────────────────────────────────────────

type Tile = { href: string; icon: IconName; title: string; count?: number; sub: string; meta: { text: string; tone?: "critical" | "attention" }[] };

/** The library as tiles with live counts (BuilderHome board). */
export function libraryTiles(lib: StudioSummary["library"] | undefined): { caption: string; tiles: Tile[] }[] {
  const live = (x: number) => ({ text: `${x} live` });
  return [
    {
      caption: "Learning",
      tiles: [
        {
          href: "/builder/question-bank", icon: "ms-question", title: "Question bank", count: lib?.questions.total,
          sub: lib ? `questions · ${lib.questions.review} in review` : "Every SAT question",
          meta: lib ? [{ text: `R&W ${lib.questions.english}` }, { text: `Math ${lib.questions.math}` }] : [],
        },
        {
          href: "/builder/sets", icon: "layers", title: "Assessments", count: lib?.sets.total,
          sub: "sets for homework and classwork",
          meta: lib ? [{ text: `English ${lib.sets.english}` }, { text: `Math ${lib.sets.math}` }] : [],
        },
        {
          href: "/builder/midterms", icon: "ms-midterm", title: "Midterms", count: lib?.midterms.total,
          sub: "Pre, Midterm, Retake",
          meta: lib ? [{ text: `English ${lib.midterms.english}` }, { text: `Math ${lib.midterms.math}` }] : [],
        },
        {
          href: "/builder/vocabulary", icon: "ms-vocab", title: "Vocabulary", count: lib?.vocabulary.sections,
          sub: "sections · words, definitions, examples",
          meta: lib && lib.vocabulary.names.length ? [{ text: lib.vocabulary.names.join(" · ") + (lib.vocabulary.sections > lib.vocabulary.names.length ? " · …" : "") }] : [],
        },
        {
          href: "/builder/categories", icon: "tag", title: "Categories", count: lib?.sets.categories,
          sub: "Organise sets · edit",
          meta: [],
        },
      ],
    },
    {
      caption: "Simulation",
      tiles: [
        { href: "/builder/pastpapers", icon: "ms-pastpaper", title: "Past papers", sub: "Real SAT papers · English and Math modules", meta: lib ? [live(lib.pastpapers.live)] : [] },
        { href: "/builder/practice-tests", icon: "pencil", title: "Practice tests", sub: "Packs and their modules", meta: lib ? [live(lib.practice_tests.live)] : [] },
        {
          href: "/builder/full-mocks", icon: "ms-fullmock", title: "Full mocks", sub: "2 R&W + break + 2 Math",
          meta: lib ? [live(lib.mocks.live), ...(lib.mocks.incomplete ? [{ text: `${lib.mocks.incomplete} incomplete`, tone: "attention" as const }] : [])] : [],
        },
        { href: "/builder/archived", icon: "archive", title: "Archived", sub: "Retired, kept, restorable · review", meta: [] },
      ],
    },
  ];
}

const META_TONE = { critical: "text-ms-critical-fg", attention: "text-ms-attention-fg" } as const;

export function Library({ q, delay }: { q: Q; delay: number }) {
  const groups = libraryTiles(q.data?.library);
  return (
    <>
      {groups.map((group, g) => (
        <section key={group.caption} {...sectionMark(group.caption)} className="animate-ms-fade-in flex flex-col gap-3" style={{ animationDelay: `${delay + g * 100}ms` }}>
          <h2 className="text-ms-h text-ms-fg">{group.caption}</h2>
          {g === 0 && q.isError ? <Failed what="the library’s counts" retry={() => void q.refetch()} /> : null}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {group.tiles.map((t, i) => (
              <Link
                key={t.href}
                href={t.href}
                style={{ animationDelay: `${delay + 40 + g * 100 + i * 35}ms` }}
                className="animate-ms-card-in ms-hover-lift flex min-h-[132px] flex-col gap-2 rounded-ms-card bg-ms-card p-4 shadow-ms-1"
              >
                <Icon name={t.icon} size="lg" className="text-ms-fg-2" />
                <span className="flex flex-col leading-tight">
                  <span className="text-[15px] font-semibold text-ms-fg">{t.title}</span>
                  <span className="text-[13px] text-ms-fg-3">
                    {t.count !== undefined ? (
                      <>
                        <RollNumber value={t.count} className="font-semibold tabular-nums text-ms-fg-2" />{" "}
                      </>
                    ) : null}
                    {t.sub}
                  </span>
                </span>
                {t.meta.length ? (
                  <span className="mt-auto flex flex-wrap gap-x-2 text-[12.5px] tabular-nums text-ms-fg-3">
                    {t.meta.map((m) => (
                      <span key={m.text} className={m.tone ? `font-semibold ${META_TONE[m.tone]}` : ""}>{m.text}</span>
                    ))}
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        </section>
      ))}
      <p className="-mt-2 text-[13px] text-ms-fg-3">
        The <Link href="/builder/bank" className="font-semibold text-ms-primary-text hover:underline">old sets bank (legacy)</Link> is still open for reference.
      </p>
    </>
  );
}
