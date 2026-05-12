"use client";

import { useEffect, useRef, useState } from "react";
import { classesApi } from "@/lib/api";
import {
  BookOpen,
  Calendar,
  Calculator,
  ClipboardList,
  FileText,
  Loader2,
  LayoutGrid,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

type ContentType = "none" | "practice_test" | "mock_exam" | "pastpaper_pack" | "assessment";

type AssignmentOption = {
  id: number;
  title: string;
  label?: string;
  subject?: string;
};

type AssignmentOptions = {
  practice_tests?: AssignmentOption[];
  mock_exams?: AssignmentOption[];
  pastpaper_packs?: AssignmentOption[];
  assessment_sets?: AssignmentOption[];
};

export type DrawerMode =
  | { type: "create"; classroomId: number }
  | {
      type: "edit";
      classroomId: number;
      assignment: {
        id: number;
        title: string;
        instructions?: string;
        due_at?: string | null;
        practice_test?: number | null;
        mock_exam?: number | null;
        pastpaper_pack?: number | null;
      };
    };

export type DrawerResult = {
  id: number;
  title: string;
  due_at: string | null;
  created_at?: string;
};

interface Props {
  mode: DrawerMode;
  onClose: () => void;
  onSaved: (result: DrawerResult) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectContentType(assignment: DrawerMode extends { type: "edit"; assignment: infer A } ? A : never): ContentType {
  if ((assignment as { mock_exam?: number | null }).mock_exam) return "mock_exam";
  if ((assignment as { pastpaper_pack?: number | null }).pastpaper_pack) return "pastpaper_pack";
  if ((assignment as { practice_test?: number | null }).practice_test) return "practice_test";
  return "none";
}

function formatForInput(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toISOString().slice(0, 16);
  } catch {
    return "";
  }
}

const CONTENT_TYPE_OPTIONS: { value: ContentType; label: string; icon: React.ElementType }[] = [
  { value: "none", label: "No linked content", icon: ClipboardList },
  { value: "practice_test", label: "Practice test", icon: BookOpen },
  { value: "mock_exam", label: "Mock exam", icon: LayoutGrid },
  { value: "pastpaper_pack", label: "Pastpaper pack", icon: FileText },
  { value: "assessment", label: "Assessment", icon: Calculator },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function AssignmentDrawer({ mode, onClose, onSaved }: Props) {
  const isEdit = mode.type === "edit";
  const classroomId = mode.classroomId;
  const existingAssignment = isEdit ? mode.assignment : null;

  // Form state
  const [title, setTitle] = useState(existingAssignment?.title ?? "");
  const [instructions, setInstructions] = useState(existingAssignment?.instructions ?? "");
  const [dueAt, setDueAt] = useState(formatForInput(existingAssignment?.due_at));
  const [contentType, setContentType] = useState<ContentType>(
    existingAssignment ? detectContentType(existingAssignment as Parameters<typeof detectContentType>[0]) : "none",
  );
  const [selectedContentId, setSelectedContentId] = useState<number | "">(() => {
    if (!existingAssignment) return "";
    return (
      existingAssignment.mock_exam ??
      existingAssignment.pastpaper_pack ??
      existingAssignment.practice_test ??
      ""
    );
  });

  // Options loading
  const [options, setOptions] = useState<AssignmentOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  // Submission state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const titleRef = useRef<HTMLInputElement>(null);

  // Focus title on mount
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Load content options
  useEffect(() => {
    if (contentType === "none") return;
    let cancelled = false;
    setOptionsLoading(true);
    setOptionsError(null);
    (async () => {
      try {
        const data = await classesApi.getAssignmentOptions(classroomId);
        if (!cancelled) setOptions(data as AssignmentOptions);
      } catch {
        if (!cancelled) setOptionsError("Could not load content options.");
      } finally {
        if (!cancelled) setOptionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contentType, classroomId]);

  // Reset content selection when type changes
  const handleContentTypeChange = (t: ContentType) => {
    setContentType(t);
    setSelectedContentId("");
  };

  const currentOptions: AssignmentOption[] | undefined = (() => {
    if (!options) return undefined;
    switch (contentType) {
      case "practice_test":
        return options.practice_tests;
      case "mock_exam":
        return options.mock_exams;
      case "pastpaper_pack":
        return options.pastpaper_packs;
      case "assessment":
        return options.assessment_sets;
      default:
        return undefined;
    }
  })();

  const handleSave = async () => {
    if (!title.trim()) {
      setSaveError("Title is required.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        instructions: instructions.trim(),
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        // Clear all content FKs, then set the chosen one
        practice_test: null,
        mock_exam: null,
        pastpaper_pack: null,
      };
      if (selectedContentId !== "" && contentType !== "none") {
        payload[contentType] = selectedContentId;
      }

      let result: DrawerResult;
      if (isEdit && existingAssignment) {
        result = (await classesApi.updateAssignment(
          classroomId,
          existingAssignment.id,
          payload,
        )) as DrawerResult;
      } else {
        result = (await classesApi.createAssignment(classroomId, payload)) as DrawerResult;
      }
      onSaved(result);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setSaveError(typeof detail === "string" ? detail : "Failed to save assignment.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        className="fixed inset-0 z-40 bg-black/30[2px]"
        aria-label="Close drawer"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 className="text-base font-extrabold text-foreground">
            {isEdit ? "Edit assignment" : "New assignment"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* Title */}
          <div>
            <label className="mb-1.5 block text-xs font-bold text-foreground">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Week 3 Reading & Writing"
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-medium placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Due date */}
          <div>
            <label className="mb-1.5 block text-xs font-bold text-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                Due date (optional)
              </span>
            </label>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Content type */}
          <div>
            <label className="mb-1.5 block text-xs font-bold text-foreground">
              Linked content
            </label>
            <div className="grid grid-cols-1 gap-1.5">
              {CONTENT_TYPE_OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => handleContentTypeChange(value)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm font-semibold text-left transition-colors",
                    contentType === value
                      ? "border-primary/30 bg-primary/8 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Content picker */}
          {contentType !== "none" && (
            <div>
              <label className="mb-1.5 block text-xs font-bold text-foreground">
                Select content
              </label>
              {optionsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading options…
                </div>
              ) : optionsError ? (
                <p className="text-sm text-red-600">{optionsError}</p>
              ) : currentOptions && currentOptions.length > 0 ? (
                <select
                  value={selectedContentId}
                  onChange={(e) =>
                    setSelectedContentId(e.target.value ? Number(e.target.value) : "")
                  }
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">— Select —</option>
                  {currentOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.title}
                      {opt.label ? ` (${opt.label})` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-muted-foreground">No items available.</p>
              )}
            </div>
          )}

          {/* Instructions */}
          <div>
            <label className="mb-1.5 block text-xs font-bold text-foreground">
              Instructions (optional)
            </label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              placeholder="Any notes for students…"
              className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-medium placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Error */}
          {saveError && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {saveError}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !title.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Save changes" : "Create assignment"}
          </button>
        </div>
      </div>
    </>
  );
}
