"use client";

import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Calculator,
  CalendarClock,
  Check,
  ClipboardCheck,
  Coins,
  CreditCard,
  Flame,
  ListChecks,
  PartyPopper,
  Receipt,
  Target,
  Trophy,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { ExplainButton, Skeleton } from "@/components/ui";
import { ErrorState } from "@/features/classroom/ui";
import { POINTS_EXPLAINER, STRIKE_EXPLAINER, XP_EXPLAINER, type Explainer } from "@/features/rewards/explainers";
import type { MyRewards } from "@/features/rewards/rewardsApi";
import { cn } from "@/lib/cn";

import {
  daysUntil,
  dueLabel,
  localDate,
  profileChecklist,
  recentResults,
  resultHref,
  subjectLabel,
  summariseHomework,
  type ChecklistKey,
  type DueTone,
  type HomeworkRow,
} from "./profileModel";
import { Eyebrow, IconTile, Panel, PanelHeader, pill, TONE, type Tone } from "./profileUi";
import type { Load, ProfileAttempt, ProfileMe, SettingsSectionKey } from "./types";

/* ── Stat tiles ──────────────────────────────────────────────────────────────────────── */

/**
 * One of the student's own figures. The whole tile opens the page the figure comes from — the
 * link's `::after` covers the tile — and the ! sits above that, so it still opens its panel.
 */
function StatTile({
  index,
  tone,
  icon,
  label,
  value,
  detail,
  href,
  cta,
  explain,
}: {
  index: number;
  tone: Tone;
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  detail: React.ReactNode;
  href: string;
  cta: string;
  explain?: Explainer;
}) {
  return (
    <div
      className="quartz quartz-float squircle cr-cardrise group relative flex flex-col p-4 [--sq:12px]"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {explain ? (
        // Placed by a wrapper: the button's own root is `relative`, and `cn` does not merge, so
        // an `absolute` passed in loses to it — on the old tiles the ! sat on top of the icon.
        <span className="absolute right-2.5 top-2.5 z-10">
          <ExplainButton title={explain.title} side="left">
            {explain.body}
          </ExplainButton>
        </span>
      ) : null}
      <div className="flex items-center gap-2.5">
        <IconTile icon={icon} tone={tone} size="sm" />
        <Eyebrow>{label}</Eyebrow>
      </div>
      <p className={cn("ds-num mt-3 text-[30px] font-extrabold leading-none tracking-tight", TONE[tone].text)}>{value}</p>
      <p className="mt-1.5 flex-1 text-[12.5px] leading-snug text-muted-foreground">{detail}</p>
      <Link
        href={href}
        className={cn(
          "ds-ring mt-3 inline-flex w-fit items-center gap-1 rounded-md text-[12.5px] font-bold no-underline",
          "after:absolute after:inset-0 after:content-['']",
          TONE[tone].text,
        )}
      >
        {cta}
        <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </div>
  );
}

