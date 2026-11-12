"use client";

// Journal lesson homework editor — the same two-column builder as the classroom
// AssignmentForm, reusing the shared picker/card/filter helpers. Two differences:
//   • content is scoped by the Journal's (subject, level), loaded from /journals/content-options/
//   • the deadline is RELATIVE ("due N days after the lesson") — not an absolute date.
// Midterm lessons render a distinct info panel with no homework fields.
//
// In the console's look (design handoff v0.3). The words, the rules and the calls are the editor's own.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Icon, type IconName } from "@/components/ui/Icon";
import { LibraryError } from "@/features/builderLibrary/sectionParts";
import { Button, EmptyState, Segmented, Switch, Tabs } from "@/features/console/ui";
import { journalsApi } from "@/features/journals/api";
import type { ContentOptions, JournalDetail, LessonDetail } from "@/features/journals/types";
import { CONTROL, SERIF_AREA } from "@/features/questionsAdmin/questionLook";
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
import { cn } from "@/lib/cn";
import MultiLinkInput, { fromLinkRows, toLinkRows, type LinkRow } from "@/components/MultiLinkInput";
import LessonVideoField from "@/components/LessonVideoField";
import VocabPicker from "@/features/journals/VocabPicker";
import {
  BACK_LINK,
  CHIP,
  FileDrop,
  JField,
  LoadingLine,
  Medallion,
  PANEL,
  PendingFile,
  PickTick,
  StoredFile,
} from "@/features/journals/journalParts";

type PracticeScope = "BOTH" | "ENGLISH" | "MATH";
type TabKey = "pastpapers" | "assessments" | "vocabulary" | "submission";

/** A long text field in the console's shell (sans: this is the admin's brief, not a question). */
const AREA = SERIF_AREA;

