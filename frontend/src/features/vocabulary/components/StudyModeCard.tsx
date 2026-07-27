import Link from "next/link";
import { Layers, Shuffle, Timer, ClipboardCheck, type LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui";
import { cn } from "@/lib/cn";

import { STUDY_MODE_LABEL, type StudyMode } from "../types";

/** URL segment per mode — the route is `/vocabulary/sets/<id>/<segment>`. */
export const STUDY_MODE_SEGMENT: Record<StudyMode, string> = {
  flashcard: "flashcards",
  matching: "matching",
  speed: "speed",
  test: "test",
};

const MODE_META: Record<StudyMode, { icon: LucideIcon; blurb: string; iconClass: string }> = {
  flashcard: {
    icon: Layers,
    blurb: "Flip each card and mark what you knew. Missed words come back.",
    iconClass: "bg-primary-soft text-primary",
  },
  matching: {
    icon: Shuffle,
    blurb: "Pair every word with its definition. The clock runs the whole way.",
    iconClass: "bg-accent-soft text-accent",
  },
  speed: {
    icon: Timer,
    blurb: "Sixty seconds. Pick the right meaning as fast as you can.",
    iconClass: "bg-warning-soft text-warning-foreground",
  },
  test: {
    icon: ClipboardCheck,
    blurb: "Multiple choice, true/false and spelling — every word, once.",
    iconClass: "bg-success-soft text-success-foreground",
  },
};

export function StudyModeCard({ mode, setId, disabled }: { mode: StudyMode; setId: number; disabled?: boolean }) {
  const meta = MODE_META[mode];
  const Icon = meta.icon;

  const body = (
    <Card variant={disabled ? "outlined" : "interactive"} className={cn("h-full", disabled && "opacity-60")}>
      <CardContent className="flex h-full flex-col gap-3">
        <span className={cn("flex h-11 w-11 items-center justify-center rounded-xl", meta.iconClass)}>
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h3 className="ds-h4">{STUDY_MODE_LABEL[mode]}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{meta.blurb}</p>
        </div>
      </CardContent>
    </Card>
  );

  if (disabled) return body;

  return (
    <Link href={`/vocabulary/sets/${setId}/${STUDY_MODE_SEGMENT[mode]}`} className="ds-ring block rounded-2xl">
      {body}
    </Link>
  );
}
