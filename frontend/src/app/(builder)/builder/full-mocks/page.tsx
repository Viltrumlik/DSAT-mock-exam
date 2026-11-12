"use client";

/**
 * /builder/full-mocks — Full Mock builder hub (NEW `mocks` backend app).
 *
 * The full-mock system (mocks app). A full mock
 * auto-provisions two sections (Reading & Writing, then Math), each with two
 * modules. Author questions per module in the editor.
 *
 * In the console's look as a media library (design handoff v0.3, Modern board, PR 15a): one card per mock,
 * its cover drawing the test's shape and length; New full mock opens the create form in a dialog.
 */

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ToastProvider";
import { mocksAdminApi, type AdminMock } from "@/features/mocksAdmin/api";
import { LibraryCard, LibrarySkeleton, TestCover, type CoverBlock } from "@/features/builderLibrary/LibraryCard";
import {
  Badge,
  Button,
  ChipCount,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  SearchField,
  buttonClass,
  chipClass,
  inputShell,
} from "@/features/console/ui";

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

/** The official count when the server does not say: 27 per R&W module, 22 per Math module. */
const DEFAULT_TARGET = { MATH: 22, READING_WRITING: 27 } as const;

/** The mock's shape for its cover — R&W 1, R&W 2, the break, Math 1, Math 2 — and what is still missing. */
function mockShape(mock: AdminMock): { blocks: CoverBlock[]; minutes: number; missing: number } {
  const blocks: CoverBlock[] = [];
  let minutes = 0;
  let missing = 0;
  mock.sections.forEach((section, si) => {
    if (si > 0) {
      blocks.push({ key: `break-${si}`, tone: "break", weight: 6, title: `${mock.break_minutes} min break` });
      minutes += mock.break_minutes;
    }
    const tone = section.subject === "MATH" ? "math" : "rw";
    [...section.modules]
      .sort((a, b) => a.module_order - b.module_order)
      .forEach((m, mi) => {
        const target = m.question_target ?? DEFAULT_TARGET[section.subject as keyof typeof DEFAULT_TARGET] ?? 27;
        minutes += m.time_limit_minutes;
        missing += Math.max(0, target - m.question_count);
        blocks.push({
          key: `${section.subject}-${m.id}`,
          tone,
          weight: target,
          fill: target > 0 ? Math.min(1, m.question_count / target) : 1,
          second: mi > 0,
          title: `${subjectLabel(section.subject)} · Module ${m.module_order} · ${m.question_count} / ${target} questions · ${m.time_limit_minutes} min`,
        });
      });
  });
  return { blocks, minutes, missing };
}

type StatusFilter = "all" | "published" | "drafts";

const FIELD_LABEL = "mb-1.5 block text-[14px] font-medium leading-5 text-ms-fg";
const CONTROL = inputShell({ className: "w-full outline-none placeholder:text-ms-fg-3" });