function StatTiles({ rewards, homework }: { rewards: Load<MyRewards>; homework: Load<HomeworkRow[]> }) {
  const r = rewards.status === "ready" ? rewards.data : null;
  const pending = rewards.status === "loading";
  const failed = "Couldn't load this just now.";
  const summary = homework.status === "ready" ? summariseHomework(homework.data) : null;
  const turnedInPct = summary && summary.total > 0 ? Math.round((summary.turnedIn / summary.total) * 100) : null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        index={0}
        tone="primary"
        icon={Trophy}
        label="XP"
        value={r ? r.xp.toLocaleString("en-US") : pending ? "…" : "—"}
        detail={r ? "Earned by turning up and doing the work." : pending ? "Counting…" : failed}
        href="/leaderboard"
        cta="Leaderboard"
        explain={XP_EXPLAINER}
      />
      <StatTile
        index={1}
        tone="amber"
        icon={Flame}
        label="Strikes"
        value={r ? r.strikes : pending ? "…" : "—"}
        detail={
          r
            ? r.current_streak === 0
              ? "Attend your next lesson to start a run."
              : `${r.current_streak} ${r.current_streak === 1 ? "lesson" : "lessons"} in a row · best ${r.best_streak}`
            : pending
              ? "Counting…"
              : failed
        }
        href="/shop"
        cta="Shop"
        explain={STRIKE_EXPLAINER}
      />
      <StatTile
        index={2}
        tone="emerald"
        icon={Coins}
        label="Points"
        value={r ? r.points.toLocaleString("en-US") : pending ? "…" : "—"}
        detail={r ? `${r.coins} ${r.coins === 1 ? "coin" : "coins"} to spend in the shop` : pending ? "Counting…" : failed}
        href="/rewards"
        cta="Points & coins"
        explain={POINTS_EXPLAINER}
      />
      <StatTile
        index={3}
        tone="sky"
        icon={ClipboardCheck}
        label="Homework"
        value={summary ? (turnedInPct == null ? "—" : `${turnedInPct}%`) : homework.status === "loading" ? "…" : "—"}
        detail={
          summary
            ? summary.total === 0
              ? "Nothing has been set yet."
              : `${summary.turnedIn} of ${summary.total} turned in`
            : homework.status === "loading"
              ? "Counting…"
              : failed
        }
        href="/assessments"
        cta="All homework"
      />
    </div>
  );
}

/* ── Goal and latest results ─────────────────────────────────────────────────────────── */

function GoalWell({ tone, label, children, sub }: { tone: Tone; label: string; children: React.ReactNode; sub: React.ReactNode }) {
  return (
    <div className={cn("squircle p-4 [--sq:10px]", TONE[tone].well)}>
      <Eyebrow className={TONE[tone].text}>{label}</Eyebrow>
      <p className="ds-num mt-2 text-[30px] font-extrabold leading-none tracking-tight text-foreground">{children}</p>
      <p className="mt-2 text-[12.5px] font-medium text-muted-foreground">{sub}</p>
    </div>
  );
}

function formatExamDate(ymd: string): string {
  const d = localDate(ymd);
  return d ? d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : ymd;
}

