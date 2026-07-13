"use client";

// Journal lesson homework editor — the same two-column builder as the classroom
// AssignmentForm, reusing the shared picker/card/filter helpers. Two differences:
//   • content is scoped by the Journal's (subject, level), loaded from /journals/content-options/
//   • the deadline is RELATIVE ("due N days after the lesson") — not an absolute date.
// Midterm lessons render a distinct info panel with no homework fields.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { journalsApi } from "@/features/journals/api";
import type { ContentOptions, JournalDetail, LessonDetail } from "@/features/journals/types";
import {
  buildHomeworkPastpaperCards,
  filterPastpaperCards,
  formatLineDate,
  pastpaperCardYears,
  sharedPastpaperPackTitle,
  singleDisplayTitle,
  subjectLabel,
  type CardPastpaperPack,
  type CardSingle,
} from "@/lib/practiceTestCards";
import { allowedSourcesForSubject, sourceLabel } from "@/lib/assessmentSources";
import {
  ClassroomAlert,
  ClassroomButton,
  ClassroomField,
  crInputClass,
  crTextareaClass,
} from "@/components/classroom";
import { SegmentedControl } from "@/components/SegmentedControl";
import {
  ArrowLeft, BookOpen, Check, ClipboardList, GraduationCap, Inbox, Layers,
  Link2, Loader2, Paperclip, Search, SlidersHorizontal, Upload, X,
} from "lucide-react";

type PracticeScope = "BOTH" | "ENGLISH" | "MATH";
type TabKey = "pastpapers" | "assessments" | "submission";

const DEFAULT_DEADLINE = "23:59";
const pad = (n: number) => String(n).padStart(2, "0");

function time12(h: number, m: number): string {
  const ampm = h < 12 ? "AM" : "PM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${pad(m)} ${ampm}`;
}
function timeOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let h = 0; h < 24; h++) for (const m of [0, 30]) out.push({ value: `${pad(h)}:${pad(m)}`, label: time12(h, m) });
  out.push({ value: "23:59", label: "11:59 PM (end of day)" });
  return out;
}

function cardReactKey(c: CardPastpaperPack | CardSingle): string {
  return c.kind === "single" ? `single-${c.test.id}` : `pack-${c.packKey}`;
}
function cardSectionIds(c: CardPastpaperPack | CardSingle): number[] {
  return c.kind === "single" ? [c.test.id] : c.tests.map((t) => t.id);
}
function cardHeading(c: CardPastpaperPack | CardSingle): string {
  return c.kind === "pastpaper_pack"
    ? (c.pack?.title && String(c.pack.title).trim()) || sharedPastpaperPackTitle(c.tests)
    : singleDisplayTitle(c.test);
}

type AssessmentOpt = ContentOptions["assessment_sets"][number];
type PackOpt = ContentOptions["practice_test_packs"][number];
type CartItem = { key: string; type: "pastpaper" | "practice" | "assessment"; title: string; meta: string; onRemove: () => void };

