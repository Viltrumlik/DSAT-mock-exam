"use client";

import { useState } from "react";
import { Trophy, GraduationCap, Crown, EyeOff, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { EmptyState, LoadingState, ErrorState } from "../ui";
import { capabilitiesFor } from "../capabilities";
import type { ClassroomWithRole } from "../types";
import { useRankings } from "../rankingsHooks";
import type { RankingKind, RankingRow } from "../rankingsApi";

const KIND_META: Record<RankingKind, { title: string; icon: LucideIcon; desc: string }> = {
  SAT: { title: "SAT", icon: Trophy, desc: "Ranked by SAT performance — practice tests, past papers, and mock exams." },
  ACADEMIC: { title: "Academic", icon: GraduationCap, desc: "Points earned across assignments, quizzes, and practice." },
};

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return (p[0][0] + (p[1]?.[0] ?? "")).toUpperCase();
}
function fmt(n: number | null): string {
  return n == null ? "—" : Math.round(n).toLocaleString("en-US");
}

// Avatar colour cycle for the ranked list (soft bg, strong text).
const AV: [string, string][] = [
  ["var(--primary-soft)", "var(--primary)"],
  ["rgba(109,78,199,.14)", "#6d4ec7"],
  ["rgba(13,148,136,.14)", "#0d9488"],
  ["rgba(224,133,26,.16)", "#e0851a"],
  ["rgba(214,71,127,.14)", "#d6477f"],
];

export function Rankings({ classroom }: { classroom: ClassroomWithRole }) {
  const [kind, setKind] = useState<RankingKind>("SAT");
  return <RankingBoard key={kind} classroom={classroom} kind={kind} setKind={setKind} />;
}

