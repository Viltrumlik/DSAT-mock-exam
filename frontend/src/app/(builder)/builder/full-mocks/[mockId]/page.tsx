"use client";

/**
 * /builder/full-mocks/[mockId] — Full Mock overview.
 *
 * Edit the mock's title/break, publish/unpublish, and open each of the four
 * modules (grouped by section) in the shared question editor
 * (ModuleQuestionsPanel — the SAME editor pastpapers use, with the SAT 27/22
 * per-module question limit and score caps).
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  Calculator,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  Loader2,
  Save,
} from "lucide-react";
import { mocksAdminApi } from "@/features/mocksAdmin/api";
import { StateTag } from "@/components/governance";
import { useToast } from "@/components/ToastProvider";
import { STUDIO_FIELD_LABEL, STUDIO_INPUT } from "@/components/studio/primitives";

function parseError(e: unknown): string {
  const data = (e as { response?: { data?: unknown } })?.response?.data;
  if (data) {
    if (typeof data === "string") return data;
    if (typeof data === "object") {
      const d = data as Record<string, unknown>;
      if (typeof d.detail === "string") return d.detail;
      if (Array.isArray(d.non_field_errors)) return d.non_field_errors.join(" ");
    }
  }
  return (e as { message?: string })?.message || "Something went wrong.";
}

function subjectLabel(subject: string): string {
  return subject === "MATH" ? "Math" : "Reading & Writing";
}

const mockKey = (id: number) => ["mocks", "admin", "detail", id] as const;

export default function FullMockOverviewPage() {
  const params = useParams<{ mockId: string }>();
  const mockId = Number(params.mockId);
  const qc = useQueryClient();
  const toast = useToast();

  const { data: mock, isLoading, error } = useQuery({
    queryKey: mockKey(mockId),
    queryFn: () => mocksAdminApi.getMock(mockId),
    enabled: Number.isFinite(mockId) && mockId > 0,
  });

  const invalidateMock = () => qc.invalidateQueries({ queryKey: mockKey(mockId) });

  const [title, setTitle] = useState("");
  const [breakMinutes, setBreakMinutes] = useState<number>(10);
  useEffect(() => {
    if (mock) {
      setTitle(mock.title ?? "");
      setBreakMinutes(mock.break_minutes ?? 10);
    }
  }, [mock]);

  const dirty = !!mock && (title.trim() !== (mock.title ?? "") || breakMinutes !== mock.break_minutes);

  const saveMeta = useMutation({
    mutationFn: () => mocksAdminApi.updateMock(mockId, { title: title.trim(), break_minutes: breakMinutes }),
    onSuccess: () => {
      toast.push({ message: "Mock details saved.", tone: "success" });
      void invalidateMock();
    },
    onError: (e) => toast.push({ message: parseError(e), tone: "error" }),
  });

  const publishMut = useMutation({
    mutationFn: () => mocksAdminApi.publishMock(mockId),
    onSuccess: () => {
      toast.push({ message: "Mock published.", tone: "success" });
      void invalidateMock();
    },
    onError: (e) => toast.push({ message: parseError(e), tone: "error" }),
  });
  const unpublishMut = useMutation({
    mutationFn: () => mocksAdminApi.unpublishMock(mockId),
    onSuccess: () => {
      toast.push({ message: "Mock unpublished.", tone: "success" });
      void invalidateMock();
    },
    onError: (e) => toast.push({ message: parseError(e), tone: "error" }),
  });

  const totalQuestions = useMemo(
    () => (mock?.sections ?? []).reduce((sum, s) => sum + s.modules.reduce((n, m) => n + m.question_count, 0), 0),
    [mock],
  );

  if (!Number.isFinite(mockId) || mockId <= 0) {
    return <div className="p-8 text-sm text-red-700">Invalid mock id.</div>;
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error || !mock) {
    return (
      <div className="space-y-4">
        <Link href="/builder/full-mocks" className="inline-flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to full mocks
        </Link>
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error ? parseError(error) : "Mock not found."}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Link
        href="/builder/full-mocks"
        className="inline-flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to full mocks
      </Link>

      {/* Header card */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <StateTag state={mock.is_published ? "PUBLISHED" : "DRAFT"} size="sm" />
            <span className="text-xs text-muted-foreground">
              {totalQuestions} question{totalQuestions !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {mock.is_published ? (
              <button
                type="button"
                onClick={() => unpublishMut.mutate()}
                disabled={unpublishMut.isPending}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors"
              >
                {unpublishMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <EyeOff className="h-3 w-3" />}
                Unpublish
              </button>
            ) : (
              <button
                type="button"
                onClick={() => publishMut.mutate()}
                disabled={publishMut.isPending || !mock.publish_ready}
                title={!mock.publish_ready ? mock.publish_block_reason : "Publish this mock"}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
              >
                {publishMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
                Publish
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <label className={STUDIO_FIELD_LABEL}>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={STUDIO_INPUT} />
          </div>
          <div className="w-32">
            <label className={STUDIO_FIELD_LABEL}>Break (min)</label>
            <input
              type="number"
              min={0}
              value={breakMinutes}
              onChange={(e) => setBreakMinutes(Math.max(0, Number(e.target.value) || 0))}
              className={STUDIO_INPUT}
            />
          </div>
          <button
            type="button"
            onClick={() => saveMeta.mutate()}
            disabled={!dirty || !title.trim() || saveMeta.isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saveMeta.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save details
          </button>
        </div>

        {!mock.is_published && !mock.publish_ready && mock.publish_block_reason && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {mock.publish_block_reason}
          </div>
        )}
      </div>

      {/* Modules — each opens the shared question editor */}
      <div className="space-y-3">
        {mock.sections.map((section) => (
          <div key={section.subject}>
            <div className="mb-1.5 flex items-center gap-2 px-1">
              <div
                className={`rounded-md p-1 ${section.subject === "MATH" ? "bg-emerald-100 text-emerald-700" : "bg-primary/10 text-primary"}`}
              >
                {section.subject === "MATH" ? <Calculator className="h-3.5 w-3.5" /> : <BookOpen className="h-3.5 w-3.5" />}
              </div>
              <span className="text-xs font-bold text-foreground">{subjectLabel(section.subject)}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {section.modules.map((m) => (
                <Link
                  key={m.id}
                  href={`/builder/full-mocks/${mockId}/${m.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold text-foreground">Module {m.module_order}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Clock className="h-2.5 w-2.5" />
                      {m.time_limit_minutes} min · {m.question_count} question{m.question_count !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-primary">
                    Edit questions <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
