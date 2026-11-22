"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { formatLastSeen } from "@/features/ops/users/peopleColumns";
import { NEW_CAMPAIGN_PATH } from "@/features/ops/sms/smsTabs";
import {
  Badge,
  Button,
  CourseTag,
  Menu,
  balanceVerdict,
  buttonClass,
  courseLevelOf,
  signedAmount,
  verdictText,
  type GlanceFact,
  type MenuItem,
} from "@/features/console/ui";
import { dayText } from "@/features/ops/detail/groupFacts";
import { formatDateTime, formatPhone } from "./format";
import { ONE_TIME_PASSWORD_ROLES, todayFact } from "./PersonHeader";
import type { PersonCore } from "./personApi";

/**
 * The student profile's left card (StudentProfile board, lc-up structure, 22 Nov 2026): the photo, the name with
 * its ✎, the ID and the day the account was added, the balance (signed, tinted by its verdict — `view_money` only),
 * the coins when the student has a wallet, the desk's actions — Take payment, SMS, and lc-up's ⋮ items that exist
 * here — then the facts lc-up lists under them. Nothing here is fetched: it is the page's own payload.
 */

export type ProfileActions = {
  busy: boolean;
  /** ✎: the account and parent forms (the old Overview), in a sheet. */
  onEdit?: () => void;
  /** Take payment / refund / adjustment, when the viewer may and the ledger takes money. */
  onPay?: (kind: "payment" | "refund" | "adjust") => void;
  refundOpen?: boolean;
  adjustOpen?: boolean;
  /** Why Take payment is shown but closed ("Payments are entered in lc-up until the cutover."). */
  payClosedReason?: string | null;
  /** Shown only with `take_payment`. */
  canTakePayment: boolean;
  /** `view_money`: the balance (the server leaves lc-up's money out without it too). */
  canMoney: boolean;
  canSms: boolean;
  /** The coins well's ✎ (the shop's permission, `events_shop`). */
  onEditCoins?: () => void;
  onAddToGroup?: () => void;
  /** Account actions (`mayChangeAccount`). */
  onToggleFreeze?: () => void;
  onOneTimePassword?: () => void;
  onRevoke?: () => void;
  onDelete?: () => void;
};

function Photo({ person }: { person: PersonCore }) {
  const name = person.name || person.username;
  return person.avatar_url ? (
    // eslint-disable-next-line @next/next/no-img-element -- a signed media URL, not a static asset
    <img src={person.avatar_url} alt={name} className="size-16 shrink-0 rounded-[16px] object-cover" />
  ) : (
    <span
      role="img"
      aria-label="No photo"
      className="grid size-16 shrink-0 place-items-center rounded-[16px] bg-ms-surface-2 text-ms-fg-3"
    >
      <Icon name="image" size="lg" />
    </span>
  );
}

function StateBadges({ person }: { person: PersonCore }) {
  const otp = person.one_time_password;
  return (
    <div className="flex flex-wrap gap-1.5">
      {person.frozen_reason === "debt" ? (
        <Badge tone="frozen" icon="snow">Frozen for debt</Badge>
      ) : person.is_frozen ? (
        <Badge tone="frozen" icon="snow">Frozen by an admin</Badge>
      ) : (
        <Badge tone="positive" dot>Active</Badge>
      )}
      {person.lcup ? <Badge tone="line" icon="link">lc-up linked</Badge> : null}
      {otp ? (
        <Badge tone={otp.locked ? "critical" : "attention"} icon="key">
          {otp.locked ? "One-time password locked" : `One-time password · until ${dayText(otp.expires_at)}`}
        </Badge>
      ) : null}
      {person.last_seen ? null : <Badge tone="neutral">Never signed in</Badge>}
    </div>
  );
}

/** A frozen account, said in words: what still works and what lifts it. */
function FrozenNote({ person }: { person: PersonCore }) {
  if (!person.is_frozen) return null;
  const debt = person.frozen_reason === "debt";
  return (
    <div className="flex gap-2.5 rounded-ms-ctl bg-ms-frozen-soft px-3.5 py-3 text-[14px] text-ms-frozen-fg">
      <Icon name="ms-freeze" size="sm" className="mt-0.5" />
      <p>
        <b>{debt ? "Frozen for debt." : "Frozen by an admin."}</b>{" "}
        {debt
          ? "They can still come to lessons but can’t open homework or mocks. The freeze lifts when lc-up records the payment."
          : "Their access stays closed until an admin unfreezes the account."}
      </p>
    </div>
  );
}

