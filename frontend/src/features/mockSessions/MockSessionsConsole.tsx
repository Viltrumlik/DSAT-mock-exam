"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronLeft,
  CirclePlay,
  Loader2,
  Plus,
  RefreshCw,
  Square,
  XCircle,
} from "lucide-react";
import { mockSessionsApi, type MockSession, type MockSessionParticipant } from "./api";
import { mocksAdminApi } from "@/features/mocksAdmin/api";
import { useToast } from "@/components/ToastProvider";
import { useMe } from "@/hooks/useMe";

/**
 * The invigilated-sitting console — one component for both audiences.
 *
 * An ADMIN creates the sitting and owns its code; a TEACHER runs the room on the day. The
 * server enforces that split; this hides what a teacher would be refused so they are never
 * offered a button that 403s.
 *
 * The participant list polls while a room is live. There is no push transport available on
 * this deployment (the SSE endpoint holds a synchronous worker per client, of which there
 * are three), so a small poll is the honest way to keep a queue current.
 */

function parseError(e: unknown): string {
  const data = (e as { response?: { data?: unknown } })?.response?.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.detail === "string") return d.detail;
  }
  return (e as { message?: string })?.message || "Something went wrong.";
}

const STATUS_TONE: Record<string, string> = {
  OPEN: "bg-blue-50 text-blue-700 border-blue-200",
  STARTED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ENDED: "bg-slate-100 text-slate-600 border-slate-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

function Pill({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${tone ?? "border-border text-muted-foreground"}`}>
      {children}
    </span>
  );
}

export default function MockSessionsConsole() {
  const [openId, setOpenId] = useState<number | null>(null);
  return openId == null ? (
    <SessionList onOpen={setOpenId} />
  ) : (
    <SessionRoom sessionId={openId} onBack={() => setOpenId(null)} />
  );
}

// ── list + create ────────────────────────────────────────────────────────────

function SessionList({ onOpen }: { onOpen: (id: number) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useMe();
  const role = String((me as { role?: string } | undefined)?.role ?? "").toLowerCase();
  const canCreate = role !== "teacher";

  const { data: sessions, isLoading } = useQuery({
    queryKey: ["mock-sessions", "list"],
    queryFn: mockSessionsApi.list,
  });
  const { data: mocks } = useQuery({
    queryKey: ["mocks", "admin", "list"],
    queryFn: mocksAdminApi.listMocks,
    enabled: canCreate,
  });

  const publishedMocks = useMemo(() => (mocks ?? []).filter((m) => m.is_published), [mocks]);
  const [mockId, setMockId] = useState<number | "">("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState("");

  const create = useMutation({
    mutationFn: () =>
      mockSessionsApi.create({ mock: Number(mockId), session_date: date, title: title.trim() }),
    onSuccess: (s) => {
      toast.push({ message: `Sitting created. Code ${s.access_code}`, tone: "success" });
      setTitle("");
      void qc.invalidateQueries({ queryKey: ["mock-sessions", "list"] });
    },
    onError: (e) => toast.push({ message: parseError(e), tone: "error" }),
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-foreground">Mock sittings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          An invigilated full mock: students enter the code, you let them in, and the paper opens
          for everyone at once. Fullscreen is enforced and leaving the screen is policed.
        </p>
      </div>

      {canCreate && (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <p className="text-sm font-bold text-foreground">New sitting</p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Mock</label>
              <select
                value={mockId}
                onChange={(e) => setMockId(e.target.value ? Number(e.target.value) : "")}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">Choose a published mock…</option>
                {publishedMocks.map((m) => (
                  <option key={m.id} value={m.id}>{m.title}</option>
                ))}
              </select>
              {publishedMocks.length === 0 && (
                <p className="mt-1 text-[11px] text-amber-700">Publish a mock first — an unpublished one cannot be sat.</p>
              )}
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 rounded-xl border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="min-w-[180px] flex-1">
              <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Label (optional)</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Saturday morning"
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={() => create.mutate()}
              disabled={!mockId || !date || create.isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create &amp; get code
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            The code works on that date only, so yesterday&apos;s slip of paper can&apos;t open today&apos;s room.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (sessions ?? []).length === 0 ? (
          <p className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            No sittings yet.
          </p>
        ) : (
          (sessions ?? []).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onOpen(s.id)}
              className="flex w-full items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-extrabold text-foreground">{s.title || s.mock_title}</p>
                  <Pill tone={STATUS_TONE[s.status]}>{s.status}</Pill>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {s.session_date} · {s.mock_title} · {s.counts.pending} waiting · {s.counts.approved} approved
                  {s.counts.seated > 0 ? ` · ${s.counts.seated} sitting` : ""}
                </p>
              </div>
              <span className="shrink-0 font-mono text-lg font-extrabold tracking-[0.2em] text-foreground">
                {s.access_code}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ── one room ─────────────────────────────────────────────────────────────────

function SessionRoom({ sessionId, onBack }: { sessionId: number; onBack: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useMe();
  const role = String((me as { role?: string } | undefined)?.role ?? "").toLowerCase();
  const isAdmin = role !== "teacher";

  const { data: session } = useQuery({
    queryKey: ["mock-sessions", sessionId],
    queryFn: () => mockSessionsApi.get(sessionId),
  });
  const { data: people, refetch } = useQuery({
    queryKey: ["mock-sessions", sessionId, "participants"],
    queryFn: () => mockSessionsApi.participants(sessionId),
  });

  // Keep the queue current while the room is live — students are typing the code right now,
  // and a teacher watching a stale list would leave someone standing outside.
  const live = session?.status === "OPEN" || session?.status === "STARTED";
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => {
      void refetch();
      void qc.invalidateQueries({ queryKey: ["mock-sessions", sessionId] });
    }, 5000);
    return () => clearInterval(t);
  }, [live, refetch, qc, sessionId]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["mock-sessions", sessionId] });
    void qc.invalidateQueries({ queryKey: ["mock-sessions", sessionId, "participants"] });
    void qc.invalidateQueries({ queryKey: ["mock-sessions", "list"] });
  };

  const decide = useMutation({
    mutationFn: ({ ids, approve }: { ids: number[]; approve: boolean }) =>
      mockSessionsApi.decide(sessionId, ids, approve),
    onSuccess: invalidate,
    onError: (e) => toast.push({ message: parseError(e), tone: "error" }),
  });
  const start = useMutation({
    mutationFn: () => mockSessionsApi.start(sessionId),
    onSuccess: (r) => {
      toast.push({ message: `Started. ${r.seated} student(s) are now sitting.`, tone: "success" });
      invalidate();
    },
    onError: (e) => toast.push({ message: parseError(e), tone: "error" }),
  });
  const end = useMutation({
    mutationFn: () => mockSessionsApi.end(sessionId),
    onSuccess: (r) => {
      toast.push({ message: `Closed. ${r.drained} paper(s) taken in and scored.`, tone: "success" });
      invalidate();
    },
    onError: (e) => toast.push({ message: parseError(e), tone: "error" }),
  });
  const rotate = useMutation({
    mutationFn: () => mockSessionsApi.rotateCode(sessionId),
    onSuccess: () => {
      toast.push({ message: "New code issued. The old one no longer works.", tone: "success" });
      invalidate();
    },
    onError: (e) => toast.push({ message: parseError(e), tone: "error" }),
  });

  const rows = people ?? [];
  const pending = rows.filter((p) => p.status === "PENDING");
  const approved = rows.filter((p) => p.status === "APPROVED");

  if (!session) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> All sittings
      </button>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-extrabold text-foreground">{session.title || session.mock_title}</h2>
              <Pill tone={STATUS_TONE[session.status]}>{session.status}</Pill>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {session.mock_title} · {session.session_date}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Code</p>
            <p className="font-mono text-3xl font-extrabold tracking-[0.25em] text-foreground">{session.access_code}</p>
            {isAdmin && session.status === "OPEN" && (
              <button
                onClick={() => rotate.mutate()}
                disabled={rotate.isPending}
                className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="h-3 w-3" /> New code
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {session.status !== "ENDED" && session.status !== "CANCELLED" && (
            <button
              onClick={() => start.mutate()}
              disabled={start.isPending || approved.length === 0}
              title={approved.length === 0 ? "Approve at least one student first" : "Open the paper for everyone approved"}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {start.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CirclePlay className="h-4 w-4" />}
              {session.status === "STARTED" ? "Seat newly approved" : "Start for everyone"}
            </button>
          )}
          {session.status === "STARTED" && (
            <button
              onClick={() => end.mutate()}
              disabled={end.isPending}
              className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              {end.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
              End &amp; collect papers
            </button>
          )}
        </div>
        {session.status === "STARTED" && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Everyone started at the same instant, so every student has the identical deadline.
            Ending the sitting takes in and scores every unfinished paper.
          </p>
        )}
      </div>

      {pending.length > 0 && (
        <Queue
          title={`Waiting to be let in (${pending.length})`}
          rows={pending}
          actions={(p) => (
            <div className="flex shrink-0 gap-1.5">
              <button
                onClick={() => decide.mutate({ ids: [p.id], approve: true })}
                className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Let in
              </button>
              <button
                onClick={() => decide.mutate({ ids: [p.id], approve: false })}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-bold text-muted-foreground hover:bg-muted"
              >
                <XCircle className="h-3.5 w-3.5" /> Refuse
              </button>
            </div>
          )}
          bulk={
            <button
              onClick={() => decide.mutate({ ids: pending.map((p) => p.id), approve: true })}
              disabled={decide.isPending}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Let all {pending.length} in
            </button>
          }
        />
      )}

      <Queue
        title={`In the room (${approved.length})`}
        rows={approved}
        empty="Nobody has been let in yet."
        actions={(p) => (
          <span className="shrink-0 text-[11px] font-bold text-muted-foreground">
            {p.attempt_state ? p.attempt_state.replace(/_/g, " ") : "not seated"}
          </span>
        )}
      />
    </div>
  );
}

function Queue({
  title,
  rows,
  actions,
  bulk,
  empty,
}: {
  title: string;
  rows: MockSessionParticipant[];
  actions: (p: MockSessionParticipant) => React.ReactNode;
  bulk?: React.ReactNode;
  empty?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-foreground">{title}</p>
        {bulk}
      </div>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">{empty ?? "Nobody yet."}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                {p.student_details?.name || p.student_details?.username || `#${p.student}`}
              </span>
              {actions(p)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