export default function BuilderFullMocksPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: MOCKS_KEY,
    queryFn: () => mocksAdminApi.listMocks(),
  });
  const mocks = useMemo(() => data ?? [], [data]);

  // Create form
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [breakMinutes, setBreakMinutes] = useState<number>(10);
  const createTitleId = useId();

  const invalidate = () => qc.invalidateQueries({ queryKey: MOCKS_KEY });

  const createMut = useMutation({
    mutationFn: () =>
      mocksAdminApi.createMock({ title: title.trim(), break_minutes: breakMinutes }),
    onSuccess: (mock) => {
      setTitle("");
      setBreakMinutes(10);
      setCreateOpen(false);
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
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await mocksAdminApi.deleteMock(pendingDelete.id);
    } catch (e) {
      throw new Error(parseError(e));
    }
    toast.push({ message: "Mock deleted.", tone: "success" });
    void invalidate();
  };

  const busyId =
    publishMut.isPending
      ? publishMut.variables
      : unpublishMut.isPending
      ? unpublishMut.variables
      : null;

  const publishedCount = mocks.filter((m) => m.is_published).length;
  const draftCount = mocks.length - publishedCount;

  // Search over the titles (and the #id), and the status chips.
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mocks.filter((m) => {
      if (status === "published" && !m.is_published) return false;
      if (status === "drafts" && m.is_published) return false;
      if (q && !`#${m.id} ${m.title ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [mocks, query, status]);

  const chips: { id: StatusFilter; label: string; n: number }[] = [
    { id: "all", label: "All", n: mocks.length },
    { id: "published", label: "Published", n: publishedCount },
    { id: "drafts", label: "Drafts", n: draftCount },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <header className="animate-ms-fade-in flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-ms-over mb-1.5 uppercase text-ms-primary-text">Full Mock System</p>
          <h1 className="font-ms-display text-ms-b-display text-ms-fg">Full mocks</h1>
          <p className="mt-1 max-w-2xl text-[14px] text-ms-fg-2">
            A full mock is a complete timed SAT — a Reading &amp; Writing section and a Math section,
            each with two modules. Author questions per module, then publish once every module has at
            least one question.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => void refetch()} disabled={isFetching}>
            <Icon name="refresh" size="md" className={isFetching ? "animate-ms-spin" : undefined} />
            Refresh
          </Button>
          <Button variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>
            New full mock
          </Button>
        </div>
      </header>

      {/* Search + status */}
      {!isLoading && !error && mocks.length > 0 ? (
        <div className="flex flex-col gap-3">
          <SearchField value={query} placeholder="Search full mocks" onSearch={setQuery} className="max-w-[640px]" />
          <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={status === c.id}
                onClick={() => setStatus(c.id)}
                className={chipClass(status === c.id, c.n === 0 && c.id !== "all")}
              >
                {c.label}
                <ChipCount n={c.n} on={status === c.id} />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* List */}
      {isLoading ? (
        <LibrarySkeleton />
      ) : error ? (
        <ErrorState what="full mocks" onRetry={() => void refetch()} />
      ) : mocks.length === 0 ? (
        <EmptyState
          icon="ms-fullmock"
          title="No full mocks yet"
          detail="Create a mock with New full mock — its sections and modules are provisioned automatically."
          action={
            <Button variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>
              New full mock
            </Button>
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState icon="search" title="No mocks match" detail="Try another word, or another status." />
      ) : (
        <div className="grid gap-x-[22px] gap-y-8 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((mock, i) => {
            const isBusy = busyId === mock.id;
            const shape = mockShape(mock);
            const name = `#${mock.id} · ${mock.title || "Untitled mock"}`;
            const href = `/builder/full-mocks/${mock.id}`;
            const incomplete = !mock.is_published && shape.missing > 0;
            return (
              <LibraryCard
                key={mock.id}
                delay={Math.min(i, 8) * 40}
                cover={<TestCover blocks={shape.blocks} minutes={shape.minutes} href={href} label={`Open ${name}`} />}
                icon="ms-fullmock"
                title={name}
                href={href}
                meta={
                  <>
                    {mock.question_count} question{mock.question_count !== 1 ? "s" : ""} · {mock.break_minutes} min break
                  </>
                }
                status={
                  <>
                    {mock.is_published ? (
                      <Badge tone="positive" dot>
                        Published
                      </Badge>
                    ) : (
                      <Badge tone="line">Draft</Badge>
                    )}
                    {incomplete ? (
                      <>
                        <Badge tone="attention" icon="warn">
                          Incomplete
                        </Badge>
                        <span className="text-[13px] text-ms-fg-3">
                          {shape.missing} question{shape.missing !== 1 ? "s" : ""} missing
                        </span>
                      </>
                    ) : null}
                  </>
                }
                note={
                  /* Publish block reason */
                  !mock.is_published && !mock.publish_ready && mock.publish_block_reason ? (
                    <p className="flex items-start gap-2 rounded-[12px] bg-ms-attention-soft px-3 py-2 text-[13px] leading-[18px] text-ms-attention-fg">
                      <Icon name="warn" size="sm" className="mt-px size-3.5" />
                      {mock.publish_block_reason}
                    </p>
                  ) : null
                }
                actions={
                  <>
                    {mock.is_published ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon="eye"
                        state={isBusy ? "busy" : "idle"}
                        onClick={() => unpublishMut.mutate(mock.id)}
                      >
                        Unpublish
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon="eye"
                        state={isBusy ? "busy" : "idle"}
                        disabled={!mock.publish_ready}
                        title={!mock.publish_ready ? mock.publish_block_reason : "Publish this mock"}
                        onClick={() => publishMut.mutate(mock.id)}
                      >
                        Publish
                      </Button>
                    )}
                    <Link href={href} className={buttonClass({ variant: "ghost", size: "sm" })}>
                      Open editor →
                    </Link>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="trash"
                      aria-label={`Delete mock ${mock.title}`}
                      onClick={() => setPendingDelete(mock)}
                      className="text-ms-fg-3 hover:text-ms-critical-fg"
                    />
                  </>
                }
              />
            );
          })}
        </div>
      )}

      {/* Create form */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} labelledBy={createTitleId} width={480} locked={createMut.isPending}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) createMut.mutate();
          }}
        >
          <div className="flex flex-col gap-4 px-[22px] pb-2 pt-[22px]">
            <h2 id={createTitleId} className="text-[20px] font-bold leading-7 tracking-[-0.01em] text-ms-fg">
              New full mock
            </h2>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[220px] flex-1">
                <label htmlFor={`${createTitleId}-title`} className={FIELD_LABEL}>Mock title</label>
                <input
                  id={`${createTitleId}-title`}
                  data-autofocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. SAT Full Mock — April 2026"
                  className={CONTROL}
                />
              </div>
              <div className="w-32">
                <label htmlFor={`${createTitleId}-break`} className={FIELD_LABEL}>Break (min)</label>
                <input
                  id={`${createTitleId}-break`}
                  type="number"
                  min={0}
                  value={breakMinutes}
                  onChange={(e) => setBreakMinutes(Math.max(0, Number(e.target.value) || 0))}
                  className={CONTROL}
                />
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2 border-t border-ms-border bg-ms-surface px-5 py-3.5">
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={createMut.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" icon="plus" state={createMut.isPending ? "busy" : "idle"} disabled={!title.trim()}>
              Create mock
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        tone="critical"
        icon="trash"
        title="Delete full mock?"
        confirmLabel="Delete mock"
        onConfirm={confirmDelete}
      >
        {pendingDelete
          ? `“#${pendingDelete.id} · ${pendingDelete.title}” and all of its modules and questions will be permanently removed.`
          : null}
      </ConfirmDialog>
    </div>
  );
}
