"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { journalsApi } from "@/features/journals/api";
import type { Classwork, ContentOptions, JournalDetail } from "@/features/journals/types";
import {
  ClassroomAlert,
  ClassroomButton,
  ClassroomField,
  crInputClass,
  crTextareaClass,
} from "@/components/classroom";
import { cn } from "@/lib/cn";
import {
  BookOpen,
  Check,
  ClipboardList,
  Coffee,
  Dumbbell,
  ExternalLink,
  FileText,
  Loader2,
  Paperclip,
  RefreshCw,
  Sparkles,
  Upload,
  X,
} from "lucide-react";

type Props = {
  journalId: number;
  lessonId: number;
  /** Supplies the subject/level used to scope the content pickers. */
  journal: JournalDetail;
  onSaved?: (cw: Classwork) => void;
};

/** The five lesson blocks, in running order — mirrors the classroom timetable. */
const BLOCK_META: Record<string, { label: string; icon: typeof BookOpen }> = {
  HOMEWORK_REVIEW: { label: "Homework", icon: ClipboardList },
  NEW_TOPIC: { label: "New topic", icon: Sparkles },
  BREAK: { label: "Break", icon: Coffee },
  EXERCISES: { label: "Exercises", icon: Dumbbell },
  REVISION: { label: "Revision", icon: RefreshCw },
};

