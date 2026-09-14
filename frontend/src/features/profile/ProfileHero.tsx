"use client";

import { Copy, MailCheck, MailWarning, MessageCircle, Pencil, Phone, UserCircle } from "lucide-react";
import { Avatar } from "@/components/ui";
import { cn } from "@/lib/cn";

import { roleLabel } from "./profileModel";
import { pill, TONE, type Tone } from "./profileUi";
import type { ProfileMe } from "./types";

function Chip({ tone, icon: Icon, children, onClick }: {
  tone: Tone;
  icon: typeof Phone;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const className = cn(
    "inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1 font-[inherit] text-[12.5px] font-bold",
    TONE[tone].soft,
  );
  const body = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">{children}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cn("ds-ring cr-press transition-colors", className)}>
      {body}
    </button>
  ) : (
    <span className={className}>{body}</span>
  );
}

/**
 * Who this is, in white quartz like every other page's hero.
 *
 * It replaces a blue masthead whose avatar was a ring of initials in pale blue on blue. The page's
 * sidebar glyph rides on the "Profile" chip, the way Support's and My Progress's heroes wear
 * theirs; the avatar is the face of the page because a profile is a person.
 */
export function ProfileHero({
  me,
  realEmail,
  onEdit,
  onConfirmEmail,
  onCopyUsername,
}: {
  me: ProfileMe;
  /** Empty for a Telegram signup's placeholder address — never shown as if it were real. */
  realEmail: string;
  onEdit: () => void;
  onConfirmEmail: () => void;
  onCopyUsername: () => void;
}) {
  const fullName = `${me.first_name} ${me.last_name}`.trim();

  return (
    <section className="quartz squircle cr-cardrise relative overflow-hidden [--sq:15px]">
      {/* The page's colours as one thin edge: the student's own blue, what is coming, what is done. */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-[var(--chart-6)] to-success"
      />
      <div className="relative flex flex-col gap-6 px-6 py-7 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar
            src={me.profile_image_url}
            name={fullName || me.username}
            size={88}
            className="squircle ring-4 ring-primary/10 [--sq:16px]"
          />
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-extrabold text-primary dark:text-primary-hover">
              <UserCircle className="h-3.5 w-3.5" aria-hidden />
              Profile · {roleLabel(me.role)}
            </span>
            <h1 className="mt-2.5 truncate text-[28px] font-extrabold leading-[1.1] tracking-[-0.025em] text-foreground sm:text-[32px]">
              {fullName || me.username}
            </h1>
            <p className="mt-1 text-[14.5px] font-medium text-muted-foreground">@{me.username}</p>

            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              {me.email_verified && realEmail ? (
                <Chip tone="emerald" icon={MailCheck}>{realEmail}</Chip>
              ) : (
                // Not a warning: an action, in the colour of things that are still to do.
                <Chip tone="amber" icon={MailWarning} onClick={onConfirmEmail}>
                  {realEmail ? "Confirm your email" : "Add your email"}
                </Chip>
              )}
              {me.telegram_linked ? <Chip tone="sky" icon={MessageCircle}>Telegram connected</Chip> : null}
              {me.phone_number.trim() ? <Chip tone="violet" icon={Phone}>{me.phone_number}</Chip> : null}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button type="button" onClick={onEdit} className={pill("solid")}>
            <Pencil className="h-4 w-4" aria-hidden />
            Edit profile
          </button>
          <button type="button" onClick={onCopyUsername} className={pill("soft")}>
            <Copy className="h-4 w-4" aria-hidden />
            Copy username
          </button>
        </div>
      </div>
    </section>
  );
}
