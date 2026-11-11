"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";

import { Icon, type IconName } from "@/components/ui/Icon";
import { useMe } from "@/hooks/useMe";
import api from "@/lib/api";
import { readStudioSession, sessionContinueHref, sessionContinueLabel, type StudioSession } from "@/lib/studioSession";
import { attentionCount, useBuilderAttention } from "../attention";
import { AttentionList } from "../AttentionList";

type Facet = { key: string; label?: string; options: { value: string; label: string; count: number }[] };
type QbPage = {
  count: number;
  filters?: Facet[];
  results: { id: number; qb_id?: string; question_text?: string; status?: string; updated_at?: string }[];
};

const fetchQb = async (params: Record<string, string | number>) =>
  (await api.get<QbPage>("/questionbank/questions/changelist/", { params })).data;

const LIBRARY: { caption: string; links: { href: string; icon: IconName; title: string; sub: string }[] }[] = [
  {
    caption: "Learning",
    links: [
      { href: "/builder/question-bank", icon: "ms-question", title: "Question bank", sub: "Every SAT question" },
      { href: "/builder/sets", icon: "layers", title: "Assessments", sub: "Homework and classwork sets" },
      { href: "/builder/midterms", icon: "ms-midterm", title: "Midterms", sub: "Pre, midterm, retake" },
      { href: "/builder/vocabulary", icon: "ms-vocab", title: "Vocabulary", sub: "Words, definitions, examples" },
      { href: "/builder/question-bank/imports", icon: "ms-import", title: "Imports", sub: "CSV batches" },
      { href: "/builder/categories", icon: "tag", title: "Categories", sub: "Organise sets" },
    ],
  },
  {
    caption: "Simulation",
    links: [
      { href: "/builder/pastpapers", icon: "ms-pastpaper", title: "Past papers", sub: "Real SAT papers" },
      { href: "/builder/practice-tests", icon: "pencil", title: "Practice tests", sub: "Packs and their modules" },
      { href: "/builder/full-mocks", icon: "ms-fullmock", title: "Full mocks", sub: "2 R&W + break + 2 Math" },
      { href: "/builder/archived", icon: "archive", title: "Archived", sub: "Retired, kept, restorable" },
    ],
  },
];

const STATUS_TONE: Record<string, string> = {
  TRIAGE: "bg-ms-attention-soft text-ms-attention-fg",
  APPROVED: "bg-ms-positive-soft text-ms-positive-fg",
  REJECTED: "bg-ms-critical-soft text-ms-critical-fg",
  ARCHIVED: "bg-ms-neutral-soft text-ms-neutral-fg",
  IMPORTED: "bg-ms-info-soft text-ms-info-fg",
};

