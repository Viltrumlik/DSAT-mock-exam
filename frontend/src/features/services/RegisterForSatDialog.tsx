"use client";

/**
 * Register for the SAT — the school's checklist, an explicit agreement, then the way through.
 *
 * The gate is the point. Registration finishes in a Telegram conversation with the school's
 * registrar, and a student who arrives there without the six items ready wastes the
 * registrar's time as well as their own — the school says the whole thing takes 2–3 days, and
 * most of that is waiting for a student to go and find something. So the Telegram button does
 * not exist until the box is ticked: absent, not disabled, because a greyed-out button invites
 * clicking rather than reading.
 *
 * Nothing here is recorded. Ticking the box is the student telling themselves they have read
 * it, not a consent the school stores or can later produce. If the school ever needs to prove
 * a student agreed to something, that is a different feature with a row behind it, and this
 * dialog should not be quietly repurposed into one.
 *
 * The wording is the school's own, taken from the registrar's Telegram message so a student
 * reads the same list in both places. Three things are deliberately NOT copied verbatim:
 *
 *  - the payment card is laid out as a labelled row with a copy button rather than as a wall
 *    of digits, because a student typing 16 digits from memory into a banking app is how the
 *    money reaches the wrong account;
 *  - the password line carries a warning. The school asks for it; this at least makes sure the
 *    student is told to change it afterwards, which is the one mitigation available from here;
 *  - the test dates are NOT a hard-coded list. They come from the same admin-managed exam
 *    dates the profile dropdown and the dashboard countdown read, so a sitting the school
 *    retires — or one that has simply passed — leaves this checklist on its own. A student
 *    being told to register for a date that is gone is the failure this avoids, and it is the
 *    one that would otherwise happen every single year. See `TestDates`.
 */

import { useState } from "react";
import { Copy, ExternalLink, MessageCircle } from "lucide-react";
import { Alert, Button, Modal, Skeleton } from "@/components/ui";
import { YouTubeEmbed } from "./YouTubeEmbed";
import { formatExamDate, useExamDates } from "./servicesHooks";

/**
 * Where registration actually happens — the school's registrar account.
 *
 * Named constants rather than values inlined in the JSX so there is exactly one place to
 * change each, and so they are greppable the day somebody asks "where does this send
 * students, and whose card is that?".
 */
const TELEGRAM_HANDLE = "MS_register";
const TELEGRAM_URL = `https://t.me/${TELEGRAM_HANDLE}`;

/** From https://youtu.be/yQkYwOg5_lc — how to create a College Board account. */
const ACCOUNT_VIDEO_ID = "yQkYwOg5_lc";

const FEE_UZS = "1,500,000";
const CARD_NUMBER = "5614681600990570";
const CARD_HOLDER = "Abdulahad Ne'matjonov";

const TEST_CENTERS = ["Presidential School in Fergana", "Ecocity"];

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-extrabold text-primary"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-foreground">{title}</p>
        {children ? <div className="mt-1.5">{children}</div> : null}
      </div>
    </li>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused (an insecure origin, a locked-down browser). The
      // number is on screen and selectable, so the copy button is a convenience — failing
      // silently is right, and an error toast about the clipboard would be noise.
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="truncate font-mono text-sm font-bold text-foreground">{value}</p>
      </div>
      <button
        type="button"
        onClick={copy}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-bold text-foreground"
      >
        <Copy className="h-3.5 w-3.5" aria-hidden />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/**
 * The dates the school is currently offering, from the admin-managed list.
 *
 * Four branches, and the difference between the last two is the whole reason this is a
 * component rather than three lines inline. "We could not load the dates" and "the school is
 * offering no dates" are different instructions to a student standing in front of a
 * registration checklist: one means try again, the other means go and ask. Collapsing them —
 * which every other caller of this endpoint does, via `.catch(() => [])` — would tell a
 * student the school has stopped running the SAT because their wifi dropped.
 *
 * Both non-happy paths still point at the registrar, so the checklist is never a dead end.
 */
function TestDates() {
  const dates = useExamDates();

  if (dates.isPending) {
    return <Skeleton className="h-8 w-48 rounded-lg" />;
  }

  if (dates.isError) {
    return (
      <p className="text-sm font-medium text-muted-foreground">
        Couldn&apos;t load the dates.{" "}
        <button
          type="button"
          className="font-bold text-primary underline underline-offset-2"
          onClick={() => void dates.refetch()}
        >
          Try again
        </button>{" "}
        — or just ask the registrar which are open.
      </p>
    );
  }

  if (dates.data.length === 0) {
    return (
      <p className="text-sm font-medium text-muted-foreground">
        No dates are open just now. Ask the registrar when the next one opens.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {dates.data.map((option) => (
        <span
          key={option.id}
          className="rounded-lg bg-surface-2 px-2.5 py-1 text-sm font-bold text-foreground"
        >
          {formatExamDate(option)}
        </span>
      ))}
    </div>
  );
}


export function RegisterForSatDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [agreed, setAgreed] = useState(false);

  const close = () => {
    // Reset the tick on close. A student who reopens this reads it again, which is cheap, and
    // it stops a stale agreement from an earlier session standing in for one now.
    setAgreed(false);
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title="Register for the SAT">
      <div className="space-y-4">
        <p className="text-sm font-semibold text-foreground">
          Send these six things to the registrar on Telegram.
        </p>

        <ol className="space-y-4">
          <Step n={1} title="Your College Board account">
            <p className="text-sm font-medium text-muted-foreground">
              Don&apos;t have one yet? Watch this and create it first.
            </p>
            <div className="mt-2">
              <YouTubeEmbed
                videoId={ACCOUNT_VIDEO_ID}
                title="How to create a College Board account"
              />
            </div>
          </Step>

          <Step n={2} title="Your College Board password">
            {/* Alert draws its own tone icon, so this carries text only. */}
            <Alert tone="warning">
              <span className="text-sm font-semibold">
                Send this only to the registrar, and change your password once your
                registration is confirmed. Never send it to anyone else who asks.
              </span>
            </Alert>
          </Step>

          <Step n={3} title="Test center">
            <ul className="space-y-1">
              {TEST_CENTERS.map((c) => (
                <li key={c} className="text-sm font-medium text-muted-foreground">
                  • {c}
                </li>
              ))}
            </ul>
          </Step>

          <Step n={4} title="Test date">
            <TestDates />
          </Step>

          <Step n={5} title="A photo showing your face clearly">
            <p className="text-sm font-medium text-muted-foreground">
              Like a passport photo, but not the same one — take a new picture.
            </p>
          </Step>

          <Step n={6} title={`Payment — ${FEE_UZS} UZS`}>
            <div className="space-y-2">
              <CopyRow label="Card" value={CARD_NUMBER} />
              <CopyRow label="Cardholder" value={CARD_HOLDER} />
              <p className="text-sm font-medium text-muted-foreground">
                Send the screenshot of your payment to the registrar.
              </p>
            </div>
          </Step>
        </ol>

        <Alert tone="info">
          Registration takes around 2–3 days. Please be patient — the registrar will message
          you when it&apos;s done.
        </Alert>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border p-3 text-sm font-semibold">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5"
          />
          <span>I&apos;ve read this and I have everything ready.</span>
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