export default function JournalClassworkEditor({
  journalId,
  lessonId,
  journal,
  onSaved,
}: Props) {
  const [cw, setCw] = useState<Classwork | null>(null);
  const [options, setOptions] = useState<ContentOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Durations
  const [mins, setMins] = useState({
    homework_review_minutes: 20,
    new_topic_minutes: 30,
    break_minutes: 10,
    exercises_minutes: 20,
    revision_minutes: 30,
  });
  // New topic
  const [topicTitle, setTopicTitle] = useState("");
  const [topicInstructions, setTopicInstructions] = useState("");
  const [topicUrl, setTopicUrl] = useState("");
  const [topicFiles, setTopicFiles] = useState<File[]>([]);
  const [topicAssessmentIds, setTopicAssessmentIds] = useState<Set<number>>(new Set());
  const [topicTestIds, setTopicTestIds] = useState<Set<number>>(new Set());
  // Exercises
  const [exAssessmentIds, setExAssessmentIds] = useState<Set<number>>(new Set());
  const [exTestIds, setExTestIds] = useState<Set<number>>(new Set());
  // Revision
  const [revisionNotes, setRevisionNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, opts] = await Promise.all([
        journalsApi.classwork(journalId, lessonId),
        journalsApi.contentOptions(journal.subject, journal.level, lessonId),
      ]);
      setCw(data);
      setOptions(opts);
      setMins({
        homework_review_minutes: data.homework_review_minutes,
        new_topic_minutes: data.new_topic_minutes,
        break_minutes: data.break_minutes,
        exercises_minutes: data.exercises_minutes,
        revision_minutes: data.revision_minutes,
      });
      setTopicTitle(data.new_topic_title || "");
      setTopicInstructions(data.new_topic_instructions || "");
      setTopicUrl(data.new_topic_external_url || "");
      setTopicAssessmentIds(new Set(data.new_topic_assessments.map((a) => a.assessment_set_id)));
      setTopicTestIds(new Set(data.new_topic_practice_test_ids || []));
      setExAssessmentIds(new Set(data.exercise_assessments.map((a) => a.assessment_set_id)));
      setExTestIds(new Set(data.exercise_practice_test_ids || []));
      setRevisionNotes(data.revision_notes || "");
    } catch {
      setError("Could not load the classwork plan.");
    } finally {
      setLoading(false);
    }
  }, [journalId, lessonId, journal.subject, journal.level]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        ...mins,
        new_topic_title: topicTitle.trim(),
        new_topic_instructions: topicInstructions,
        new_topic_external_url: topicUrl.trim(),
        revision_notes: revisionNotes,
        new_topic_assessment_set_ids: [...topicAssessmentIds],
        new_topic_practice_test_ids: [...topicTestIds],
        exercise_assessment_set_ids: [...exAssessmentIds],
        exercise_practice_test_ids: [...exTestIds],
      };
      let saved = await journalsApi.saveClasswork(journalId, lessonId, body);
      if (topicFiles.length > 0) {
        const fd = new FormData();
        for (const f of topicFiles) fd.append("new_topic_attachment_file", f);
        saved = await journalsApi.saveClasswork(journalId, lessonId, fd);
        setTopicFiles([]);
      }
      setCw(saved);
      setSavedAt(new Date().toLocaleTimeString());
      onSaved?.(saved);
    } catch {
      setError("Could not save the classwork plan.");
    } finally {
      setSaving(false);
    }
  };

  const timetable = useMemo(
    () => [
      { key: "HOMEWORK_REVIEW", minutes: mins.homework_review_minutes },
      { key: "NEW_TOPIC", minutes: mins.new_topic_minutes },
      { key: "BREAK", minutes: mins.break_minutes },
      { key: "EXERCISES", minutes: mins.exercises_minutes },
      { key: "REVISION", minutes: mins.revision_minutes },
    ],
    [mins],
  );
  const totalMinutes = timetable.reduce((s, b) => s + (b.minutes || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-6 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading classwork…
      </div>
    );
  }

  const review = cw?.homework_review ?? null;

  return (
    <div className="flex flex-col gap-5">
      {error && <ClassroomAlert tone="error">{error}</ClassroomAlert>}

      {/* ── Lesson timetable (reminder only) ───────────────────────────────── */}
      <section className="rounded-2xl border border-border bg-panel p-4 shadow-sm">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-[15px] font-extrabold text-foreground">Lesson timetable</h2>
          <span className="text-xs font-bold text-muted-foreground">{totalMinutes} min total</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-center">
            <thead>
              <tr>
                <th className="border border-border bg-surface-2 px-2 py-2 text-left text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  Stage
                </th>
                {timetable.map((b) => {
                  const Icon = BLOCK_META[b.key].icon;
                  return (
                    <th
                      key={b.key}
                      className="border border-border bg-surface-2 px-2 py-2 text-[12.5px] font-extrabold text-foreground"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5 text-primary" aria-hidden />
                        {BLOCK_META[b.key].label}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-border px-2 py-2 text-left text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  Time
                </td>
                {timetable.map((b) => (
                  <td key={b.key} className="border border-border px-2 py-2">
                    <span className="text-[13px] font-bold text-foreground">{b.minutes}</span>
                    <span className="text-[12px] text-muted-foreground"> min</span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">
          A reminder for the teacher during the lesson — adjust any stage below.
        </p>
      </section>

      {/* ── 1. Homework review (derived from the previous session) ─────────── */}
      <BlockCard
        blockKey="HOMEWORK_REVIEW"
        minutes={mins.homework_review_minutes}
        onMinutes={(v) => setMins((m) => ({ ...m, homework_review_minutes: v }))}
        subtitle="Go over the homework set last lesson — open each item to analyse mistakes."
      >
        {review ? (
          <div className="flex flex-col gap-2">
            <div className="text-[13px] font-bold text-foreground">
              Session {review.lesson_number}: {review.title || "Homework"}
            </div>
            {review.instructions && (
              <p className="whitespace-pre-wrap text-[12.5px] text-muted-foreground">
                {review.instructions}
              </p>
            )}
            <ul className="flex flex-col gap-1.5">
              {review.assessments.map((a) => (
                <ReviewItem key={`a-${a.id}`} icon={ClipboardList} label={a.title} kind="Assessment" />
              ))}
              {review.practice_test_ids.map((id) => (
                <ReviewItem key={`p-${id}`} icon={BookOpen} label={`Past paper #${id}`} kind="Past paper" />
              ))}
              {review.attachment_urls.map((f, i) => (
                <ReviewItem key={`f-${i}`} icon={FileText} label={f.name} kind="File" href={f.url} />
              ))}
              {review.external_url && (
                <ReviewItem icon={ExternalLink} label={review.external_url} kind="Link" href={review.external_url} />
              )}
            </ul>
            {review.assessments.length === 0 &&
              review.practice_test_ids.length === 0 &&
              review.attachment_urls.length === 0 &&
              !review.external_url && (
                <p className="text-[12.5px] text-muted-foreground">
                  That session has no attached content yet.
                </p>
              )}
          </div>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">
            This is the first session — there is no previous homework to review.
          </p>
        )}
      </BlockCard>

      {/* ── 2. New topic ───────────────────────────────────────────────────── */}
      <BlockCard
        blockKey="NEW_TOPIC"
        minutes={mins.new_topic_minutes}
        onMinutes={(v) => setMins((m) => ({ ...m, new_topic_minutes: v }))}
        subtitle="Taught exactly like a homework brief: title, instructions, resources, files and links."
      >
        <div className="flex flex-col gap-3.5">
          <ClassroomField label="Title *" htmlFor="cw-title">
            <input
              id="cw-title"
              value={topicTitle}
              onChange={(e) => setTopicTitle(e.target.value)}
              placeholder="e.g. Linear equations"
              className={`${crInputClass} font-semibold`}
            />
          </ClassroomField>
          <ClassroomField label="Instructions *" htmlFor="cw-inst">
            <textarea
              id="cw-inst"
              value={topicInstructions}
              onChange={(e) => setTopicInstructions(e.target.value)}
              placeholder="What you will teach and how"
              rows={6}
              className={crTextareaClass}
            />
          </ClassroomField>
          <ClassroomField label="External link" htmlFor="cw-url">
            <input
              id="cw-url"
              type="url"
              value={topicUrl}
              onChange={(e) => setTopicUrl(e.target.value)}
              placeholder="https://example.com/slides"
              className={crInputClass}
            />
          </ClassroomField>

          <ClassroomField label="Files">
            <label
              htmlFor="cw-files"
              className="flex cursor-pointer flex-col items-center gap-1.5 rounded-[14px] border-[1.5px] border-dashed border-border bg-card px-4 py-5 text-center transition-colors hover:border-primary hover:bg-primary/5"
            >
              <Upload className="h-5 w-5 text-primary" />
              <p className="text-[13px] text-muted-foreground">
                <strong className="text-foreground">Click to browse</strong> or drop files
              </p>
            </label>
            <input
              id="cw-files"
              type="file"
              multiple
              hidden
              onChange={(e) => {
                setTopicFiles((prev) => [...prev, ...Array.from(e.target.files || [])]);
                e.target.value = "";
              }}
            />
            {(cw?.new_topic_attachment_urls.length ?? 0) > 0 && (
              <div className="mt-2 space-y-1">
                {cw?.new_topic_attachment_urls.map((f, i) => (
                  <a
                    key={i}
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-surface-2"
                  >
                    <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{f.name}</span>
                  </a>
                ))}
              </div>
            )}
            {topicFiles.length > 0 && (
              <div className="mt-2 space-y-1">
                {topicFiles.map((f, i) => (
                  <div
                    key={`${f.name}-${i}`}
                    className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5"
                  >
                    <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate text-xs font-medium text-foreground">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => setTopicFiles((p) => p.filter((_, j) => j !== i))}
                      className="text-muted-foreground hover:text-rose-500"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </ClassroomField>

          <PickList
            title="Assessments for the new topic"
            items={(options?.assessment_sets ?? []).map((a) => ({
              id: a.id,
              label: a.title,
              meta: `${a.category ? a.category + " · " : ""}${a.question_count} questions`,
            }))}
            selected={topicAssessmentIds}
            onToggle={(id) => toggle(setTopicAssessmentIds, id)}
            emptyText="No assessment sets for this level yet."
          />
          <PickList
            title="Past papers for the new topic"
            items={(options?.practice_tests ?? []).map((p) => ({
              id: p.id,
              label: String(p.title || `Past paper #${p.id}`),
              meta: String(p.collection_name || ""),
            }))}
            selected={topicTestIds}
            onToggle={(id) => toggle(setTopicTestIds, id)}
            emptyText="No past papers for this subject."
          />
        </div>
      </BlockCard>

      {/* ── 3. Break ───────────────────────────────────────────────────────── */}
      <BlockCard
        blockKey="BREAK"
        minutes={mins.break_minutes}
        onMinutes={(v) => setMins((m) => ({ ...m, break_minutes: v }))}
        subtitle="Nothing to prepare — the teacher runs the break. It only appears in the timetable."
      >
        <p className="text-[12.5px] text-muted-foreground">No setup needed.</p>
      </BlockCard>

      {/* ── 4. Exercises ───────────────────────────────────────────────────── */}
      <BlockCard
        blockKey="EXERCISES"
        minutes={mins.exercises_minutes}
        onMinutes={(v) => setMins((m) => ({ ...m, exercises_minutes: v }))}
        subtitle="In-class practice. During the lesson the teacher grants the class access to each item."
      >
        <div className="flex flex-col gap-3.5">
          <PickList
            title="Assessments"
            items={(options?.assessment_sets ?? []).map((a) => ({
              id: a.id,
              label: a.title,
              meta: `${a.category ? a.category + " · " : ""}${a.question_count} questions`,
            }))}
            selected={exAssessmentIds}
            onToggle={(id) => toggle(setExAssessmentIds, id)}
            emptyText="No assessment sets for this level yet."
          />
          <PickList
            title="Past papers & practice tests"
            items={(options?.practice_tests ?? []).map((p) => ({
              id: p.id,
              label: String(p.title || `Past paper #${p.id}`),
              meta: String(p.collection_name || ""),
            }))}
            selected={exTestIds}
            onToggle={(id) => toggle(setExTestIds, id)}
            emptyText="No past papers for this subject."
          />
        </div>
      </BlockCard>

      {/* ── 5. Revision ────────────────────────────────────────────────────── */}
      <BlockCard
        blockKey="REVISION"
        minutes={mins.revision_minutes}
        onMinutes={(v) => setMins((m) => ({ ...m, revision_minutes: v }))}
        subtitle="Work through mistakes on the exercises above — the teacher re-opens them in class."
      >
        <div className="flex flex-col gap-3">
          {exAssessmentIds.size + exTestIds.size === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              Add exercises above — revision re-opens them.
            </p>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">
              Revision covers the {exAssessmentIds.size + exTestIds.size} item
              {exAssessmentIds.size + exTestIds.size === 1 ? "" : "s"} selected in Exercises.
            </p>
          )}
          <ClassroomField label="Revision notes" htmlFor="cw-rev">
            <textarea
              id="cw-rev"
              value={revisionNotes}
              onChange={(e) => setRevisionNotes(e.target.value)}
              placeholder="Common mistakes to focus on, worked examples to show…"
              rows={4}
              className={crTextareaClass}
            />
          </ClassroomField>
        </div>
      </BlockCard>

      {/* Save bar */}
      <div className="sticky bottom-0 flex items-center gap-3 rounded-2xl border border-border bg-panel px-4 py-3 shadow-lg">
        <span className="text-[12.5px] font-semibold text-muted-foreground">
          {cw?.is_ready ? "Classwork ready." : "Add a new-topic title and instructions to finish."}
          {savedAt ? ` Saved ${savedAt}.` : ""}
        </span>
        <div className="ml-auto">
          <ClassroomButton type="button" variant="primary" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save classwork
          </ClassroomButton>
        </div>
      </div>
    </div>
  );
}

function toggle(setter: React.Dispatch<React.SetStateAction<Set<number>>>, id: number) {
  setter((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}

function BlockCard({
  blockKey,
  minutes,
  onMinutes,
  subtitle,
  children,
}: {
  blockKey: keyof typeof BLOCK_META | string;
  minutes: number;
  onMinutes: (v: number) => void;
  subtitle: string;
  children: React.ReactNode;
}) {
  const meta = BLOCK_META[blockKey] ?? { label: blockKey, icon: BookOpen };
  const Icon = meta.icon;
  return (
    <section className="rounded-2xl border border-border bg-panel p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-extrabold text-foreground">{meta.label}</h3>
          <p className="text-[12.5px] text-muted-foreground">{subtitle}</p>
        </div>
        <label className="flex items-center gap-2">
          <span className="text-[12px] font-bold text-muted-foreground">Minutes</span>
          <input
            type="number"
            min={0}
            max={180}
            value={minutes}
            onChange={(e) => onMinutes(Math.max(0, Number(e.target.value) || 0))}
            className={`${crInputClass} w-20 text-center`}
            aria-label={`${meta.label} minutes`}
          />
        </label>
      </div>
      {children}
    </section>
  );
}

function ReviewItem({
  icon: Icon,
  label,
  kind,
  href,
}: {
  icon: typeof BookOpen;
  label: string;
  kind: string;
  href?: string;
}) {
  const inner = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{label}</span>
      <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">
        {kind}
      </span>
    </>
  );
  return (
    <li>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 transition-colors hover:border-primary"
        >
          {inner}
        </a>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">{inner}</div>
      )}
    </li>
  );
}

function PickList({
  title,
  items,
  selected,
  onToggle,
  emptyText,
}: {
  title: string;
  items: { id: number; label: string; meta?: string }[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  emptyText: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <h4 className="text-[13px] font-extrabold text-foreground">{title}</h4>
        <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
          {selected.size} selected
        </span>
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-[12.5px] text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1">
          {items.map((it) => {
            const on = selected.has(it.id);
            return (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => onToggle(it.id)}
                  aria-pressed={on}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                    on ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px]",
                      on ? "border-primary bg-primary text-white" : "border-border text-transparent",
                    )}
                  >
                    <Check className="h-2.5 w-2.5" strokeWidth={3} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-foreground">{it.label}</span>
                    {it.meta ? (
                      <span className="block truncate text-[11.5px] text-muted-foreground">{it.meta}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