function plain(html = "", max = 90) {
  const t = html.replace(/<[^>]*>/g, " ").replace(/\$[^$]*\$/g, "…").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function ago(iso?: string): string {
  if (!iso) return "";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-ms-card bg-ms-card p-5 shadow-ms-1">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-ms-h text-ms-fg">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Failed({ what, retry }: { what: string; retry: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-3.5 py-3 text-[14px]">
      <Icon name="alert" className="text-ms-critical-fg" />
      <span className="flex-1 text-ms-fg">Couldn’t load {what}. This is not zero.</span>
      <button type="button" onClick={retry} className="ms-transition min-h-9 rounded-[8px] px-2.5 font-semibold text-ms-primary-text hover:bg-ms-card">
        Retry
      </button>
    </div>
  );
}

const Shimmer = ({ rows = 3 }: { rows?: number }) => (
  <div aria-hidden="true" className="flex flex-col gap-3 py-1">
    {Array.from({ length: rows }, (_, i) => (
      <span key={i} className="animate-ms-shimmer h-4 rounded-[6px]" style={{ width: `${85 - i * 15}%` }} />
    ))}
  </div>
);

/** The bank as subject × status; every number opens the bank filtered to it. */
function BankTable() {
  const all = useQuery({ queryKey: ["console", "attention", "qb-facets"], queryFn: () => fetchQb({ page_size: 25 }), staleTime: 60_000 });
  const subjects = all.data?.filters?.find((f) => f.key === "subject")?.options ?? [];
  const statuses = all.data?.filters?.find((f) => f.key === "status")?.options ?? [];
  const bySubject = useQueries({
    queries: subjects.map((s) => ({
      queryKey: ["console", "studio", "qb-subject", s.value],
      queryFn: () => fetchQb({ page_size: 25, subject: s.value }),
      staleTime: 60_000,
    })),
  });
  const failed = all.isError || bySubject.some((q) => q.isError);
  const pending = all.isPending || bySubject.some((q) => q.isPending);
  const retry = () => {
    void all.refetch();
    bySubject.forEach((q) => void q.refetch());
  };

  return (
    <Card
      title="Question bank"
      action={all.data ? <span className="text-[14px] tabular-nums text-ms-fg-3">{all.data.count} questions</span> : undefined}
    >
      {failed ? <Failed what="the question bank" retry={retry} /> : pending ? <Shimmer /> : all.data!.count === 0 ? (
        <p className="text-[15px] text-ms-fg-2">
          The bank is empty. <Link href="/builder/question-bank/new" className="font-semibold text-ms-primary-text hover:underline">Write the first question</Link>{" "}
          or <Link href="/builder/question-bank/imports" className="font-semibold text-ms-primary-text hover:underline">import a CSV</Link>.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-[14px]">
            <thead>
              <tr>
                <th className="h-10 border-b border-ms-border px-2 text-left font-medium text-ms-fg-3" />
                {statuses.map((st) => (
                  <th key={st.value} className="h-10 border-b border-ms-border px-2 text-right font-medium text-ms-fg-3">
                    {st.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {subjects.map((sub, i) => {
                const facet = bySubject[i]?.data?.filters?.find((f) => f.key === "status")?.options ?? [];
                return (
                  <tr key={sub.value}>
                    <th scope="row" className="h-11 border-b border-ms-line px-2 text-left font-semibold text-ms-fg">
                      {sub.label}
                    </th>
                    {statuses.map((st) => {
                      const n = facet.find((o) => o.value === st.value)?.count ?? 0;
                      return (
                        <td key={st.value} className="h-11 border-b border-ms-line px-2 text-right tabular-nums">
                          <Link
                            href={`/builder/question-bank?subject=${encodeURIComponent(sub.value)}&status=${encodeURIComponent(st.value)}`}
                            aria-label={`${n} ${sub.label} questions, ${st.label}`}
                            className={`ms-transition inline-flex min-w-9 justify-end rounded-[8px] px-2 py-1 hover:bg-ms-surface-2 ${n ? "text-ms-fg" : "text-ms-fg-disabled"}`}
                          >
                            {n}
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="pt-2 text-[13px] text-ms-fg-3">Every number opens the bank filtered to it.</p>
        </div>
      )}
    </Card>
  );
}

function RecentlyEdited() {
  const q = useQuery({ queryKey: ["console", "studio", "qb-recent"], queryFn: () => fetchQb({ page_size: 25, o: "-updated" }), staleTime: 60_000 });
  const rows = (q.data?.results ?? []).slice(0, 5);
  return (
    <Card
      title="Recently edited"
      action={<Link href="/builder/question-bank?o=-updated" className="text-[14px] font-semibold text-ms-primary-text hover:underline">All</Link>}
    >
      {q.isError ? <Failed what="recent questions" retry={() => void q.refetch()} /> : q.isPending ? <Shimmer rows={4} /> : rows.length === 0 ? (
        <p className="text-[15px] text-ms-fg-2">No questions yet.</p>
      ) : (
        <div className="flex flex-col">
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/builder/question-bank/${r.id}`}
              className="ms-transition -mx-2 flex items-center gap-3 rounded-[12px] px-2 py-2.5 hover:bg-ms-surface"
            >
              <Icon name="ms-question" className="text-ms-fg-2" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px] text-ms-fg">{plain(r.question_text) || "Untitled question"}</span>
                <span className="text-[13px] text-ms-fg-3">
                  <span className="font-ms-mono">{r.qb_id}</span> · {ago(r.updated_at)}
                </span>
              </span>
              {r.status ? (
                <span className={`inline-flex h-6 shrink-0 items-center rounded-full px-2 text-[12px] font-semibold ${STATUS_TONE[r.status] ?? STATUS_TONE.ARCHIVED}`}>
                  {r.status === "TRIAGE" ? "In review" : r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

/**
 * /builder — Studio home (design handoff v0.3, BuilderHome board): what waits for review, the rule
 * that content is live, where you left off, the bank at a glance, what changed lately, the library.
 */
export function StudioHome() {
  const { me } = useMe();
  const attention = useBuilderAttention(Boolean(me));
  const review = attention.find((s) => s.id === "review");
  const [session, setSession] = useState<StudioSession | null>(null);
  useEffect(() => setSession(readStudioSession()), []);
  const continueHref = session ? sessionContinueHref(session) : null;
  const continueLabel = session ? sessionContinueLabel(session) : null;
  const first = typeof me?.first_name === "string" && me.first_name.trim() ? me.first_name.trim() : "";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-ms-display text-ms-b-display text-ms-fg">{first ? `Welcome back, ${first}` : "Studio home"}</h1>
          <p className="text-ms-body text-ms-fg-2">
            {review?.status === "done" ? (review.item ? review.item.title : "Nothing waits for review") : "Content studio"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/builder/question-bank/imports"
            className="ms-transition ms-press inline-flex min-h-11 items-center gap-2 rounded-ms-btn bg-ms-surface-2 px-4 text-[15px] font-semibold text-ms-fg hover:bg-ms-surface-3"
          >
            <Icon name="ms-import" />
            Import CSV
          </Link>
          <Link
            href="/builder/question-bank/new"
            className="ms-transition ms-press inline-flex min-h-11 items-center gap-2 rounded-ms-btn bg-ms-primary px-4 text-[15px] font-semibold text-white hover:bg-ms-primary-hover"
          >
            <Icon name="plus" />
            New question
          </Link>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-ms-ctl border border-ms-info-line bg-ms-info-soft px-4 py-3 text-[15px] text-ms-fg">
        <span className="flex items-center gap-2 font-semibold">
          <Icon name="info" className="text-ms-info-fg" />
          Content is live.
        </span>
        <span className="text-ms-fg-2">Saving reaches every attempt that hasn’t started; students already in one keep the version they started with.</span>
        <span className="flex flex-wrap gap-2">
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-ms-neutral-soft px-2 text-[12px] font-semibold text-ms-neutral-fg"><Icon name="pencil" size="sm" />Draft · staff only</span>
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-ms-positive-soft px-2 text-[12px] font-semibold text-ms-positive-fg"><Icon name="check" size="sm" />Live · students get it</span>
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-ms-neutral-soft px-2 text-[12px] font-semibold text-ms-neutral-fg"><Icon name="archive" size="sm" />Archived · restorable</span>
        </span>
      </div>

      {continueHref && continueLabel ? (
        <Link href={continueHref} className="ms-transition ms-hover-lift flex items-center gap-4 rounded-ms-card bg-ms-card px-5 py-4 shadow-ms-1">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-ms-primary-soft text-ms-primary-text">
            <Icon name="pencil" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[15px] font-semibold text-ms-fg">Continue where you left off</span>
            <span className="truncate text-[14px] text-ms-fg-3">{continueLabel}</span>
          </span>
          <Icon name="right" className="text-ms-fg-3" />
        </Link>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <div className="flex min-w-0 flex-col gap-5">
          <BankTable />
          <RecentlyEdited />
        </div>
        <Card title="Needs you" action={attentionCount(attention) ? <span className="text-[13px] text-ms-fg-3">Most urgent first</span> : undefined}>
          <AttentionList sources={attention} />
        </Card>
      </div>

      {LIBRARY.map((group) => (
        <section key={group.caption} className="flex flex-col gap-3">
          <h2 className="text-ms-h text-ms-fg">{group.caption}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {group.links.map((l) => (
              <Link key={l.href} href={l.href} className="ms-transition ms-hover-lift flex min-h-[96px] flex-col justify-between gap-3 rounded-ms-card bg-ms-card p-4 shadow-ms-1">
                <Icon name={l.icon} size="lg" className="text-ms-fg-2" />
                <span className="flex flex-col leading-tight">
                  <span className="text-[15px] font-semibold text-ms-fg">{l.title}</span>
                  <span className="text-[13px] text-ms-fg-3">{l.sub}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
