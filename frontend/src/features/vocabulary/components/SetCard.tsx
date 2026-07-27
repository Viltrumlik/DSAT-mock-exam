import type { ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, Play, Type } from "lucide-react";

import { Badge, Button, Card, CardContent } from "@/components/ui";

import type { ProgressCounts } from "../types";
import { MasteryBar } from "./MasteryBar";

/**
 * One study set, wherever it appears — a section's set list, My sets, a homework
 * group. The card is deliberately not a single <Link>: `trailing` carries real
 * controls (delete), and an anchor cannot legally contain another anchor.
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
}: {
  title: string;
  href: string;
  wordCount: number;
  completed: boolean;
  subtitle?: ReactNode;
  progress?: ProgressCounts | null;
  actionLabel?: string;
  trailing?: ReactNode;
}) {
  return (
    <Card className="flex h-full flex-col">
      <CardContent className="flex h-full flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <Link href={href} className="ds-ring block rounded-md">
              <h3 className="ds-h4 truncate hover:underline">{title}</h3>
            </Link>
            <div className="ds-num mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] font-semibold text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Type className="h-3.5 w-3.5" />
                {wordCount} {wordCount === 1 ? "word" : "words"}
              </span>
              {subtitle ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="truncate">{subtitle}</span>
                </>
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
            <Button variant={completed ? "secondary" : "primary"} size="sm" fullWidth leftIcon={<Play />} tabIndex={-1}>
              {completed ? "Practice again" : actionLabel}
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
