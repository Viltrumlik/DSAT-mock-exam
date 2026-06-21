"use client";

import { useState } from "react";
import {
  Trophy,
  GraduationCap,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUp,
  ArrowDown,
  RefreshCcw,
  EyeOff,
  History,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Card, CardHeader, Button, Pill, Select, Field, StatCard, EmptyState, LoadingState, ErrorState } from "../ui";
import type { PillTone } from "../ui";
import { capabilitiesFor } from "../capabilities";
import type { ClassroomWithRole } from "../types";
import { useRankings, useRankingHistory, useRecomputeRankings, useUpdateRankingConfig } from "../rankingsHooks";
import type { LeaderboardMode, RankingKind, RankingRow, Trend } from "../rankingsApi";

const KIND_META: Record<RankingKind, { title: string; icon: LucideIcon; desc: string; unit: string }> = {
  SAT: {
    title: "SAT Ranking",
    icon: Trophy,
    desc: "Ranked by SAT performance — practice tests, past papers, mock exams, and SAT simulations.",
    unit: "SAT score",
  },
  ACADEMIC: {
    title: "Academic Ranking",
    icon: GraduationCap,
    desc: "Ranked by graded work — homework, quizzes, classwork, participation (and attendance when enabled).",
    unit: "academic score",
  },
};

function Movement({ change }: { change: number | null }) {
  if (change == null || change === 0)
    return <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"><Minus className="h-3 w-3" /></span>;
  if (change > 0)
    return <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-emerald-600"><ArrowUp className="h-3 w-3" />{change}</span>;
  return <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-rose-600"><ArrowDown className="h-3 w-3" />{Math.abs(change)}</span>;
}

