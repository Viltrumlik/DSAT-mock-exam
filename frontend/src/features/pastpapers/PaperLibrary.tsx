"use client";

/**
 * The booklet library shared by /pastpapers and /practice-tests: the card (`Booklet`), the filter
 * pills (`Segmented`), the empty and error states, and `usePaperLibrary`, which loads the sections
 * plus the student's attempts and starts/resumes/reviews a card. Moved out of the past-papers page
 * with no change to how it renders or behaves there.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
// Public pastpaper sections + attempts live only on examsPublicApi; no feature wrapper exists.
import { examsPublicApi, type PastpaperSection } from "@/lib/api";
import { useMe } from "@/hooks/useMe";
import { useAuthCriticalGate } from "@/hooks/useAuthCriticalGate";
import { type CardAttempt, type CardState } from "@/features/pastpapers/pastpaperCardState";
import { pastpaperReportApi, type ReopenedPastpaper } from "@/features/pastpapers/pastpaperReportApi";
import {
  BookOpen, Calculator, Calendar, Globe, Play, PlayCircle, Eye, Clock,
  AlertTriangle, FileText, RefreshCw, Award, History, RotateCcw,
} from "lucide-react";

import { fmtDay, fmtMonth, isRW, sectionTitle, subjectLabel } from "@/features/pastpapers/pastpaperLabels";

type Att = CardAttempt;
type Derived = CardState;

/**
 * The data side of a booklet library: the sections, the student's attempts, the papers a homework
 * has set again, and starting/resuming/reviewing a card. Moved verbatim out of the past-papers page
 * so /pastpapers and /practice-tests behave the same. `loadSections` picks which sections to list
 * (keep it a stable reference); `backHref` is where the review page's back link returns to.
 */
