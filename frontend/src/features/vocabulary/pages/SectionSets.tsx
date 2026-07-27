"use client";

/**
 * /vocabulary/sections/[sectionId] — every set in one published bank section.
 */

import { useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Layers, Library, Type } from "lucide-react";

import { EmptyState } from "@/components/ui";

import { SetCard } from "../components/SetCard";
import { VocabCardsSkeleton, VocabErrorState } from "../components/VocabStates";
import { useVocabSection } from "../hooks";

export function SectionSets({ sectionId }: { sectionId: number }) {
  const q = useVocabSection(sectionId);

  const wordTotal = useMemo(
    () => (q.data?.sets ?? []).reduce((n, s) => n + s.word_count, 0),
    [q.data],
  );

  const valid = Number.isFinite(sectionId) && sectionId > 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-12">
      <Link
        href="/vocabulary"
        className="ds-ring inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to vocabulary
      </Link>

      {!valid || q.isError ? (
        <VocabErrorState
          title="This section isn't available"
          description="It may have been unpublished. Head back to the vocabulary hub and pick another one."
          onRetry={() => void q.refetch()}
        />
      ) : q.isLoading || !q.data ? (
        <>
          <div className="flex flex-col gap-2">
            <p className="ds-overline text-primary">Question bank</p>
            <h1 className="ds-h1">Loading section…</h1>
          </div>
          <VocabCardsSkeleton count={4} />
        </>
      ) : (
        <>
          <div>
            <p className="ds-overline text-primary">Question bank</p>
            <h1 className="ds-h1 mt-1">{q.data.title}</h1>
            {q.data.description ? <p className="ds-small mt-1 max-w-2xl">{q.data.description}</p> : null}
            <div className="ds-num mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] font-semibold text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" />
                {q.data.sets.length} {q.data.sets.length === 1 ? "set" : "sets"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Type className="h-3.5 w-3.5" />
                {wordTotal} {wordTotal === 1 ? "word" : "words"}
              </span>
            </div>
          </div>

          {q.data.sets.length === 0 ? (
            <EmptyState
              icon={Library}
              title="This section has no sets yet"
              description="Sets show up as soon as the words are published. Try another section in the meantime."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {q.data.sets.map((s) => (
                <SetCard
                  key={s.id}
                  title={s.title}
                  href={`/vocabulary/sets/${s.id}`}
                  wordCount={s.word_count}
                  completed={s.completed}
                  progress={s.progress}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