function GoalPanel({
  me,
  attempts,
  onOpenSettings,
  onRetryAttempts,
}: {
  me: ProfileMe;
  attempts: Load<ProfileAttempt[]>;
  onOpenSettings: (section: SettingsSectionKey) => void;
  onRetryAttempts: () => void;
}) {
  const days = daysUntil(me.sat_exam_date);
  const sections =
    me.target_english != null && me.target_math != null
      ? `English ${me.target_english} · Math ${me.target_math}`
      : me.target_score != null
        ? "Set your English and Math targets too."
        : "Not set yet";
  const results = attempts.status === "ready" ? recentResults(attempts.data) : [];

  return (
    <Panel index={1}>
      <PanelHeader
        icon={Target}
        tone="primary"
        title="Your goal"
        description="Where you're aiming, and how your latest tests went."
        actions={
          <button type="button" onClick={() => onOpenSettings("goal")} className={pill("soft", "primary", "sm")}>
            {me.target_score != null ? "Change goal" : "Set a goal"}
          </button>
        }
      />

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <GoalWell tone="primary" label="Target score" sub={sections}>
          {me.target_score ?? "—"}
          {me.target_score != null ? <span className="ml-1.5 text-base font-bold text-muted-foreground">/ 1600</span> : null}
        </GoalWell>
        <GoalWell
          tone="amber"
          label="Test day"
          sub={
            !me.sat_exam_date
              ? "Pick the SAT date you're aiming for."
              : days != null && days < 0
                ? "That date has passed — pick your next one."
                : formatExamDate(me.sat_exam_date)
          }
        >
          {days != null && days > 0 ? (
            <>
              {days}
              <span className="ml-1.5 text-base font-bold text-muted-foreground">{days === 1 ? "day to go" : "days to go"}</span>
            </>
          ) : days === 0 ? (
            "Today"
          ) : (
            "—"
          )}
        </GoalWell>
      </div>

      <div className="mt-6">
        <Eyebrow>Latest results</Eyebrow>
        {attempts.status === "loading" ? (
          <div className="mt-3 space-y-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="squircle h-[58px] [--sq:9px]" />
            ))}
          </div>
        ) : attempts.status === "error" ? (
          <div className="mt-2">
            <ErrorState
              title="Your results didn't load."
              message="Nothing is lost — try again in a moment."
              onRetry={onRetryAttempts}
            />
          </div>
        ) : results.length === 0 ? (
          <p className={cn("squircle mt-3 px-4 py-3 text-[13px] font-medium text-muted-foreground [--sq:9px]", TONE.primary.well)}>
            Your scores show up here after your first practice test.{" "}
            <Link href="/practice-tests" className="font-bold text-primary no-underline hover:underline dark:text-primary-hover">
              Find one
            </Link>
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {results.map((a) => {
              const math = (a.practice_test_details?.subject ?? "").toUpperCase() === "MATH";
              const title =
                a.practice_test_details?.title?.trim() ||
                a.practice_test_details?.collection_name?.trim() ||
                subjectLabel(a.practice_test_details?.subject);
              const when = a.submitted_at
                ? new Date(a.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                : "";
              return (
                <li key={a.id} className="quartz quartz-float squircle group relative flex items-center gap-3 px-3.5 py-2.5 [--sq:9px]">
                  <IconTile icon={math ? Calculator : BookOpen} tone={math ? "sky" : "emerald"} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-bold text-foreground">{title}</p>
                    <p className="truncate text-[12px] font-medium text-muted-foreground">
                      {subjectLabel(a.practice_test_details?.subject)}
                      {when ? ` · ${when}` : ""}
                    </p>
                  </div>
                  <span className="ds-num text-[20px] font-extrabold tabular-nums text-foreground">{a.score}</span>
                  <Link
                    href={resultHref(a)}
                    className="ds-ring inline-flex items-center gap-1 rounded-md text-[12.5px] font-bold text-primary no-underline after:absolute after:inset-0 after:content-[''] dark:text-primary-hover"
                  >
                    {/* The word only where there is room for it; on a phone the arrow says it, and the
                        link keeps "Review" as its name either way. */}
                    <span className="sr-only sm:not-sr-only">Review</span>
                    <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}

/* ── Finishing the profile ───────────────────────────────────────────────────────────── */

const CHECK_ACTION: Record<ChecklistKey, string> = {
  email: "Confirm",
  goal: "Set",
  exam: "Pick",
  photo: "Add",
  telegram: "Connect",
  phone: "Add",
};

function ChecklistPanel({
  me,
  realEmail,
  telegramStartUrl,
  onOpenSettings,
  onConfirmEmail,
}: {
  me: ProfileMe;
  realEmail: string;
  telegramStartUrl: string | null;
  onOpenSettings: (section: SettingsSectionKey) => void;
  onConfirmEmail: () => void;
}) {
  const items = profileChecklist(
    {
      realEmail,
      emailVerified: me.email_verified,
      targetScore: me.target_score,
      examDate: me.sat_exam_date || null,
      photoUrl: me.profile_image_url,
      telegramLinked: me.telegram_linked,
      phone: me.phone_number,
    },
    { telegramAvailable: Boolean(telegramStartUrl) },
  );
  const todo = items.filter((item) => !item.done);
  const done = items.filter((item) => item.done);

  if (todo.length === 0) {
    return (
      <Panel index={2}>
        <PanelHeader
          icon={PartyPopper}
          tone="emerald"
          title="Your profile is all set"
          description="Everything that makes it useful is filled in."
        />
        <ul className="mt-4 flex flex-wrap gap-2">
          {done.map((item) => (
            <li key={item.key} className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-bold", TONE.emerald.soft)}>
              <Check className="h-3.5 w-3.5" aria-hidden />
              {item.doneLabel}
            </li>
          ))}
        </ul>
      </Panel>
    );
  }

  // Each step goes where it is done: the email flow opens right here, the rest open their
  // section of Settings.
  const act = (key: ChecklistKey) => {
    if (key === "email") onConfirmEmail();
    else if (key === "goal" || key === "exam") onOpenSettings("goal");
    else if (key === "telegram") onOpenSettings("signin");
    else onOpenSettings("account");
  };

  return (
    <Panel index={2}>
      <PanelHeader icon={ListChecks} tone="violet" title="Finish your profile" description={`${done.length} of ${items.length} done`} />
      <ul className="mt-4 space-y-2">
        {todo.map((item) => (
          <li key={item.key} className={cn("squircle flex items-center gap-3 px-3.5 py-3 [--sq:9px]", TONE.violet.well)}>
            <span
              aria-hidden
              className="h-5 w-5 shrink-0 rounded-full border-2 border-[color-mix(in_oklab,var(--chart-6)_45%,transparent)]"
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-bold leading-snug text-foreground">{item.label}</p>
              <p className="text-[12px] font-medium leading-snug text-muted-foreground">{item.hint}</p>
            </div>
            <button type="button" onClick={() => act(item.key)} className={pill("soft", "violet", "sm")}>
              {CHECK_ACTION[item.key]}
            </button>
          </li>
        ))}
      </ul>
      {done.length > 0 ? (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] font-semibold text-muted-foreground">
          {done.map((item) => (
            <span key={item.key} className="inline-flex items-center gap-1">
              <Check className="h-3.5 w-3.5 text-success-foreground" aria-hidden />
              {item.doneLabel}
            </span>
          ))}
        </p>
      ) : null}
    </Panel>
  );
}

/* ── Homework to do ──────────────────────────────────────────────────────────────────── */

const DUE_TONE: Record<DueTone, string> = {
  "catch-up": TONE.amber.soft,
  soon: TONE.primary.soft,
  later: TONE.sky.soft,
  none: TONE.violet.soft,
};

function HomeworkPanel({ homework, onRetry }: { homework: Load<HomeworkRow[]>; onRetry: () => void }) {
  const summary = homework.status === "ready" ? summariseHomework(homework.data) : null;
  const shown = summary ? summary.toDo.slice(0, 4) : [];
  const more = summary ? summary.toDo.length - shown.length : 0;

  return (
    <Panel index={3}>
      <PanelHeader
        icon={ClipboardCheck}
        tone="amber"
        title="Homework to do"
        description="The next pieces to start, the most urgent first."
        actions={
          <Link href="/assessments" className={pill("quiet", "primary", "sm")}>
            All homework
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        }
      />

      <div className="mt-4">
        {homework.status === "loading" ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="squircle h-[60px] [--sq:9px]" />
            ))}
          </div>
        ) : homework.status === "error" ? (
          <ErrorState
            title="Your homework didn't load."
            message="Nothing has changed on it — try again in a moment."
            onRetry={onRetry}
          />
        ) : shown.length === 0 ? (
          <div className={cn("squircle flex items-center gap-3 px-4 py-4 [--sq:10px]", TONE.emerald.well)}>
            <IconTile icon={Check} tone="emerald" size="sm" />
            <p className="text-[13.5px] font-bold text-foreground">
              {summary && summary.total > 0
                ? "You're all caught up — nothing to hand in right now."
                : "No homework has been set for your classes yet."}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {shown.map((row) => {
              const due = dueLabel(row.due_at);
              const href = row.classroom_id ? `/classes/${row.classroom_id}/assignments/${row.id}` : "/assessments";
              const size =
                row.item_count && ["assessment", "pastpaper", "practice", "mock"].includes(row.content_type ?? "")
                  ? `${row.item_count} question${row.item_count === 1 ? "" : "s"}`
                  : "";
              return (
                <li key={row.id}>
                  <Link
                    href={href}
                    className="quartz quartz-float squircle ds-ring group flex items-center gap-3 px-3.5 py-3 no-underline [--sq:9px]"
                  >
                    <span
                      className={cn(
                        "hidden w-[108px] shrink-0 items-center justify-center rounded-full px-2 py-1 text-[11.5px] font-extrabold sm:inline-flex",
                        DUE_TONE[due.tone],
                      )}
                    >
                      {due.text}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-bold text-foreground">{row.title || "Homework"}</p>
                      <p className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
                        {/* On a phone the due date moves under the title, so the title keeps the width. */}
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-extrabold sm:hidden", DUE_TONE[due.tone])}>
                          {due.text}
                        </span>
                        <span className="truncate">{[row.classroom_name, size].filter(Boolean).join(" · ")}</span>
                      </p>
                    </div>
                    <ArrowRight
                      className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary"
                      aria-hidden
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {more > 0 ? (
          <Link
            href="/assessments"
            className="mt-3 inline-flex text-[12.5px] font-bold text-primary no-underline hover:underline dark:text-primary-hover"
          >
            {more} more to do
          </Link>
        ) : null}
      </div>
    </Panel>
  );
}

/* ── Payments ────────────────────────────────────────────────────────────────────────── */

const PAYMENT_PREVIEW: { icon: LucideIcon; label: string }[] = [
  { icon: CreditCard, label: "Pay for your course online" },
  { icon: CalendarClock, label: "See when your next payment is due" },
  { icon: Receipt, label: "Keep every receipt in one place" },
];

/**
 * Payments, before there is anything to pay here. The owner asked for the block now with
 * "Coming soon" inside it, so the place exists before the feature does. It shows what is coming
 * and no figures at all: a made-up amount on a student's own profile would read as a real bill.
 */
function PaymentsPanel() {
  return (
    <Panel index={4} className="overflow-hidden" aria-label="Payments — coming soon">
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", TONE.violet.edge)} />
      <PanelHeader
        icon={Wallet}
        tone="violet"
        title="Payments"
        description="Your course payments, on your profile."
        actions={
          <span className={cn("inline-flex items-center rounded-full px-3 py-1 text-[12px] font-extrabold", TONE.violet.soft)}>
            Coming soon
          </span>
        }
      />
      <ul className="mt-4 space-y-2">
        {PAYMENT_PREVIEW.map(({ icon: Icon, label }) => (
          <li
            key={label}
            className={cn(
              "squircle flex items-center gap-3 border border-dashed border-[color-mix(in_oklab,var(--chart-6)_30%,transparent)] px-3.5 py-2.5 [--sq:9px]",
              TONE.violet.well,
            )}
          >
            <Icon className={cn("h-4 w-4 shrink-0", TONE.violet.text)} aria-hidden />
            <span className="text-[13px] font-semibold text-foreground">{label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12.5px] font-medium text-muted-foreground">
        Until then, payments are made at your learning center as usual.
      </p>
    </Panel>
  );
}

/* ── The tab ─────────────────────────────────────────────────────────────────────────── */

export function OverviewTab({
  me,
  realEmail,
  rewards,
  homework,
  attempts,
  telegramStartUrl,
  onOpenSettings,
  onConfirmEmail,
  onRetryHomework,
  onRetryAttempts,
}: {
  me: ProfileMe;
  realEmail: string;
  rewards: Load<MyRewards>;
  homework: Load<HomeworkRow[]>;
  attempts: Load<ProfileAttempt[]>;
  telegramStartUrl: string | null;
  onOpenSettings: (section: SettingsSectionKey) => void;
  onConfirmEmail: () => void;
  onRetryHomework: () => void;
  onRetryAttempts: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <StatTiles rewards={rewards} homework={homework} />
      {/* Two columns that stack on their own. As two shared rows, a tall checklist left a gap
          under a short goal card the height of the difference. */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-5">
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-3">
          <GoalPanel me={me} attempts={attempts} onOpenSettings={onOpenSettings} onRetryAttempts={onRetryAttempts} />
          <HomeworkPanel homework={homework} onRetry={onRetryHomework} />
        </div>
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-2">
          <ChecklistPanel
            me={me}
            realEmail={realEmail}
            telegramStartUrl={telegramStartUrl}
            onOpenSettings={onOpenSettings}
            onConfirmEmail={onConfirmEmail}
          />
          <PaymentsPanel />
        </div>
      </div>
    </div>
  );
}
