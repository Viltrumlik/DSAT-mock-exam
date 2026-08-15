"use client";

import { useState } from "react";
import { Trophy, Users, Building2, Globe2, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { HeroPage, PageHero, Skeleton } from "@/components/ui";
// The classroom's devices, so the school-wide board reads as the same product as the class one.
import { Card, CardHeader, EmptyState, ErrorState } from "@/features/classroom/ui";
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

/** Podium colours for the top three, then a flat list. Matches the classroom board. */
const MEDAL = ["#d4a017", "#9aa4b2", "#b4703a"];

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
      onClick={onClick}
      className={cn(
        "rounded-full px-3.5 py-1.5 text-[13px] font-bold transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-surface-2 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Row({ row, highlight }: { row: LeaderboardRow; highlight?: boolean }) {
  const medal = row.rank <= 3 ? MEDAL[row.rank - 1] : undefined;
  return (
    <li
      className={cn(
        "flex items-center gap-3 py-3",
        highlight && "rounded-xl bg-primary/[0.06] px-3",
      )}
    >
      <span
        className="ds-num w-8 shrink-0 text-center text-sm font-extrabold"
        style={{ color: medal ?? "var(--muted-foreground)" }}
      >
        {row.rank}
      </span>
      <Avatar src={row.profile_image_url} name={row.name} size={36} className="font-extrabold" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-foreground">
          {row.name}
          {row.is_me ? <span className="ml-1.5 text-xs font-extrabold text-primary">you</span> : null}
        </p>
        {/* Branch and region are the whole reason this board is worth crossing classes for —
            without them a global row is a name and a number with no context. */}
        <p className="truncate text-xs font-semibold text-muted-foreground">
          {row.branch ? `${row.branch}${row.region ? ` · ${row.region}` : ""}` : "No branch yet"}
        </p>
      </div>
      <span className="ds-num shrink-0 text-sm font-extrabold text-foreground">
        {row.xp.toLocaleString("en-US")}
        <span className="ml-1 text-[11px] font-bold text-muted-foreground">XP</span>
      </span>
    </li>
  );
}

export function LeaderboardPage() {
  const [scope, setScope] = useState<LeaderboardScope>("GLOBAL");
  const [window, setWindow] = useState<LeaderboardWindow>("ALL");
  const [subject, setSubject] = useState<string | null>(null);
  const [branch, setBranch] = useState<number | null>(null);

  const filters = useLeaderboardFilters();
  const board = useLeaderboard({
    scope,
    window,
    subject,
    // A branch filter only means anything on the global board; inside "My Branch" the scope
    // has already decided it.
    branch: scope === "GLOBAL" ? branch : null,
  });

  const rows = board.data?.rows ?? [];
  // Only show "your position" separately when they are not already visible in the table —
  // repeating a row the student can see is noise, and hiding it when they cannot is worse.
  const my = board.data?.my;
  const myIsVisible = my != null && rows.some((r) => r.student_id === my.student_id);

  return (
    <HeroPage className="space-y-5">
      <Card pad="none" className="cr-card overflow-hidden">
        <PageHero
          badge="Leaderboard"
          title="Leaderboard"
          description="Ranked on XP — what you earn by turning up and doing the work."
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
                  onClick={() => setScope(value)}
                  className={cn(
                    "flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold transition-colors",
                    scope === value ? "bg-white text-primary" : "bg-black/[0.22] text-white",
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

      <Card className="cr-card space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {(filters.data?.windows ?? []).map((w) => (
            <Chip key={w.value} active={window === w.value} onClick={() => setWindow(w.value)}>
              {w.label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip active={subject === null} onClick={() => setSubject(null)}>
            All subjects
          </Chip>
          {(filters.data?.subjects ?? []).map((s) => (
            <Chip key={s.value} active={subject === s.value} onClick={() => setSubject(s.value)}>
              {s.label}
            </Chip>
          ))}
        </div>
        {scope === "GLOBAL" && (filters.data?.branches.length ?? 0) > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Chip active={branch === null} onClick={() => setBranch(null)}>
              All branches
            </Chip>
            {(filters.data?.branches ?? []).map((b) => (
              <Chip key={b.id} active={branch === b.id} onClick={() => setBranch(b.id)}>
                {b.name}
              </Chip>
            ))}
          </div>
        ) : null}

        {/* The server's own sentence about what this slice counts. Rendered rather than
            paraphrased in the client, so the two can never drift apart. */}
        {board.data?.scope_note ? (
          <p className="text-[13px] font-medium text-muted-foreground">{board.data.scope_note}</p>
        ) : null}
      </Card>

      <Card className="cr-card space-y-3">
        <CardHeader
          title="Standings"
          description={board.data ? `${board.data.count} ranked` : undefined}
        />
        {/* Four branches, always: loading, error, empty, data. An error that renders as an
            empty board tells the student they are alone on it. */}
        {board.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
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
          <ul className={cn("divide-y divide-border", board.isFetching && "opacity-60")}>
            {rows.map((row) => (
              <Row key={row.student_id} row={row} highlight={row.is_me} />
            ))}
          </ul>
        )}

        {my && !myIsVisible ? (
          <div className="border-t border-border pt-3">
            <p className="mb-1 text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
              Your position
            </p>
            <ul>
              <Row row={my} highlight />
            </ul>
          </div>
        ) : null}

        {my == null && !board.isPending && !board.isError ? (
          <div className="flex items-center gap-2 border-t border-border pt-3 text-[13px] font-semibold text-muted-foreground">
            <Zap className="h-4 w-4 shrink-0" aria-hidden />
            Earn your first XP and you&apos;ll appear here.
          </div>
        ) : null}
      </Card>
    </HeroPage>
  );
}
