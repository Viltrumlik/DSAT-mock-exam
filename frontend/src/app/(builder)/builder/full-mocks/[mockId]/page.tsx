"use client";

/**
 * /builder/full-mocks/[mockId] — Full Mock overview.
 *
 * Edit the mock's title/break, publish/unpublish, and open each of the four
 * modules (grouped by section) in the shared question editor
 * (ModuleQuestionsPanel — the SAME editor pastpapers use, with the SAT 27/22
 * per-module question limit and score caps).
 *
 * In the console's look (design handoff v0.3, PR 20). The words and the calls are the page's own.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ToastProvider";
import { LibraryError } from "@/features/builderLibrary/sectionParts";
import { recordRecent } from "@/features/console/recent";
import { Badge, Button } from "@/features/console/ui";
import { mocksAdminApi } from "@/features/mocksAdmin/api";
import { CONTROL, FIELD_LABEL } from "@/features/questionsAdmin/questionLook";
import { cn } from "@/lib/cn";

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

function BackLink() {
  return (
    <Link
      href="/builder/full-mocks"
      className="ms-transition inline-flex w-fit items-center gap-1 rounded-[8px] px-2 py-1 text-[14px] font-semibold text-ms-primary-text hover:bg-ms-surface-2"
    >
      <Icon name="left" size="sm" className="size-3.5" />
      Back to full mocks
    </Link>
  );
}

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

  // Studio home's "Continue where you left off" (BuilderHome board).
  useEffect(() => {
    if (mock) recordRecent({ kind: "mock", id: mockId, name: mock.title || `Full mock ${mockId}`, href: `/builder/full-mocks/${mockId}` });
  }, [mock, mockId]);

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
    return <LibraryError>Invalid mock id.</LibraryError>;
  }

  if (isLoading) {
    return (
      <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-4">
        <div className="h-[220px] animate-ms-shimmer rounded-ms-card bg-ms-surface-2" />
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[72px] animate-ms-shimmer rounded-ms-card bg-ms-surface-2" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !mock) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <LibraryError>{error ? parseError(error) : "Mock not found."}</LibraryError>
      </div>
    );
  }

  const busy = publishMut.isPending || unpublishMut.isPending;

  return (
    <div className="flex flex-col gap-5">
      <BackLink />

      {/* Header */}
      <header data-header className="animate-ms-fade-in flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-[18rem]">
          <p className="text-ms-over mb-1.5 uppercase text-ms-primary-text">Full mock</p>
          <h1 className="break-words font-ms-display text-ms-b-display text-ms-fg">{mock.title || `Full mock ${mockId}`}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[14px] text-ms-fg-2">
            {mock.is_published ? (
              <Badge tone="positive" dot>
                Published
              </Badge>
            ) : (
              <Badge tone="line">Draft</Badge>
            )}
            <span>
              {totalQuestions} question{totalQuestions !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {mock.is_published ? (
            <Button variant="secondary" icon="eye" state={unpublishMut.isPending ? "busy" : "idle"} disabled={busy} onClick={() => unpublishMut.mutate()}>
              Unpublish
            </Button>
          ) : (
            <Button
              variant="primary"
              icon="eye"
              state={publishMut.isPending ? "busy" : "idle"}
              disabled={busy || !mock.publish_ready}
              title={!mock.publish_ready ? mock.publish_block_reason : "Publish this mock"}
              onClick={() => publishMut.mutate()}
            >
              Publish
            </Button>
          )}
        </div>
      </header>

      {/* Details */}
      <form
        aria-label="Mock details"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && title.trim() && !saveMeta.isPending) saveMeta.mutate();
        }}
        className="animate-ms-card-in flex flex-col gap-3 rounded-ms-card bg-ms-card p-4 shadow-ms-1 sm:p-5"
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <label htmlFor="mock-title" className={FIELD_LABEL}>
              Title
            </label>
            <input id="mock-title" value={title} onChange={(e) => setTitle(e.target.value)} className={CONTROL} />
          </div>
          <div className="w-32">
            <label htmlFor="mock-break" className={FIELD_LABEL}>
              Break (min)
            </label>
            <input
              id="mock-break"
              type="number"
              min={0}
              value={breakMinutes}
              onChange={(e) => setBreakMinutes(Math.max(0, Number(e.target.value) || 0))}
              className={CONTROL}
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            icon="check"
            state={saveMeta.isPending ? "busy" : "idle"}
            disabled={!dirty || !title.trim() || saveMeta.isPending}
          >
            Save details
          </Button>
        </div>

        {!mock.is_published && !mock.publish_ready && mock.publish_block_reason ? (
          <p className="flex items-start gap-2 rounded-[12px] bg-ms-attention-soft px-3 py-2 text-[13px] leading-[18px] text-ms-attention-fg">
            <Icon name="warn" size="sm" className="mt-px size-3.5 shrink-0" />
            {mock.publish_block_reason}
          </p>
        ) : null}

        {/* Short of the official SAT shape. Publishing is still allowed (the scorer is
            proportional), but a "full mock" that hands out 12 Reading questions instead of
            27 should say so out loud rather than look finished. */}
        {(mock.publish_warnings?.length ?? 0) > 0 ? (
          <div className="rounded-[12px] bg-ms-surface px-3.5 py-2.5 text-[13px] leading-[18px] text-ms-fg-2">
            <p className="font-semibold text-ms-fg">Shorter than a real SAT</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {mock.publish_warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </form>

      {/* Modules — each opens the shared question editor */}
      <div className="flex flex-col gap-4">
        {mock.sections.map((section) => {
          const math = section.subject === "MATH";
          return (
            <section key={section.subject} aria-label={subjectLabel(section.subject)} className="animate-ms-fade-in">
              <div className="mb-2 flex items-center gap-2 px-1">
                <span
                  className={cn(
                    "grid size-6 place-items-center rounded-[7px]",
                    math ? "bg-ms-math-soft text-ms-math-fg" : "bg-ms-rw-soft text-ms-rw-fg",
                  )}
                >
                  <Icon name={math ? "sigma" : "book"} size="sm" className="size-3.5" />
                </span>
                <h2 className="text-[15px] font-semibold text-ms-fg">{subjectLabel(section.subject)}</h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {section.modules.map((m) => (
                  <Link
                    key={m.id}
                    data-module={m.id}
                    href={`/builder/full-mocks/${mockId}/${m.id}`}
                    className="ms-transition ms-press group flex items-center justify-between gap-3 rounded-ms-card bg-ms-card px-4 py-3.5 shadow-ms-1 hover:bg-ms-surface"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-[10px]",
                          math ? "bg-ms-math-soft text-ms-math-fg" : "bg-ms-rw-soft text-ms-rw-fg",
                        )}
                      >
                        <Icon name="ms-module" size="sm" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold text-ms-fg">Module {m.module_order}</p>
                        <p className="mt-0.5 flex items-center gap-1 text-[13px] tabular-nums text-ms-fg-2">
                          <Icon name="clock" size="sm" className="size-3.5 text-ms-fg-3" />
                          {m.time_limit_minutes} min ·{" "}
                          {m.question_target
                            ? `${m.question_count} / ${m.question_target} questions`
                            : `${m.question_count} question${m.question_count !== 1 ? "s" : ""}`}
                        </p>
                      </div>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 text-[14px] font-semibold text-ms-primary-text">
                      Edit questions <Icon name="right" size="sm" />
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
