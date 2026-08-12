"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/cn";

const SCALE = [1, 2, 3, 4, 5] as const;

/** What each star means, said out loud. Five unlabelled stars are a Rorschach test — one
 *  student's 3 is another's 5 — and a screen reader gets nothing from "3 button". */
const MEANING: Record<number, string> = {
  1: "Didn't help",
  2: "A little help",
  3: "Helped",
  4: "Really helped",
  5: "Exactly what I needed",
};

/**
 * The student's verdict on a session their teacher has marked attended.
 *
 * It rates the HOUR, not the student, and it is deliberately disconnected from points:
 * settling as HELD is what pays, whatever the rating says. Tying the money to the review
 * would put the teacher's interest against the student's honesty.
 *
 * Already rated? It still shows, and still submits — a student who misclicks 1 is not stuck
 * with it.
 */
export function SessionRating({
  rating, comment, pending, onRate,
}: {
  rating: number | null;
  comment: string;
  pending: boolean;
  onRate: (rating: number, comment: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number | null>(rating);
  const [note, setNote] = useState(comment);
  const [hovered, setHovered] = useState<number | null>(null);

  if (rating != null && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ds-ring inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-bold text-muted-foreground hover:bg-surface-2"
        aria-label={`You rated this ${rating} out of 5 — ${MEANING[rating]}. Change it.`}
      >
        {SCALE.map((n) => (
          <Star
            key={n}
            aria-hidden
            className={cn("h-3.5 w-3.5", n <= rating ? "fill-amber-400 text-amber-400" : "text-border")}
          />
        ))}
      </button>
    );
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Rate this session
      </Button>
    );
  }

  const shown = hovered ?? picked ?? 0;
  return (
    <div className="w-full space-y-2 rounded-xl border border-border bg-surface-2 p-3">
      <p className="text-xs font-bold text-foreground">How was this session?</p>
      <div className="flex items-center gap-1" onMouseLeave={() => setHovered(null)}>
        {SCALE.map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} out of 5 — ${MEANING[n]}`}
            aria-pressed={picked === n}
            onMouseEnter={() => setHovered(n)}
            onFocus={() => setHovered(n)}
            onBlur={() => setHovered(null)}
            onClick={() => setPicked(n)}
            className="ds-ring rounded p-0.5"
          >
            <Star
              aria-hidden
              className={cn(
                "h-6 w-6 transition-colors",
                n <= shown ? "fill-amber-400 text-amber-400" : "text-border",
              )}
            />
          </button>
        ))}
        <span className="ml-2 text-xs font-semibold text-muted-foreground">
          {shown ? MEANING[shown] : "Pick a star"}
        </span>
      </div>
      <Input
        inputSize="sm"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Anything you'd like your teacher to know (optional)"
        maxLength={500}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={picked == null || pending}
          loading={pending}
          onClick={() => {
            if (picked != null) onRate(picked, note.trim());
            setOpen(false);
          }}
        >
          Send
        </Button>
        <Button variant="ghost" size="sm" onClick={() => { setOpen(false); setPicked(rating); setNote(comment); }}>
          Not now
        </Button>
      </div>
    </div>
  );
}
