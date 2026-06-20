"use client";

/**
 * /pastpapers — Past papers library, 1:1 with the MasterSAT Past Papers mockup
 * (shared `.dzboard` scope): SIMULATION header, Region + Year + Status segmented
 * filters, search, and booklet cards with per-user state.
 *
 * Status + scores are derived per pack from the student's section attempts
 * (GET /exams/attempts/): a pack is Completed when every section has a completed
 * attempt, In progress when some section is started, otherwise New. Scores are
 * the scaled section scores (R&W + Math, each /800; composite /1600).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
// Public pastpaper packs + attempts live only on examsPublicApi; no feature wrapper exists.
// eslint-disable-next-line no-restricted-imports
import { examsPublicApi, type PastpaperPackPublic, type PastpaperPackSection } from "@/lib/api";
import { useMe } from "@/hooks/useMe";
import {
  BookOpen, Calculator, Calendar, Globe, Search, Play, PlayCircle, Eye, Clock,
  AlertTriangle, FileText, RefreshCw, Lock,
} from "lucide-react";

function fmtMonth(s: string | null): string {
  if (!s) return "Undated";
  try { return new Date(s).toLocaleDateString("en-US", { month: "long", year: "numeric" }); } catch { return s; }
}
function fmtDay(s: string | null | undefined): string {
  if (!s) return "";
  try { return new Date(s).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }); } catch { return ""; }
}
function yearOf(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s); return Number.isNaN(d.getTime()) ? null : String(d.getFullYear());
}
function isRW(subject: string): boolean {
  return subject === "READING_WRITING" || subject?.toLowerCase().includes("reading");
}

type Att = { id: number; practice_test: number; is_completed: boolean; is_expired: boolean; score: number | null; completed_at?: string | null; submitted_at?: string | null };
type Status = "new" | "progress" | "completed";
type Derived = {
  status: Status;
  total: number | null; rw: number | null; math: number | null;
  completedDate: string | null; pct: number;
  hasRW: boolean; hasMath: boolean;
};

function derive(pack: PastpaperPackPublic, byTest: Map<number, Att[]>): Derived {
  const sections = pack.sections;
  const rwSec = sections.find((s) => isRW(s.subject));
  const mathSec = sections.find((s) => !isRW(s.subject));
  const compOf = (s?: PastpaperPackSection) => s ? (byTest.get(s.id) ?? []).find((a) => a.is_completed) : undefined;
  const startedOf = (s: PastpaperPackSection) => (byTest.get(s.id) ?? []).some((a) => a.is_completed || (!a.is_completed && !a.is_expired));

  const comps = sections.map((s) => compOf(s));
  const completedCount = comps.filter(Boolean).length;
  const allDone = sections.length > 0 && completedCount === sections.length;
  const anyStarted = sections.some(startedOf);
  const status: Status = allDone ? "completed" : anyStarted ? "progress" : "new";

  const rwComp = compOf(rwSec); const mathComp = compOf(mathSec);
  const rw = rwComp?.score ?? null; const math = mathComp?.score ?? null;
  const scored = comps.map((c) => c?.score).filter((s): s is number => typeof s === "number");
  const total = allDone && scored.length ? Math.min(1600, scored.reduce((a, b) => a + b, 0)) : null;
  const dates = comps.map((c) => c?.completed_at || c?.submitted_at).filter(Boolean) as string[];
  const completedDate = dates.sort().slice(-1)[0] ?? null;
  const pct = sections.length ? Math.round((completedCount / sections.length) * 100) : 0;

  return { status, total, rw, math, completedDate, pct, hasRW: !!rwSec, hasMath: !!mathSec };
}

type Region = "ALL" | "US" | "INTL";
type StatusFilter = "ALL" | "new" | "progress" | "completed";

export default function PastpapersPage() {
  const router = useRouter();
  const { isAuthenticated } = useMe();
  const [packs, setPacks] = useState<PastpaperPackPublic[]>([]);
  const [atts, setAtts] = useState<Att[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [region, setRegion] = useState<Region>("ALL");
  const [year, setYear] = useState<string>("ALL");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    setLoading(true); setError(false);
    Promise.all([
      examsPublicApi.getPastpaperPacks(),
      isAuthenticated ? examsPublicApi.getAttempts().then((r) => r.items as Att[]).catch(() => []) : Promise.resolve([] as Att[]),
    ])
      .then(([p, a]) => { setPacks(p); setAtts(a); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [isAuthenticated]);
  useEffect(() => { load(); }, [load]);

  const byTest = useMemo(() => {
    const m = new Map<number, Att[]>();
    for (const a of atts) { const l = m.get(a.practice_test) ?? []; l.push(a); m.set(a.practice_test, l); }
    for (const l of m.values()) l.sort((x, y) => y.id - x.id);
    return m;
  }, [atts]);

  const years = useMemo(() => {
    const set = new Set<string>();
    for (const p of packs) { const y = yearOf(p.practice_date); if (y) set.add(y); }
    return Array.from(set).sort((a, b) => Number(b) - Number(a));
  }, [packs]);

  const rows = useMemo(() => {
    const q = search.toLowerCase().trim();
    return packs
      .map((p) => ({ pack: p, d: derive(p, byTest) }))
      .filter(({ pack, d }) => {
        if (region === "US" && pack.form_type !== "US") return false;
        if (region === "INTL" && pack.form_type === "US") return false;
        if (year !== "ALL" && yearOf(pack.practice_date) !== year) return false;
        if (status !== "ALL" && d.status !== status) return false;
        if (q) {
          const blob = `${pack.title || ""} ${pack.label || ""} ${pack.form_type || ""} ${fmtMonth(pack.practice_date)}`.toLowerCase();
          if (!blob.includes(q)) return false;
        }
        return true;
      });
  }, [packs, byTest, region, year, status, search]);

  const hasFilter = region !== "ALL" || year !== "ALL" || status !== "ALL" || !!search.trim();

  return (
    <div className="dzboard" style={{ maxWidth: 1280, width: "100%", margin: "0 auto" }}>
      <div className="dz-content">
        <div style={{ marginBottom: 22 }}>
          <div className="dz-headin" style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".18em", color: "var(--dz-faint)" }}>SIMULATION</div>
          <h1 className="dz-headin" style={{ margin: "8px 0 0", fontSize: 38, lineHeight: 1.05, fontWeight: 800, letterSpacing: "-.03em", color: "var(--dz-ink)" }}>Past papers</h1>
        </div>

        <div className="dz-headin" style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 20, flexWrap: "wrap" }}>
          <Segmented label="REGION" value={region} onChange={(v) => setRegion(v as Region)}
            options={[{ v: "ALL", l: "All" }, { v: "US", l: "US" }, { v: "INTL", l: "International" }]} />
          {years.length > 0 ? (
            <Segmented label="YEAR" value={year} onChange={setYear}
              options={[{ v: "ALL", l: "All" }, ...years.map((y) => ({ v: y, l: y }))]} />
          ) : null}
          <Segmented label="STATUS" value={status} onChange={(v) => setStatus(v as StatusFilter)}
            options={[{ v: "ALL", l: "All" }, { v: "new", l: "New" }, { v: "progress", l: "In progress" }, { v: "completed", l: "Completed" }]} />
        </div>

        <div className="dz-headin" style={{ position: "relative", marginBottom: 24, maxWidth: 560 }}>
          <span style={{ position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)", color: "var(--dz-faint)", display: "flex" }}><Search size={18} /></span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search past papers…"
            style={{ width: "100%", border: "1px solid var(--dz-border)", background: "var(--dz-panel)", borderRadius: 14, padding: "14px 16px 14px 48px", fontFamily: "inherit", fontSize: 15, color: "var(--dz-ink)", outline: "none" }} />
        </div>

        {error ? (
          <PapersError onRetry={load} />
        ) : loading ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 18 }}>
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="dz-skel" style={{ height: 210, borderRadius: 18 }} />)}
          </div>
        ) : rows.length === 0 ? (
          <PapersEmpty hasFilter={hasFilter} />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 18 }}>
            {rows.map(({ pack, d }) => <Booklet key={pack.id} pack={pack} d={d} onOpen={() => router.push(`/pastpapers/${pack.id}`)} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function Segmented({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em", color: "var(--dz-faint)" }}>{label}</span>
      <div style={{ display: "flex", gap: 5, background: "var(--dz-card)", borderRadius: 11, padding: 4 }}>
        {options.map((o) => {
          const active = o.v === value;
          return (
            <div key={o.v} role="button" tabIndex={0} onClick={() => onChange(o.v)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onChange(o.v); } }}
              className="dz-seg"
              style={{ padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 700, background: active ? "var(--dz-indigo)" : "transparent", color: active ? "#fff" : "var(--dz-mute)", boxShadow: active ? "0 2px 8px rgba(42,104,192,.35)" : "none" }}>
              {o.l}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Booklet({ pack, d, onOpen }: { pack: PastpaperPackPublic; d: Derived; onOpen: () => void }) {
  const isUS = pack.form_type === "US";
  const regionMain = isUS ? "var(--dz-indigo)" : "#0d9488";
  const regionSoft = isUS ? "var(--dz-indigo-soft)" : "rgba(13,148,136,.12)";
  const statusMeta = {
    new: { dot: regionMain, label: "Not started", color: "var(--dz-mute)", bg: "var(--dz-card)" },
    progress: { dot: "var(--dz-amber)", label: "In progress", color: "var(--dz-amber)", bg: "color-mix(in srgb, var(--dz-amber) 12%, transparent)" },
    completed: { dot: "#16a34a", label: "Completed", color: "#16a34a", bg: "rgba(22,163,74,.12)" },
  }[d.status];

  return (
    <div className="dz-booklet" onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      style={{ display: "flex", border: "1px solid var(--dz-border)", borderRadius: 18, overflow: "hidden", background: "var(--dz-panel)", cursor: "pointer" }}>
      <div className="dz-edge" style={{ width: 11, background: d.status === "completed" ? "#16a34a" : d.status === "progress" ? "var(--dz-amber)" : regionMain, flex: "none" }} />
      <div style={{ width: 10, background: "repeating-linear-gradient(var(--dz-panel), var(--dz-panel) 3px, var(--dz-border) 3px, var(--dz-border) 6px)", borderRight: "1px solid var(--dz-border)", flex: "none" }} />
      <div style={{ padding: "18px 20px", flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, color: statusMeta.color, background: statusMeta.bg, padding: "4px 10px", borderRadius: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: statusMeta.dot }} /> {statusMeta.label}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, color: regionMain, background: regionSoft, padding: "4px 10px", borderRadius: 8 }}>
            {isUS ? <span style={{ fontSize: 13, lineHeight: 1 }}>🇺🇸</span> : <Globe size={13} />} {isUS ? "US" : "International"}
          </span>
        </div>
        <div className="clip1" style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.01em", color: "var(--dz-ink)" }}>
          {pack.title || `SAT past paper — ${fmtMonth(pack.practice_date)}`}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--dz-mute)", marginTop: 6 }}>
          <Calendar size={14} /> {fmtMonth(pack.practice_date)}
          {pack.label ? <><span style={{ color: "var(--dz-faint)" }}>·</span> Form {pack.label}</> : null}
        </div>
        <div style={{ height: 1, background: "var(--dz-border)", margin: "15px 0" }} />

        {d.status === "completed" ? (
          <>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 14, marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", color: "var(--dz-faint)", marginBottom: 3 }}>FINAL SCORE</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                  <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-.03em", color: "var(--dz-ink)", lineHeight: 1 }}>{d.total ?? "—"}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--dz-faint)" }}>/ 1600</span>
                </div>
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ display: "flex", gap: 8 }}>
                {d.hasRW ? <ScoreSplit label="R&W" value={d.rw} color="var(--dz-indigo)" /> : null}
                {d.hasRW && d.hasMath ? <div style={{ width: 1, background: "var(--dz-border)" }} /> : null}
                {d.hasMath ? <ScoreSplit label="MATH" value={d.math} color="#0d9488" /> : null}
              </div>
            </div>
            {d.completedDate ? (
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 600, color: "var(--dz-mute)", marginBottom: 14 }}>
                <Clock size={13} /> Completed {fmtDay(d.completedDate)}
              </div>
            ) : null}
            <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} className="dz-actionbtn"
              style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: 11, borderRadius: 11, border: "none", background: "var(--dz-indigo)", color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
              <Eye size={15} /> Review answers
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: "var(--dz-faint)", marginTop: 10 }}>
              <Lock size={12} /> Completed papers are one-time — your score is final
            </div>
          </>
        ) : d.status === "progress" ? (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--dz-mute)" }}>Keep going — you&apos;ve started this one</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: "var(--dz-amber)" }}>{d.pct}%</span>
            </div>
            <div style={{ height: 8, borderRadius: 6, background: "var(--dz-card)", overflow: "hidden", marginBottom: 14 }}>
              <div style={{ height: "100%", width: `${d.pct}%`, background: "var(--dz-amber)", borderRadius: 6 }} />
            </div>
            <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} className="dz-actionbtn"
              style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: 11, borderRadius: 11, border: "none", background: "var(--dz-amber)", color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
              <PlayCircle size={15} /> Resume
            </button>
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {d.hasRW ? <Chip icon={<BookOpen size={13} />} label="R&W" color="var(--dz-indigo)" soft="var(--dz-indigo-soft)" /> : null}
            {d.hasMath ? <Chip icon={<Calculator size={13} />} label="Math" color="#0d9488" soft="rgba(13,148,136,.12)" /> : null}
            <div style={{ flex: 1 }} />
            <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} className="dz-actionbtn"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 18px", borderRadius: 11, border: "none", background: "var(--dz-indigo)", color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
              <Play size={15} /> Start
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ScoreSplit({ label, value, color }: { label: string; value: number | null; color: string }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".06em", color }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: "var(--dz-ink)", lineHeight: 1.1 }}>{value ?? "—"}</div>
    </div>
  );
}

function Chip({ icon, label, color, soft }: { icon: React.ReactNode; label: string; color: string; soft: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, color, background: soft, padding: "6px 11px", borderRadius: 9 }}>
      {icon} {label}
    </span>
  );
}

function PapersEmpty({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div style={{ border: "1.5px dashed var(--dz-border)", borderRadius: 22, padding: "64px 40px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", background: "var(--dz-card)" }}>
      <div style={{ width: 88, height: 88, borderRadius: 26, background: "var(--dz-indigo-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--dz-indigo)", marginBottom: 22 }}>
        <FileText size={40} />
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.01em", color: "var(--dz-ink)" }}>{hasFilter ? "No matching papers" : "No past papers yet"}</div>
      <div style={{ fontSize: 15, fontWeight: 500, color: "var(--dz-mute)", marginTop: 8, maxWidth: 420, lineHeight: 1.5 }}>
        {hasFilter ? "Try a different region, year, status, or search." : "Released SAT papers will appear here once added."}
      </div>
    </div>
  );
}

function PapersError({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={{ border: "1.5px solid var(--dz-error-border)", borderRadius: 22, padding: "64px 40px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", background: "var(--dz-error-bg)" }}>
      <div style={{ width: 88, height: 88, borderRadius: 26, background: "var(--dz-error-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--dz-error)", marginBottom: 22 }}>
        <AlertTriangle size={40} />
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.01em", color: "var(--dz-ink)" }}>Couldn&apos;t load past papers</div>
      <div style={{ fontSize: 15, fontWeight: 500, color: "var(--dz-mute)", marginTop: 8, maxWidth: 440, lineHeight: 1.5 }}>
        Something went wrong on our end. Check your connection and try again.
      </div>
      <button type="button" onClick={onRetry} className="dz-joinbtn2"
        style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 26, padding: "13px 22px", borderRadius: 13, border: "none", background: "var(--dz-indigo)", fontFamily: "inherit", fontSize: 15, fontWeight: 700, color: "#fff", cursor: "pointer" }}>
        <RefreshCw size={18} /> Try again
      </button>
    </div>
  );
}
