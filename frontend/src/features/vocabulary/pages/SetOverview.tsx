"use client";

/**
 * /vocabulary/sets/[setId] — one set's launcher. Identical for a bank set and a
 * student's own custom set; only the breadcrumb and the "edit words" affordance
 * differ.
 *
 * The set payload carries per-word status but no aggregate, so the ring and the
 * bar are derived here from the word list — one fewer field for the API to keep
 * in sync with the filter that sits right below it.
 */

import { useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Pencil, Type } from "lucide-react";

import { Alert, Badge, Button, Card, CardContent, ProgressRing, Skeleton } from "@/components/ui";

import { MasteryBar, masteredPercent } from "../components/MasteryBar";
import { StudyModeCard } from "../components/StudyModeCard";
import { VocabErrorState, VocabRowsSkeleton } from "../components/VocabStates";
import { WordList } from "../components/WordList";
import { useVocabSet } from "../hooks";
import { STUDY_MODES, type ProgressCounts } from "../types";

export function SetOverview({ setId }: { setId: number }) {
  const q = useVocabSet(setId);
  const set = q.data;

  const progress = useMemo<ProgressCounts>(() => {
    const counts: ProgressCounts = { new: 0, learning: 0, mastered: 0, total: 0 };
    for (const w of set?.words ?? []) {
      counts[w.status] += 1;
      counts.total += 1;
    }
    return counts;
  }, [set]);

  const valid = Number.isFinite(setId) && setId > 0;
  const backHref = set?.section ? `/vocabulary/sections/${set.section.id}` : "/vocabulary";
  const backLabel = set?.section ? `Back to ${set.section.title}` : "Back to vocabulary";

  if (!valid || q.isError) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6 pb-12">
        <BackLink href="/vocabulary" label="Back to vocabulary" />
        <VocabErrorState
          title="This set isn't available"
          description="It may have been removed, or it belongs to another student. Pick another set from the hub."
          onRetry={() => void q.refetch()}
        />
      </div>
    );
  }

  if (q.isLoading || !set) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6 pb-12">
        <BackLink href="/vocabulary" label="Back to vocabulary" />
        <Skeleton className="h-28 rounded-2xl" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
        <VocabRowsSkeleton count={5} />
      </div>
    );
  }

  const empty = set.words.length === 0;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 pb-12">
      <BackLink href={backHref} label={backLabel} />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-5">
          <div className="min-w-0 flex-1">
            <p className="ds-overline text-primary">{set.section ? set.section.title : "My set"}</p>
            <h1 className="ds-h1 mt-1">{set.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="neutral">
                <Type className="h-3 w-3" />
                <span className="ds-num">{set.word_count}</span> {set.word_count === 1 ? "word" : "words"}
              </Badge>
              {set.completed ? (
                <Badge variant="success">
                  <CheckCircle2 className="h-3 w-3" /> Completed
                </Badge>
              ) : null}
              {set.is_custom ? (
                <Link href={`/vocabulary/new-set?set=${set.id}`} className="ds-ring rounded-lg">
                  <Button variant="ghost" size="sm" leftIcon={<Pencil />} tabIndex={-1}>
                    Edit words
                  </Button>
                </Link>
              ) : null}
            </div>
            <MasteryBar progress={progress} legend className="mt-4 max-w-md" />
          </div>
          <ProgressRing
            value={masteredPercent(progress)}
            size={88}
            strokeWidth={7}
            color={masteredPercent(progress) >= 100 ? "text-success" : "text-primary"}
            className="shrink-0"
          />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="ds-h3">Study this set</h2>
          <p className="ds-small mt-0.5">Finishing any one mode marks the set complete.</p>
        </div>
        {empty ? (
          <Alert tone="warning" title="Nothing to study yet">
            This set has no words, so the study modes stay locked.
            {set.is_custom ? " Add a few words and they will unlock straight away." : ""}
          </Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STUDY_MODES.map((mode) => (
            <StudyModeCard key={mode} mode={mode} setId={set.id} disabled={empty} />
          ))}
        </div>
      </div>

      <WordList words={set.words} />
    </div>
  );
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="ds-ring inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> {label}
    </Link>
  );
}
