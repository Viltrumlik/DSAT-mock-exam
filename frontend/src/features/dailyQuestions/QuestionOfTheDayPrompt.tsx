"use client";

/**
 * The Question of the Day prompt, top right on every student page (owner, 2026-10-31: the
 * dashboard card is gone; "tepada o'ngda notificationga o'xshab … yo'qolmaydi student yechishni
 * yoki yechmaslikni tanlamagunicha").
 *
 * It has no close button and no timeout: it leaves only when the student decides. "Solve" opens
 * the runner for that subject; "Not today" hides it until the server deals tomorrow's questions.
 * Opening the runner and leaving without answering is not a decision — the prompt is back on the
 * next page, because the question is still there to answer.
 *
 * Not a dialog: it does not trap focus or dim the page, and the sign-in dialogs (push, survey,
 * event) paint their scrim over it. It is mounted only in the shell's normal branch, so it never
 * interrupts a runner, a test or the Question of the Day page itself.
 */

import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui";
import { rewardLabel, trackLabel } from "./dailyQuestionsFormat";
import { useTodaysQuestions } from "./dailyQuestionsHooks";
import { useQotdSkip } from "./useQotdSkip";

export const QOTD_PATH = "/question-of-the-day";

export function QuestionOfTheDayPrompt({ userId }: { userId: number | null | undefined }) {
  const router = useRouter();
  const today = useTodaysQuestions();
  const skip = useQotdSkip(userId, today.data?.date);

  // A failed fetch says nothing here: a corner toast reporting an error on every page would be
  // noise, and the next page's fetch tries again.
  if (!today.data || !skip.ready || skip.skipped) return null;
  const { enabled, questions, reward } = today.data;
  const open = enabled ? questions.filter((q) => q.status === "open") : [];
  if (open.length === 0) return null;

  return (
    <section
      aria-labelledby="qotd-prompt-title"
      className="ds-anim-slide-right fixed left-3 right-3 top-[76px] z-[45] rounded-2xl border border-border bg-card p-4 shadow-modal md:left-auto md:right-6 md:w-[360px]"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
          <Sparkles className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id="qotd-prompt-title" className="text-[15px] font-extrabold leading-tight">
            Question of the Day
          </h2>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
            {open.length > 1
              ? "Your English and Math questions are waiting"
              : `Your ${trackLabel(open[0])} question is waiting`}
            {" "}— one try, and right first time earns {rewardLabel(reward)}.
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        {open.map((q, i) => (
          <Button
            key={q.id}
            size="sm"
            fullWidth
            variant={i === 0 ? "primary" : "secondary"}
            onClick={() => router.push(`${QOTD_PATH}?subject=${q.subject}`)}
          >
            {open.length > 1 ? `Solve ${trackLabel(q)}` : "Solve now"}
          </Button>
        ))}
        <Button size="sm" fullWidth variant="ghost" onClick={skip.skip}>
          Not today
        </Button>
      </div>
    </section>
  );
}
