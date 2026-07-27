import type { ReactNode } from "react";
import Link from "next/link";
import { BookOpen, CheckCircle2, Play, Type } from "lucide-react";

import { Badge, Button, Card, CardContent } from "@/components/ui";
import { cn } from "@/lib/cn";

import type { ProgressCounts } from "../types";
import { MasteryBar } from "./MasteryBar";

/**
 * One study set, wherever it appears — a section's set list, My sets, a homework
 * group. The card is deliberately not a single <Link>: `trailing` carries real
 * controls (delete), and an anchor cannot legally contain another anchor.
 *
 * A finished set is stated three ways so it reads at a glance: a success-tinted
 * icon square, the `bg-success-soft` "Done" pill, and a success ring on the card.
 * `index` only drives the entrance stagger.
 */
export function SetCard({
  title,
  href,
  wordCount,
  completed,
  subtitle,
  progress,
  actionLabel = "Practice",
  trailing,
  index = 0,
}: {
  title: string;
  href: string;
  wordCount: number;
  completed: boolean;
  subtitle?: ReactNode;
  progress?: ProgressCounts | null;
  actionLabel?: string;
  trailing?: ReactNode;
  index?: number;
}) {
  // `cr-card` already carries the hover lift, so no `cr-lift` on top of it. The
  // border hover matches Card's `interactive` variant, which this card can't
  // use: it hosts real controls, so it isn't one big click target.
  return (
    <Card
      className={cn(
        "cr-card group flex h-full flex-col hover:border-border-strong",
        completed && "ring-1 ring-inset ring-success/40",
      )}
      style={{ animationDelay: `${Math.min(index, 12) * 60}ms` }}
    >
      <CardContent className="flex h-full flex-col gap-3.5">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "cr-iconpop flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
              completed ? "bg-success-soft text-success" : "bg-primary-soft text-primary",
            )}
          >
            {completed ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <BookOpen className="h-5 w-5" aria-hidden />}
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
              {subtitle ? (
                <span className="max-w-full truncate rounded-full bg-surface-2 px-2.5 py-0.5 text-[12px] font-semibold text-muted-foreground">
                  {subtitle}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {completed ? (
              <Badge variant="success">
                <CheckCircle2 className="h-3 w-3" /> Done
              </Badge>
            ) : null}
            {trailing}
          </div>
        </div>

        {progress ? <MasteryBar progress={progress} /> : null}

        <div className="mt-auto pt-1">
          <Link href={href} className="ds-ring block rounded-xl">
            <Button
              className="cr-press"
              variant={completed ? "secondary" : "primary"}
              size="sm"
              fullWidth
              leftIcon={<Play />}
              tabIndex={-1}
            >
              {completed ? "Practice again" : actionLabel}
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