export function usePaperLibrary({ loadSections, backHref }: {
  loadSections: () => Promise<PastpaperSection[]>;
  backHref: string;
}) {
  const router = useRouter();
  const { isAuthenticated } = useMe();
  const { assertCriticalAuth } = useAuthCriticalGate();
  const [sections, setSections] = useState<PastpaperSection[]>([]);
  const [atts, setAtts] = useState<Att[]>([]);
  const [reopened, setReopened] = useState<Map<number, ReopenedPastpaper>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [starting, setStarting] = useState<number | null>(null);
  const [startError, setStartError] = useState<{ sectionId: number; msg: string } | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(false);
    Promise.all([
      loadSections(),
      isAuthenticated ? examsPublicApi.getAttempts().then((r) => r.items as Att[]).catch(() => []) : Promise.resolve([] as Att[]),
      // Finished papers a homework has set again. Soft like the attempts above: without it a
      // card falls back to what it showed before, "Completed", and the page still works.
      isAuthenticated ? pastpaperReportApi.reopened().catch(() => [] as ReopenedPastpaper[]) : Promise.resolve([] as ReopenedPastpaper[]),
    ])
      .then(([s, a, r]) => {
        setSections(s);
        setAtts(a);
        setReopened(new Map(r.map((row) => [row.practice_test_id, row])));
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [isAuthenticated, loadSections]);
  useEffect(() => { load(); }, [load]);

  const byTest = useMemo(() => {
    const m = new Map<number, Att[]>();
    for (const a of atts) { const l = m.get(a.practice_test) ?? []; l.push(a); m.set(a.practice_test, l); }
    for (const l of m.values()) l.sort((x, y) => y.id - x.id);
    return m;
  }, [atts]);

  const handleOpen = async (section: PastpaperSection, d: Derived) => {
    // Completed: review the newest finished sitting. Otherwise start/resume an attempt; a paper
    // a homework has set again starts a NEW sitting, and the old one stays in the history.
    if (d.status === "completed" && d.completedAttemptId) {
      router.push(`/review/${d.completedAttemptId}?back=${encodeURIComponent(backHref)}`);
      return;
    }
    if (!assertCriticalAuth()) return;
    setStarting(section.id);
    setStartError(null);
    try {
      let attempt = d.openAttemptId != null ? atts.find((a) => a.id === d.openAttemptId) : undefined;
      const isFreshStart = !attempt;
      if (!attempt) {
        attempt = (await examsPublicApi.startTest(section.id)) as unknown as Att;
        const started = attempt;
        setAtts((prev) => (prev.some((a) => a.id === started.id) ? prev : [...prev, started]));
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

  return { sections, atts, reopened, loading, error, load, byTest, starting, startError, handleOpen };
}

export function Segmented({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) {
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

export function Booklet({ section, d, busy, error, onOpen, onReport, onHistory, badge, meta }: {
  section: PastpaperSection; d: Derived; busy: boolean; error: string | null; onOpen: () => void; onReport: () => void; onHistory: () => void;
  /** Replaces the region badge (US / International) when given, e.g. a practice test's level. */
  badge?: ReactNode;
  /** Replaces the sitting month under the title when given. */
  meta?: ReactNode;
}) {
  const isUS = section.form_type === "US";
  const rw = isRW(section.subject);
  const regionMain = isUS ? "var(--dz-indigo)" : "#0d9488";
  const regionSoft = isUS ? "var(--dz-indigo-soft)" : "rgba(13,148,136,.12)";
  const subjAccent = rw ? "var(--dz-indigo)" : "#0d9488";
  const subjSoft = rw ? "var(--dz-indigo-soft)" : "rgba(13,148,136,.12)";
  const statusMeta = {
    new: { dot: regionMain, label: "Not started", color: "var(--dz-mute)", bg: "var(--dz-card)" },
    progress: { dot: "var(--dz-amber)", label: "In progress", color: "var(--dz-amber)", bg: "color-mix(in srgb, var(--dz-amber) 12%, transparent)" },
    reopened: { dot: "var(--dz-indigo)", label: "Assigned again", color: "var(--dz-indigo)", bg: "var(--dz-indigo-soft)" },
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
          {badge !== undefined ? badge : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, color: regionMain, background: regionSoft, padding: "4px 10px", borderRadius: 8 }}>
              {isUS ? <span style={{ fontSize: 13, lineHeight: 1 }}>🇺🇸</span> : <Globe size={13} />} {isUS ? "US" : "International"}
            </span>
          )}
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
          {meta !== undefined ? meta : <><Calendar size={14} /> {fmtMonth(section.practice_date)}</>}
        </div>
        <div style={{ height: 1, background: "var(--dz-border)", margin: "15px 0" }} />

        {error ? (
          <div style={{ marginBottom: 12, fontSize: 12, fontWeight: 600, color: "var(--dz-error)", background: "var(--dz-error-soft)", padding: "8px 12px", borderRadius: 10 }}>{error}</div>
        ) : null}

        {d.status === "completed" ? (
          <>
            <ScoreBlock label="YOUR SCORE" score={d.score} />
            {d.completedDate ? (
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 600, color: "var(--dz-mute)", marginBottom: 14 }}>
                <Clock size={13} /> Completed {fmtDay(d.completedDate)}
              </div>
            ) : null}
            <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} className="dz-actionbtn"
              style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: 11, borderRadius: 11, border: "none", background: "var(--dz-indigo)", color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
              <Eye size={15} /> Review answers
            </button>
            {/* Second, quieter button. "Review answers" walks the paper question by question;
                this is the other question a student has after a score — what to practise —
                and it is also where the certificate is downloaded. */}
            {d.completedAttemptId ? (
              <button type="button" onClick={(e) => { e.stopPropagation(); onReport(); }} className="dz-actionbtn"
                style={{ width: "100%", marginTop: 8, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: 11, borderRadius: 11, border: "1px solid var(--dz-line)", background: "transparent", color: "var(--dz-ink)", fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
                <Award size={15} /> Report &amp; certificate
              </button>
            ) : null}
            {d.sittings > 1 ? <HistoryLink sittings={d.sittings} onClick={onHistory} /> : null}
          </>
        ) : d.status === "reopened" ? (
          // Sat before, and a homework has set it again since: a new sitting, not the old review.
          // The last score stays on the card until the new one replaces it.
          <>
            <ScoreBlock label="LAST SCORE" score={d.score} />
            {d.reopenedBy ? (
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 600, color: "var(--dz-mute)", marginBottom: 14, minWidth: 0 }}>
                <RotateCcw size={13} style={{ flex: "none" }} />
                <span className="clip1">Set again in {d.reopenedBy.assignment_title}</span>
              </div>
            ) : null}
            <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); onOpen(); }} className="dz-actionbtn"
              style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: 11, borderRadius: 11, border: "none", background: "var(--dz-indigo)", color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
              <Play size={15} /> {busy ? "Starting…" : "Start again"}
            </button>
            <HistoryLink sittings={d.sittings} onClick={onHistory} />
          </>
        ) : d.status === "progress" ? (
          <>
            {d.sittings > 0 ? <ScoreBlock label="LAST SCORE" score={d.score} /> : null}
            <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); onOpen(); }} className="dz-actionbtn"
              style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: 11, borderRadius: 11, border: "none", background: "var(--dz-amber)", color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
              <PlayCircle size={15} /> {busy ? "…" : "Resume"}
            </button>
            {d.sittings > 0 ? <HistoryLink sittings={d.sittings} onClick={onHistory} /> : null}
          </>
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

