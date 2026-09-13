"use client";

/**
 * /vocabulary/sections/[sectionId] — every set in one published bank section.
 *
 * Header card follows the classroom-detail idiom: icon square + title + pills,
 * with the section's real aggregates as stat tiles underneath.
 */

import Link from "next/link";
import { ArrowLeft, CheckCircle2, Layers, Library, Type } from "lucide-react";

import { Badge, Card, CardContent, EmptyState, ExplainButton, ProgressRing, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";

import { SetCard } from "../components/SetCard";
import { VocabCardsSkeleton, VocabErrorState } from "../components/VocabStates";
import { useVocabSection } from "../hooks";
import { sectionLook, type VocabToneClasses } from "../sectionTone";

/** "Mastered" is green throughout the feature, section hue or not. */
const SUCCESS: Pick<VocabToneClasses, "icon" | "wash" | "edge" | "text"> = {
  icon: "bg-success/15 text-success-foreground",
  wash: "border-success/25 bg-success-soft",
  edge: "from-success via-success/40 to-transparent",
  text: "text-success-foreground",
};

export function SectionSets({ sectionId }: { sectionId: number }) {
  const q = useVocabSection(sectionId);
  // The colour the hub card wore, carried through the click — a section is the same
  // place on both pages and should look like it.
  const look = sectionLook(sectionId);

  const sets = q.data?.sets ?? [];
  // Words comes from the SECTION's own aggregate, the same one the hub card shows. Summing
  // the sets would count a word that appears in two of them twice, so the hub said 25 and
  // this page said 50 one click later.
  const wordCount = q.data?.word_count ?? 0;
  // The ring counts SETS mastered, matching the hub card and the bars on the cards below.
  const masteredSets = q.data?.mastery?.mastered_sets ?? 0;

  const valid = Number.isFinite(sectionId) && sectionId > 0;
  const masteredPct = q.data?.mastery?.percent ?? 0;
  // Distinct words already proved, and sets with at least one finished game — both from
  // the payload the page already has, neither shown anywhere before.
  const masteredWords = q.data?.progress?.mastered ?? 0;
  const startedSets = sets.filter((s) => s.completed).length;
  const allDone = sets.length > 0 && sets.every((s) => s.mastery?.is_mastered);

  return (
    <div
      className="mx-auto flex max-w-6xl flex-col gap-7 pb-14"
      style={{ fontFamily: "var(--font-plus-jakarta), system-ui, sans-serif" }}
    >
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
          <HeaderSkeleton />
          <VocabCardsSkeleton count={4} className="lg:grid-cols-3" />
        </>
      ) : (
        <>
          <Card className="cr-cardrise relative overflow-hidden">
            <span aria-hidden className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br", look.glow)} />
            <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", look.edge)} />
            <CardContent className="relative flex flex-col gap-5">
              <div className="flex items-start gap-4">
                <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", look.icon)}>
                  <look.Icon className="h-6 w-6" aria-hidden />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="primary">Question bank</Badge>
                    {allDone ? (
                      <Badge variant="success">
                        <CheckCircle2 className="h-3 w-3" /> Every set mastered
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <h1 className="ds-h1">{q.data.title}</h1>
                    <ExplainButton title="What the ring and the bars mean">
                      The ring counts the <strong className="font-bold text-foreground">sets</strong> you have
                      finished in this section. The four-colour bar on each card below is that set&rsquo;s four
                      games — one colour each — filled once you play that game with every word right.
                    </ExplainButton>
                  </div>
                  {q.data.description ? <p className="ds-small mt-1.5 max-w-2xl">{q.data.description}</p> : null}
                </div>

                <span className="shrink-0" title={`${masteredSets} of ${sets.length} sets mastered`}>
                  <ProgressRing
                    value={masteredPct}
                    size={64}
                    strokeWidth={6}
                    color={masteredPct >= 100 ? "text-success" : look.ring}
                    trackColor={masteredPct >= 100 ? "text-success/20" : look.ringTrack}
                  />
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <StatTile
                  icon={Layers}
                  label="Sets"
                  value={sets.length}
                  detail={startedSets > 0 ? `${startedSets} already started` : "none started yet"}
                  index={0}
                  look={look}
                />
                <StatTile
                  icon={Type}
                  label="Words"
                  value={wordCount}
                  detail={`${masteredWords} of them mastered`}
                  index={1}
                  look={look}
                />
                <StatTile
                  icon={CheckCircle2}
                  label="Sets mastered"
                  value={masteredSets}
                  detail={`${masteredPct}% of this section`}
                  index={2}
                  look={SUCCESS}
                />
              </div>
            </CardContent>
          </Card>

          {sets.length === 0 ? (
            <EmptyState
              className="cr-cardrise"
              icon={Library}
              title="This section has no sets yet"
              description="Sets show up as soon as the words are published. Try another section in the meantime."
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {sets.map((s, i) => (
                <SetCard
                  key={s.id}
                  index={i}
                  title={s.title}
                  href={`/vocabulary/sets/${s.id}`}
                  wordCount={s.word_count}
                  completed={s.completed}
                  mastery={s.mastery}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The three aggregates under a section's title.
 *
 * They were three white rectangles with a hairline border — the one part of the page
 * with no colour and no second fact on it, which the owner picked out by name. Each now
 * wears the section's own hue (the last one green, because "mastered" is green
 * everywhere in this feature) and carries a line that says something the big number
 * cannot: how many of the sets have been opened, how many of the words are already
 * proved, how far through the section that leaves you.
 */
function StatTile({
  icon: Icon,
  label,
  value,
  detail,
  index,
  look,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  /** A second, DIFFERENT fact. Never a restatement of `value`. */
  detail: string;
  index: number;
  look: Pick<VocabToneClasses, "icon" | "wash" | "edge" | "text">;
}) {
  return (
    <div
      className={cn("cr-card relative overflow-hidden rounded-2xl border p-4", look.wash)}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", look.edge)} />
      <div className="flex items-center gap-2.5">
        <span className={cn("cr-iconpop grid h-9 w-9 shrink-0 place-items-center rounded-xl", look.icon)}>
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <p className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">{label}</p>
      </div>
      <p className={cn("ds-num mt-2.5 text-[30px] font-extrabold leading-none tracking-tight", look.text)}>
        {value}
      </p>
      <p className="mt-1.5 text-[12.5px] font-medium leading-snug text-muted-foreground">{detail}</p>
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <Card className="cr-cardrise" aria-hidden>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-start gap-4">
          <Skeleton className="h-12 w-12" />
          <div className="flex flex-1 flex-col gap-2.5">
            <Skeleton variant="circle" className="h-5 w-32" />
            <Skeleton variant="text" className="w-1/2" />
            <Skeleton variant="text" className="w-3/4" />
          </div>
          <Skeleton variant="circle" className="h-16 w-16 shrink-0" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[62px]" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