function TrendBadge({ trend }: { trend: Trend | null }) {
  if (!trend) return null;
  const map: Record<Trend, { tone: PillTone; Icon: React.ElementType; label: string }> = {
    IMPROVING: { tone: "success", Icon: TrendingUp, label: "Improving" },
    DECLINING: { tone: "warning", Icon: TrendingDown, label: "Declining" },
    STABLE: { tone: "neutral", Icon: Minus, label: "Steady" },
  };
  const m = map[trend];
  return <Pill tone={m.tone}><m.Icon className="h-3 w-3" /> {m.label}</Pill>;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Top-3 podium (1st centered + taller, with crown), matching the Classroom mockup. */
function Podium({ rows, scoreOf }: { rows: RankingRow[]; scoreOf: (r: RankingRow) => number | null }) {
  const top = rows.slice(0, 3);
  if (top.length < 3) return null;
  const order = [top[1], top[0], top[2]]; // 2nd, 1st, 3rd
  const meta: Record<number, { ring: string; medal: string; pad: string }> = {
    1: { ring: "bg-gradient-to-br from-amber-400 to-amber-600", medal: "bg-amber-500", pad: "pt-7" },
    2: { ring: "bg-gradient-to-br from-slate-300 to-slate-500", medal: "bg-slate-400", pad: "pt-4" },
    3: { ring: "bg-gradient-to-br from-orange-300 to-orange-500", medal: "bg-orange-400", pad: "pt-4" },
  };
  return (
    <div className="mb-4 grid grid-cols-3 items-end gap-3">
      {order.map((r) => {
        const m = meta[r.rank] ?? meta[3];
        const score = scoreOf(r);
        return (
          <div key={`${r.rank}-${r.name}`}
            className={cn("relative flex flex-col items-center rounded-2xl border p-4", m.pad,
              r.is_me ? "border-primary bg-primary/5" : "border-border bg-card")}>
            {r.rank === 1 && <span className="absolute -top-3 text-amber-500">👑</span>}
            <div className={cn("flex h-14 w-14 items-center justify-center rounded-full text-base font-extrabold text-white shadow-md", m.ring)}>
              {initials(r.name)}
            </div>
            <span className={cn("-mt-2.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-extrabold text-white ring-2 ring-card", m.medal)}>{r.rank}</span>
            <div className="mt-2 max-w-full truncate text-center text-sm font-extrabold text-foreground">
              {r.name}{r.is_me && <span className="ml-1 text-xs text-primary">You</span>}
            </div>
            <div className="mt-0.5 text-[13px] font-bold text-muted-foreground">{score != null ? `${Math.round(score)} pts` : "—"}</div>
          </div>
        );
      })}
    </div>
  );
}

function topPercent(p: number | null): string | null {
  if (p == null) return null;
  return `Top ${Math.max(1, Math.round(100 - p))}%`;
}

function num(c: Record<string, unknown> | null, key: string): number | null {
  const v = c?.[key];
  return typeof v === "number" ? v : null;
}

export function Rankings({ classroom }: { classroom: ClassroomWithRole }) {
  const [kind, setKind] = useState<RankingKind>("SAT");
  return (
    <div className="space-y-5">
      {/* SAT and Academic are completely separate experiences — switch, never combine. */}
      <div className="inline-flex rounded-xl border border-border p-0.5">
        {(["SAT", "ACADEMIC"] as RankingKind[]).map((k) => {
          const M = KIND_META[k];
          return (
            <button key={k} onClick={() => setKind(k)}
              className={cn("inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold",
                kind === k ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:text-foreground")}>
              <M.icon className="h-4 w-4" /> {M.title}
            </button>
          );
        })}
      </div>
      <RankingBoard key={kind} classroom={classroom} kind={kind} />
    </div>
  );
}

function RankingBoard({ classroom, kind }: { classroom: ClassroomWithRole; kind: RankingKind }) {
  const classId = Number(classroom.id);
  const caps = capabilitiesFor(classroom.my_role);
  const { data, isLoading, isError, refetch } = useRankings(classId, kind);
  const recompute = useRecomputeRankings(classId);
  const updateConfig = useUpdateRankingConfig(classId, kind);
  const [showHistory, setShowHistory] = useState(false);
  const M = KIND_META[kind];

  if (isLoading) return <LoadingState label={`Loading ${M.title}…`} />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  const hideScores = data.config.hide_score_values;
  const showScore = (row: RankingRow) => (row.is_me ? row.score : hideScores && !caps.isStaff ? null : row.score);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title={M.title}
          description={M.desc}
          actions={
            data.can_recompute && (
              <Button size="sm" variant="secondary" icon={RefreshCcw} loading={recompute.isPending}
                onClick={() => recompute.mutate([kind])}>
                Recompute
              </Button>
            )
          }
        />

        {data.can_configure && (
          <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-dashed border-border p-3">
            <Field label="Leaderboard visibility" className="w-44">
              <Select
                value={data.config.leaderboard_mode}
                onChange={(e) => updateConfig.mutate({ leaderboard_mode: e.target.value as LeaderboardMode })}
              >
                <option value="FULL">Full — names + scores</option>
                <option value="ANONYMOUS">Anonymous — hide names</option>
                <option value="HIDDEN">Hidden — own rank only</option>
              </Select>
            </Field>
            <label className="flex items-center gap-2 pb-2.5 text-sm text-foreground">
              <input type="checkbox" checked={data.config.hide_score_values}
                onChange={(e) => updateConfig.mutate({ hide_score_values: e.target.checked })}
                className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-[var(--ring)]" />
              Hide score values
            </label>
          </div>
        )}

        {/* My position — always highlighted, own score always visible */}
        {data.my && (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Your rank" value={`#${data.my.rank}`} icon={M.icon} accent="text-amber-600 bg-amber-500/10" />
            <StatCard label={M.unit} value={data.my.score != null ? Math.round(data.my.score) : "—"} icon={TrendingUp} />
            {data.my.percentile != null && <StatCard label="Standing" value={topPercent(data.my.percentile) ?? "—"} icon={Trophy} accent="text-emerald-600 bg-emerald-500/10" />}
            {kind === "SAT" && num(data.my.components, "best") != null && (
              <StatCard label="Best" value={Math.round(num(data.my.components, "best") as number)} icon={Trophy} />
            )}
            {kind === "ACADEMIC" && num(data.my.components, "completion_rate") != null && (
              <StatCard label="Completion" value={`${num(data.my.components, "completion_rate")}%`} icon={GraduationCap} />
            )}
          </div>
        )}
      </Card>

      {/* Leaderboard */}
      <Card>
        <CardHeader
          title="Leaderboard"
          description={data.period_key ? `Updated ${data.period_key}` : undefined}
          actions={data.my && (
            <Button size="sm" variant="ghost" icon={History} onClick={() => setShowHistory((v) => !v)}>
              My history
            </Button>
          )}
        />
        {data.rows.length >= 3 && data.config.leaderboard_mode !== "ANONYMOUS" ? (
          <Podium rows={data.rows} scoreOf={showScore} />
        ) : null}
        <div className="mt-4 space-y-1.5">
          {data.rows.length === 0 ? (
            <EmptyState icon={M.icon} title="No rankings yet"
              description={data.can_configure ? "Once students complete work, recompute to build the leaderboard." : "Your ranking will appear once there's enough data."} />
          ) : (
            (data.rows.length >= 3 && data.config.leaderboard_mode !== "ANONYMOUS" ? data.rows.slice(3) : data.rows).map((row) => {
              const score = showScore(row);
              return (
                <div key={`${row.rank}-${row.name}`}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-4 py-2.5",
                    row.is_me ? "border-primary bg-primary/5" : "border-border",
                  )}>
                  <span className="w-8 shrink-0 text-sm font-bold tabular-nums text-muted-foreground">#{row.rank}</span>
                  <Movement change={row.rank_change} />
                  <span className={cn("min-w-0 flex-1 truncate text-sm", row.is_me ? "font-semibold text-foreground" : "text-foreground")}>
                    {row.name}{row.is_me && <span className="ml-1.5 text-xs text-primary">You</span>}
                  </span>
                  {kind === "SAT" && row.confidence && row.confidence !== "HIGH" && (
                    <Pill tone="neutral">{row.confidence === "LOW" ? "Provisional" : "Building"}</Pill>
                  )}
                  <TrendBadge trend={row.trend} />
                  {row.percentile != null && <span className="hidden w-16 text-right text-xs text-muted-foreground sm:inline">{Math.round(row.percentile)}%ile</span>}
                  <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">
                    {score != null ? Math.round(score) : <EyeOff className="ml-auto h-3.5 w-3.5 text-muted-foreground" />}
                  </span>
                </div>
              );
            })
          )}
        </div>
        {!caps.isStaff && data.config.leaderboard_mode === "HIDDEN" && (
          <p className="mt-3 text-center text-xs text-muted-foreground">Your teacher shows only your own position for this class.</p>
        )}
      </Card>

      {showHistory && <HistoryPanel classId={classId} kind={kind} onClose={() => setShowHistory(false)} />}
    </div>
  );
}