function ScoreBlock({ label, score }: { label: string; score: number | null }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 14, marginBottom: 14 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", color: "var(--dz-faint)", marginBottom: 3 }}>{label}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
          <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-.03em", color: "var(--dz-ink)", lineHeight: 1 }}>{score ?? "—"}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--dz-faint)" }}>/ 800</span>
        </div>
      </div>
    </div>
  );
}

/** Every finished sitting of the paper, each with its own certificate, on the report page. */
function HistoryLink({ sittings, onClick }: { sittings: number; onClick: () => void }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} className="dz-actionbtn"
      style={{ alignSelf: "center", marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 8, border: "none", background: "transparent", color: "var(--dz-mute)", fontFamily: "inherit", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
      <History size={13} /> History · {sittings} {sittings === 1 ? "attempt" : "attempts"}
    </button>
  );
}

export function PapersEmpty({ hasFilter, noun = "papers" }: { hasFilter: boolean; noun?: string }) {
  // "papers" is the past-papers library's own wording (kept exactly); any other noun is a plain list of that thing.
  const pastPapers = noun === "papers";
  return (
    <div style={{ border: "1.5px dashed var(--dz-border)", borderRadius: 22, padding: "64px 40px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", background: "var(--dz-card)" }}>
      <div style={{ width: 88, height: 88, borderRadius: 26, background: "var(--dz-indigo-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--dz-indigo)", marginBottom: 22 }}>
        <FileText size={40} />
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.01em", color: "var(--dz-ink)" }}>{hasFilter ? `No matching ${noun}` : pastPapers ? "No past papers yet" : `No ${noun} yet`}</div>
      <div style={{ fontSize: 15, fontWeight: 500, color: "var(--dz-mute)", marginTop: 8, maxWidth: 420, lineHeight: 1.5 }}>
        {hasFilter
          ? (pastPapers ? "Try a different region, year, status, or search." : "Try a different subject, status, or search.")
          : (pastPapers ? "Released SAT papers will appear here once added." : `New ${noun} will appear here once they are added.`)}
      </div>
    </div>
  );
}

export function PapersError({ onRetry, noun = "past papers" }: { onRetry: () => void; noun?: string }) {
  return (
    <div style={{ border: "1.5px solid var(--dz-error-border)", borderRadius: 22, padding: "64px 40px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", background: "var(--dz-error-bg)" }}>
      <div style={{ width: 88, height: 88, borderRadius: 26, background: "var(--dz-error-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--dz-error)", marginBottom: 22 }}>
        <AlertTriangle size={40} />
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.01em", color: "var(--dz-ink)" }}>{`Couldn't load ${noun}`}</div>
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
