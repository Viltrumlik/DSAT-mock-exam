"use client";

/**
 * Past paper detail — 1:1 with the MasterSAT Paper Detail mockup (.dzboard scope):
 * a sticky left rail (region + title + composite score ring / progress) and section
 * cards with per-section score rings + Start/Continue/Review-Retry actions.
 * Data + start/resume logic preserved from the original page.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
// Public pastpaper packs + attempts live only on examsPublicApi; no feature wrapper exists.
// eslint-disable-next-line no-restricted-imports
import { examsPublicApi, type PastpaperPackPublic, type PastpaperPackSection } from "@/lib/api";
import { examsStudentApi } from "@/features/examsStudent/api";
import { useMe } from "@/hooks/useMe";
import { useAuthCriticalGate } from "@/hooks/useAuthCriticalGate";
import { ArrowLeft, BookOpen, Calculator, Calendar, Eye, Play, Trophy, Globe } from "lucide-react";
import { Spinner } from "@/components/ui";

function formatDate(s: string | null): string {
  if (!s) return "Undated";
  try { return new Date(s).toLocaleDateString("en-US", { month: "long", year: "numeric" }); } catch { return s; }
}
function isRW(subject: string): boolean {
  return subject === "READING_WRITING" || subject?.toLowerCase().includes("reading");
}
function subjectLabel(subject: string): string {
  if (isRW(subject)) return "Reading & Writing";
  if (subject === "MATH" || subject?.toLowerCase().includes("math")) return "Mathematics";
  return subject;
}
function totalMinutes(s: PastpaperPackSection): number {
  return isRW(s.subject) ? s.module_count * 32 : s.module_count * 35;
}

type AttemptRow = { id: number; practice_test: number; is_completed: boolean; is_expired: boolean; score?: number | null };

function Ring({ size, stroke, value, max, color, gradient }: { size: number; stroke: number; value: number; max: number; color?: string; gradient?: boolean }) {
  const r = (size - stroke) / 2 - 1;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  const off = c * (1 - pct);
  const gid = `g${size}`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
      {gradient ? (
        <defs>
          <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={size} y2={size}>
            <animateTransform attributeName="gradientTransform" type="rotate" from={`0 ${size / 2} ${size / 2}`} to={`360 ${size / 2} ${size / 2}`} dur="6s" repeatCount="indefinite" />
            <stop offset="0" stopColor="#2a68c0" />
            <stop offset="1" stopColor="#16a34a" />
          </linearGradient>
        </defs>
      ) : null}
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--dz-border)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={gradient ? `url(#${gid})` : color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={{ transition: "stroke-dashoffset .8s cubic-bezier(.22,1,.36,1)" }} />
    </svg>
  );
}

function PaperDetailInner() {
  const { packId } = useParams<{ packId: string }>();
  const id = Number(packId);
  const router = useRouter();
  const { isAuthenticated } = useMe();
  const { assertCriticalAuth } = useAuthCriticalGate();

  const [pack, setPack] = useState<PastpaperPackPublic | null>(null);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [starting, setStarting] = useState<number | null>(null);
  const [startError, setStartError] = useState<{ sectionId: number; msg: string } | null>(null);

  useEffect(() => {
    if (!id || !Number.isFinite(id)) return;
    let cancelled = false;
    (async () => {
      try {
        setFetchError(null);
        const [packData, attData] = await Promise.all([
          examsPublicApi.getPastpaperPack(id),
          isAuthenticated ? examsStudentApi.getAttempts() : Promise.resolve({ items: [] as AttemptRow[] }),
        ]);
        if (!cancelled) {
          setPack(packData);
          setAttempts((attData.items as AttemptRow[]).filter((a) => packData.sections.some((s) => s.id === a.practice_test)));
        }
      } catch (e: unknown) {
        if (!cancelled) {
          const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          setFetchError(typeof d === "string" ? d : "Could not load this past paper.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, isAuthenticated]);

  const sections = useMemo(
    () => [...(pack?.sections ?? [])].sort((a, b) => (isRW(a.subject) ? 0 : 1) - (isRW(b.subject) ? 0 : 1)),
    [pack],
  );
  const secState = (s: PastpaperPackSection) => {
    const list = attempts.filter((a) => a.practice_test === s.id).sort((a, b) => b.id - a.id);
    const completed = list.find((a) => a.is_completed);
    const active = list.find((a) => !a.is_completed && !a.is_expired);
    return { completed, active, done: !!completed, score: completed?.score ?? null };
  };
  const doneCount = sections.filter((s) => secState(s).done).length;
  const allDone = sections.length > 0 && doneCount === sections.length;
  const composite = allDone
    ? Math.min(1600, sections.reduce((sum, s) => sum + (secState(s).score ?? 0), 0))
    : null;

  const handleStart = async (sectionId: number) => {
    if (!assertCriticalAuth()) return;
    setStarting(sectionId);
    setStartError(null);
    try {
      let attempt = attempts.find((a) => a.practice_test === sectionId && !a.is_completed && !a.is_expired);
      const isFreshStart = !attempt;
      if (!attempt) {
        attempt = (await examsStudentApi.startTest(sectionId)) as AttemptRow;
        setAttempts((prev) => [...prev, attempt!]);
      }
      try { sessionStorage.setItem(`mastersat.attempt.bootstrap.${attempt.id}`, JSON.stringify(attempt)); } catch {}
      router.push(`/exam/${attempt.id}${isFreshStart ? "?welcome=1" : ""}`);
    } catch (e: unknown) {
      const data = (e as { response?: { data?: unknown } })?.response?.data;
      let msg = "Could not start the test. Please try again.";
      if (data && typeof data === "object") {
        const d = data as Record<string, unknown>;
        if (typeof d.message === "string") msg = d.message;
        else if (typeof d.detail === "string") msg = d.detail;
        else if (typeof d.error === "string") msg = d.error;
        else if (d.code === "practice_test_empty") msg = "This section has no questions yet.";
      }
      setStartError({ sectionId, msg });
      setStarting(null);
    }
  };

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center"><Spinner className="h-10 w-10 text-primary" /></div>;
  if (!pack) {
    return (
      <div className="dzboard" style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ border: "1.5px dashed var(--dz-border)", borderRadius: 22, padding: "64px 40px", textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--dz-ink)" }}>{fetchError ?? "Past paper not found"}</div>
          <Link href="/pastpapers" style={{ display: "inline-block", marginTop: 18, color: "var(--dz-indigo)", fontWeight: 700 }}>← Back to past papers</Link>
        </div>
      </div>
    );
  }

  const isUS = pack.form_type === "US";
  const regionMain = isUS ? "var(--dz-indigo)" : "#0d9488";
  const regionSoft = isUS ? "var(--dz-indigo-soft)" : "rgba(13,148,136,.12)";

  return (
    <div className="dzboard" style={{ maxWidth: 1280, width: "100%", margin: "0 auto" }}>
      <div className="dz-content">
        <button type="button" onClick={() => router.push("/pastpapers")} className="dz-secbtn"
          style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--dz-mute)", fontWeight: 700, fontSize: 14, cursor: "pointer", marginBottom: 20, padding: "9px 15px", borderRadius: 11, border: "1.5px solid var(--dz-border)", background: "var(--dz-panel)" }}>
          <ArrowLeft size={16} /> Past papers
        </button>

        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 28, alignItems: "start" }} className="dz-paper">
          {/* Left rail */}
          <div style={{ position: "sticky", top: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, color: regionMain, background: regionSoft, padding: "4px 10px", borderRadius: 8 }}>
                {isUS ? <span style={{ fontSize: 12 }}>🇺🇸</span> : <Globe size={12} />} {isUS ? "US" : "International"}
              </span>
              {pack.label ? <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", color: "var(--dz-faint)" }}>FORM {pack.label}</span> : null}
            </div>
            <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.1, fontWeight: 800, letterSpacing: "-.03em", color: "var(--dz-ink)" }}>
              {pack.title || `SAT past paper — ${formatDate(pack.practice_date)}`}
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--dz-mute)", marginTop: 10 }}>
              <Calendar size={14} /> {formatDate(pack.practice_date)}
            </div>

            {allDone ? (
              <div style={{ background: "linear-gradient(135deg,var(--dz-panel),rgba(22,163,74,.08))", border: "1px solid rgba(22,163,74,.25)", borderRadius: 18, padding: "24px 22px", marginTop: 22, display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12, fontWeight: 800, letterSpacing: ".08em", color: "#16a34a", alignSelf: "flex-start" }}>
                  <Trophy size={14} /> ALL SECTIONS COMPLETE
                </div>
                <div style={{ position: "relative", width: 176, height: 176, margin: "18px 0 6px" }} className="dz-pop">
                  <Ring size={176} stroke={13} value={composite ?? 0} max={1600} gradient />
                  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-.03em", color: "var(--dz-indigo-deep)", lineHeight: 1 }}>{composite}</span>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#3f9e76", marginTop: 2 }}>/ 1600</div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ background: "var(--dz-card)", border: "1px solid var(--dz-border)", borderRadius: 18, padding: 20, marginTop: 22 }}>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".08em", color: "var(--dz-faint)" }}>PROGRESS</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--dz-ink)", marginTop: 8 }}>{doneCount} of {sections.length || 2} sections complete</div>
                <div style={{ height: 8, borderRadius: 6, background: "var(--dz-border)", overflow: "hidden", marginTop: 12 }}>
                  <div style={{ height: "100%", width: `${sections.length ? (doneCount / sections.length) * 100 : 0}%`, borderRadius: 6, background: "var(--dz-indigo)" }} />
                </div>
              </div>
            )}
          </div>

          {/* Right: sections */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {sections.length === 0 ? (
              <div style={{ border: "1.5px dashed var(--dz-border)", borderRadius: 16, padding: 26, textAlign: "center", color: "var(--dz-mute)", fontWeight: 600 }}>No sections yet</div>
            ) : (
              sections.map((s) => {
                const st = secState(s);
                const rw = isRW(s.subject);
                const accent = rw ? "var(--dz-indigo)" : "#0d9488";
                const accentSoft = rw ? "var(--dz-indigo-soft)" : "rgba(13,148,136,.12)";
                const Icon = rw ? BookOpen : Calculator;
                const status = st.done ? { label: "Done", color: "#16a34a", bg: "rgba(22,163,74,.12)" }
                  : st.active ? { label: "In progress", color: "var(--dz-amber)", bg: "color-mix(in srgb,var(--dz-amber) 14%,transparent)" }
                  : { label: "Not started", color: "var(--dz-mute)", bg: "var(--dz-card)" };
                return (
                  <div key={s.id} className="dz-statecard" style={{ background: "var(--dz-panel)", border: "1px solid var(--dz-border)", borderRadius: 18, padding: 20 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                      <div style={{ width: 48, height: 48, flex: "none", borderRadius: 14, background: accentSoft, color: accent, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={24} /></div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.01em", color: "var(--dz-ink)" }}>{subjectLabel(s.subject)}</span>
                          <span style={{ fontSize: 11, fontWeight: 800, color: status.color, background: status.bg, padding: "3px 9px", borderRadius: 8 }}>{status.label}</span>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--dz-mute)", marginTop: 5 }}>
                          {s.module_count} module{s.module_count !== 1 ? "s" : ""} · {totalMinutes(s)} min
                        </div>
                      </div>
                      {st.done ? (
                        <div style={{ position: "relative", width: 74, height: 74, flex: "none" }} className="dz-pop">
                          <Ring size={74} stroke={7} value={st.score ?? 0} max={800} color={accent} />
                          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.02em", color: "var(--dz-ink)", lineHeight: 1 }}>{st.score ?? "—"}</div>
                            <div style={{ fontSize: 9, fontWeight: 700, color: "var(--dz-faint)" }}>/ 800</div>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {startError?.sectionId === s.id ? (
                      <div style={{ marginTop: 12, fontSize: 12, fontWeight: 600, color: "var(--dz-error)", background: "var(--dz-error-soft)", padding: "8px 12px", borderRadius: 10 }}>{startError.msg}</div>
                    ) : null}

                    {st.done ? (
                      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                        <Link href={`/review/${st.completed!.id}`} style={{ flex: 1 }}>
                          <button type="button" className="dz-actionbtn" style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: 12, borderRadius: 12, border: "1px solid var(--dz-border)", background: "var(--dz-card)", color: "var(--dz-mute)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                            <Eye size={15} /> Review answers
                          </button>
                        </Link>
                        <button type="button" disabled={starting === s.id} onClick={() => handleStart(s.id)} className="dz-actionbtn"
                          style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "12px 24px", borderRadius: 12, border: "none", background: "var(--dz-indigo-deep)", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
                          <Play size={15} /> {starting === s.id ? "…" : "Retry"}
                        </button>
                      </div>
                    ) : (
                      <button type="button" disabled={starting === s.id} onClick={() => handleStart(s.id)} className="dz-actionbtn"
                        style={{ width: "100%", marginTop: 16, padding: 14, borderRadius: 12, border: "none", background: "var(--dz-indigo-deep)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                        <Play size={15} /> {starting === s.id ? "Starting…" : st.active ? "Continue" : "Start"}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PastpaperPackDetailPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[40vh] items-center justify-center"><Spinner className="h-10 w-10 text-primary" /></div>}>
      <PaperDetailInner />
    </Suspense>
  );
}