function HistoryPanel({ classId, kind, onClose }: { classId: number; kind: RankingKind; onClose: () => void }) {
  const { data, isLoading, isError, refetch } = useRankingHistory(classId, kind);
  const points = data?.history ?? [];
  const maxScore = Math.max(1, ...points.map((p) => p.score));

  return (
    <Card>
      <CardHeader title="Ranking history" description="Your position over time" actions={<Button size="sm" variant="ghost" onClick={onClose}>Close</Button>} />
      {isLoading ? <LoadingState label="Loading history…" /> : isError ? <ErrorState onRetry={() => refetch()} /> : points.length === 0 ? (
        <EmptyState icon={History} title="No history yet" description="History builds up as rankings are recomputed over time." />
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex items-end gap-1.5" style={{ height: 100 }}>
            {points.map((p) => (
              <div key={p.period_key} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${p.period_key} · #${p.rank} · ${Math.round(p.score)}`}>
                <div className="w-full rounded-t bg-primary/60" style={{ height: `${(p.score / maxScore) * 100}%`, minHeight: 2 }} />
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            {[...points].reverse().map((p) => (
              <div key={p.period_key} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="text-muted-foreground">{p.period_key}</span>
                <span className="font-medium text-foreground">#{p.rank} · {Math.round(p.score)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