export default function JournalLessonEditor({ journalId, lessonId }: { journalId: number; lessonId: number }) {
  const router = useRouter();
  const back = () => router.push(`/ops/journals/${journalId}`);

  const [journal, setJournal] = useState<JournalDetail | null>(null);
  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [options, setOptions] = useState<ContentOptions>({ subject: "", level: "", practice_tests: [], assessment_sets: [], practice_test_packs: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // form state
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [allowFileUpload, setAllowFileUpload] = useState(false);
  const [dueAfterDays, setDueAfterDays] = useState("");
  const [deadlineTime, setDeadlineTime] = useState(DEFAULT_DEADLINE);
  const [practiceScope, setPracticeScope] = useState<PracticeScope>("BOTH");
  const [selectedTestIds, setSelectedTestIds] = useState<Set<number>>(new Set());
  const [selectedAssessmentIds, setSelectedAssessmentIds] = useState<Set<number>>(new Set());
  const [selectedPackIds, setSelectedPackIds] = useState<Set<number>>(new Set());
  const [files, setFiles] = useState<File[]>([]);

  const [activeTab, setActiveTab] = useState<TabKey>("assessments");
  const [pastpaperSearch, setPastpaperSearch] = useState("");
  const [pastpaperRegion, setPastpaperRegion] = useState<"ALL" | "US" | "INTL">("ALL");
  const [pastpaperYear, setPastpaperYear] = useState("ALL");
  const [assessmentSearch, setAssessmentSearch] = useState("");
  const [assessmentSource, setAssessmentSource] = useState("ALL");

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [j, l] = await Promise.all([journalsApi.get(journalId), journalsApi.lesson(journalId, lessonId)]);
        if (cancelled) return;
        setJournal(j);
        setLesson(l);
        // prefill
        setTitle(l.title || "");
        setInstructions(l.instructions || "");
        setExternalUrl(l.external_url || "");
        setAllowFileUpload(l.allow_file_upload);
        setDueAfterDays(l.due_after_days != null ? String(l.due_after_days) : "");
        setDeadlineTime(l.deadline_time ? l.deadline_time.slice(0, 5) : DEFAULT_DEADLINE);
        if (l.practice_scope === "MATH" || l.practice_scope === "ENGLISH" || l.practice_scope === "BOTH") setPracticeScope(l.practice_scope);
        setSelectedAssessmentIds(new Set(l.assessments.map((a) => a.assessment_set_id)));
        setSelectedTestIds(new Set(l.practice_test_ids || []));
        setSelectedPackIds(new Set(l.practice_test_pack_ids || []));
        if (l.lesson_type === "HOMEWORK") {
          const opts = await journalsApi.contentOptions(j.subject, j.level, lessonId);
          if (!cancelled) setOptions(opts);
        }
      } catch {
        if (!cancelled) setLoadError("Could not load this lesson.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [journalId, lessonId]);

  // Auto-scope + tab defaults from subject/level.
  const subject = journal?.subject ?? "";
  const level = journal?.level ?? "";
  const domainSubject = subject === "MATH" ? "math" : subject === "ENGLISH" ? "english" : "";
  const allowedSources = useMemo(() => allowedSourcesForSubject(domainSubject), [domainSubject]);
  const showPastpapers = level === "middle" || level === "senior";
  useEffect(() => {
    if (subject === "MATH") setPracticeScope("MATH");
    else if (subject === "ENGLISH") setPracticeScope("ENGLISH");
  }, [subject]);
  useEffect(() => {
    if (!showPastpapers && activeTab === "pastpapers") setActiveTab("assessments");
  }, [showPastpapers, activeTab]);

  // Derived picker data (reusing the shared helpers).
  const pastpaperCards = useMemo(() => buildHomeworkPastpaperCards(options.practice_tests as unknown[]), [options.practice_tests]);
  const pastpaperYears = useMemo(() => pastpaperCardYears(pastpaperCards), [pastpaperCards]);
  const filteredPastpaperCards = useMemo(
    () => filterPastpaperCards(pastpaperCards, { region: pastpaperRegion, year: pastpaperYear, search: pastpaperSearch }),
    [pastpaperCards, pastpaperRegion, pastpaperYear, pastpaperSearch],
  );
  const filteredAssessmentSets = useMemo(() => {
    const q = assessmentSearch.trim().toLowerCase();
    return options.assessment_sets.filter((a) => {
      if (assessmentSource !== "ALL" && (a.source || "") !== assessmentSource) return false;
      if (q && !`${a.title} ${a.category} ${a.description}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [options.assessment_sets, assessmentSearch, assessmentSource]);

  const cardSelected = (c: CardPastpaperPack | CardSingle) => {
    const ids = cardSectionIds(c);
    return ids.length > 0 && ids.every((id) => selectedTestIds.has(id));
  };
  const handleCardSelect = (c: CardPastpaperPack | CardSingle) => {
    const ids = cardSectionIds(c);
    const isSel = cardSelected(c);
    setSelectedTestIds((prev) => {
      const next = new Set(prev);
      if (isSel) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
    if (!isSel && !title.trim()) setTitle(cardHeading(c));
  };
  const handleAssessmentSelect = (a: AssessmentOpt) => {
    const was = selectedAssessmentIds.has(a.id);
    setSelectedAssessmentIds((prev) => {
      const next = new Set(prev);
      if (was) next.delete(a.id);
      else next.add(a.id);
      return next;
    });
    if (!was && !title.trim()) setTitle(a.title);
  };
  const handlePackSelect = (p: PackOpt) => {
    setSelectedPackIds((prev) => {
      const next = new Set(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.add(p.id);
      return next;
    });
  };

  const cartItems = useMemo<CartItem[]>(() => {
    const out: CartItem[] = [];
    for (const c of pastpaperCards) {
      if (!cardSelected(c)) continue;
      const secs = cardSectionIds(c);
      out.push({ key: `pp-${cardReactKey(c)}`, type: "pastpaper", title: cardHeading(c), meta: `Past paper · ${secs.length} section${secs.length !== 1 ? "s" : ""}`, onRemove: () => handleCardSelect(c) });
    }
    for (const p of options.practice_test_packs) {
      if (!selectedPackIds.has(p.id)) continue;
      out.push({ key: `pack-${p.id}`, type: "practice", title: p.title || `Pack #${p.id}`, meta: `Practice test · ${p.section_count} sections`, onRemove: () => handlePackSelect(p) });
    }
    for (const a of options.assessment_sets) {
      if (!selectedAssessmentIds.has(a.id)) continue;
      out.push({ key: `as-${a.id}`, type: "assessment", title: a.title, meta: `${a.category ? a.category + " · " : ""}${a.question_count} questions`, onRemove: () => handleAssessmentSelect(a) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastpaperCards, options, selectedTestIds, selectedPackIds, selectedAssessmentIds]);

  const hasInstructions = instructions.trim().length > 0;
  const hasContent = cartItems.length > 0 || allowFileUpload || files.length > 0 || (lesson?.attachment_urls.length ?? 0) > 0;
  const ready = hasInstructions && hasContent;

  const save = async () => {
    setFormError(null);
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        instructions,
        external_url: externalUrl.trim(),
        allow_file_upload: allowFileUpload,
        practice_scope: practiceScope,
        due_after_days: dueAfterDays === "" ? null : Number(dueAfterDays),
        deadline_time: deadlineTime || null,
        assessment_set_ids: [...selectedAssessmentIds],
        practice_test_ids: [...selectedTestIds],
        practice_test_pack_ids: [...selectedPackIds],
      };
      const saved = await journalsApi.saveLesson(journalId, lessonId, body);
      if (files.length > 0) {
        const fd = new FormData();
        for (const f of files) fd.append("attachment_file", f);
        await journalsApi.saveLesson(journalId, lessonId, fd);
      }
      setLesson(saved);
      back();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setFormError(detail || "Could not save the lesson.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-2xl border border-border bg-card px-6 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading lesson…
      </div>
    );
  }
  if (loadError || !lesson || !journal) {
    return (
      <div className="mx-auto max-w-3xl">
        <BackButton onClick={back} />
        <ClassroomAlert tone="error">{loadError || "Lesson not found."}</ClassroomAlert>
      </div>
    );
  }

  // ── Midterm lesson: distinct info panel, no homework ──
  if (lesson.lesson_type === "MIDTERM") {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <BackButton onClick={back} />
        <div className="rounded-2xl border border-[#6d4ec7]/40 bg-[#6d4ec7]/5 p-8 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#6d4ec7]/15 text-[#6d4ec7]">
            <GraduationCap className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-2xl font-extrabold text-foreground">Lesson {lesson.lesson_number} · Midterm</h1>
          <p className="mx-auto mt-2 max-w-md text-sm font-semibold text-muted-foreground">
            This is a midterm checkpoint for {journal.display_title}. Midterm lessons carry no homework —
            students sit the midterm exam here. Homework configuration is intentionally disabled.
          </p>
        </div>
      </div>
    );
  }

  const searchInputCls = `${crInputClass} pl-10`;
  const cardGrid = "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(228px,1fr))]";
  const cartDot: Record<CartItem["type"], string> = { pastpaper: "bg-primary", practice: "bg-emerald-500", assessment: "bg-[#6d4ec7]" };
  const panelCls = "flex flex-col gap-4 rounded-[20px] border border-border bg-background p-6 shadow-sm";
  const groupTitle = (t: string) => <h3 className="text-[15px] font-extrabold text-foreground">{t}</h3>;

  function PickCard({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={`relative flex w-full flex-col gap-1.5 rounded-[14px] border-[1.5px] p-4 pr-9 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-primary hover:shadow-md ${selected ? "border-primary bg-primary/10 shadow-[0_0_0_1px_var(--primary)]" : "border-border bg-card"}`}
      >
        <span className={`absolute right-3.5 top-3.5 flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] transition-all ${selected ? "border-primary bg-primary text-white" : "border-border bg-background text-transparent"}`}>
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
        {children}
      </button>
    );
  }

  const TABS: { key: TabKey; label: string; icon: typeof BookOpen }[] = [
    ...(showPastpapers ? [{ key: "pastpapers" as const, label: "Pastpapers", icon: BookOpen }] : []),
    { key: "assessments", label: "Assessments", icon: ClipboardList },
    { key: "submission", label: "Submission", icon: SlidersHorizontal },
  ];

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <div className="mb-5">
        <BackButton onClick={back} />
        <div className="flex items-center gap-4">
          <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[15px] bg-primary/10 text-primary"><ClipboardList className="h-6 w-6" /></div>
          <div>
            <h1 className="text-[25px] font-extrabold tracking-tight text-foreground">Lesson {lesson.lesson_number} homework</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-[13.5px] font-semibold text-muted-foreground">
              <span>{journal.display_title}</span>
              <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{lesson.status}</span>
            </div>
          </div>
        </div>
      </div>

      {formError && <div className="mb-4"><ClassroomAlert tone="error">{formError}</ClassroomAlert></div>}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* LEFT */}
        <section className="flex flex-col overflow-hidden rounded-[20px] border border-border bg-panel shadow-md lg:sticky lg:top-4 lg:max-h-[calc(100vh-120px)]">
          <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto p-5">
            <div className="flex flex-col gap-3.5">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-primary/10 text-primary"><ClipboardList className="h-[17px] w-[17px]" /></span>
                <h2 className="flex-1 text-[15.5px] font-extrabold text-foreground">Lesson homework</h2>
              </div>

              <ClassroomField label="Title" htmlFor="jl-title">
                <input id="jl-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Reading practice set" className={`${crInputClass} font-semibold`} />
              </ClassroomField>

              <ClassroomField label="Instructions *" htmlFor="jl-inst" hint="Tell students exactly what to do — this is the main brief.">
                <textarea id="jl-inst" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Write clear, detailed directions for students" rows={9} className={crTextareaClass} />
              </ClassroomField>

              <ClassroomField label="Deadline" hint="Relative to the lesson date once a classroom follows this journal.">
                <div className="flex gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="whitespace-nowrap text-sm font-semibold text-muted-foreground">Due after</span>
                    <input type="number" min={0} max={60} value={dueAfterDays} onChange={(e) => setDueAfterDays(e.target.value)} placeholder="—" className={`${crInputClass} w-16 text-center`} />
                    <span className="whitespace-nowrap text-sm font-semibold text-muted-foreground">days</span>
                  </div>
                  <select aria-label="Deadline time" value={deadlineTime} onChange={(e) => setDeadlineTime(e.target.value)} disabled={dueAfterDays === ""} className={`${crInputClass} min-w-0 flex-1 disabled:opacity-50`}>
                    {timeOptions().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </ClassroomField>
            </div>

            {/* cart */}
            <div className="flex flex-col gap-3.5 border-t border-border pt-[18px]">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-primary/10 text-primary"><Layers className="h-[17px] w-[17px]" /></span>
                <h2 className="flex-1 text-[15.5px] font-extrabold text-foreground">Selected content</h2>
                <span className="whitespace-nowrap rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-bold text-muted-foreground">{cartItems.length} selected</span>
              </div>
              {cartItems.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-border bg-card px-4 py-5 text-center">
                  <Inbox className="h-6 w-6 text-muted-foreground/60" />
                  <p className="text-[13px] text-muted-foreground">Nothing selected yet. Add an assessment or past paper from the library.</p>
                </div>
              ) : (
                <ul className="flex flex-col">
                  {cartItems.map((it) => (
                    <li key={it.key} className="flex items-center gap-2.5 border-t border-dashed border-border py-2.5 first:border-t-0">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${cartDot[it.type]}`} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-bold text-foreground">{it.title}</div>
                        <div className="truncate text-[11.5px] text-muted-foreground/80">{it.meta}</div>
                      </div>
                      <button type="button" onClick={it.onRemove} aria-label={`Remove ${it.title}`} className="flex shrink-0 rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-rose-500/10 hover:text-rose-500"><X className="h-3.5 w-3.5" /></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="border-t border-border bg-panel px-5 pb-[18px] pt-3.5">
            <p className="mb-2.5 flex items-center gap-2 text-[12.5px] font-semibold text-muted-foreground">
              <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${ready ? "bg-emerald-500" : "bg-amber-500"}`} />
              {!hasInstructions ? "Add instructions for students." : !hasContent ? "Add content, a file, or enable file upload." : "Ready to save."}
            </p>
            <div className="flex gap-2">
              <ClassroomButton type="button" variant="secondary" onClick={back}>Cancel</ClassroomButton>
              <ClassroomButton type="button" variant="primary" className="flex-1" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save lesson
                {cartItems.length > 0 ? <span className="ml-1 rounded-md bg-white/25 px-1.5 py-0.5 text-xs">{cartItems.length}</span> : null}
              </ClassroomButton>
            </div>
          </div>
        </section>

        {/* RIGHT */}
        <section className="flex min-w-0 flex-col gap-[18px]">
          <div className="flex gap-2 overflow-x-auto pb-0.5" role="tablist">
            {TABS.map((tab) => {
              const active = activeTab === tab.key;
              const Icon = tab.icon;
              return (
                <button key={tab.key} type="button" role="tab" aria-selected={active} onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-xl border-[1.5px] px-4 py-2.5 text-sm font-bold transition-all ${active ? "border-primary bg-primary/10 text-primary" : "border-border bg-panel text-muted-foreground hover:-translate-y-px hover:border-primary hover:text-primary"}`}>
                  <Icon className="h-4 w-4" /> {tab.label}
                </button>
              );
            })}
          </div>

          {activeTab === "pastpapers" && (
            <div className={panelCls} role="tabpanel">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input value={pastpaperSearch} onChange={(e) => setPastpaperSearch(e.target.value)} placeholder="Search pastpapers…" className={searchInputCls} />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <SegmentedControl label="Region" value={pastpaperRegion} onChange={(v) => setPastpaperRegion(v as "ALL" | "US" | "INTL")} options={[{ value: "ALL", label: "All" }, { value: "US", label: "US" }, { value: "INTL", label: "International" }]} />
                {pastpaperYears.length > 0 && (
                  <SegmentedControl label="Year" value={pastpaperYear} onChange={setPastpaperYear} options={[{ value: "ALL", label: "All" }, ...pastpaperYears.map((y) => ({ value: y, label: y }))]} />
                )}
              </div>
              {filteredPastpaperCards.length === 0 ? (
                <EmptyPanel icon={BookOpen} title="No pastpapers match" text="Try clearing the search or filters." />
              ) : (
                <>
                  {groupTitle("Available")}
                  <div className={cardGrid}>
                    {filteredPastpaperCards.map((c) => {
                      const lineDate = c.kind === "pastpaper_pack" ? c.pack?.practice_date || c.tests[0]?.practice_date : c.test.practice_date || c.test.created_at;
                      const rows = c.kind === "pastpaper_pack" ? c.tests : [{ id: c.test.id, subject: c.test.subject }];
                      return (
                        <PickCard key={cardReactKey(c)} selected={cardSelected(c)} onClick={() => handleCardSelect(c)}>
                          <span className="text-[11px] font-extrabold uppercase tracking-wider text-primary">{c.kind === "pastpaper_pack" ? "Full exam" : "Practice test"}</span>
                          <span className="text-[12.5px] font-semibold text-muted-foreground">{formatLineDate(lineDate)}</span>
                          <span className="line-clamp-2 text-[15px] font-bold leading-snug text-foreground">{cardHeading(c)}</span>
                          <span className="mt-0.5 flex flex-wrap gap-1.5">
                            {rows.map((t) => <span key={t.id} className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-primary">{subjectLabel(t.subject)}</span>)}
                          </span>
                        </PickCard>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === "assessments" && (
            <div className={panelCls} role="tabpanel">
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input value={assessmentSearch} onChange={(e) => setAssessmentSearch(e.target.value)} placeholder="Search assessments…" className={searchInputCls} />
                </div>
                {allowedSources.length > 0 && (
                  <select aria-label="Source" value={assessmentSource} onChange={(e) => setAssessmentSource(e.target.value)} className={`${crInputClass} sm:w-[180px]`}>
                    <option value="ALL">All sources</option>
                    {allowedSources.map((s) => <option key={s} value={s}>{sourceLabel(s)}</option>)}
                  </select>
                )}
              </div>
              {filteredAssessmentSets.length === 0 ? (
                <EmptyPanel icon={ClipboardList} title="No assessment sets found" text={`Create ${journal.level} ${domainSubject} sets in the Builder console.`} />
              ) : (
                <>
                  {groupTitle("Available")}
                  <div className={cardGrid}>
                    {filteredAssessmentSets.map((a) => (
                      <PickCard key={a.id} selected={selectedAssessmentIds.has(a.id)} onClick={() => handleAssessmentSelect(a)}>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-extrabold uppercase ${a.subject === "math" ? "bg-[#6d4ec7]/12 text-[#6d4ec7] dark:bg-purple-900/40 dark:text-purple-300" : "bg-primary/10 text-primary"}`}>{a.subject}</span>
                          {a.source && <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">{sourceLabel(a.source)}</span>}
                          {a.category && <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">{a.category}</span>}
                        </span>
                        <span className="line-clamp-2 text-[15px] font-bold leading-snug text-foreground">{a.title}</span>
                        <span className="text-[12px] font-semibold text-muted-foreground">{a.question_count} questions</span>
                      </PickCard>
                    ))}
                  </div>
                </>
              )}
              <p className="text-[12.5px] font-medium text-muted-foreground/80">Only {journal.level_label} {domainSubject} sets are shown — content is scoped to this journal&apos;s level.</p>
            </div>
          )}

          {activeTab === "submission" && (
            <div className={panelCls} role="tabpanel">
              {groupTitle("Submission & resources")}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-bold text-foreground">Allow file submissions</div>
                  <p className="mt-1 text-[12.5px] text-muted-foreground">Students can turn in a file for manual grading.</p>
                </div>
                <button type="button" role="switch" aria-checked={allowFileUpload} aria-label="Allow file submissions" onClick={() => setAllowFileUpload((v) => !v)}
                  className={`inline-flex h-[25px] w-[44px] shrink-0 items-center rounded-full transition-colors ${allowFileUpload ? "bg-primary" : "bg-border"}`}>
                  <span className={`inline-block h-[19px] w-[19px] transform rounded-full bg-white shadow-sm transition-transform duration-200 ${allowFileUpload ? "translate-x-[22px]" : "translate-x-[3px]"}`} />
                </button>
              </div>

              <ClassroomField label="External link" hint="Add a link to outside material, like a video or article." htmlFor="jl-url">
                <div className="relative">
                  <Link2 className="pointer-events-none absolute left-3.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted-foreground" />
                  <input id="jl-url" type="url" value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://example.com/resource" className={`${crInputClass} pl-10`} />
                </div>
              </ClassroomField>

              <ClassroomField label="Files" hint="PDF, Word, Excel, PowerPoint, text, or images — students can download these.">
                {lesson.attachment_urls.length > 0 && (
                  <div className="mb-2 space-y-1">
                    {lesson.attachment_urls.map((f, i) => (
                      <a key={i} href={f.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-surface-2">
                        <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" /><span className="truncate">{f.name}</span>
                      </a>
                    ))}
                  </div>
                )}
                <label htmlFor="jl-files" className="flex cursor-pointer flex-col items-center gap-1.5 rounded-[14px] border-[1.5px] border-dashed border-border bg-card px-4 py-6 text-center transition-colors hover:border-primary hover:bg-primary/5">
                  <Upload className="h-[22px] w-[22px] text-primary" />
                  <p className="text-[13.5px] text-muted-foreground"><strong className="text-foreground">Click to browse</strong> or drop files</p>
                </label>
                <input id="jl-files" name="attachment_file" type="file" multiple hidden accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.png,.jpg,.jpeg,.gif,.webp"
                  onChange={(e) => { setFiles((prev) => [...prev, ...Array.from(e.target.files || [])]); e.target.value = ""; }} />
                {files.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {files.map((f, i) => (
                      <div key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5">
                        <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate text-xs font-medium text-foreground">{f.name}</span>
                        <button type="button" onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-rose-500"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </ClassroomField>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function EmptyPanel({ icon: Icon, title, text }: { icon: typeof BookOpen; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-border bg-card px-5 py-10 text-center">
      <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-panel text-muted-foreground shadow-sm"><Icon className="h-6 w-6" /></span>
      <h4 className="text-base font-extrabold text-foreground">{title}</h4>
      <p className="max-w-[320px] text-[13.5px] text-muted-foreground">{text}</p>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mb-4 inline-flex items-center gap-2 text-[13.5px] font-bold text-muted-foreground transition-colors hover:text-primary">
      <ArrowLeft className="h-4 w-4" /> Back to journal
    </button>
  );
}
