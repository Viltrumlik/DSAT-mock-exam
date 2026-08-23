"use client";

/**
 * Register for the SAT — instructions, an explicit agreement, then the way through.
 *
 * The gate is the point. Registration finishes in a Telegram conversation with the school's
 * registrar, and a student who arrives there without having read what they need to have ready
 * wastes the registrar's time as well as their own. So the Telegram button does not exist
 * until the box is ticked — not disabled, absent — because a greyed-out button invites
 * clicking rather than reading.
 *
 * Nothing here is recorded. Ticking the box is the student telling themselves they have read
 * it, not a consent the school stores or can later produce. If the school ever needs to prove
 * a student agreed to something, that is a different feature with a row behind it, and this
 * dialog should not be quietly repurposed into it.
 */

import { useState } from "react";
import { ExternalLink, MessageCircle } from "lucide-react";
import { Alert, Button, Modal } from "@/components/ui";

/**
 * Where registration actually happens.
 *
 * The school's registrar account, given by the school: @MS_register. Kept as a named constant
 * rather than inlined in the JSX so there is exactly one place to change it, and so it is
 * greppable the day somebody asks "where does this send students?".
 */
const TELEGRAM_HANDLE = "MS_register";
const TELEGRAM_URL = `https://t.me/${TELEGRAM_HANDLE}`;

/**
 * ⚠️ PLACEHOLDER COPY — the school is supplying the real wording.
 *
 * Written to be structurally right (what to bring, what it costs, what happens next) so the
 * dialog can be looked at and the layout judged, but every line here is a guess and none of
 * it should reach a student. Replace the whole array; the component reads its length and
 * nothing else, so swapping in more or fewer steps needs no other change.
 */
const INSTRUCTIONS: { title: string; body: string }[] = [
  {
    title: "Have your passport ready",
    body: "Registration uses the name and date of birth exactly as they appear on your passport. A name that does not match will stop you sitting the exam on the day.",
  },
  {
    title: "Know which test date you want",
    body: "Check the SAT dates with your teacher first. Registration closes several weeks before each sitting, and late registration costs more.",
  },
  {
    title: "Have a photo that meets the rules",
    body: "A clear, recent head-and-shoulders photo against a plain background. No hat, no sunglasses, and your whole face visible.",
  },
  {
    title: "Be ready to pay the exam fee",
    body: "The fee is paid to College Board, not to the school. The registrar will tell you the current amount and how to pay it.",
  },
  {
    title: "The registrar finishes it with you on Telegram",
    body: "Send them a message and they will take you through the rest. Do not send your passport photo to anyone else.",
  },
];

export function RegisterForSatDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [agreed, setAgreed] = useState(false);

  const close = () => {
    // Reset the tick on close. A student who reopens this has to read it again, which is
    // cheap, and it stops a stale agreement from an earlier session standing in for one now.
    setAgreed(false);
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title="Register for the SAT">
      <div className="space-y-4">
        <p className="text-sm font-semibold text-muted-foreground">
          Read these before you message the registrar — having it all ready is what makes
          registration take five minutes instead of a week.
        </p>

        <ol className="space-y-3">
          {INSTRUCTIONS.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span
                aria-hidden
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-extrabold text-primary"
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground">{step.title}</p>
                <p className="text-sm font-medium text-muted-foreground">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border p-3 text-sm font-semibold">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5"
          />
          <span>I&apos;ve read this and I have everything I need.</span>
        </label>

        {/* Absent until agreed, not disabled — see the header comment. */}
        {agreed ? (
          <a
            href={TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-extrabold text-primary-foreground no-underline"
            onClick={close}
          >
            <MessageCircle className="h-4 w-4" aria-hidden />
            Message @{TELEGRAM_HANDLE} on Telegram
            <ExternalLink className="h-3.5 w-3.5 opacity-80" aria-hidden />
          </a>
        ) : (
          <Alert tone="info">Tick the box above and the Telegram link will appear.</Alert>
        )}

        <div className="flex justify-end">
          <Button variant="secondary" onClick={close}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