function BalanceWell({ person }: { person: PersonCore }) {
  const lcup = person.lcup;
  if (!lcup) return null;
  const balance = lcup.balance;
  const verdict = balanceVerdict(balance);
  const tint = verdict === "critical" ? "bg-ms-critical-soft" : verdict === "positive" ? "bg-ms-positive-soft" : "bg-ms-surface";
  return (
    <div data-testid="balance" className={cn("flex flex-col gap-1 rounded-ms-ctl px-4 py-3.5", tint)}>
      <span className={cn("flex items-center gap-1.5 text-[13px] font-medium", verdict ? verdictText(verdict) : "text-ms-fg-2")}>
        <Icon name="wallet" size="sm" />
        Balance, so&apos;m
      </span>
      <span className={cn("text-[24px] font-bold leading-8 tabular-nums md:text-[22px]", verdictText(verdict))}>
        {balance === null ? "—" : signedAmount(balance)}
      </span>
      <span className="text-[12.5px] text-ms-fg-3">
        lc-up · updated {formatDateTime(lcup.updated_at)}
        {lcup.exempt ? " · never frozen for debt" : ""}
      </span>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-[14px] text-ms-fg-3">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-[14px] text-ms-fg">{children}</dd>
    </>
  );
}

/** A glance fact's tone as text colour: only a verdict is coloured. */
const toneText = (tone: GlanceFact["tone"]) =>
  tone === "positive" || tone === "attention" || tone === "critical" ? verdictText(tone) : undefined;

const SUBJECT_LABEL: Record<string, string> = { math: "Mathematics", english: "English", both: "Both" };