// No deadline helpers here: homework is due at the start of the class's next lesson,
// derived server-side when the session is released to a classroom.

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
  const [options, setOptions] = useState<ContentOptions>({ subject: "", level: "", practice_tests: [], assessment_sets: [], practice_test_packs: [], vocabulary_sections: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // form state
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoKey, setVideoKey] = useState<string | null>(null);
  const [videoRemoved, setVideoRemoved] = useState(false);
  const [allowFileUpload, setAllowFileUpload] = useState(false);
  const [practiceScope, setPracticeScope] = useState<PracticeScope>("BOTH");
  const [selectedTestIds, setSelectedTestIds] = useState<Set<number>>(new Set());
  const [selectedVocabIds, setSelectedVocabIds] = useState<Set<number>>(new Set());
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
        setLinks(
          l.external_urls?.length
            ? toLinkRows(l.external_urls, l.external_url_labels)
            : l.external_url
              ? [{ url: l.external_url, label: "" }]
              : [],
        );
        setVideoUrl(l.video_file_url ? "" : l.video_url || "");
        setVideoKey(null);
        setVideoRemoved(false);
        setAllowFileUpload(l.allow_file_upload);
        if (l.practice_scope === "MATH" || l.practice_scope === "ENGLISH" || l.practice_scope === "BOTH") setPracticeScope(l.practice_scope);
        setSelectedAssessmentIds(new Set(l.assessments.map((a) => a.assessment_set_id)));
        setSelectedTestIds(new Set(l.practice_test_ids || []));
        setSelectedVocabIds(new Set(l.vocabulary_set_ids || []));
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
  const allowedSources = useMemo(
    () => allowedSourcesForSubject(domainSubject, level ? [level] : undefined),
    [domainSubject, level]
  );
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
  const hasContent =
    cartItems.length > 0 ||
    selectedVocabIds.size > 0 ||
    allowFileUpload ||
    files.length > 0 ||
    links.some((l) => l.url.trim().length > 0) ||
    (lesson?.attachment_urls.length ?? 0) > 0;
  const ready = hasInstructions && hasContent;

  const save = async () => {
    setFormError(null);
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        instructions,
        external_urls: fromLinkRows(links).urls,
        external_url_labels: fromLinkRows(links).labels,
        video_url: videoUrl.trim(),
        ...(videoKey ? { video_key: videoKey } : {}),
        ...(videoRemoved && !videoKey && !videoUrl.trim() ? { remove_video: true } : {}),
        allow_file_upload: allowFileUpload,
        practice_scope: practiceScope,
        assessment_set_ids: [...selectedAssessmentIds],
        vocabulary_set_ids: [...selectedVocabIds],
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
    return <LoadingLine card className="mx-auto max-w-3xl">Loading lesson…</LoadingLine>;
  }
  if (loadError || !lesson || !journal) {
    return (
      <div className="mx-auto max-w-3xl">
        <BackButton onClick={back} />
        <LibraryError>{loadError || "Lesson not found."}</LibraryError>
      </div>
    );
  }

  // ── Midterm lesson: distinct info panel, no homework ──
  if (lesson.lesson_type === "MIDTERM") {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <BackButton onClick={back} />
        <div className="animate-ms-card-in rounded-ms-card border border-ms-info-line bg-ms-info-soft p-8 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-[16px] bg-ms-card text-ms-info-fg">
            <Icon name="ms-midterm" size="xl" />
          </span>
          <h1 className="mt-4 text-ms-title text-ms-fg">Lesson {lesson.lesson_number} · Midterm</h1>
          <p className="mx-auto mt-2 max-w-md text-[14px] text-ms-fg-2">
            This is a midterm checkpoint for {journal.display_title}. Midterm lessons carry no homework —
            students sit the midterm exam here. Homework configuration is intentionally disabled.
          </p>
        </div>
      </div>
    );
  }

  const cardGrid = "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(228px,1fr))]";
  const cartDot: Record<CartItem["type"], string> = { pastpaper: "bg-ms-primary", practice: "bg-ms-positive", assessment: "bg-ms-math" };
  const panelCls = cn(PANEL, "animate-ms-fade-in flex flex-col gap-4 p-5 sm:p-6");
  const groupTitle = (t: string) => <h3 className="text-[15px] font-semibold text-ms-fg">{t}</h3>;

  const TABS: { key: TabKey; label: string; icon: IconName }[] = [
    ...(showPastpapers ? [{ key: "pastpapers" as const, label: "Pastpapers", icon: "ms-pastpaper" as const }] : []),
    { key: "assessments", label: "Assessments", icon: "clipboard" },
    { key: "vocabulary", label: "Vocabulary", icon: "ms-vocab" },
    { key: "submission", label: "Submission", icon: "sliders" },
  ];
  const panelProps = (key: TabKey) => ({ role: "tabpanel", id: `jl-content-${key}-panel`, "aria-labelledby": `jl-content-${key}` });

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <div className="mb-5">
        <BackButton onClick={back} />
        <div className="flex min-w-0 items-center gap-4">
          <Medallion icon="clipboard" size="lg" />
          <div className="min-w-0">
            <h1 className="text-ms-title text-ms-fg">Lesson {lesson.lesson_number} homework</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2.5 text-[14px] text-ms-fg-2">
              <span>{journal.display_title}</span>
              <span className={CHIP}>{lesson.status}</span>
            </div>
          </div>
        </div>
      </div>

      {formError && <div className="mb-4"><LibraryError>{formError}</LibraryError></div>}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* LEFT */}
        <section className={cn(PANEL, "flex flex-col overflow-hidden lg:sticky lg:top-[calc(var(--ms-topbar)_+_16px)] lg:max-h-[calc(100vh_-_var(--ms-topbar)_-_32px)]")}>
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2.5">
                <Medallion icon="clipboard" />
                <h2 className="flex-1 text-[16px] font-semibold text-ms-fg">Lesson homework</h2>
              </div>

              <JField label="Title" htmlFor="jl-title">
                <input id="jl-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Reading practice set" className={CONTROL} />
              </JField>

              <JField label="Instructions *" htmlFor="jl-inst" hint="Tell students exactly what to do — this is the main brief.">
                <textarea id="jl-inst" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Write clear, detailed directions for students" rows={9} className={AREA} />
              </JField>

              <div className="flex items-start gap-2.5 rounded-ms-ctl border border-dashed border-ms-border-strong bg-ms-surface px-4 py-3">
                <Icon name="clock" size="sm" className="mt-0.5 text-ms-primary-text" />
                <div>
                  <div className="text-[14px] font-semibold text-ms-fg">Due at the next lesson</div>
                  <p className="mt-0.5 text-[13px] text-ms-fg-2">
                    When a class receives this homework it stays open until that class&apos;s
                    next lesson begins — no deadline to set here.
                  </p>
                </div>
              </div>
            </div>

            {/* cart */}
            <div className="flex flex-col gap-3.5 border-t border-ms-line pt-5">
              <div className="flex items-center gap-2.5">
                <Medallion icon="layers" />
                <h2 className="flex-1 text-[16px] font-semibold text-ms-fg">Selected content</h2>
                <span className={CHIP}>{cartItems.length} selected</span>
              </div>
              {cartItems.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-ms-ctl border border-dashed border-ms-border-strong bg-ms-surface px-4 py-5 text-center">
                  <Icon name="inbox" size="lg" className="text-ms-fg-3" />
                  <p className="text-[13px] text-ms-fg-2">Nothing selected yet. Add an assessment or past paper from the library.</p>
                </div>
              ) : (
                <ul className="flex flex-col">
                  {cartItems.map((it) => (
                    <li key={it.key} data-cart={it.key} className="animate-ms-fade-in flex items-center gap-2.5 border-t border-dashed border-ms-line py-2.5 first:border-t-0">
                      <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-full", cartDot[it.type])} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-semibold text-ms-fg">{it.title}</div>
                        <div className="truncate text-[12px] text-ms-fg-3">{it.meta}</div>
                      </div>
                      <button
                        type="button"
                        onClick={it.onRemove}
                        aria-label={`Remove ${it.title}`}
                        className="ms-transition grid size-7 shrink-0 place-items-center rounded-[8px] text-ms-fg-3 hover:bg-ms-critical-soft hover:text-ms-critical-fg"
                      >
                        <Icon name="x" size="sm" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="border-t border-ms-line bg-ms-surface px-5 pb-4 pt-3.5">
            <p className="mb-2.5 flex items-center gap-2 text-[13px] font-medium text-ms-fg-2">
              <span aria-hidden="true" className={cn("size-[7px] shrink-0 rounded-full", ready ? "bg-ms-positive" : "bg-ms-attention")} />
              {!hasInstructions ? "Add instructions for students." : !hasContent ? "Add content, a file, or enable file upload." : "Ready to save."}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={back}>Cancel</Button>
              <Button variant="primary" className="flex-1" onClick={save} state={saving ? "busy" : "idle"}>
                Save lesson
                {cartItems.length > 0 ? <span className="ml-1 rounded-[6px] bg-white/25 px-1.5 py-0.5 text-[12px] tabular-nums">{cartItems.length}</span> : null}
              </Button>
            </div>
          </div>
        </section>

        {/* RIGHT */}
        <section className="flex min-w-0 flex-col gap-[18px]">
          <Tabs<TabKey>
            label="Homework content"
            idPrefix="jl-content"
            value={activeTab}
            onChange={setActiveTab}
            tabs={TABS.map((tab) => ({
              id: tab.key,
              label: (
                <span className="inline-flex items-center gap-2">
                  <Icon name={tab.icon} size="sm" /> {tab.label}
                </span>
              ),
            }))}
          />

          {activeTab === "pastpapers" && (
            <div className={panelCls} {...panelProps("pastpapers")}>
              <SearchInput value={pastpaperSearch} onChange={setPastpaperSearch} placeholder="Search pastpapers…" />
              <div className="flex flex-wrap items-center gap-3">
                <LabelledSegmented label="Region">
                  <Segmented
                    label="Region"
                    size="sm"
                    value={pastpaperRegion}
                    onChange={(v) => setPastpaperRegion(v as "ALL" | "US" | "INTL")}
                    options={[{ value: "ALL", label: "All" }, { value: "US", label: "US" }, { value: "INTL", label: "International" }]}
                  />
                </LabelledSegmented>
                {pastpaperYears.length > 0 && (
                  <LabelledSegmented label="Year">
                    <Segmented
                      label="Year"
                      size="sm"
                      value={pastpaperYear}
                      onChange={setPastpaperYear}
                      options={[{ value: "ALL", label: "All" }, ...pastpaperYears.map((y) => ({ value: y, label: y }))]}
                    />
                  </LabelledSegmented>
                )}
              </div>
              {filteredPastpaperCards.length === 0 ? (
                <EmptyPanel icon="ms-pastpaper" title="No pastpapers match" text="Try clearing the search or filters." />
              ) : (
                <>
                  {groupTitle("Available")}
                  <div className={cardGrid}>
                    {filteredPastpaperCards.map((c) => {
                      const lineDate = c.kind === "pastpaper_pack" ? c.pack?.practice_date || c.tests[0]?.practice_date : c.test.practice_date || c.test.created_at;
                      const rows = c.kind === "pastpaper_pack" ? c.tests : [{ id: c.test.id, subject: c.test.subject }];
                      return (
                        <PickCard key={cardReactKey(c)} selected={cardSelected(c)} onClick={() => handleCardSelect(c)}>
                          <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-ms-primary-text">{c.kind === "pastpaper_pack" ? "Full exam" : "Past paper"}</span>
                          <span className="text-[13px] text-ms-fg-2">{formatLineDate(lineDate)}</span>
                          <span className="line-clamp-2 text-[15px] font-semibold leading-snug text-ms-fg">{cardHeading(c)}</span>
                          <span className="mt-0.5 flex flex-wrap gap-1.5">
                            {rows.map((t) => <span key={t.id} className="inline-flex h-6 items-center rounded-full bg-ms-primary-soft px-[9px] text-[12px] font-semibold leading-none text-ms-primary-text">{subjectLabel(t.subject)}</span>)}
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
            <div className={panelCls} {...panelProps("assessments")}>
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="min-w-0 flex-1">
                  <SearchInput value={assessmentSearch} onChange={setAssessmentSearch} placeholder="Search assessments…" />
                </div>
                {allowedSources.length > 0 && (
                  <div className="sm:w-[180px] sm:shrink-0">
                    <select aria-label="Source" value={assessmentSource} onChange={(e) => setAssessmentSource(e.target.value)} className={CONTROL}>
                      <option value="ALL">All sources</option>
                      {allowedSources.map((s) => <option key={s} value={s}>{sourceLabel(s)}</option>)}
                    </select>
                  </div>
                )}
              </div>
              {filteredAssessmentSets.length === 0 ? (
                <EmptyPanel icon="clipboard" title="No assessment sets found" text={`Create ${journal.level} ${domainSubject} sets in the Builder console.`} />
              ) : (
                <>
                  {groupTitle("Available")}
                  <div className={cardGrid}>
                    {filteredAssessmentSets.map((a) => (
                      <PickCard key={a.id} selected={selectedAssessmentIds.has(a.id)} onClick={() => handleAssessmentSelect(a)}>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className={cn("inline-flex h-[22px] items-center rounded-full px-2 text-[12px] font-semibold capitalize leading-none", a.subject === "math" ? "bg-ms-math-soft text-ms-math-fg" : "bg-ms-rw-soft text-ms-rw-fg")}>{a.subject}</span>
                          {a.source && <span className="inline-flex h-[22px] items-center rounded-full bg-ms-positive-soft px-2 text-[12px] font-medium leading-none text-ms-positive-fg">{sourceLabel(a.source)}</span>}
                          {a.category && <span className="inline-flex h-[22px] items-center rounded-full bg-ms-surface-2 px-2 text-[12px] font-medium leading-none text-ms-fg-2">{a.category}</span>}
                        </span>
                        <span className="line-clamp-2 text-[15px] font-semibold leading-snug text-ms-fg">{a.title}</span>
                        <span className="text-[13px] text-ms-fg-2">{a.question_count} questions</span>
                      </PickCard>
                    ))}
                  </div>
                </>
              )}
              <p className="text-[13px] text-ms-fg-3">Only {journal.level_label} {domainSubject} sets are shown — content is scoped to this journal&apos;s level.</p>
            </div>
          )}

          {activeTab === "vocabulary" && (
            <div className={panelCls} {...panelProps("vocabulary")}>
              <VocabPicker
                sections={options.vocabulary_sections}
                selectedIds={selectedVocabIds}
                onToggle={(id) =>
                  setSelectedVocabIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                inputClassName={CONTROL}
                idPrefix="jl-vocab"
              />
              <p className="text-[13px] text-ms-fg-3">Students study these word sets on the Vocabulary page. Vocabulary is shared across all levels.</p>
            </div>
          )}

          {activeTab === "submission" && (
            <div className={panelCls} {...panelProps("submission")}>
              {groupTitle("Submission & resources")}
              <Switch
                checked={allowFileUpload}
                onChange={setAllowFileUpload}
                label="Allow file submissions"
                help="Students can turn in a file for manual grading."
              />

              <JField label="External links" hint="Add one or more links to outside material, like videos or articles. Give a link a name and students see the name instead of the address.">
                <MultiLinkInput value={links} onChange={setLinks} inputClassName={CONTROL} idPrefix="jl-url" />
              </JField>

              <JField label="Lesson video" hint="A student who missed the lesson can watch it. Upload the recording from your computer, or paste a YouTube/Vimeo/Loom/Drive link.">
                <LessonVideoField
                  url={videoUrl}
                  onUrlChange={setVideoUrl}
                  videoKey={videoKey}
                  onVideoKeyChange={setVideoKey}
                  removed={videoRemoved}
                  onRemovedChange={setVideoRemoved}
                  existingUrl={lesson?.video_file_url || lesson?.video_url || ""}
                  requestUpload={(filename) => journalsApi.videoUploadUrl(filename)}
                  inputClassName={CONTROL}
                  idPrefix="jl-video"
                />
              </JField>

              <JField label="Files" hint="PDF, Word, Excel, PowerPoint, text, or images — students can download these.">
                {lesson.attachment_urls.length > 0 && (
                  <div className="mb-2 flex flex-col gap-1">
                    {lesson.attachment_urls.map((f, i) => (
                      <StoredFile key={i} href={f.url} name={f.name} />
                    ))}
                  </div>
                )}
                <FileDrop htmlFor="jl-files" roomy />
                <input id="jl-files" name="attachment_file" type="file" multiple hidden accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.png,.jpg,.jpeg,.gif,.webp"
                  onChange={(e) => { setFiles((prev) => [...prev, ...Array.from(e.target.files || [])]); e.target.value = ""; }} />
                {files.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1">
                    {files.map((f, i) => (
                      <PendingFile key={`${f.name}-${f.size}-${i}`} name={f.name} onRemove={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))} />
                    ))}
                  </div>
                )}
              </JField>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** A content card to pick: the tick at the top right, blue once chosen. */
function PickCard({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "ms-hover-lift relative flex w-full flex-col gap-1.5 rounded-ms-ctl border-[1.5px] p-4 pr-10 text-left",
        selected ? "border-ms-primary bg-ms-primary-soft" : "border-ms-border bg-ms-card hover:border-ms-border-strong",
      )}
    >
      <span className="absolute right-3.5 top-3.5">
        <PickTick on={selected} />
      </span>
      {children}
    </button>
  );
}

/** A list's search box with its magnifier. */
function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Icon name="search" size="sm" className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-ms-fg-3" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cn(CONTROL, "pl-9")} />
    </div>
  );
}

/** A segmented control with its name shown before it. */
function LabelledSegmented({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 max-w-full items-center gap-2">
      <span aria-hidden="true" className="text-[13px] font-medium text-ms-fg-3">{label}</span>
      {children}
    </div>
  );
}

function EmptyPanel({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <div className="rounded-ms-ctl border border-dashed border-ms-border-strong bg-ms-surface">
      <EmptyState icon={icon} title={title} detail={text} />
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={BACK_LINK}>
      <Icon name="left" size="sm" /> Back to journal
    </button>
  );
}
