"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ClipboardList, Coffee, Eye, FileText } from "lucide-react";
import { mockApi, type MockRow } from "@/lib/mockApi";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { HeroPage, PageHero, Skeleton } from "@/components/ui";
// The house devices, so a mock reads as part of the same product as the classroom.
import { Button, buttonClassName, Card, EmptyState, ErrorState, Pill } from "@/features/classroom/ui";
import MockSessionPanel from "./MockSessionPanel";

/** Student full-mock list — 4-module SAT simulations (2 English + 2 Math + a 10-min break). */

function Row({ m, index }: { m: MockRow; index: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function enter() {
    setBusy(true);
    try {
      const attemptId = await mockApi.createAttempt(m.mock_id);
      // `welcome=1` only on a FRESH sitting. A resume drops straight back into the module
      // the server is holding — its clock has been running since the student left, so a
      // "click Start when you're ready" screen would just burn their remaining time.
      const qs = m.in_progress ? "?src=mock" : "?src=mock&welcome=1";
      router.push(`/exam/${attemptId}${qs}`);
    } catch (e) {
      pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
      setBusy(false);
    }
  }

  const label = m.in_progress ? "Resume mock" : m.submitted ? "Retake mock" : "Start mock";

  return (
    <Card
      className="cr-card cr-lift flex flex-wrap items-center gap-4"
      style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
    >
      <span className="cr-iconpop flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-transform">
        <FileText className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-[16px] font-extrabold text-foreground">{m.title}</p>
          {/* The state used to live only in the button's verb, which a student scanning a
              list of papers does not read. */}
          {m.in_progress ? (
            <Pill tone="warning">In progress</Pill>
          ) : m.submitted ? (
            <Pill tone="success">Completed</Pill>
          ) : null}
        </div>
        {/* One text flow, not a flex row: a gap between the number and its unit renders as
            "4  modules" and "10 m break". */}
        <p className="mt-0.5 text-[13px] font-semibold text-muted-foreground">
          <span className="ds-num">{m.module_count}</span> modules · out of 1600
          <span className="ml-1.5 inline-flex items-center gap-1 align-[-1px]">
            <Coffee className="h-3.5 w-3.5" aria-hidden />
            <span><span className="ds-num">{m.break_minutes}</span>m break</span>
          </span>
        </p>
      </div>
      {m.submitted && m.total_score != null && (
        <div className="shrink-0 text-right leading-none">
          <span className="ds-num text-[22px] font-extrabold text-foreground">{m.total_score}</span>
          <span className="ds-num text-[12px] font-bold text-muted-foreground"> /1600</span>
        </div>
      )}
      {/* A finished sitting needs a way back to its score. The only button used to be
          "Retake", so the single click available to a student who had just completed a
          mock started a NEW attempt and buried the result they were looking for. */}
      {m.result_attempt_id != null && (
        <Link
          href={`/mock-exam/result/${m.result_attempt_id}`}
          className={buttonClassName({ variant: "secondary", className: "shrink-0" })}
        >
          <Eye className="h-4 w-4" aria-hidden /> View result
        </Link>
      )}
      <Button className="cr-press shrink-0" loading={busy} iconRight={ArrowRight} onClick={enter}>
        {label}
      </Button>
    </Card>
  );
}

/** A quiet section label — the same device the page has always used above each block. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12px] font-extrabold tracking-[0.16em] text-muted-foreground">{children}</p>
  );
}

export default function MockList() {
  const mine = useQuery({ queryKey: ["mock", "mine"], queryFn: mockApi.myMocks });
  const mocks = mine.data ?? [];
  const best = mocks.reduce<number | null>(
    (acc, m) => (m.total_score != null && (acc == null || m.total_score > acc) ? m.total_score : acc),
    null,
  );

  return (
    <HeroPage className="space-y-5">
      <Card pad="none" className="cr-card overflow-hidden">
        <PageHero
          badge="Mock"
          title="Mock exam"
          description="A full timed SAT simulation: 2 Reading & Writing modules, a 10-minute break, then 2 Math modules — scored out of 1600."
          tiles={
            mine.isSuccess
              ? [
                  { label: "Papers", value: mocks.length },
                  ...(best != null
                    ? [{ label: "Your best", value: `${best} / 1600`, accent: true as const }]
                    : []),
                ]
              : []
          }
        />
      </Card>

      {/* Two ways to sit the same paper. An invigilated sitting is run by a teacher with a
          code; practice below is the student's own, whenever they like. */}
      <MockSessionPanel />

      <div className="space-y-3 pt-3">
        <SectionLabel>PRACTISE ON YOUR OWN</SectionLabel>
        {/* `isPending`, not `isLoading`: between retries `isLoading` drops to false while the
            data is still undefined, and the branch below would claim there are no papers. */}
        {mine.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-[86px] rounded-2xl" />
            <Skeleton className="h-[86px] rounded-2xl" />
          </div>
        ) : mine.isError ? (
          // Not an empty state: "no mocks available yet" told a student with a paper waiting
          // for them that there was nothing to sit.
          <Card className="cr-card">
            <ErrorState
              title="Your mocks aren't loading right now."
              message="Nothing has been lost — your papers will be here once the list loads."
              onRetry={() => void mine.refetch()}
            />
          </Card>
        ) : mocks.length === 0 ? (
          <Card className="cr-card">
            <EmptyState
              icon={ClipboardList}
              title="No mocks available yet"
              description="When your learning center publishes a full mock, it will show up here to sit whenever you like."
            />
          </Card>
        ) : (
          mocks.map((m, i) => <Row key={m.mock_id} m={m} index={i} />)
        )}
      </div>
    </HeroPage>
  );
}