function targetsText(sat: PersonCore["sat"]): string {
  const parts = [
    sat.target_english != null ? `EN ${sat.target_english}` : null,
    sat.target_math != null ? `Math ${sat.target_math}` : null,
    sat.target_score != null ? `Total ${sat.target_score}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

/** The facts under "+ More information": only those the account has. */
function moreFacts(person: PersonCore): { label: string; value: ReactNode }[] {
  const out: { label: string; value: ReactNode }[] = [];
  if (person.username) out.push({ label: "Username", value: `@${person.username}` });
  if (person.email) out.push({ label: "Email", value: `${person.email}${person.email_verified ? " · verified" : " · not verified"}` });
  out.push({ label: "Telegram", value: person.telegram_linked ? "Linked" : "Not linked" });
  out.push({ label: "Created by lc-up", value: person.lcup_created ? "Yes" : "No" });
  if (person.sat.exam_date) out.push({ label: "SAT exam date", value: dayText(person.sat.exam_date) });
  const targets = targetsText(person.sat);
  if (targets) out.push({ label: "Targets", value: `${targets} · set by the student` });
  if (person.subject) out.push({ label: "Subject", value: SUBJECT_LABEL[person.subject] ?? person.subject });
  if (person.past_groups.length) out.push({ label: "Earlier groups", value: person.past_groups.map((g) => g.name).join(", ") });
  return out;
}

export function ProfileCard({ person, actions }: { person: PersonCore; actions: ProfileActions }) {
  const [more, setMore] = useState(false);
  const name = person.name || person.username;
  const today = person.glance?.today?.length ? todayFact(person) : null;
  const callPhone = person.parent?.phone || person.phone;
  const extra = moreFacts(person);
  const canOtp = ONE_TIME_PASSWORD_ROLES.has(person.role);
  const smsHref = `${NEW_CAMPAIGN_PATH}?student=${person.id}`;

  const menu: MenuItem[] = [];
  if (actions.onEdit) menu.push({ label: "Edit", icon: "pencil", onSelect: actions.onEdit });
  if (actions.onAddToGroup) menu.push({ label: "Add to group", icon: "userplus", onSelect: actions.onAddToGroup });
  if (actions.canSms) menu.push({ label: "SMS", icon: "msg", href: smsHref });
  if (actions.refundOpen && actions.onPay) menu.push({ label: "Refund a payment", icon: "undo", onSelect: () => actions.onPay?.("refund") });
  if (actions.adjustOpen && actions.onPay) menu.push({ label: "Edit balance", icon: "wallet", onSelect: () => actions.onPay?.("adjust") });
  const account: MenuItem[] = [];
  if (actions.onToggleFreeze) account.push({ label: person.is_frozen ? "Unfreeze" : "Freeze", icon: "snow", onSelect: actions.onToggleFreeze });
  if (actions.onOneTimePassword && canOtp) {
    account.push(
      person.phone
        ? { label: "One-time password", icon: "key", onSelect: actions.onOneTimePassword }
        : { label: "One-time password", icon: "key", disabledReason: "Add a phone number first" },
    );
  }
  if (actions.onRevoke) account.push({ label: "Log out everywhere", icon: "logout", onSelect: actions.onRevoke });
  if (actions.onDelete) account.push({ label: "Delete account", icon: "trash", danger: true, onSelect: actions.onDelete });
  const items: MenuItem[] = menu.length && account.length ? [...menu, "separator", ...account] : [...menu, ...account];

  return (
    <aside aria-label="Student" className="flex min-w-0 flex-col gap-[18px] rounded-ms-card border border-ms-border bg-ms-card p-[22px] md:max-w-[380px] md:flex-[1_1_320px]">
      <div className="flex items-center gap-3.5">
        <Photo person={person} />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="flex items-center gap-1 text-[20px] font-bold leading-[26px] text-ms-fg">
            <span className="min-w-0 break-words">{name}</span>
            {actions.onEdit ? <Button variant="ghost" size="sm" icon="pencil" aria-label="Edit student" onClick={actions.onEdit} /> : null}
          </h1>
          <span className="text-[13px] text-ms-fg-3">
            ID {person.id} · added {dayText(person.date_joined)}
          </span>
        </div>
      </div>
      <StateBadges person={person} />
      <FrozenNote person={person} />
      {actions.canMoney ? <BalanceWell person={person} /> : null}
      {person.coins !== null && person.coins !== undefined ? (
        <div className="relative rounded-ms-ctl bg-ms-surface px-3 py-2.5">
          {actions.onEditCoins ? (
            <Button variant="ghost" size="sm" icon="pencil" aria-label="Edit coins" className="absolute right-1.5 top-1.5" onClick={actions.onEditCoins} />
          ) : null}
          <div className="text-[13px] text-ms-fg-3">Coins</div>
          <div className="text-[20px] font-semibold tabular-nums text-ms-fg">{signedAmount(person.coins)}</div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {actions.canTakePayment ? (
            <Button
              variant="primary"
              icon="ms-paid"
              className="w-full md:w-auto md:flex-1"
              disabled={Boolean(actions.payClosedReason) || !actions.onPay}
              onClick={() => actions.onPay?.("payment")}
            >
              Take payment
            </Button>
          ) : null}
          {callPhone ? (
            <a href={`tel:+${callPhone.replace(/\D/g, "")}`} className={buttonClass({ className: "flex-1 md:hidden" })}>
              <Icon name="phone" />
              {person.parent?.phone ? "Call parent" : "Call"}
            </a>
          ) : null}
          {actions.canSms ? (
            <>
              <Link href={smsHref} className={buttonClass({ className: "flex-1 md:hidden" })}>
                <Icon name="msg" />
                SMS
              </Link>
              <Link href={smsHref} aria-label="Send SMS" title="Send SMS" className={buttonClass({ square: true, className: "max-md:hidden" })}>
                <Icon name="msg" />
              </Link>
            </>
          ) : null}
          {items.length ? <Menu label="More actions" variant="secondary" items={items} disabled={actions.busy} /> : null}
        </div>
        {actions.canTakePayment && actions.payClosedReason ? <p className="text-[12.5px] text-ms-fg-3">{actions.payClosedReason}</p> : null}
      </div>

      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 gap-y-2.5">
        <Fact label="Phone">{person.phone ? <span className="tabular-nums">{formatPhone(person.phone)}</span> : "—"}</Fact>
        {person.parent?.name || person.parent?.phone ? (
          <Fact label="Parent">
            {[person.parent.name, person.parent.phone ? formatPhone(person.parent.phone) : ""].filter(Boolean).join(" · ")}
          </Fact>
        ) : null}
        {person.groups.length ? (
          <Fact label={person.groups.length === 1 ? "Group" : "Groups"}>
            <span className="flex flex-wrap gap-1">
              {person.groups.map((g) => (
                <CourseTag key={g.id} level={courseLevelOf(g.level, g.name)} size="sm">
                  {g.name}
                </CourseTag>
              ))}
            </span>
          </Fact>
        ) : (
          <Fact label="Group">Not in any class</Fact>
        )}
        {today ? (
          <Fact label="Today">
            <span className={toneText(today.tone)}>{today.value}</span>
            {today.sub ? <span className="text-ms-fg-3"> · {today.sub}</span> : null}
          </Fact>
        ) : null}
        <Fact label="Last seen">{formatLastSeen(person.last_seen)}</Fact>
        {more
          ? extra.map((f) => (
              <Fact key={f.label} label={f.label}>
                {f.value}
              </Fact>
            ))
          : null}
      </dl>
      {extra.length ? (
        <button
          type="button"
          aria-expanded={more}
          onClick={() => setMore((v) => !v)}
          className="self-start text-[14px] font-medium text-ms-primary-text hover:underline"
        >
          {more ? "− Less information" : "+ More information"}
        </button>
      ) : null}
    </aside>
  );
}
