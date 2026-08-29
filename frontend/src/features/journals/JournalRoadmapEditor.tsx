"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import {
  ArrowDown,
  ArrowUp,
  Image as ImageIcon,
  Loader2,
  Plus,
  Save,
  Trash2,
  Type as TypeIcon,
  Video as VideoIcon,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { journalsApi } from "./api";
import type { Roadmap, RoadmapSection, RoadmapSectionKind } from "./types";

/**
 * The reading a student does before the homework.
 *
 * Sections are edited LOCALLY and saved in one request, because the API is declarative about
 * them: the list you send is the list that ends up stored. Saving each keystroke would mean
 * a delete every time an author cleared a field to retype it.
 *
 * A picture or a video is the exception — a file needs a section row to attach to, so the
 * upload button appears only once the section has been saved and has an id. That is stated
 * on the button rather than left for the author to discover.
 */

const KINDS: { value: RoadmapSectionKind; label: string; icon: typeof TypeIcon; hint: string }[] = [
  { value: "TEXT", label: "Text", icon: TypeIcon, hint: "A passage. Leave a blank line between paragraphs." },
  { value: "IMAGE", label: "Picture", icon: ImageIcon, hint: "A diagram or a photo, with a caption under it." },
  { value: "VIDEO", label: "Video", icon: VideoIcon, hint: "A YouTube link, or upload the file." },
];

const BLANK: RoadmapSection = {
  kind: "TEXT",
  heading: "",
  body: "",
  caption: "",
  video_url: "",
};

