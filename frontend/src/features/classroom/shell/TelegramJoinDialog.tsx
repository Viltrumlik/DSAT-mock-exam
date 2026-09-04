"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Send, ShieldCheck } from "lucide-react";

import TelegramLoginButton from "@/components/TelegramLoginButton";
import { usersApi } from "@/lib/api";
import { Button, Dialog, ErrorState, Spinner } from "../ui";
import { useJoinTelegramGroup, useTelegramGroup } from "../telegramHooks";
import type { TelegramGroupState } from "../telegramApi";

/**
 * What a student reads before they are given a way into the class group.
 *
 * The rules come from the server rather than being written here, because the bot enforces
 * them and the two must not be able to drift: a page that promises one thing while the bot
 * does another is worse than a page that says nothing.
 *
 * Three steps, and the student is only ever shown the one they are on — connect Telegram,
 * read what the link is, take the link. Nothing here removes anybody or explains a removal
 * after the fact; that arrives as a notification, because by then they are not on this page.
 */

function Rules({ rules }: { rules: string[] }) {
  return (
    <ol className="mt-1 space-y-2.5">
      {rules.map((rule, i) => (
        <li key={rule} className="flex gap-3 text-[13px] leading-relaxed text-muted-foreground">
          <span className="mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-bold text-foreground">
            {i + 1}
          </span>
          <span>{rule}</span>
        </li>
      ))}
    </ol>
  );
}

function InviteLink({ state }: { state: TelegramGroupState }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(state.invite_link);
      setCopied(true);
    } catch {
      // Clipboard access is refused in plenty of ordinary situations (an insecure origin, a
      // locked-down browser). The link is on screen and the Open button works either way, so
      // the honest response is to leave the button unchanged rather than raise an error
      // about a convenience.
    }
  }, [state.invite_link]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <div className="rounded-xl border border-border bg-surface-2 p-4">
      <p className="text-[13px] font-semibold text-foreground">Your invite is ready</p>
      <p className="mt-1 text-[12px] text-muted-foreground">
        It works once, for your Telegram account only, and expires in about{" "}
        {state.invite_ttl_minutes} minutes.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={state.invite_link}
          target="_blank"
          rel="noopener noreferrer"
          className="ds-ring inline-flex items-center gap-1.5 rounded-xl bg-[#2AABEE] px-3.5 py-2 text-[13px] font-bold text-white transition-opacity hover:opacity-90"
        >
          <ExternalLink className="h-[15px] w-[15px]" aria-hidden /> Open in Telegram
        </a>
        <Button variant="secondary" size="sm" icon={copied ? Check : Copy} onClick={copy}>
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
    </div>
  );
}

export function TelegramJoinDialog({
  open,
  onClose,
  classId,
  className,
}: {
  open: boolean;
  onClose: () => void;
  classId: number;
  className: string;
}) {
  const { data: state, isLoading, isError, refetch } = useTelegramGroup(classId, open);
  const join = useJoinTelegramGroup(classId);
  const [startUrl, setStartUrl] = useState<string | null>(null);

  // Only fetched once the student is actually looking at a class whose group needs it, and
  // only when they have not already connected — this is a network call to learn a button's
  // href, not something to do on every classroom render.
  useEffect(() => {
    if (!open || !state || state.telegram_linked || startUrl) return;
    let cancelled = false;
    usersApi
      .getTelegramWidgetConfig()
      .then((cfg) => {
        if (!cancelled) setStartUrl(cfg.enabled ? cfg.start_url : null);
      })
      .catch(() => {
        if (!cancelled) setStartUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, state, startUrl]);

  const joinError = join.error as { response?: { data?: { detail?: string } } } | null;
  const errorMessage = joinError?.response?.data?.detail ?? "";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <Send className="h-4 w-4 text-[#2AABEE]" aria-hidden /> Join the {className} Telegram group
        </span>
      }
      description="Read this first — the invite you get is yours alone."
    >
      {/* Four branches, and they are exclusive. A refetch that fails while cached state is
          still on screen must NOT paint "could not load the group" over a dialog that is
          showing a perfectly good invite — the student would read the error and abandon a
          link that works. Failure with nothing to show is the error state; failure with
          something to show is a line saying the screen may be out of date. */}
      {isLoading && !state && (
        <div className="flex justify-center py-8">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      )}

      {isError && !state && (
        <ErrorState
          title="Could not load the group"
          message="Something went wrong reading this class's Telegram group."
          onRetry={() => refetch()}
        />
      )}

      {state && (
        // The rules run to six lines and the action sits under them, so on a phone the
        // button would be below the fold — and the Dialog locks body scroll, which would
        // leave it unreachable rather than merely awkward.
        <div className="max-h-[58vh] space-y-4 overflow-y-auto pr-1">
          {isError && (
            <p className="text-[12px] text-muted-foreground">
              Could not refresh just now — this is the last state we know of.
            </p>
          )}
          <Rules rules={state.rules} />

          {/* Not eligible — frozen, or no longer in the class. Say why, offer nothing. */}
          {!state.eligible && state.message && (
            <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-[13px] leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              {state.message}
            </div>
          )}

          {state.eligible && !state.telegram_linked && (
            <div className="rounded-xl border border-border bg-surface-2 p-4">
              <p className="text-[13px] font-semibold text-foreground">
                Step 1 — connect your Telegram
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                You will come straight back here afterwards.
              </p>
              <div className="mt-3">
                {startUrl ? (
                  <TelegramLoginButton
                    startUrl={startUrl}
                    next={`/classes/${classId}`}
                    label="Connect Telegram"
                  />
                ) : (
                  <p className="text-[12px] text-muted-foreground">
                    Telegram sign-in is not available right now. Please try again later.
                  </p>
                )}
              </div>
            </div>
          )}

          {state.eligible && state.telegram_linked && state.invite_link && (
            <InviteLink state={state} />
          )}

          {state.eligible && state.telegram_linked && !state.invite_link && (
            <div className="rounded-xl border border-border bg-surface-2 p-4">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                <ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> Telegram connected
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {state.status === "JOINED"
                  ? "You are already in the group. Get a new link only if you have left it."
                  : "Press below and the bot will cut you a single-use invite."}
              </p>
              <div className="mt-3">
                <Button
                  variant="primary"
                  size="sm"
                  icon={Send}
                  loading={join.isPending}
                  onClick={() => join.mutate()}
                >
                  {state.status === "JOINED" ? "Get a new link" : "Get my invite link"}
                </Button>
              </div>
              {errorMessage && (
                <p className="mt-3 text-[12px] font-medium text-rose-600 dark:text-rose-400">
                  {errorMessage}
                </p>
              )}
              {join.data?.already_member && !join.data.invite_link && (
                <p className="mt-3 text-[12px] text-muted-foreground">
                  You are already in the group — no new link was needed.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

export default TelegramJoinDialog;