function RankingBoard({ classroom, kind, setKind }: { classroom: ClassroomWithRole; kind: RankingKind; setKind: (k: RankingKind) => void }) {
  const classId = Number(classroom.id);
  const caps = capabilitiesFor(classroom.my_role);
  const { data, isLoading, isError, refetch } = useRankings(classId, kind);

  const hideScores = data?.config.hide_score_values;
  const scoreOf = (row: RankingRow) => (row.is_me ? row.score : hideScores && !caps.isStaff ? null : row.score);

  return (
    <div className="space-y-5">
      {/* Header: title + SAT/Academic segmented */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Trophy className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-extrabold tracking-tight text-foreground">Class rankings</h2>
        </div>
        <div className="flex gap-1 rounded-xl bg-surface-2 p-1">
          {(["SAT", "ACADEMIC"] as RankingKind[]).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={cn("rounded-lg px-3.5 py-1.5 text-sm font-bold transition-colors",
                kind === k ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground")}>
              {KIND_META[k].title}
            </button>
          ))}
        </div>
      </div>
      <p className="-mt-3 text-[13px] font-medium text-muted-foreground">{KIND_META[kind].desc}</p>

      {isLoading ? (
        <LoadingState label="Loading rankings…" />
      ) : isError || !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : data.rows.length === 0 ? (
        <EmptyState icon={Trophy} title="No rankings yet"
          description={data.can_configure ? "Once students complete work, recompute to build the leaderboard." : "Your ranking will appear once there's enough data."} />
      ) : (
        <>
          {data.rows.length >= 3 && data.config.leaderboard_mode !== "ANONYMOUS" ? (
            <Podium rows={data.rows} scoreOf={scoreOf} />
          ) : null}
          <div className="flex flex-col gap-2">
            {(data.rows.length >= 3 && data.config.leaderboard_mode !== "ANONYMOUS" ? data.rows.slice(3) : data.rows).map((row, i) => {
              const [abg, ac] = AV[(row.rank - 1) % AV.length];
              const score = scoreOf(row);
              return (
                <div key={`${row.rank}-${row.name}-${i}`}
                  className={cn("group flex items-center gap-3.5 rounded-2xl border px-4 py-3 transition-all hover:translate-x-[3px] hover:border-primary hover:shadow-[0_6px_16px_rgba(42,104,192,.12)]",
                    row.is_me ? "border-primary bg-primary/5" : "border-border bg-card")}>
                  <span className="w-[26px] shrink-0 text-center text-[15px] font-extrabold tabular-nums text-muted-foreground">{row.rank}</span>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[14px] font-extrabold" style={{ background: abg, color: ac }}>{initials(row.name)}</span>
                  <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-foreground">
                    {row.name}{row.is_me ? <span className="ml-1.5 text-xs font-bold text-primary">You</span> : null}
                  </span>
                  <span className="w-[84px] shrink-0 text-right text-[15px] font-extrabold tabular-nums text-foreground">
                    {score != null ? fmt(score) : <EyeOff className="ml-auto h-3.5 w-3.5 text-muted-foreground" />}
                  </span>
                </div>
              );
            })}
          </div>
          {!caps.isStaff && data.config.leaderboard_mode === "HIDDEN" ? (
            <p className="text-center text-xs text-muted-foreground">Your teacher shows only your own position for this class.</p>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Top-3 podium — 1st centred + taller with crown (1:1 with the Classroom mockup). */
function Podium({ rows, scoreOf }: { rows: RankingRow[]; scoreOf: (r: RankingRow) => number | null }) {
  const top = rows.slice(0, 3);
  if (top.length < 3) return null;
  const order = [top[1], top[0], top[2]]; // 2nd, 1st, 3rd
  const RANK: Record<number, { soft: string; border: string; medal: string; av: string }> = {
    1: { soft: "linear-gradient(160deg,#fdf3d6,#fff)", border: "1.5px solid #f0d488", medal: "#e3a008", av: "linear-gradient(135deg,#f5b740,#d98f0a)" },
    2: { soft: "linear-gradient(160deg,#eef1f6,#fff)", border: "1.5px solid #e7ebf3", medal: "#94a3b8", av: "linear-gradient(135deg,#cbd5e1,#94a3b8)" },
    3: { soft: "linear-gradient(160deg,#fbeed5,#fff)", border: "1.5px solid #f0d9b3", medal: "#e0851a", av: "linear-gradient(135deg,#f4b15f,#e0851a)" },
  };
  return (
    <div className="grid grid-cols-3 items-end gap-3 sm:gap-4">
      {order.map((r) => {
        const m = RANK[r.rank] ?? RANK[3];
        const first = r.rank === 1;
        const score = scoreOf(r);
        return (
          <div key={`${r.rank}-${r.name}`}
            className="relative flex flex-col items-center rounded-[18px] px-3 pb-[18px] text-center"
            style={{
              paddingTop: first ? 34 : 22,
              background: r.is_me ? "var(--primary-soft)" : m.soft,
              border: r.is_me ? "2px solid var(--primary)" : m.border,
            }}>
            {first ? <Crown className="absolute -top-3 h-6 w-6" style={{ color: "#e3a008", fill: "#f5c542" }} /> : null}
            <span className={cn("flex items-center justify-center rounded-full font-extrabold text-white shadow-md", first ? "h-16 w-16 text-lg" : "h-14 w-14 text-base")} style={{ background: m.av }}>
              {initials(r.name)}
            </span>
            <span className="z-10 -mt-3 flex h-6 w-6 items-center justify-center rounded-full text-xs font-extrabold text-white ring-2 ring-card" style={{ background: m.medal }}>{r.rank}</span>
            <div className="mt-2.5 max-w-full truncate text-[15px] font-extrabold text-foreground">
              {r.name}{r.is_me ? <span className="ml-1 text-xs text-primary">You</span> : null}
            </div>
            <div className="mt-0.5 text-[13px] font-bold text-muted-foreground">{score != null ? `${fmt(score)} pts` : "—"}</div>
          </div>
        );
      })}
    </div>
  );
}