export default function JournalRoadmapEditor({
  journalId,
  lessonId,
  onSaved,
}: {
  journalId: number;
  lessonId: number;
  onSaved?: () => void;
}) {
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [sections, setSections] = useState<RoadmapSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await journalsApi.roadmap(journalId, lessonId);
      setRoadmap(data);
      setSections(data.sections);
    } catch {
      setError("Could not load the roadmap for this session.");
    } finally {
      setLoading(false);
    }
  }, [journalId, lessonId]);

  useEffect(() => {
    void load();
  }, [load]);

  function patchRoadmap(next: Partial<Roadmap>) {
    setRoadmap((prev) => (prev ? { ...prev, ...next } : prev));
  }

  function patchSection(index: number, next: Partial<RoadmapSection>) {
    setSections((prev) => prev.map((s, i) => (i === index ? { ...s, ...next } : s)));
  }

  function move(index: number, delta: number) {
    setSections((prev) => {
      const to = index + delta;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  }

  async function save() {
    if (!roadmap) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await journalsApi.saveRoadmap(journalId, lessonId, {
        title: roadmap.title,
        summary: roadmap.summary,
        estimated_minutes: roadmap.estimated_minutes,
        require_read_confirmation: roadmap.require_read_confirmation,
        sections,
      });
      setRoadmap(saved);
      // The response carries the ids of sections that were just created — without taking
      // them the upload buttons on those rows would stay disabled until a reload.
      setSections(saved.sections);
      setNotice("Saved.");
      onSaved?.();
    } catch (e) {
      const data = (e as { response?: { data?: { detail?: string } } })?.response?.data;
      setError(data?.detail || "Could not save the roadmap.");
    } finally {
      setSaving(false);
    }
  }

  async function upload(index: number, file: File) {
    const section = sections[index];
    if (!section.id) return;
    setUploading(section.id);
    setError(null);
    try {
      const updated = await journalsApi.uploadRoadmapMedia(journalId, lessonId, section.id, file);
      patchSection(index, updated);
    } catch {
      setError("That file could not be uploaded.");
    } finally {
      setUploading(null);
    }
  }

  async function clearMedia(index: number) {
    const section = sections[index];
    if (!section.id) return;
    setUploading(section.id);
    try {
      const updated = await journalsApi.clearRoadmapMedia(journalId, lessonId, section.id);
      patchSection(index, updated);
    } catch {
      setError("That file could not be removed.");
    } finally {
      setUploading(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-1 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading roadmap…
      </div>
    );
  }
  if (!roadmap) {
    return (
      <div className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
        {error ?? "Roadmap not found."}
        <button
          type="button"
          onClick={() => void load()}
          className="ml-3 underline underline-offset-2"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-panel p-5">
        <h2 className="text-lg font-extrabold text-foreground">Roadmap</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          What a student reads before opening this session’s homework — the explanation of
          the topic, in text, pictures and video. It is optional: a session with nothing
          here simply has no reading, and still publishes.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-bold text-foreground">Title</span>
            <input
              value={roadmap.title}
              maxLength={200}
              onChange={(e) => patchRoadmap({ title: e.target.value })}
              placeholder="Falls back to the session's own title"
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-bold text-foreground">
              Reading time (minutes)
            </span>
            <input
              type="number"
              min={0}
              max={240}
              value={roadmap.estimated_minutes}
              onChange={(e) => patchRoadmap({ estimated_minutes: Number(e.target.value) })}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground"
            />
          </label>
        </div>
        <label className="mt-3 block">
          <span className="mb-1.5 block text-sm font-bold text-foreground">One-line summary</span>
          <input
            value={roadmap.summary}
            maxLength={300}
            onChange={(e) => patchRoadmap({ summary: e.target.value })}
            placeholder="Read this before you start the homework."
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground"
          />
        </label>
        <label className="mt-3 flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={roadmap.require_read_confirmation}
            onChange={(e) => patchRoadmap({ require_read_confirmation: e.target.checked })}
            className="mt-0.5 h-[18px] w-[18px] accent-primary"
          />
          <span>
            <span className="block text-sm font-bold text-foreground">
              Hold the homework until they confirm they’ve read it
            </span>
            <span className="block text-[13px] text-muted-foreground">
              The homework button appears at the bottom of the reading once they press
              “I’ve finished reading”. Turn this off and the button is always there.
            </span>
          </span>
        </label>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}
      {notice && !error && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          {notice}
        </div>
      )}
      {roadmap.validation_reasons.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {roadmap.validation_reasons[0]}
        </div>
      )}

      {sections.map((section, index) => {
        const kind = KINDS.find((k) => k.value === section.kind) ?? KINDS[0];
        const media = section.kind === "IMAGE" ? section.image_url : section.video_file_url;
        return (
          <div key={section.id ?? `new-${index}`} className="rounded-2xl border border-border bg-panel p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {KINDS.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    onClick={() => patchSection(index, { kind: k.value })}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-bold transition-colors",
                      section.kind === k.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <k.icon className="h-3.5 w-3.5" aria-hidden /> {k.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <IconBtn onClick={() => move(index, -1)} disabled={index === 0} label="Move up">
                  <ArrowUp className="h-4 w-4" aria-hidden />
                </IconBtn>
                <IconBtn
                  onClick={() => move(index, 1)}
                  disabled={index === sections.length - 1}
                  label="Move down"
                >
                  <ArrowDown className="h-4 w-4" aria-hidden />
                </IconBtn>
                <IconBtn
                  onClick={() => setSections((prev) => prev.filter((_, i) => i !== index))}
                  label="Remove section"
                >
                  <Trash2 className="h-4 w-4 text-rose-500" aria-hidden />
                </IconBtn>
              </div>
            </div>

            <p className="mb-3 text-[13px] text-muted-foreground">{kind.hint}</p>

            <input
              value={section.heading}
              maxLength={200}
              onChange={(e) => patchSection(index, { heading: e.target.value })}
              placeholder="Heading (optional)"
              className="mb-3 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-bold text-foreground"
            />

            {section.kind === "TEXT" && (
              <textarea
                value={section.body}
                rows={8}
                onChange={(e) => patchSection(index, { body: e.target.value })}
                placeholder={"Write the explanation here.\n\nLeave a blank line between paragraphs."}
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm leading-relaxed text-foreground"
              />
            )}

            {section.kind === "VIDEO" && (
              <input
                value={section.video_url}
                onChange={(e) => patchSection(index, { video_url: e.target.value })}
                placeholder="https://youtu.be/… — or upload a file below"
                className="mb-3 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground"
              />
            )}

            {section.kind === "IMAGE" && (
              <input
                value={section.caption}
                maxLength={300}
                onChange={(e) => patchSection(index, { caption: e.target.value })}
                placeholder="Caption under the picture (optional)"
                className="mb-3 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground"
              />
            )}

            {section.kind !== "TEXT" && (
              <div className="mt-3 space-y-2">
                {section.kind === "IMAGE" && section.image_url && (
                  <div className="max-w-sm overflow-hidden rounded-xl border border-border">
                    {/* `unoptimized`: the bucket is private, so this is a signed URL that
                        expires in an hour and Next's optimizer would cache a 403. */}
                    <Image
                      src={section.image_url}
                      alt=""
                      width={640}
                      height={360}
                      unoptimized
                      className="h-auto w-full object-contain"
                    />
                  </div>
                )}
                {section.kind === "VIDEO" && section.video_file_url && (
                  <p className="text-[13px] font-semibold text-emerald-600 dark:text-emerald-400">
                    A video file is attached.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[13px] font-bold text-foreground hover:bg-surface-2",
                      !section.id && "cursor-not-allowed opacity-60",
                    )}
                  >
                    {uploading === section.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {media ? "Replace file" : "Upload a file"}
                    <input
                      type="file"
                      accept={section.kind === "IMAGE" ? "image/*" : "video/*"}
                      disabled={!section.id || uploading != null}
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void upload(index, file);
                      }}
                    />
                  </label>
                  {media && (
                    <button
                      type="button"
                      onClick={() => void clearMedia(index)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-bold text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden /> Remove file
                    </button>
                  )}
                  {!section.id && (
                    // Said plainly rather than left as a mysteriously dead button: a file
                    // has to attach to a row, and this row does not exist yet.
                    <span className="text-[12px] font-medium text-muted-foreground">
                      Save first — a file attaches to a section that exists.
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSections((prev) => [...prev, { ...BLANK }])}
          className="inline-flex items-center gap-2 rounded-xl border-[1.5px] border-border px-4 py-2.5 text-sm font-bold text-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <Plus className="h-4 w-4" aria-hidden /> Add a section
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Save className="h-4 w-4" aria-hidden />
          )}
          Save roadmap
        </button>
      </div>
    </div>
  );
}

function IconBtn({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-40"
    >
      {children}
    </button>
  );
}
