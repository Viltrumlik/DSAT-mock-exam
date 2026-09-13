"use client";

/**
 * /vocabulary/sections/[sectionId] — every set in one published bank section.
 *
 * Header card follows the classroom-detail idiom: icon square + title + pills,
 * with the section's real aggregates as stat tiles underneath.
 */

import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Layers,
  Library,
  Trophy,
  Type,
  type LucideIcon,
} from "lucide-react";

import {
  Badge,
  Card,
  CardContent,
  EmptyState,
  ExplainButton,
  ProgressRing,
  Skeleton,
} from "@/components/ui";
import { cn } from "@/lib/cn";

import { SetCard } from "../components/SetCard";
import { VocabCardsSkeleton, VocabErrorState } from "../components/VocabStates";
import { useVocabSection } from "../hooks";
import { sectionLook } from "../sectionTone";

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
            <span
              aria-hidden
              className={cn(
                "absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r",
                look.edge,
              )}
            />
            <CardContent className="relative flex flex-col gap-5">
              <div className="flex items-start gap-3.5">
                <span
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                    look.icon,
                  )}
                >
                  <look.Icon className="h-5 w-5" aria-hidden />
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
                      The ring counts the{" "}
                      <strong className="font-bold text-foreground">
                        sets
                      </strong>{" "}
                      you have finished in this section. The four-colour bar on
                      each card below is that set&rsquo;s four games — one
                      colour each — filled once you play that game with every
                      word right.
                    </ExplainButton>
                  </div>
                  {q.data.description ? (
                    <p className="ds-small mt-1.5 max-w-2xl">
                      {q.data.description}
                    </p>
                  ) : null}
                </div>

                <span
                  className="shrink-0"
                  title={`${masteredSets} of ${sets.length} sets mastered`}
                >
                  <ProgressRing
                    value={masteredPct}
                    size={64}
                    strokeWidth={6}
                    color={masteredPct >= 100 ? "text-success" : look.ring}
                    trackColor={
                      masteredPct >= 100 ? "text-success/20" : look.ringTrack
                    }
                  />
                </span>
              </div>

              {/* Inside the card, on its own white — no tray under them. Three blocks on
                  a white card, told apart from it by a one-pixel edge and the weight of
                  their shadow, which is the whole of the device now. */}
              <div className="mt-1">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Fact
                    icon={Layers}
                    label="Sets"
                    value={sets.length}
                    detail={
                      startedSets > 0
                        ? `${startedSets} already started`
                        : "none started yet"
                    }
                    index={0}
                  />
                  <Fact
                    icon={Type}
                    label="Words"
                    value={wordCount}
                    detail={`${masteredWords} of them mastered`}
                    index={1}
                  />
                  <Fact
                    icon={Trophy}
                    label="Sets mastered"
                    value={masteredSets}
                    detail={`${masteredPct}% of this section`}
                    index={2}
                    accent={look.text}
                  />
                </div>
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
 * One of the three aggregates under a section's title — a block of quartz.
 *
 * Three goes at this. Flat white rectangles were called plain. Tinting them in the
 * section's colour made each one a miniature of the card it sat inside, at which point
 * the page had one rounded tinted rectangle at three sizes: *"ranglar ko'payib ketgan …
 * shapelar juda katta va takrorlayapti kattasini"*. Taking the colour back out returned
 * them to plain.
 *
 * The bind is that decoration was being attempted with hue, and hue was the thing there
 * was already too much of. So these are decorated with **material** instead — the `.quartz`
 * block in globals.css: a lit top facet, a shaded bottom one, a cleavage sheen across the
 * corner, real weight underneath, and a lift under the cursor. That is a great deal of
 * ornament and not one new colour on the page.
 *
 * The glyph is carved rather than printed: outsized, cropped by the block's own edge, at
 * four per cent of the foreground with a white shadow a pixel below it, which is what
 * reads as an engraving in stone rather than an icon sitting on top of it.
 */
function Fact({
  icon: Icon,
  label,
  value,
  detail,
  index,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  /** A second, DIFFERENT fact. Never a restatement of `value`. */
  detail: string;
  index: number;
  /** Text colour for the number. Default is plain foreground. */
  accent?: string;
}) {
  return (
    <div
      className="quartz quartz-float cr-cardrise relative h-full overflow-hidden rounded-2xl px-5 py-4"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <Icon
        aria-hidden
        className="pointer-events-none absolute -bottom-4 -right-3 h-[86px] w-[86px] text-foreground/[0.05]"
        strokeWidth={1.25}
      />
      <div className="relative">
        <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
          {label}
        </p>
        <p
          className={cn(
            "ds-num mt-1.5 text-[26px] font-extrabold leading-none tracking-tight",
            accent ?? "text-foreground",
          )}
        >
          {value}
        </p>
        <p className="mt-1.5 text-[12px] font-medium text-muted-foreground">
          {detail}
        </p>
      </div>
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <Card className="cr-cardrise overflow-hidden" aria-hidden>
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
        {/* The three blocks, so the card does not change height on load. */}
        <div className="mt-1">
          <div className="grid gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[104px] rounded-2xl" />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
