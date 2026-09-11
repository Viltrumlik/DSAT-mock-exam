"use client";

import { Fragment, useId, useState } from "react";
import {
  Award,
  Building2,
  ChevronDown,
  Crown,
  Flame,
  Globe2,
  Rocket,
  RotateCcw,
  SlidersHorizontal,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { HeroPage, PageHero, Skeleton } from "@/components/ui";
// The classroom's devices, so the school-wide board reads as the same product as the class one.
import { Card, CardHeader, EmptyState, ErrorState, Pill } from "@/features/classroom/ui";
import { useMyRewards } from "@/features/rewards/rewardsHooks";
import { useLeaderboard, useLeaderboardFilters } from "./leaderboardHooks";
import type {
  LeaderboardRow,
  LeaderboardScope,
  LeaderboardWindow,
} from "./leaderboardApi";

const SCOPES: { value: LeaderboardScope; label: string; icon: LucideIcon }[] = [
  { value: "GROUP", label: "My Group", icon: Users },
  { value: "BRANCH", label: "My Branch", icon: Building2 },
  { value: "GLOBAL", label: "Global", icon: Globe2 },
];

/** Only for the folded summary line, in the moment before the server's own labels arrive —
 *  the chips themselves never render anything but the server's. */
const WINDOW_LABEL: Record<LeaderboardWindow, string> = { ALL: "All time", MONTH: "This month" };

type Medal = {
  /** The medal colour itself. */
  solid: string;
  /** Light-to-deep fill: the avatar ring, the rank badge, the podium step. */
  fill: string;
  /** The coloured shadow a medallist's avatar casts. */
  glow: string;
};

/**
 * Gold, silver, bronze — the classroom board's set (`classroom/pages/Rankings.tsx`), so a medal
 * is the same colour on both boards. This page used to carry three slightly different hexes
 * under a comment saying they matched.
 *
 * Solid colours rather than theme tokens on purpose: gold is gold in either theme. Every
 * surface they sit on here is either their own fill or a translucent wash, so both themes hold.
 */
const MEDALS: Record<1 | 2 | 3, Medal> = {
  1: { solid: "#e3a008", fill: "linear-gradient(160deg,#f5b740,#d98f0a)", glow: "0 10px 26px -10px rgba(227,160,8,.9)" },
  2: { solid: "#94a3b8", fill: "linear-gradient(160deg,#cbd5e1,#94a3b8)", glow: "0 10px 26px -10px rgba(148,163,184,.95)" },
  3: { solid: "#e0851a", fill: "linear-gradient(160deg,#f4b15f,#e0851a)", glow: "0 10px 26px -10px rgba(224,133,26,.9)" },
};
/** The crown's fill, from the same set. */
const CROWN_FILL = "#f5c542";

/** Ranks can tie, so a medal follows the rank the server gave — never the row's position. */
function medalOf(rank: number): Medal | undefined {
  return rank === 1 || rank === 2 || rank === 3 ? MEDALS[rank] : undefined;
}

/** How tall each podium step stands, by medal. */
const STEP: Record<1 | 2 | 3, string> = {
  1: "h-24 sm:h-28",
  2: "h-16 sm:h-20",
  3: "h-11 sm:h-14",
};
/** Where the first three stand, in rank order: the leader in the middle, second on the left. */
const SLOT = ["order-2", "order-1", "order-3"];

// Inline styles below read the house tokens by their raw names (`--primary`, `--chart-4`), not
// the `--color-*` aliases: Tailwind only emits an alias some utility class uses, and nothing uses
// `--color-chart-4`, so `var(--color-chart-4)` resolved to nothing and those avatars lost their
// colour. The raw names are plain CSS in globals.css, defined for both themes.

/** The podium's backdrop: a warm light over the winner, over a wash of the house blue. */
const STAGE =
  "radial-gradient(60% 58% at 50% 0%, rgba(245,197,66,.26), transparent 72%)," +
  "linear-gradient(180deg, color-mix(in oklab, var(--primary) 10%, transparent), transparent 88%)";

/** A little confetti behind the podium. Decoration only; the house chart ramp keeps it on-palette. */
const CONFETTI: React.CSSProperties[] = [
  { left: "4%", top: "14%", width: 8, height: 8, background: "var(--chart-5)", opacity: 0.55 },
  { left: "11%", top: "42%", width: 5, height: 5, background: "var(--chart-2)", opacity: 0.65 },
  { left: "27%", top: "7%", width: 6, height: 6, background: CROWN_FILL, opacity: 0.8 },
  { left: "72%", top: "9%", width: 5, height: 5, background: "var(--chart-3)", opacity: 0.65 },
  { left: "88%", top: "18%", width: 8, height: 8, background: "var(--chart-6)", opacity: 0.5 },
  { left: "95%", top: "46%", width: 5, height: 5, background: "var(--chart-1)", opacity: 0.6 },
];

/** Initials colours for rows without a photo, from the house chart ramp so both themes are
 *  covered. Keyed on the student rather than the rank, so a filter that moves someone does not
 *  also repaint them. */
const TINTS = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5", "--chart-6"];

function tintOf(studentId: number): React.CSSProperties {
  const colour = `var(${TINTS[studentId % TINTS.length]})`;
  return { background: `color-mix(in oklab, ${colour} 16%, transparent)`, color: colour };
}

/** Branch and region are the whole reason this board is worth crossing classes for — without
 *  them a global row is a name and a number with no context. */
function placeOf(row: LeaderboardRow): string {
  return row.branch ? `${row.branch}${row.region ? ` · ${row.region}` : ""}` : "No branch yet";
}

type Goal = { xp: number; rank: number };

/**
 * What it takes to move up one place: the gap to the row directly above, plus one — to pass
 * them, not to tie, because a tie is settled by earning count and could still leave the student
 * where they are.
 *
 * Only when that row is on screen. A viewer below the visible list gets a target only if the
 * last visible row is the very next rank up; anything else is a number to take on trust. Null at
 * #1, and when the row above shares their rank.
 */
function nextGoal(rows: LeaderboardRow[], my: LeaderboardRow | null): Goal | null {
  if (!my) return null;
  const at = rows.findIndex((r) => r.student_id === my.student_id);
  if (at >= 0) {
    const me = rows[at];
    const above = at > 0 ? rows[at - 1] : undefined;
    if (!above || above.rank >= me.rank) return null;
    return { xp: Math.max(1, above.xp - me.xp + 1), rank: above.rank };
  }
  const last = rows[rows.length - 1];
  if (!last || last.rank !== my.rank - 1) return null;
  return { xp: Math.max(1, last.xp - my.xp + 1), rank: last.rank };
}

function YouTag() {
  return (
    <span className="shrink-0 rounded-full bg-primary px-1.5 py-px text-[10px] font-extrabold uppercase tracking-[0.06em] text-primary-foreground">
      you
    </span>
  );
}

/** `awards` — how many earnings sit behind the XP. The tie-break, and the answer to "from what?". */
function AwardsChip({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-chart-6/10 px-2 py-0.5 text-[11px] font-bold text-chart-6">
      <Award className="h-3 w-3" aria-hidden />
      {count.toLocaleString("en-US")} {count === 1 ? "award" : "awards"}
    </span>
  );
}

/** Growth-oriented by construction: it names the next place, never the distance from the top.
 *  `dark:text-primary-hover` wherever brand-blue text sits on the card: the dark theme's
 *  `--primary` is a 3:1 indigo on the near-black surface, its hover shade clears 4.5:1. */
function GoalLine({ goal, pill, className }: { goal: Goal; pill?: boolean; className?: string }) {
  return (
    <p
      className={cn(
        "inline-flex items-center gap-1.5 font-bold text-primary dark:text-primary-hover",
        pill ? "rounded-full bg-primary/10 px-3 py-1.5 text-xs" : "text-[11px]",
        className,
      )}
    >
      <Rocket className={pill ? "h-3.5 w-3.5" : "h-3 w-3"} aria-hidden />
      {goal.xp.toLocaleString("en-US")} XP to reach #{goal.rank}
    </p>
  );
}

function RankBadge({ rank, highlight }: { rank: number; highlight?: boolean }) {
  const medal = medalOf(rank);
  return (
    <span
      className={cn(
        "ds-num flex h-8 min-w-8 shrink-0 items-center justify-center rounded-xl px-1.5 text-[13px] font-extrabold",
        medal
          ? "text-white"
          : highlight
            ? "bg-primary text-primary-foreground"
            : "bg-foreground/[0.06] text-muted-foreground",
      )}
      style={medal ? { background: medal.fill, textShadow: "0 1px 2px rgba(15,23,42,.3)" } : undefined}
    >
      {rank}
    </span>
  );
}

function Chip({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        // `font-[inherit]`: the global `button { font-family }` rule would otherwise set these
        // in Geist inside a page set in Plus Jakarta.
        "ds-ring cr-pill rounded-full px-3.5 py-1.5 font-[inherit] text-[13px] font-bold",
        active
          ? "bg-primary text-primary-foreground shadow-[0_6px_14px_-6px_var(--primary)]"
          : "bg-surface-2 text-muted-foreground hover:bg-surface-3 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <p id={id} className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground sm:w-16 sm:shrink-0">
        {label}
      </p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * The filters, folded behind one button — the school found three rows of chips took the page
 * over. Folded, the bar still says what the board is filtered to, so nobody has to open it to
 * find out why their number changed.
 *
 * The panel opens on `grid-template-rows: 0fr → 1fr`, which animates to the content's real
 * height (a `max-height` guess would clip a long branch list or stall at the top). `inert`
 * while folded, so the hidden chips drop out of the tab order and the accessibility tree.
 */
function FilterBar({
  open, onToggle, summary, onReset, children,
}: {
  open: boolean;
  onToggle: () => void;
  summary: { key: string; label: string; active: boolean }[];
  onReset: () => void;
  children: React.ReactNode;
}) {
  const panelId = useId();
  const active = summary.filter((s) => s.active).length;
  return (
    <Card pad="none" className="cr-card overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className={cn(
            "ds-ring cr-press inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 font-[inherit] text-sm font-bold transition-colors",
            open
              ? "bg-primary text-primary-foreground shadow-[0_8px_18px_-8px_var(--primary)]"
              : "bg-primary/10 text-primary hover:bg-primary/15 dark:text-primary-hover",
          )}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          Filters
          {active > 0 ? (
            <span
              className={cn(
                "ds-num flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-extrabold",
                open ? "bg-white text-primary" : "bg-primary text-primary-foreground",
              )}
            >
              {active}
              <span className="sr-only"> active</span>
            </span>
          ) : null}
          <ChevronDown
            aria-hidden
            className={cn(
              "h-4 w-4 transition-transform duration-300 motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </button>
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-muted-foreground">
          {summary.map((s, i) => (
            <Fragment key={s.key}>
              {i > 0 ? <span aria-hidden className="mx-1.5 opacity-60">·</span> : null}
              <span className={s.active ? "font-bold text-foreground" : undefined}>{s.label}</span>
            </Fragment>
          ))}
        </p>
        {active > 0 ? (
          <button
            type="button"
            onClick={onReset}
            className="ds-ring inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-[inherit] text-[13px] font-bold text-primary transition-colors hover:bg-primary/10 dark:text-primary-hover"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Reset
          </button>
        ) : null}
      </div>
      <div
        id={panelId}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-3 border-t border-border px-4 py-4 sm:px-5">{children}</div>
        </div>
      </div>
    </Card>
  );
}

function PodiumColumn({ row, slot }: { row: LeaderboardRow; slot: number }) {
  const place = (row.rank >= 1 && row.rank <= 3 ? row.rank : 3) as 1 | 2 | 3;
  const medal = MEDALS[place];
  const first = place === 1;
  return (
    <li
      className={cn("cr-rise flex min-w-0 flex-col items-center text-center", SLOT[slot])}
      style={{ animationDelay: `${slot * 90}ms` }}
    >
      <span className="sr-only">Rank {row.rank}: </span>
      {first ? (
        <Crown
          aria-hidden
          className="cr-float mb-1 h-7 w-7 sm:h-8 sm:w-8"
          style={{ color: medal.solid, fill: CROWN_FILL }}
        />
      ) : null}
      <span className="rounded-full p-[3px]" style={{ background: medal.fill, boxShadow: medal.glow }}>
        <span className="block rounded-full bg-card p-[2px]">
          <Avatar
            src={row.profile_image_url}
            name={row.name}
            size={first ? 72 : 58}
            className="font-extrabold"
            style={{ background: medal.fill, color: "#fff", textShadow: "0 1px 2px rgba(15,23,42,.35)" }}
          />
        </span>
      </span>
      {/* Two lines rather than an ellipsis: a phone gives each step under a hundred pixels, and
          the three names are the point of the podium. */}
      <p className="mt-2.5 line-clamp-2 max-w-full break-words px-0.5 text-[13px] font-extrabold leading-tight text-foreground sm:text-[15px]">
        {row.name}
      </p>
      {row.is_me ? (
        <span className="mt-1">
          <YouTag />
        </span>
      ) : null}
      <p className="mt-0.5 max-w-full truncate px-0.5 text-[11px] font-semibold text-muted-foreground sm:text-xs">
        {row.branch ?? "No branch yet"}
      </p>
      <p className="ds-num mt-1 text-lg font-extrabold leading-tight text-foreground sm:text-[22px]">
        {row.xp.toLocaleString("en-US")}
        <span className="ml-1 text-[10px] font-bold text-muted-foreground sm:text-[11px]">XP</span>
      </p>
      <div className="mt-1.5">
        <AwardsChip count={row.awards} />
      </div>
      {/* The step. Its numeral repeats the rank read out above, so it is decoration here. */}
      <div
        aria-hidden
        className={cn("relative mt-3 flex w-full justify-center overflow-hidden rounded-t-xl sm:rounded-t-2xl", STEP[place])}
        style={{ background: medal.fill }}
      >
        <span className="absolute inset-y-0 left-[14%] w-[20%] -skew-x-12 bg-white/20" />
        <span
          className="relative mt-1.5 text-3xl font-extrabold text-white sm:mt-2 sm:text-4xl"
          style={{ textShadow: "0 2px 6px rgba(15,23,42,.3)" }}
        >
          {row.rank}
        </span>
      </div>
    </li>
  );
}

/** The first three, stood on a podium — the classroom board's layout, in fuller colour. */
function Podium({ rows }: { rows: LeaderboardRow[] }) {
  return (
    <div className="relative overflow-hidden rounded-2xl" style={{ background: STAGE }}>
      {CONFETTI.map((style, i) => (
        <span key={i} aria-hidden className="absolute rounded-full" style={style} />
      ))}
      {/* Rank order in the DOM, podium order on screen — a screen reader hears 1, 2, 3. */}
      <ol className="relative mx-auto grid max-w-2xl grid-cols-3 items-end gap-1.5 px-1.5 pt-7 sm:gap-4 sm:px-8 sm:pt-9">
        {rows.map((row, i) => (
          <PodiumColumn key={row.student_id} row={row} slot={i} />
        ))}
      </ol>
    </div>
  );
}

function StandingRow({
  row, highlight, goal, index = 0,
}: {
  row: LeaderboardRow;
  highlight?: boolean;
  goal?: Goal | null;
  index?: number;
}) {
  return (
    <li
      className={cn(
        "cr-rowin2 flex items-center gap-2.5 rounded-2xl px-2 py-2.5 sm:gap-4 sm:px-3.5",
        highlight
          ? "bg-primary/[0.07] ring-1 ring-inset ring-primary/30"
          : "transition-colors hover:bg-foreground/[0.03]",
      )}
      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
    >
      <RankBadge rank={row.rank} highlight={highlight} />
      <Avatar
        src={row.profile_image_url}
        name={row.name}
        size={40}
        className="font-extrabold"
        style={tintOf(row.student_id)}
      />
      {/* Name over branch on the left, XP over awards on the right. A phone cannot spare a
          right column for both figures without cutting the name short, so there the name takes
          the whole first line, the XP sits on the branch line and the awards go under it. The
          next place to reach, when there is one, runs underneath. DOM order is reading order. */}
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
        <p className="col-[1/-1] row-[1] flex min-w-0 items-center gap-1.5 text-sm font-bold text-foreground sm:col-[1]">
          <span className="truncate">{row.name}</span>
          {row.is_me ? <YouTag /> : null}
        </p>
        <p className="col-[1] row-[2] truncate text-xs font-semibold text-muted-foreground">{placeOf(row)}</p>
        <span className="ds-num col-[2] row-[2] justify-self-end whitespace-nowrap text-sm font-extrabold text-foreground sm:row-[1] sm:text-[15px]">
          {row.xp.toLocaleString("en-US")}
          <span className="ml-1 text-[11px] font-bold text-muted-foreground">XP</span>
        </span>
        <span className="col-[1] row-[3] justify-self-start sm:col-[2] sm:row-[2] sm:justify-self-end">
          <AwardsChip count={row.awards} />
        </span>
        {goal ? <GoalLine goal={goal} className="col-[1/-1] row-[4] mt-0.5 sm:row-[3]" /> : null}
      </div>
    </li>
  );
}

export function LeaderboardPage() {
  const [scope, setScope] = useState<LeaderboardScope>("GLOBAL");
  const [window, setWindow] = useState<LeaderboardWindow>("ALL");
  const [subject, setSubject] = useState<string | null>(null);
  const [branch, setBranch] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const filters = useLeaderboardFilters();
  // The top-bar points pill already reads this on every page, so the streak costs no request.
  const rewards = useMyRewards();
  const board = useLeaderboard({
    scope,
    window,
    subject,
    // A branch filter only means anything on the global board; inside "My Branch" the scope
    // has already decided it.
    branch: scope === "GLOBAL" ? branch : null,
  });

  const rows = board.data?.rows ?? [];
  const my = board.data?.my ?? null;
  // Only show "your position" separately when they are not already visible in the table —
  // repeating a row the student can see is noise, and hiding it when they cannot is worse.
  const myRow = my ? rows.find((r) => r.student_id === my.student_id) : undefined;
  const myIsVisible = myRow != null;
  // The row the student can see beats `my` for the hero: `my.rank` shares a tied rank, the table
  // breaks the tie, and the two must not disagree on one screen.
  const standing = myRow ?? my;
  const podium = rows.length >= 3 ? rows.slice(0, 3) : [];
  const list = rows.length >= 3 ? rows.slice(3) : rows;
  const goal = nextGoal(rows, my);
  const podiumGoal = goal && myRow && podium.includes(myRow) ? goal : null;
  const streak = rewards.data?.current_streak ?? 0;

  const branchApplies = scope === "GLOBAL" && branch !== null;
  const summary = [
    {
      key: "window",
      label: filters.data?.windows.find((w) => w.value === window)?.label ?? WINDOW_LABEL[window],
      active: window !== "ALL",
    },
    {
      key: "subject",
      label: subject
        ? (filters.data?.subjects.find((s) => s.value === subject)?.label ?? subject)
        : "All subjects",
      active: subject !== null,
    },
    ...(branchApplies
      ? [{
          key: "branch",
          label: filters.data?.branches.find((b) => b.id === branch)?.name ?? "Branch",
          active: true,
        }]
      : []),
  ];

  // The viewer's own figures. A dash, never a zero, whenever the board has not said — while it
  // loads, when it failed, and when the student has no standing on this slice.
  const tiles = [
    {
      label: "Your rank",
      value: standing ? `#${standing.rank}` : "—",
      accent: true,
      icon: standing?.rank === 1 ? Crown : Trophy,
    },
    { label: "Your XP", value: standing ? standing.xp.toLocaleString("en-US") : "—", icon: Zap },
    { label: "Awards", value: standing ? standing.awards.toLocaleString("en-US") : "—", icon: Award },
    // A count of lessons attended in a row. Shown only while there is one to celebrate.
    ...(streak > 0
      ? [{ label: "Streak", value: `${streak} ${streak === 1 ? "lesson" : "lessons"}`, icon: Flame }]
      : []),
  ];

  return (
    <HeroPage className="space-y-5">
      <Card pad="none" className="cr-card overflow-hidden">
        <PageHero
          badge="Leaderboard"
          icon={Trophy}
          title="Leaderboard"
          description="Ranked on XP — what you earn by turning up and doing the work."
          tiles={tiles}
        >
          <div className="mt-6 flex flex-wrap gap-2">
            {SCOPES.map(({ value, label, icon: Icon }) => {
              // "My Branch" is hidden rather than shown over an empty board when the school
              // has not put this student's class in a branch yet.
              if (value === "BRANCH" && filters.data && !filters.data.my_branch) return null;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={scope === value}
                  onClick={() => setScope(value)}
                  className={cn(
                    "ds-ring cr-press flex items-center gap-2 rounded-2xl px-4 py-2.5 font-[inherit] text-sm font-bold transition-colors",
                    scope === value
                      ? "bg-white text-primary shadow-[0_8px_20px_-10px_rgba(15,23,42,.6)]"
                      : "bg-black/[0.22] text-white hover:bg-black/30",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {value === "BRANCH" && filters.data?.my_branch
                    ? filters.data.my_branch.name
                    : label}
                </button>
              );
            })}
          </div>
        </PageHero>
      </Card>

      <FilterBar
        open={filtersOpen}
        onToggle={() => setFiltersOpen((o) => !o)}
        summary={summary}
        onReset={() => {
          setWindow("ALL");
          setSubject(null);
          setBranch(null);
        }}
      >
        <FilterGroup label="Time">
          {(filters.data?.windows ?? []).map((w) => (
            <Chip key={w.value} active={window === w.value} onClick={() => setWindow(w.value)}>
              {w.label}
            </Chip>
          ))}
        </FilterGroup>
        <FilterGroup label="Subject">
          <Chip active={subject === null} onClick={() => setSubject(null)}>
            All subjects
          </Chip>
          {(filters.data?.subjects ?? []).map((s) => (
            <Chip key={s.value} active={subject === s.value} onClick={() => setSubject(s.value)}>
              {s.label}
            </Chip>
          ))}
        </FilterGroup>
        {scope === "GLOBAL" && (filters.data?.branches.length ?? 0) > 0 ? (
          <FilterGroup label="Branch">
            <Chip active={branch === null} onClick={() => setBranch(null)}>
              All branches
            </Chip>
            {(filters.data?.branches ?? []).map((b) => (
              <Chip key={b.id} active={branch === b.id} onClick={() => setBranch(b.id)}>
                {b.name}
              </Chip>
            ))}
          </FilterGroup>
        ) : null}
      </FilterBar>

      {/* A notch less padding on a phone, where every pixel of it comes out of the names. */}
      <Card pad="none" className="cr-card space-y-4 p-4 sm:p-6">
        <CardHeader
          title={
            <span className="flex items-center gap-2.5 text-base font-extrabold">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white"
                style={{ background: MEDALS[1].fill, boxShadow: MEDALS[1].glow }}
              >
                <Trophy className="h-4 w-4" aria-hidden />
              </span>
              Standings
            </span>
          }
          // The server's own sentence about what this slice counts. Rendered rather than
          // paraphrased in the client, so the two can never drift apart — and out here rather
          // than inside the folded filters, because it is what explains a total that shrank.
          description={
            board.data?.scope_note ? (
              <span className="text-[13px] font-medium">{board.data.scope_note}</span>
            ) : undefined
          }
          // The rows this response carries, capped by the server — not how many are ranked.
          actions={
            board.data && !board.isError && rows.length > 0 ? (
              <Pill tone="primary" className="dark:text-primary-hover">Top {board.data.count}</Pill>
            ) : undefined
          }
        />
        {/* Four branches, always: loading, error, empty, data. An error that renders as an
            empty board tells the student they are alone on it. */}
        {board.isPending ? (
          <div className="space-y-2">
            <div className="grid grid-cols-3 items-end gap-2 sm:gap-4">
              <Skeleton className="h-32 rounded-2xl" />
              <Skeleton className="h-40 rounded-2xl" />
              <Skeleton className="h-28 rounded-2xl" />
            </div>
            <Skeleton className="h-14 rounded-2xl" />
            <Skeleton className="h-14 rounded-2xl" />
            <Skeleton className="h-14 rounded-2xl" />
          </div>
        ) : board.isError ? (
          <ErrorState
            title="The leaderboard isn't loading right now."
            message="Your XP is safe — only this list failed to load."
            onRetry={() => void board.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title="Nothing on this board yet"
            description="Once XP is earned here, the standings will show up."
          />
        ) : (
          <div className={cn("space-y-4 transition-opacity duration-200", board.isFetching && "opacity-60")}>
            {podium.length > 0 ? <Podium rows={podium} /> : null}
            {podiumGoal ? (
              <div className="flex justify-center">
                <GoalLine goal={podiumGoal} pill />
              </div>
            ) : null}
            {list.length > 0 ? (
              <ul className="space-y-1">
                {list.map((row, i) => (
                  <StandingRow
                    key={row.student_id}
                    row={row}
                    highlight={row.is_me}
                    goal={row === myRow ? goal : null}
                    index={i}
                  />
                ))}
              </ul>
            ) : null}
          </div>
        )}

        {my && !myIsVisible ? (
          <div className="border-t border-border pt-4">
            <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
              Your position
            </p>
            <ul>
              <StandingRow row={my} highlight goal={goal} />
            </ul>
          </div>
        ) : null}

        {my == null && !board.isPending && !board.isError ? (
          <div className="flex items-center gap-3 rounded-2xl bg-primary/[0.06] px-3.5 py-3 text-[13px] font-semibold text-foreground">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-white shadow-[0_6px_14px_-6px_var(--primary)]">
              <Zap className="h-4 w-4" aria-hidden />
            </span>
            Earn your first XP and you&apos;ll appear here.
          </div>
        ) : null}
      </Card>
    </HeroPage>
  );
}
