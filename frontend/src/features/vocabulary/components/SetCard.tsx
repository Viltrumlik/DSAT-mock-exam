import type { ReactNode } from "react";
import Link from "next/link";
import { BookOpen, CheckCircle2, Gamepad2, Play, Type } from "lucide-react";

import { Button, Card, CardContent } from "@/components/ui";
import { Pill } from "@/features/classroom/ui";
import { cn } from "@/lib/cn";

import type { SetMastery } from "../types";
import { MasteryBar } from "./MasteryBar";

/**
 * One study set, wherever it appears — a section's set list, My sets, a homework
 * group. The card is deliberately not a single <Link>: `trailing` carries real
 * controls (delete), and an anchor cannot legally contain another anchor.
 *
 * A MASTERED set — all four games played clean — is stated three ways so it reads at a
 * glance: a success-tinted icon square, the `bg-success-soft` "Mastered" pill, and a
 * success ring on the card. Short of that the card shows how many games are left, which is
 * the number the student can actually act on. `index` only drives the entrance stagger.
 */
export function SetCard({
  title,
  href,
  wordCount,
  completed,
  subtitle,
  mastery,
  actionLabel = "Practice",
  trailing,
  index = 0,
}: {
  title: string;
  href: string;
  wordCount: number;
  /** Any one game finished. Kept for the "Practice again" wording, never for the badge. */
  completed: boolean;
  subtitle?: ReactNode;
  mastery?: SetMastery | null;
  actionLabel?: string;
  trailing?: ReactNode;
  index?: number;
}) {
  const mastered = Boolean(mastery?.is_mastered);
  // `cr-card` already carries the hover lift, so no `cr-lift` on top of it. The
  // border hover matches Card's `interactive` variant, which this card can't
  // use: it hosts real controls, so it isn't one big click target.
  return (
    <Card
      className={cn(
        "cr-card group flex h-full flex-col hover:border-border-strong",
        mastered && "ring-1 ring-inset ring-success/40",
      )}
      style={{ animationDelay: `${Math.min(index, 12) * 60}ms` }}
    >
      <CardContent className="flex h-full flex-col gap-3.5">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "cr-iconpop flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
              mastered ? "bg-success-soft text-success" : "bg-primary-soft text-primary",
            )}
          >
            {mastered ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <BookOpen className="h-5 w-5" aria-hidden />}
          </span>

          <div className="min-w-0 flex-1">
            <Link href={href} className="ds-ring block rounded-md">
              <h3 className="ds-h4 line-clamp-2 hover:underline">{title}</h3>
            </Link>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-0.5 text-[12px] font-semibold text-muted-foreground">
                <Type className="h-3.5 w-3.5" aria-hidden />
                <span className="ds-num">{wordCount}</span> {wordCount === 1 ? "word" : "words"}
              </span>
              {mastery ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-0.5 text-[12px] font-semibold text-muted-foreground">
                  <Gamepad2 className="h-3.5 w-3.5" aria-hidden />
                  <span className="ds-num">
                    {mastery.mastered_modes}/{mastery.total_modes}
                  </span>{" "}
                  games
                </span>
              ) : null}
              {subtitle ? (
                <span className="max-w-full truncate rounded-full bg-surface-2 px-2.5 py-0.5 text-[12px] font-semibold text-muted-foreground">
                  {subtitle}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {mastered ? (
              <Pill tone="success">
                <CheckCircle2 className="h-3 w-3" /> Mastered
              </Pill>
            ) : null}
            {trailing}
          </div>
        </div>

        {mastery ? <MasteryBar mastery={mastery} /> : null}

        <div className="mt-auto pt-1">
          <Link href={href} className="ds-ring block rounded-xl">
            <Button
              className="cr-press"
              variant={mastered ? "secondary" : "primary"}
              size="sm"
              fullWidth
              leftIcon={<Play />}
              tabIndex={-1}
            >
              {mastered ? "Play again" : completed ? "Keep going" : actionLabel}
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
