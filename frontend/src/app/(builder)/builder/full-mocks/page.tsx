"use client";

/**
 * /builder/full-mocks — Full Mock builder hub (NEW `mocks` backend app).
 *
 * The full-mock system (mocks app). A full mock
 * auto-provisions two sections (Reading & Writing, then Math), each with two
 * modules. Author questions per module in the editor.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Calculator,
  Clock,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Plus,
  RefreshCcw,
  Timer,
  Trash2,
} from "lucide-react";
import { mocksAdminApi, type AdminMock } from "@/features/mocksAdmin/api";
import { StateTag } from "@/components/governance";
import { ConfirmDialog } from "@/features/classroom/ui";
import { useToast } from "@/components/ToastProvider";
import {
  STUDIO_BTN_PRIMARY,
  STUDIO_BTN_SECONDARY,
  STUDIO_CARD,
  STUDIO_ERROR_BANNER,
  STUDIO_FIELD_LABEL,
  STUDIO_INPUT,
  STUDIO_PAGE_DESC,
  STUDIO_PAGE_TITLE,
} from "@/components/studio/primitives";

const MOCKS_KEY = ["mocks", "admin", "list"] as const;

function parseError(e: unknown): string {
  const data = (e as { response?: { data?: unknown } })?.response?.data;
  if (data) {
    if (typeof data === "string") return data;
    if (typeof data === "object") {
      const d = data as Record<string, unknown>;
      if (typeof d.detail === "string") return d.detail;
      if (Array.isArray(d.non_field_errors)) return d.non_field_errors.join(" ");
      const parts = Object.entries(d)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" ") : String(v)}`)
        .join(" ");
      if (parts) return parts;
    }
  }
  return (e as { message?: string })?.message || "Something went wrong.";
}

function subjectLabel(subject: string): string {
  return subject === "MATH" ? "Math" : "Reading & Writing";
}

export default function BuilderFullMocksPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: MOCKS_KEY,
    queryFn: () => mocksAdminApi.listMocks(),
  });
  const mocks = data ?? [];

  // Create form
  const [title, setTitle] = useState("");
  const [breakMinutes, setBreakMinutes] = useState<number>(10);

  const invalidate = () => qc.invalidateQueries({ queryKey: MOCKS_KEY });

  const createMut = useMutation({
    mutationFn: () =>
      mocksAdminApi.createMock({ title: title.trim(), break_minutes: breakMinutes }),
    onSuccess: (mock) => {
      setTitle("");
      setBreakMinutes(10);
      toast.push({ message: "Mock created.", tone: "success" });
      router.push(`/builder/full-mocks/${mock.id}`);
    },
    onError: (e) => toast.push({ message: parseError(e), tone: "error" }),
  });

  const publishMut = useMutation({
    mutationFn: (id: number) => mocksAdminApi.publishMock(id),
    onSuccess: () => {
      toast.push({ message: "Mock published.", tone: "success" });
      void invalidate();
    },
    onError: (e) => toast.push({ message: parseError(e), tone: "error" }),
  });

  const unpublishMut = useMutation({
    mutationFn: (id: number) => mocksAdminApi.unpublishMock(id),
    onSuccess: () => {
      toast.push({ message: "Mock unpublished.", tone: "success" });
      void invalidate();
    },
    onError: (e) => toast.push({ message: parseError(e), tone: "error" }),
  });

  const [pendingDelete, setPendingDelete] = useState<AdminMock | null>(null);
  const deleteMut = useMutation({
    mutationFn: (id: number) => mocksAdminApi.deleteMock(id),
    onSuccess: () => {
      setPendingDelete(null);
      toast.push({ message: "Mock deleted.", tone: "success" });
      void invalidate();
    },
    onError: (e) => toast.push({ message: parseError(e), tone: "error" }),
  });

  const busyId =
    publishMut.isPending
      ? publishMut.variables
      : unpublishMut.isPending
      ? unpublishMut.variables
      : null;

  const publishedCount = mocks.filter((m) => m.is_published).length;
  const draftCount = mocks.length - publishedCount;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-0.5 text-[12px] font-medium text-muted-foreground">
            Full Mock System
          </p>
          <h1 className={STUDIO_PAGE_TITLE}>Full mocks</h1>
          <p className={`${STUDIO_PAGE_DESC} max-w-xl`}>
            A full mock is a complete timed SAT — a Reading &amp; Writing section and a Math section,
            each with two modules. Author questions per module, then publish once every module has at
            least one question.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className={`shrink-0 ${STUDIO_BTN_SECONDARY}`}
        >
          <RefreshCcw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Create form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) createMut.mutate();
        }}
        className={`${STUDIO_CARD} px-3 py-3`}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className={STUDIO_FIELD_LABEL}>Mock title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. SAT Full Mock — April 2026"
              className={STUDIO_INPUT}
            />
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
            type="submit"
            disabled={!title.trim() || createMut.isPending}
            className={STUDIO_BTN_PRIMARY}
          >
            {createMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Create mock
          </button>
        </div>
      </form>

      {/* Stats */}
      {!isLoading && mocks.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          <div className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            {mocks.length} mock{mocks.length !== 1 ? "s" : ""}
          </div>
          {publishedCount > 0 && (
            <div className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Eye className="h-3.5 w-3.5" />
              {publishedCount} published
            </div>
          )}
          {draftCount > 0 && (
            <div className="inline-flex items-center gap-1.5 text-foreground">
              {draftCount} draft{draftCount !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className={STUDIO_ERROR_BANNER}>
          {parseError(error)}
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : mocks.length === 0 ? (
        <div className={`${STUDIO_CARD} px-3 py-8 text-center`}>
          <div className="mb-2 flex justify-center">
            <FileText className="h-5 w-5 text-muted-foreground/60" />
          </div>
          <p className="text-[13px] font-semibold text-foreground">No full mocks yet</p>
          <p className="mt-0.5 mx-auto max-w-xs text-[13px] text-muted-foreground">
            Create a mock above — its sections and modules are provisioned automatically.
          </p>
        </div>
      ) : (
        <div className={`${STUDIO_CARD} divide-y divide-border`}>
          {mocks.map((mock) => {
            const isBusy = busyId === mock.id;
            return (
              <div key={mock.id} className="px-3 py-2.5 hover:bg-surface-2/40">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-[13px] font-semibold text-foreground">
                        #{mock.id} · {mock.title || "Untitled mock"}
                      </h3>
                      <StateTag state={mock.is_published ? "PUBLISHED" : "DRAFT"} size="xs" />
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        {mock.question_count} question{mock.question_count !== 1 ? "s" : ""}
                      </span>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="inline-flex items-center gap-1">
                        <Timer className="h-3 w-3" />
                        {mock.break_minutes} min break
                      </span>
                    </p>
                    {/* Section / module summary */}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {mock.sections.map((section) => (
                        <div
                          key={section.subject}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2/40 px-2 py-1 text-[12px] font-medium text-foreground"
                        >
                          {section.subject === "MATH" ? (
                            <Calculator className="h-3 w-3 text-muted-foreground" />
                          ) : (
                            <BookOpen className="h-3 w-3 text-muted-foreground" />
                          )}
                          {subjectLabel(section.subject)}
                          <span className="flex items-center gap-1 text-muted-foreground">
                            {section.modules.map((m) => (
                              <span key={m.id} className="inline-flex items-center gap-0.5">
                                <Clock className="h-2.5 w-2.5" />
                                {m.time_limit_minutes}m/{m.question_count}q
                              </span>
                            ))}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {mock.is_published ? (
                      <button
                        type="button"
                        onClick={() => unpublishMut.mutate(mock.id)}
                        disabled={isBusy}
                        className={STUDIO_BTN_SECONDARY}
                      >
                        {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <EyeOff className="h-3 w-3" />}
                        Unpublish
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => publishMut.mutate(mock.id)}
                        disabled={isBusy || !mock.publish_ready}
                        title={!mock.publish_ready ? mock.publish_block_reason : "Publish this mock"}
                        className={STUDIO_BTN_PRIMARY}
                      >
                        {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
                        Publish
                      </button>
                    )}
                    <Link
                      href={`/builder/full-mocks/${mock.id}`}
                      className={STUDIO_BTN_SECONDARY}
                    >
                      Open editor →
                    </Link>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(mock)}
                      title="Delete mock"
                      aria-label={`Delete mock ${mock.title}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:hover:border-red-900/60 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Publish block reason */}
                {!mock.is_published && !mock.publish_ready && mock.publish_block_reason && (
                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                    {mock.publish_block_reason}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        tone="danger"
        title="Delete full mock?"
        description={
          pendingDelete
            ? `“#${pendingDelete.id} · ${pendingDelete.title}” and all of its modules and questions will be permanently removed.`
            : undefined
        }
        confirmLabel="Delete mock"
        loading={deleteMut.isPending}
        onConfirm={() => pendingDelete && deleteMut.mutate(pendingDelete.id)}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
