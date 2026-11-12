"use client";

import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";

import { Icon } from "@/components/ui/Icon";
import { useMe } from "@/hooks/useMe";
import api from "@/lib/api";
import { attentionCount, useBuilderAttention } from "../attention";
import { AttentionList } from "../AttentionList";
import { RollNumber } from "../RollNumber";
import { Card, Failed, Skeleton } from "../today/parts";
import { buttonClass } from "../ui";
import { ContinueRow, Coverage, headerLine, Library, TeamToday } from "./cards";
import { useStudioSummary } from "./summary";

type Facet = { key: string; label?: string; options: { value: string; label: string; count: number }[] };
type QbPage = { count: number; filters?: Facet[] };

const fetchQb = async (params: Record<string, string | number>) =>
  (await api.get<QbPage>("/questionbank/questions/changelist/", { params })).data;

/** The bank as subject × status; every number opens the bank filtered to it. */
function BankTable({ delay }: { delay: number }) {
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
      delay={delay}
      action={all.data ? <span className="text-[14px] tabular-nums text-ms-fg-3"><RollNumber value={all.data.count} /> questions</span> : undefined}
    >
      {failed ? <Failed what="the question bank" retry={retry} /> : pending ? <Skeleton /> : all.data!.count === 0 ? (
        <p className="text-[15px] text-ms-fg-2">
          The bank is empty. <Link href="/builder/question-bank/new" className="font-semibold text-ms-primary-text hover:underline">Write the first question</Link>.
        </p>
      ) : (
        <div className="animate-ms-fade-in overflow-x-auto">
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

/**
 * /builder — Studio home (design handoff v0.3, BuilderHome board): what waits for review and how close the
 * next mock is, the rule that content is live (and who is in a live mock now), where you left off, the three
 * kinds of thing that need the team, the bank at a glance, what the team did today, coverage by skill, and
 * the library with live counts. One Studio summary request feeds every card and the bell.
 */
export function StudioHome() {
  const { me } = useMe();
  const summary = useStudioSummary(Boolean(me), true);
  const attention = useBuilderAttention(Boolean(me), true);
  const count = attentionCount(attention);
  const first = typeof me?.first_name === "string" && me.first_name.trim() ? me.first_name.trim() : "";
  const live = summary.data?.mocks.mid_attempt[0];

  return (
    <div className="flex flex-col gap-6">
      <header className="animate-ms-fade-in flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-ms-display text-ms-b-display text-ms-fg">{first ? `Welcome back, ${first}` : "Studio home"}</h1>
          <p className="text-ms-body text-ms-fg-2">{headerLine(summary.data)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/builder/question-bank/new" className={buttonClass({ variant: "primary" })}>
            <Icon name="plus" />
            New question
          </Link>
        </div>
      </header>

      <div
        style={{ animationDelay: "40ms" }}
        className="animate-ms-card-in flex flex-wrap items-center gap-x-5 gap-y-2 rounded-ms-ctl border border-ms-info-line bg-ms-info-soft px-4 py-3 text-[15px] text-ms-fg"
      >
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
        {live ? (
          <Link
            href={`/builder/full-mocks/${live.id}`}
            className="animate-ms-pop ml-auto inline-flex h-7 items-center gap-2 rounded-full bg-ms-card px-3 text-[13px] font-semibold text-ms-fg shadow-ms-1 hover:underline"
            title="Students in an English or Math module or on the break. Saving now reaches only attempts that haven’t started."
          >
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-ms-positive opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex size-2 rounded-full bg-ms-positive" />
            </span>
            {live.students} mid-attempt on {live.title}
          </Link>
        ) : null}
      </div>

      <ContinueRow q={summary} delay={80} />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Card
          title="Needs you"
          delay={140}
          aside={
            count ? (
              <span key={count} className="animate-ms-pop inline-flex h-5 min-w-[22px] items-center justify-center rounded-full bg-ms-danger-btn px-1.5 text-[12px] font-semibold tabular-nums text-white">
                {count}
              </span>
            ) : undefined
          }
          action={count ? <span className="text-[13px] text-ms-fg-3">most urgent first</span> : undefined}
        >
          <AttentionList sources={attention} illustrate />
        </Card>
        <BankTable delay={200} />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <TeamToday q={summary} delay={260} />
        <Coverage q={summary} delay={320} />
      </div>

      <Library q={summary} delay={380} />
    </div>
  );
}
