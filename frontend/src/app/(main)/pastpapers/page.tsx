"use client";

/**
 * /pastpapers — Past papers library, 1:1 with the MasterSAT Past Papers mockup
 * (shared `.dzboard` scope): SIMULATION header, Region + Year + Status segmented
 * filters, search, and booklet cards with per-user state.
 *
 * Each card is ONE standalone section (a `PracticeTest`, subject MATH or
 * READING_WRITING). The former `PastpaperPack` grouping was removed on the
 * backend; sections carry `collection_name` (the former pack title) which we use
 * to visually group cards. Status + per-section score are derived from the
 * student's attempts (GET /exams/attempts/). Each section is scored standalone
 * (200–800 style); there is no composite /1600. Clicking a card starts/resumes
 * that single section's attempt directly (POST /exams/attempts/ → /exam/{id}).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
// Public pastpaper sections + attempts live only on examsPublicApi; no feature wrapper exists.
// eslint-disable-next-line no-restricted-imports
import { examsPublicApi, type PastpaperSection } from "@/lib/api";
import { useMe } from "@/hooks/useMe";
import { useAuthCriticalGate } from "@/hooks/useAuthCriticalGate";
import {
  BookOpen, Calculator, Calendar, Globe, Search, Play, PlayCircle, Eye, Clock,
  AlertTriangle, FileText, RefreshCw,
} from "lucide-react";

function fmtMonth(s: string | null | undefined): string {
  if (!s) return "Undated";
  try { return new Date(s).toLocaleDateString("en-US", { month: "long", year: "numeric" }); } catch { return s; }
}
function fmtDay(s: string | null | undefined): string {
  if (!s) return "";
  try { return new Date(s).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }); } catch { return ""; }
}
function yearOf(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = new Date(s); return Number.isNaN(d.getTime()) ? null : String(d.getFullYear());
}
function isRW(subject: string): boolean {
  return subject === "READING_WRITING" || subject?.toLowerCase().includes("reading");
}
function subjectLabel(subject: string): string {
  if (isRW(subject)) return "Reading & Writing";
  if (subject === "MATH" || subject?.toLowerCase().includes("math")) return "Mathematics";
  return subject;
}
function variantLabel(s: PastpaperSection): string {
  // The paper variant shown as the card TITLE (e.g. "Int. A", "US A"), derived by
  // stripping the "<Month Year>" prefix from collection_name. The month is the
  // GROUP HEADER; the subject (R&W / Math) is the badge — so the title only needs
  // the variant, which is what tells the two sittings of a month apart.
  const coll = (s.collection_name || "").trim();
  const month = fmtMonth(s.practice_date);
  if (coll) {
    if (month && coll.toLowerCase().startsWith(month.toLowerCase())) {
      const rest = coll.slice(month.length).trim();
      if (rest) return rest;
    }
    const parts = coll.split(/\s+/);
    if (parts.length > 2) return parts.slice(2).join(" ");
    return coll;
  }
  const region = s.form_type === "US" ? "US" : "Int.";
  return s.label && s.label.trim() ? `${region} ${s.label.trim()}` : region;
}
function sectionTitle(s: PastpaperSection): string {
  if (s.title && s.title.trim()) return s.title.trim();
  return variantLabel(s);
}
function collectionLabel(s: PastpaperSection): string {
  // Group header = the sitting month (e.g. "October 2025"); ALL variants
  // (Int. A/B, US A/B) live under one month, distinguished by the card title.
  return fmtMonth(s.practice_date);
}

type Att = { id: number; practice_test: number; is_completed: boolean; is_expired: boolean; score: number | null; completed_at?: string | null; submitted_at?: string | null };
type Status = "new" | "progress" | "completed";
type Derived = {
  status: Status;
  score: number | null;
  completedDate: string | null;
  completedAttemptId: number | null;
};

function derive(section: PastpaperSection, list: Att[]): Derived {
  const sorted = [...list].sort((a, b) => b.id - a.id);
  const completed = sorted.find((a) => a.is_completed);
  const active = sorted.find((a) => !a.is_completed && !a.is_expired);
  const status: Status = completed ? "completed" : active ? "progress" : "new";
  return {
    status,
    score: completed?.score ?? null,
    completedDate: completed?.completed_at || completed?.submitted_at || null,
    completedAttemptId: completed?.id ?? null,
  };
}

type Region = "ALL" | "US" | "INTL";
type StatusFilter = "ALL" | "new" | "progress" | "completed";

export default function PastpapersPage() {
  const router = useRouter();
  const { isAuthenticated } = useMe();
  const { assertCriticalAuth } = useAuthCriticalGate();
  const [sections, setSections] = useState<PastpaperSection[]>([]);
  const [atts, setAtts] = useState<Att[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [region, setRegion] = useState<Region>("ALL");
  const [year, setYear] = useState<string>("ALL");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");
  const [starting, setStarting] = useState<number | null>(null);
  const [startError, setStartError] = useState<{ sectionId: number; msg: string } | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(false);
    Promise.all([
      examsPublicApi.getPastpaperSections(),
      isAuthenticated ? examsPublicApi.getAttempts().then((r) => r.items as Att[]).catch(() => []) : Promise.resolve([] as Att[]),
    ])
      .then(([s, a]) => { setSections(s); setAtts(a); })
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
    for (const s of sections) { const y = yearOf(s.practice_date); if (y) set.add(y); }
    return Array.from(set).sort((a, b) => Number(b) - Number(a));
  }, [sections]);

  const rows = useMemo(() => {
    const q = search.toLowerCase().trim();
    return sections
      .map((s) => ({ section: s, d: derive(s, byTest.get(s.id) ?? []) }))
      .filter(({ section, d }) => {
        if (region === "US" && section.form_type !== "US") return false;
        if (region === "INTL" && section.form_type === "US") return false;
        if (year !== "ALL" && yearOf(section.practice_date) !== year) return false;
        if (status !== "ALL" && d.status !== status) return false;
        if (q) {
          const blob = `${sectionTitle(section)} ${collectionLabel(section)} ${section.label || ""} ${section.form_type || ""} ${subjectLabel(section.subject)} ${fmtMonth(section.practice_date)}`.toLowerCase();
          if (!blob.includes(q)) return false;
        }
        return true;
      });
  }, [sections, byTest, region, year, status, search]);

  // Group filtered cards by sitting MONTH (one header per month); within a month
  // order by variant then subject so each paper's R&W + Math sit together, and
  // list months newest-first.
  const groups = useMemo(() => {
    const map = new Map<string, { section: PastpaperSection; d: Derived }[]>();
    for (const row of rows) {
      const key = collectionLabel(row.section);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    const subjRank = (s: PastpaperSection) => (isRW(s.subject) ? 0 : 1);
    for (const items of map.values()) {
      items.sort((a, b) => {
        const c = (a.section.collection_name || "").localeCompare(b.section.collection_name || "");
        return c !== 0 ? c : subjRank(a.section) - subjRank(b.section);
      });
    }
    return Array.from(map.entries())
      .map(([name, items]) => ({ name, items, sortKey: items[0]?.section.practice_date || "" }))
      .sort((a, b) => (b.sortKey || "").localeCompare(a.sortKey || ""))
      .map(({ name, items }) => ({ name, items }));
  }, [rows]);

  const hasFilter = region !== "ALL" || year !== "ALL" || status !== "ALL" || !!search.trim();

  const handleOpen = async (section: PastpaperSection, d: Derived) => {
    // Completed: review the finished attempt. Otherwise start/resume an attempt.
    if (d.status === "completed" && d.completedAttemptId) {
      router.push(`/review/${d.completedAttemptId}?back=/pastpapers`);
      return;
    }
    if (!assertCriticalAuth()) return;
    setStarting(section.id);
    setStartError(null);
    try {
      let attempt = atts.find((a) => a.practice_test === section.id && !a.is_completed && !a.is_expired);
      const isFreshStart = !attempt;
      if (!attempt) {
        attempt = (await examsPublicApi.startTest(section.id)) as unknown as Att;
        setAtts((prev) => [...prev, attempt!]);
      }
      try { sessionStorage.setItem(`mastersat.attempt.bootstrap.${attempt.id}`, JSON.stringify(attempt)); } catch {}
      router.push(`/exam/${attempt.id}${isFreshStart ? "?welcome=1" : ""}`);
    } catch (e: unknown) {
      const data = (e as { response?: { data?: unknown } })?.response?.data;
      let msg = "Could not start this section. Please try again.";
      if (data && typeof data === "object") {
        const dd = data as Record<string, unknown>;
        if (typeof dd.message === "string") msg = dd.message;
        else if (typeof dd.detail === "string") msg = dd.detail;
        else if (typeof dd.error === "string") msg = dd.error;
        else if (dd.code === "practice_test_empty") msg = "This section has no questions yet.";
      }
      setStartError({ sectionId: section.id, msg });
      setStarting(null);
    }
  };

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
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="dz-skel" style={{ height: 200, borderRadius: 18 }} />)}
          </div>
        ) : groups.length === 0 ? (
          <PapersEmpty hasFilter={hasFilter} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
            {groups.map((g) => (
              <div key={g.name}>
                <div className="dz-headin" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--dz-mute)" }}>{g.name}</span>
                  <span style={{ flex: 1, height: 1, background: "var(--dz-border)" }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 18 }}>
                  {g.items.map(({ section, d }) => (
                    <Booklet
                      key={section.id}
                      section={section}
                      d={d}
                      busy={starting === section.id}
                      error={startError?.sectionId === section.id ? startError.msg : null}
                      onOpen={() => void handleOpen(section, d)}
                    />
                  ))}
                </div>
              </div>
            ))}
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

function Booklet({ section, d, busy, error, onOpen }: { section: PastpaperSection; d: Derived; busy: boolean; error: string | null; onOpen: () => void }) {
  const isUS = section.form_type === "US";
  const rw = isRW(section.subject);
  const regionMain = isUS ? "var(--dz-indigo)" : "#0d9488";
  const regionSoft = isUS ? "var(--dz-indigo-soft)" : "rgba(13,148,136,.12)";
  const subjAccent = rw ? "var(--dz-indigo)" : "#0d9488";
  const subjSoft = rw ? "var(--dz-indigo-soft)" : "rgba(13,148,136,.12)";
  const statusMeta = {
    new: { dot: regionMain, label: "Not started", color: "var(--dz-mute)", bg: "var(--dz-card)" },
    progress: { dot: "var(--dz-amber)", label: "In progress", color: "var(--dz-amber)", bg: "color-mix(in srgb, var(--dz-amber) 12%, transparent)" },
    completed: { dot: "#16a34a", label: "Completed", color: "#16a34a", bg: "rgba(22,163,74,.12)" },
  }[d.status];
  const SubjIcon = rw ? BookOpen : Calculator;

  return (
    <div className="dz-booklet" onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      style={{ display: "flex", border: "1px solid var(--dz-border)", borderRadius: 18, overflow: "hidden", background: "var(--dz-panel)", cursor: "pointer" }}>
      <div className="dz-edge" style={{ width: 11, background: d.status === "completed" ? "#16a34a" : d.status === "progress" ? "var(--dz-amber)" : regionMain, flex: "none" }} />
      <div style={{ width: 10, background: "repeating-linear-gradient(var(--dz-panel), var(--dz-panel) 3px, var(--dz-border) 3px, var(--dz-border) 6px)", borderRight: "1px solid var(--dz-border)", flex: "none" }} />
      <div style={{ padding: "18px 20px", flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, color: statusMeta.color, background: statusMeta.bg, padding: "4px 10px", borderRadius: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: statusMeta.dot }} /> {statusMeta.label}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, color: regionMain, background: regionSoft, padding: "4px 10px", borderRadius: 8 }}>
            {isUS ? <span style={{ fontSize: 13, lineHeight: 1 }}>🇺🇸</span> : <Globe size={13} />} {isUS ? "US" : "International"}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, color: subjAccent, background: subjSoft, padding: "5px 11px", borderRadius: 9 }}>
            <SubjIcon size={13} /> {subjectLabel(section.subject)}
          </span>
        </div>

        {/* marginTop:auto absorbs any extra card height (when a shorter card is
            stretched next to a taller sibling) BETWEEN the badge and the title,
            so the title/date/action move down together instead of leaving an
            awkward gap around the button. Collapses to 0 on a full card. */}
        <div className="clip1" style={{ marginTop: "auto", fontSize: 18, fontWeight: 800, letterSpacing: "-.01em", color: "var(--dz-ink)" }}>
          {sectionTitle(section)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--dz-mute)", marginTop: 6 }}>
          <Calendar size={14} /> {fmtMonth(section.practice_date)}
          {section.label ? <><span style={{ color: "var(--dz-faint)" }}>·</span> Form {section.label}</> : null}
        </div>
        <div style={{ height: 1, background: "var(--dz-border)", margin: "15px 0" }} />

        {error ? (
          <div style={{ marginBottom: 12, fontSize: 12, fontWeight: 600, color: "var(--dz-error)", background: "var(--dz-error-soft)", padding: "8px 12px", borderRadius: 10 }}>{error}</div>
        ) : null}

        {d.status === "completed" ? (
          <>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 14, marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", color: "var(--dz-faint)", marginBottom: 3 }}>YOUR SCORE</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                  <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-.03em", color: "var(--dz-ink)", lineHeight: 1 }}>{d.score ?? "—"}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--dz-faint)" }}>/ 800</span>
                </div>
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
          </>
        ) : d.status === "progress" ? (
          <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); onOpen(); }} className="dz-actionbtn"
            style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: 11, borderRadius: 11, border: "none", background: "var(--dz-amber)", color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
            <PlayCircle size={15} /> {busy ? "…" : "Resume"}
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); onOpen(); }} className="dz-actionbtn"
            style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: 11, borderRadius: 11, border: "none", background: "var(--dz-indigo)", color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
            <Play size={15} /> {busy ? "Starting…" : "Start"}
          </button>
        )}
      </div>
    </div>
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
