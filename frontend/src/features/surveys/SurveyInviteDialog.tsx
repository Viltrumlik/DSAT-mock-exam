"use client";

/**
 * The survey invitation a student meets right after signing in.
 *
 * The learning center's ask: publish a survey, and the next time a student signs in they are
 * *told* — by name, with what it pays — rather than left to notice a button.
 *
 * There is already a survey button in the top bar (`StudentHeaderExtras`), and it stays. This
 * is not a replacement for it, it is the thing that gets a student to press it once. The push
 * opt-in went through exactly this arc — a row in the bell drawer, then a card in the page,
 * both reported by the school as "students are not seeing it", both measured as such in
 * production — and only a modal moved the number. A survey has the same shape of problem: it
 * exists for two weeks, then closes, and a prompt nobody looks at costs the school the answers.
 *
 * The rules that keep it a prompt and not a nag:
 *
 *   * **Once per sign-in, per survey.** The marker lives in `sessionStorage` (see
 *     `lib/surveyInvitePrompt`), so closing it silences that survey until the student signs in
 *     again — not for good, which is what a `localStorage` dismissal would have meant for a
 *     survey the school is still chasing replies to.
 *   * **Never on `/surveys` itself.** Interrupting somebody to suggest the page they are
 *     already reading is how a prompt teaches people to dismiss prompts.
 *   * **Students only.** Teachers and admins are shown "everyone" surveys by
 *     `/surveys/open/` too, and the top-bar button reflects that — but the modal interrupts,
 *     and a form written for students should not stop an admin's work to ask.
 *   * **A failed fetch shows nothing.** The top-bar prompt survives an error on purpose (it is
 *     the only desktop route to `/surveys`, so it must not vanish with the network); a modal
 *     has no such duty, and "something might be waiting" is not worth a dialog.
 *
 * The number it names is read from `points_award`, never hard-coded: surveys have been
 * per-survey priced since the school found a one-question pulse and a thirty-question
 * evaluation both paying 40, and a survey worth 0 is a legitimate thing an admin can create.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList } from "lucide-react";

import { Modal } from "@/components/ui";
import { RewardCoin } from "@/components/RewardCoin";
import { useMe } from "@/hooks/useMe";
import { markSurveyInviteShown, wasSurveyInviteShown } from "@/lib/surveyInvitePrompt";

import { useOpenSurveys } from "./surveysHooks";

/** Long enough for the page behind it to settle, short enough to still read as "on sign-in". */
const OPEN_DELAY_MS = 1500;

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function SurveyInviteDialog() {
  const { me } = useMe();
  const pathname = usePathname();
  const surveys = useOpenSurveys();

  // Newest first — the server orders `/surveys/open/` by `-created_at`, so the survey that was
  // just published is the one a student is being told about.
  const waiting = surveys.data ?? [];
  const featured = waiting[0] ?? null;
  const featuredId = featured?.id ?? null;

  const role = String((me as { role?: string } | undefined)?.role ?? "").trim().toLowerCase();
  const onSurveysRoute = (pathname || "").startsWith("/surveys");
  const eligible = role === "student" && !onSurveysRoute && featured != null;

  // Read after mount, never during render: `sessionStorage` does not exist while the server
  // renders, and seeding state from it directly would hydrate-mismatch. Starting at `false`
  // means the default is "stay shut" — a flash of a prompt the student already closed is
  // worse than showing it a beat late.
  const [owed, setOwed] = useState(false);
  useEffect(() => {
    setOwed(featuredId != null && !wasSurveyInviteShown(featuredId));
  }, [featuredId]);

  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!owed || !eligible || featuredId == null) {
      setOpen(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setOpen(true);
      // Marked when it is actually seen, not when the component mounts: a student who signs in
      // and immediately navigates away has not been asked, and should be asked next time.
      markSurveyInviteShown(featuredId);
    }, OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [owed, eligible, featuredId]);

  if (!eligible || featured == null) return null;

  // Closing by any route — the ×, the backdrop, Escape, "Maybe later" — settles it for this
  // sign-in. `owed` is cleared as well as `open`, because `eligible` flips every time the
  // student walks onto and off `/surveys`, and without this the dialog would re-open behind
  // them each time they came back.
  const close = () => {
    setOpen(false);
    setOwed(false);
  };

  const points = featured.points_award;
  const others = waiting.length - 1;

  return (
    <Modal
      open={open}
      onClose={close}
      title="You have a survey waiting"
      description="Tell the learning center how it's going — it stays between you and the office."
    >
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <ClipboardList className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-foreground">{featured.title}</p>
          <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
            <span className="ds-num">{featured.question_count}</span>
            {` question${featured.question_count === 1 ? "" : "s"}`}
            {featured.closes_at ? ` · closes ${fmtDate(featured.closes_at)}` : ""}
            {/* Said before they open it, not after they have typed an opinion they would
                rather not sign. */}
            {featured.allow_anonymous ? " · can be anonymous" : ""}
          </p>

          {/* Read from the survey, never written into the sentence: an admin can price a
              survey at anything, and a prompt that promises 40 while the ledger pays 10 is
              worse than a prompt that mentions no number at all. A survey worth nothing gets
              the honest version of the sentence instead. */}
          {points > 0 ? (
            <p className="mt-3 flex items-center gap-2 text-sm font-bold text-foreground">
              {/* The minted point, not a line icon of a coin. A coin is a different object in
                  this product — a currency minted FROM points and gone once spent — so a coin
                  beside a points sentence names the wrong thing. `xs` is the size this device
                  documents for sitting inline beside a number. */}
              <RewardCoin kind="point" size="xs" />
              <span>
                Finishing it earns you <span className="ds-num">{points}</span> points.
              </span>
            </p>
          ) : (
            <p className="mt-3 text-sm font-semibold text-muted-foreground">
              It only takes a minute.
            </p>
          )}

          {others > 0 ? (
            <p className="mt-2 text-xs font-medium text-muted-foreground">
              {`And ${others} more ${others === 1 ? "survey is" : "surveys are"} waiting after this one.`}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={close}
          className="ds-ring rounded-xl px-4 py-2 text-sm font-extrabold text-muted-foreground"
        >
          Maybe later
        </button>
        <Link
          // Straight into the form when one is waiting; to the list when there is a choice to
          // make. The same rule the top-bar button follows, so the two cannot disagree about
          // where "the survey" is.
          href={others > 0 ? "/surveys" : `/surveys/${featured.id}`}
          onClick={close}
          className="ds-ring rounded-xl bg-primary px-4 py-2 text-sm font-extrabold text-primary-foreground"
        >
          Take the survey
        </Link>
      </div>
    </Modal>
  );
}
