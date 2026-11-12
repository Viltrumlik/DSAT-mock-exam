"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";

import { Icon } from "@/components/ui/Icon";
import { LibraryError } from "@/features/builderLibrary/sectionParts";
import { Button, Checkbox, Segmented, buttonClass, type SegmentOption } from "@/features/console/ui";
import { CONTROL, FIELD_LABEL, SERIF_AREA } from "@/features/questionsAdmin/questionLook";
import { cn } from "@/lib/cn";
import { journalsApi } from "./api";
import { LoadingLine, Notice, PANEL } from "./journalParts";
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
 *
 * In the console's look (design handoff v0.3). The words, the rules and the calls are the editor's own.
 */

const KINDS: (SegmentOption<RoadmapSectionKind> & { hint: string })[] = [
  { value: "TEXT", label: "Text", icon: "type", hint: "A passage. Leave a blank line between paragraphs." },
  { value: "IMAGE", label: "Picture", icon: "image", hint: "A diagram or a photo, with a caption under it." },
  { value: "VIDEO", label: "Video", icon: "monitor", hint: "A YouTube link, or upload the file." },
];

const BLANK: RoadmapSection = {
  kind: "TEXT",
  heading: "",
  body: "",
  caption: "",
  video_url: "",
};

/** A long text field in the console's shell (sans: the student's reading page is sans too). */
const AREA = SERIF_AREA;

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
    return <LoadingLine>Loading roadmap…</LoadingLine>;
  }
  if (!roadmap) {
    return (
      <LibraryError>
        {error ?? "Roadmap not found."}
        <button
          type="button"
          onClick={() => void load()}
          className="ml-3 font-semibold underline underline-offset-2"
        >
          Try again
        </button>
      </LibraryError>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className={cn(PANEL, "animate-ms-card-in p-5")}>
        <h2 className="text-[18px] font-bold leading-6 text-ms-fg">Roadmap</h2>
        <p className="mt-1 text-[14px] leading-[21px] text-ms-fg-2">
          What a student reads before opening this session’s homework — the explanation of
          the topic, in text, pictures and video. It is optional: a session with nothing
          here simply has no reading, and still publishes.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={FIELD_LABEL}>Title</span>
            <input
              value={roadmap.title}
              maxLength={200}
              onChange={(e) => patchRoadmap({ title: e.target.value })}
              placeholder="Falls back to the session's own title"
              className={CONTROL}
            />
          </label>
          <label className="block">
            <span className={FIELD_LABEL}>
              Reading time (minutes)
            </span>
            <input
              type="number"
              min={0}
              max={240}
              value={roadmap.estimated_minutes}
              onChange={(e) => patchRoadmap({ estimated_minutes: Number(e.target.value) })}
              className={cn(CONTROL, "tabular-nums")}
            />
          </label>
        </div>
        <label className="mt-3 block">
          <span className={FIELD_LABEL}>One-line summary</span>
          <input
            value={roadmap.summary}
            maxLength={300}
            onChange={(e) => patchRoadmap({ summary: e.target.value })}
            placeholder="Read this before you start the homework."
            className={CONTROL}
          />
        </label>
        <label className="mt-4 flex cursor-pointer items-start gap-3">
          <span className="mt-0.5 inline-flex">
            <Checkbox
              checked={roadmap.require_read_confirmation}
              onChange={() => patchRoadmap({ require_read_confirmation: !roadmap.require_read_confirmation })}
              label="Hold the homework until they confirm they’ve read it"
            />
          </span>
          <span>
            <span className="block text-[15px] font-medium leading-5 text-ms-fg">
              Hold the homework until they confirm they’ve read it
            </span>
            <span className="mt-0.5 block text-[13px] leading-[18px] text-ms-fg-3">
              The homework button appears at the bottom of the reading once they press
              “I’ve finished reading”. Turn this off and the button is always there.
            </span>
          </span>
        </label>
      </div>

      {error && <LibraryError>{error}</LibraryError>}
      {notice && !error && <Notice tone="positive">{notice}</Notice>}
      {roadmap.validation_reasons.length > 0 && <Notice tone="attention">{roadmap.validation_reasons[0]}</Notice>}

      {sections.map((section, index) => {
        const kind = KINDS.find((k) => k.value === section.kind) ?? KINDS[0];
        const media = section.kind === "IMAGE" ? section.image_url : section.video_file_url;
        return (
          <div key={section.id ?? `new-${index}`} data-roadmap-section={index} className={cn(PANEL, "animate-ms-card-in p-5")}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <Segmented<RoadmapSectionKind>
                label="Section kind"
                size="sm"
                value={section.kind}
                onChange={(v) => patchSection(index, { kind: v })}
                options={KINDS.map(({ value, label, icon }) => ({ value, label, icon }))}
              />
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" icon="up" aria-label="Move up" onClick={() => move(index, -1)} disabled={index === 0} />
                <Button
                  variant="ghost"
                  size="sm"
                  icon="down"
                  aria-label="Move down"
                  onClick={() => move(index, 1)}
                  disabled={index === sections.length - 1}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  icon="trash"
                  aria-label="Remove section"
                  onClick={() => setSections((prev) => prev.filter((_, i) => i !== index))}
                />
              </div>
            </div>

            <p className="mb-3 text-[13px] text-ms-fg-3">{kind.hint}</p>

            <div className="mb-3">
              <input
                value={section.heading}
                maxLength={200}
                onChange={(e) => patchSection(index, { heading: e.target.value })}
                placeholder="Heading (optional)"
                aria-label="Heading (optional)"
                className={cn(CONTROL, "font-semibold")}
              />
            </div>

            {section.kind === "TEXT" && (
              <textarea
                value={section.body}
                rows={8}
                onChange={(e) => patchSection(index, { body: e.target.value })}
                placeholder={"Write the explanation here.\n\nLeave a blank line between paragraphs."}
                className={AREA}
              />
            )}

            {section.kind === "VIDEO" && (
              <div className="mb-3">
                <input
                  value={section.video_url}
                  onChange={(e) => patchSection(index, { video_url: e.target.value })}
                  placeholder="https://youtu.be/… — or upload a file below"
                  className={CONTROL}
                />
              </div>
            )}

            {section.kind === "IMAGE" && (
              <div className="mb-3">
                <input
                  value={section.caption}
                  maxLength={300}
                  onChange={(e) => patchSection(index, { caption: e.target.value })}
                  placeholder="Caption under the picture (optional)"
                  className={CONTROL}
                />
              </div>
            )}

            {section.kind !== "TEXT" && (
              <div className="mt-3 flex flex-col gap-2">
                {section.kind === "IMAGE" && section.image_url && (
                  <div className="max-w-sm overflow-hidden rounded-ms-ctl border border-ms-border">
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
                  <p className="flex items-center gap-1.5 text-[13px] font-medium text-ms-positive-fg">
                    <Icon name="ok" size="sm" className="size-3.5" />
                    A video file is attached.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    className={cn(
                      buttonClass({ variant: "secondary", size: "sm" }),
                      !section.id ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                    )}
                  >
                    {uploading === section.id ? (
                      <Icon name="loader" size="sm" className="animate-ms-spin" />
                    ) : (
                      <Icon name="plus" size="sm" />
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
                    <Button variant="ghost" size="sm" icon="x" onClick={() => void clearMedia(index)}>
                      Remove file
                    </Button>
                  )}
                  {!section.id && (
                    // Said plainly rather than left as a mysteriously dead button: a file
                    // has to attach to a row, and this row does not exist yet.
                    <span className="text-[13px] text-ms-fg-3">
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
        <Button icon="plus" onClick={() => setSections((prev) => [...prev, { ...BLANK }])}>
          Add a section
        </Button>
        <Button variant="primary" icon="check" state={saving ? "busy" : "idle"} onClick={() => void save()}>
          Save roadmap
        </Button>
      </div>
    </div>
  );
}
