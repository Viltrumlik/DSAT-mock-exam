"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { examsStudentApi } from "@/features/examsStudent/api";
import { FlaskConical, ChevronRight, BookOpen, Calculator } from "lucide-react";
import { HeroPage, PageHero, Skeleton } from "@/components/ui";
// The house devices, so practice reads as part of the same product as the classroom.
import { Card, EmptyState, ErrorState, Pill } from "@/features/classroom/ui";

type PracticeTestPackSection = {
  id: number;
  title: string;
  subject: string;
  module_count: number;
};

type PracticeTestPack = {
  id: number;
  title: string;
  description: string;
  is_published: boolean;
  sections: PracticeTestPackSection[];
  created_at: string;
};

function subjectLabel(subject: string): string {
  if (subject === "READING_WRITING") return "Reading & Writing";
  if (subject === "MATH") return "Mathematics";
  return subject;
}

export default function PracticeTestsListPage() {
  const [packs, setPacks] = useState<PracticeTestPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const data = await examsStudentApi.getPracticeTestPacksStudent();
      setPacks(data as PracticeTestPack[]);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <HeroPage className="space-y-5">
      <Card pad="none" className="cr-card overflow-hidden">
        <PageHero
          badge="Practice"
          icon={FlaskConical}
          title="Practice tests"
          description="Untimed practice — start any section in any order."
          tiles={
            !loading && !failed && packs.length > 0
              ? [{ label: "Available", value: packs.length, accent: true }]
              : []
          }
        />
      </Card>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}
        </div>
      ) : failed ? (
        // Not an empty state: "no practice tests yet" would tell a student with work waiting
        // that there is nothing to practise.
        <Card className="cr-card">
          <ErrorState
            title="Practice tests aren't loading right now."
            message="Nothing has been lost — they'll be here once the list loads."
            onRetry={() => void load()}
          />
        </Card>
      ) : packs.length === 0 ? (
        <Card className="cr-card">
          <EmptyState
            icon={FlaskConical}
            title="No practice tests yet"
            description="Practice test packs appear here once your teacher publishes them."
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {packs.map((pack, i) => (
            <Link
              key={pack.id}
              href={`/practice-tests/${pack.id}`}
              className="ds-ring block rounded-2xl"
              style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
            >
              <Card className="cr-card cr-lift flex h-full flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[16px] font-extrabold text-foreground">
                      {pack.title || `Practice test #${pack.id}`}
                    </h3>
                    {pack.description ? (
                      <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">
                        {pack.description}
                      </p>
                    ) : null}
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                </div>
                <div className="mt-auto flex flex-wrap gap-1.5">
                  {pack.sections.map((s) => {
                    const isRW = s.subject === "READING_WRITING";
                    return (
                      <Pill key={s.id} tone={isRW ? "info" : "success"}>
                        {isRW ? (
                          <BookOpen className="h-3 w-3" aria-hidden />
                        ) : (
                          <Calculator className="h-3 w-3" aria-hidden />
                        )}
                        {subjectLabel(s.subject)}
                      </Pill>
                    );
                  })}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </HeroPage>
  );
}
