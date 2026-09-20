"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { classesApi } from "@/lib/api";
import { crInputClass } from "@/components/classroom";
import HomeworkFilePreviewTile from "@/components/classroom/HomeworkFilePreviewTile";
import { fileNameFromUrl } from "@/lib/homeworkFileDisplay";
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardCheck, Loader2, RotateCcw, Trophy, User } from "lucide-react";
import { useAuthCriticalGate } from "@/hooks/useAuthCriticalGate";
import { capabilitiesFor } from "@/features/classroom/capabilities";

type Member = {
  role: string;
  user: { id: number; email?: string; first_name?: string; last_name?: string };
};

function studentLabel(u: Member["user"]) {
  const n = `${u.first_name || ""} ${u.last_name || ""}`.trim();
  return n || u.email || `User #${u.id}`;
}

function isTurnedIn(status: string | undefined) {
  return status === "SUBMITTED" || status === "REVIEWED";
}

export type HomeworkGradingAssignmentViewProps = {
  basePath: string;
  classId: number;
  assignmentId: number;
};

export default function HomeworkGradingAssignmentView({
  basePath,
  classId,
  assignmentId,
}: HomeworkGradingAssignmentViewProps) {
  const { assertCriticalAuth, criticalAuthReady } = useAuthCriticalGate();
  const hubHref = basePath.replace(/\/$/, "");

  const [loading, setLoading] = useState(true);
  /**
   * Why the page did not load: a request failed, or the user's role cannot grade. It takes the lists'
   * place — drawn from no data, they would say nothing was turned in.
   */
  const [error, setError] = useState<string | null>(null);
  /** `error` came from a request that failed, so trying again may work. A retry never turns a refusal round. */
  const [loadFailed, setLoadFailed] = useState(false);
  /** A failed save or return. Everything else on the page is still true, so it stays on screen. */
  const [actionError, setActionError] = useState<string | null>(null);
  const [className, setClassName] = useState("");
  const [assignmentTitle, setAssignmentTitle] = useState("");
  const [assignmentLocksFileUpload, setAssignmentLocksFileUpload] = useState(false);
  const [people, setPeople] = useState<Member[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  const [gradeDraft, setGradeDraft] = useState({ grade: "", feedback: "" });
  const [returnNote, setReturnNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoadFailed(false);
    setLoading(true);
    try {
      const cls = await classesApi.get(classId);
      // The server grades on `can_grade`: the whole teaching team (OWNER, TEACHER, TA and the
      // legacy ADMIN), not the ADMIN role alone.
      if (!capabilitiesFor(cls?.my_role).canGrade) {
        setError("Only class teachers can grade this homework.");
        setLoading(false);
        return;
      }
      setClassName(cls?.name || `Class #${classId}`);

      const assigns = await classesApi.listAssignments(classId);
      const list = assigns.items;
      const a = list.find((x) => Number(x.id) === assignmentId);
      setAssignmentTitle(a?.title ? String(a.title) : `Assignment #${assignmentId}`);
      setAssignmentLocksFileUpload(Boolean(a?.locks_file_upload));

      const [subs, plist] = await Promise.all([
        classesApi.listSubmissions(classId, assignmentId),
        classesApi.people(classId),
      ]);
      setSubmissions(Array.isArray(subs) ? subs : []);
      setPeople(Array.isArray(plist) ? plist : []);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "Could not load assignment.");
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [classId, assignmentId]);

  useEffect(() => {
    if (!Number.isFinite(classId) || !Number.isFinite(assignmentId)) return;
    load();
  }, [classId, assignmentId, load]);

  const byUserId = useMemo(() => {
    const m = new Map<number, any>();
    for (const s of submissions) {
      const uid = s.student?.id ?? s.student_id;
      if (typeof uid === "number") m.set(uid, s);
    }
    return m;
  }, [submissions]);

  const { turnedIn, notTurnedIn } = useMemo(() => {
    const students = people.filter((p) => p.role === "STUDENT");
    const ti: { user: Member["user"]; sub: any }[] = [];
    const nt: { user: Member["user"]; sub: any | null }[] = [];
    for (const m of students) {
      const uid = m.user.id;
      const sub = byUserId.get(uid) ?? null;
      const st = sub?.status as string | undefined;
      if (isTurnedIn(st)) {
        ti.push({ user: m.user, sub });
      } else {
        nt.push({ user: m.user, sub });
      }
    }
    const sortUser = (a: { user: Member["user"] }, b: { user: Member["user"] }) =>
      studentLabel(a.user).localeCompare(studentLabel(b.user));
    ti.sort(sortUser);
    nt.sort(sortUser);
    return { turnedIn: ti, notTurnedIn: nt };
  }, [people, byUserId]);

  const selectedSub = useMemo(() => {
    if (selectedUserId == null) return null;
    return byUserId.get(selectedUserId) ?? null;
  }, [selectedUserId, byUserId]);

  useEffect(() => {
    if (!selectedSub) {
      setGradeDraft({ grade: "", feedback: "" });
      setReturnNote("");
      return;
    }
    const r = selectedSub.review;
    setGradeDraft({
      grade: r?.grade != null ? String(r.grade) : "",
      feedback: typeof r?.feedback === "string" ? r.feedback : "",
    });
    setReturnNote("");
  }, [selectedSub?.id, selectedSub?.revision, selectedSub]);

  const saveGrade = async () => {
    if (!selectedSub?.id) return;
    if (!assertCriticalAuth()) {
      return;
    }
    setSaving(true);
    setActionError(null);
    setSuccess(null);
    try {
      await classesApi.gradeSubmission(Number(selectedSub.id), {
        grade: gradeDraft.grade === "" ? null : gradeDraft.grade,
        feedback: gradeDraft.feedback ?? "",
        ...(typeof selectedSub.revision === "number" ? { expected_revision: selectedSub.revision } : {}),
      });
      setSuccess("Review saved.");
      window.setTimeout(() => setSuccess(null), 4000);
      await load();
    } catch (e: unknown) {
      const ax = e as { response?: { status?: number; data?: { detail?: string } } };
      if (ax.response?.status === 409) {
        setActionError("Submission changed. Refreshed.");
        await load();
        return;
      }
      const d = ax.response?.data?.detail;
      setActionError(typeof d === "string" ? d : "Could not save grade.");
    } finally {
      setSaving(false);
    }
  };

  const doReturn = async () => {
    if (!selectedSub?.id) return;
    if (!assertCriticalAuth()) {
      return;
    }
    setSaving(true);
    setActionError(null);
    setSuccess(null);
    try {
      await classesApi.returnSubmission(Number(selectedSub.id), {
        ...(returnNote.trim() ? { note: returnNote.trim() } : {}),
        ...(typeof selectedSub.revision === "number" ? { expected_revision: selectedSub.revision } : {}),
      });
      setSuccess("Returned to student for revision.");
      window.setTimeout(() => setSuccess(null), 4000);
      await load();
    } catch (e: unknown) {
      const ax = e as { response?: { status?: number; data?: { detail?: string } } };
      if (ax.response?.status === 409) {
        setActionError("Submission changed. Refreshed.");
        await load();
        return;
      }
      const d = ax.response?.data?.detail;
      setActionError(typeof d === "string" ? d : "Could not return.");
    } finally {
      setSaving(false);
    }
  };

  const canGrade =
    selectedSub && (selectedSub.status === "SUBMITTED" || selectedSub.status === "REVIEWED");
  const canReturn = canGrade;

  if (!Number.isFinite(classId) || !Number.isFinite(assignmentId)) {
    return <p className="p-8 text-muted-foreground">Invalid link.</p>;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link
          href={hubHref}
          className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          All homework
        </Link>
        <span className="text-muted-foreground">/</span>
        {/* The teacher route, not `/classes/…`. This view is mounted only under
            /teacher/homework/grading, and teacher.mastersat.uz bounces every path outside
            /teacher back to the portal — so the student link sent a teacher to their own
            dashboard and looked, from the outside, like a page that had lost the class. */}
        <Link
          href={`/teacher/classrooms/${classId}/assignments/${assignmentId}`}
          className="text-sm font-semibold text-primary hover:underline"
        >
          Open in class
        </Link>
      </div>

      <div className="mb-8">
        <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Grading</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-foreground md:text-3xl">{assignmentTitle}</h1>
        <p className="mt-2 text-muted-foreground">
          <span className="font-semibold text-foreground/90">{className}</span>
        </p>

        {/* Teacher attention summary — only shown after load */}
        {!loading && !error && (turnedIn.length > 0 || notTurnedIn.length > 0) && (() => {
          const unreviewed = turnedIn.filter(({ sub }) => sub?.status === "SUBMITTED").length;
          const noneIn = turnedIn.length === 0 && notTurnedIn.length > 0;
          const allDone = unreviewed === 0 && turnedIn.length > 0 && notTurnedIn.length === 0;
          if (allDone) return (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <p className="text-sm font-semibold text-emerald-800">All submitted and reviewed. Nothing outstanding.</p>
            </div>
          );
          if (noneIn) return (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <p className="text-sm font-semibold text-amber-800">No submissions yet. Consider sending a reminder.</p>
            </div>
          );
          if (unreviewed > 0) return (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5">
              <ClipboardCheck className="h-4 w-4 text-primary shrink-0" />
              <p className="text-sm font-semibold text-foreground">
                {unreviewed} submission{unreviewed === 1 ? "" : "s"} waiting for your review
                {notTurnedIn.length > 0 ? ` · ${notTurnedIn.length} not yet submitted` : ""}
              </p>
            </div>
          );
          return null;
        })()}
      </div>

      {/* A 409 reloads the page. If that reload fails, "Refreshed." is no longer true. */}
      {actionError && !error ? (
        <div role="alert" className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {actionError}
        </div>
      ) : null}
      {success ? (
        <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
          {success}
        </div>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          <p>{error}</p>
          {loadFailed ? (
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-red-300 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-100"
            >
              <RotateCcw className="h-4 w-4" />
              Try again
            </button>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-5">
            <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
                <ClipboardCheck className="h-4 w-4" />
                Submitted ({turnedIn.length})
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">Ready to review and grade.</p>
              <ul className="mt-3 max-h-[min(40vh,320px)] space-y-1 overflow-y-auto">
                {turnedIn.length === 0 ? (
                  <li className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted-foreground">No submissions yet.</li>
                ) : (
                  turnedIn.map(({ user, sub }) => (
                    <li key={user.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedUserId(user.id)}
                        className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                          selectedUserId === user.id
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-transparent hover:bg-surface-2"
                        }`}
                      >
                        <User className="h-4 w-4 shrink-0 opacity-70" />
                        <span className="min-w-0 flex-1 truncate">{studentLabel(user)}</span>
                        {sub?.status === "REVIEWED" ? (
                          <Trophy className="h-4 w-4 shrink-0 text-amber-600" aria-label="Reviewed" />
                        ) : null}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </section>

            <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                Not submitted ({notTurnedIn.length})
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">Draft, returned for revision, or no work yet.</p>
              <ul className="mt-3 max-h-[min(40vh,280px)] space-y-1 overflow-y-auto">
                {notTurnedIn.length === 0 ? (
                  <li className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted-foreground">Everyone turned work in.</li>
                ) : (
                  notTurnedIn.map(({ user, sub }) => (
                    <li key={user.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedUserId(user.id)}
                        className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                          selectedUserId === user.id
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-transparent hover:bg-surface-2"
                        }`}
                      >
                        <User className="h-4 w-4 shrink-0 opacity-70" />
                        <span className="min-w-0 flex-1 truncate">{studentLabel(user)}</span>
                        <span className="shrink-0 text-[10px] font-bold uppercase text-muted-foreground">
                          {sub?.status || "—"}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </section>
          </div>

          <div className="lg:col-span-7">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
              {selectedUserId == null ? (
                <p className="text-sm text-muted-foreground">Select a student to view uploads, test results, and grading.</p>
              ) : !selectedSub ? (
                <div>
                  <p className="text-lg font-bold text-foreground">
                    {studentLabel(people.find((p) => p.user.id === selectedUserId)?.user || { id: selectedUserId })}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">No submission record for this assignment yet.</p>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
                    <div>
                      <p className="text-lg font-bold text-foreground">
                        {studentLabel(
                          selectedSub.student || people.find((p) => p.user.id === selectedUserId)?.user || { id: selectedUserId },
                        )}
                      </p>
                      <p className="mt-1 text-sm font-medium text-muted-foreground">Status: {selectedSub.status}</p>
                    </div>
                  </div>

                  <div className="mt-5">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Uploaded files</h3>
                    {(Array.isArray(selectedSub.files) ? selectedSub.files : []).length === 0 ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        {assignmentLocksFileUpload
                          ? "No extra files — student may rely on assigned test completion only."
                          : "No files uploaded."}
                      </p>
                    ) : (
                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {(selectedSub.files as { id: number; url: string; file_name?: string; file_type?: string }[]).map((f) => {
                          const label = (f.file_name || fileNameFromUrl(f.url) || "File").trim() || "File";
                          return (
                            <HomeworkFilePreviewTile
                              key={f.id}
                              name={label}
                              remoteUrl={f.url}
                              href={f.url}
                              fileType={f.file_type}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="mt-6">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Pastpaper / practice test</h3>
                    {selectedSub.attempt == null ? (
                      <p className="mt-2 text-sm text-muted-foreground">No linked test attempt.</p>
                    ) : (
                      <div className="mt-2 rounded-xl border border-border bg-surface-2/80 px-4 py-3 text-sm">
                        <p className="font-semibold text-foreground">
                          {(selectedSub.attempt as { practice_test_name?: string }).practice_test_name || "Practice test"}
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          Attempt #{(selectedSub.attempt as { id?: number }).id}
                          {(selectedSub.attempt as { is_completed?: boolean }).is_completed ? " · Completed" : " · In progress"}
                          {(selectedSub.attempt as { score?: number | null }).score != null ? (
                            <span className="font-bold text-foreground">
                              {" "}
                              · Score {(selectedSub.attempt as { score?: number | null }).score}
                            </span>
                          ) : null}
                        </p>
                      </div>
                    )}
                  </div>

                  {canGrade ? (
                    <div className="mt-8 space-y-4 border-t border-border pt-6">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Grade & feedback</h3>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground">Score / grade</label>
                          <input
                            className={`${crInputClass} mt-1 w-full`}
                            value={gradeDraft.grade}
                            onChange={(e) => setGradeDraft((p) => ({ ...p, grade: e.target.value }))}
                            placeholder="e.g. 95"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="text-xs font-semibold text-muted-foreground">Feedback</label>
                          <textarea
                            className={`${crInputClass} mt-1 min-h-[96px] w-full resize-y`}
                            value={gradeDraft.feedback}
                            onChange={(e) => setGradeDraft((p) => ({ ...p, feedback: e.target.value }))}
                            placeholder="Comments for the student"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={saving || !criticalAuthReady}
                        onClick={() => void saveGrade()}
                        className="ms-btn-primary ms-cta-fill inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold sm:w-auto"
                      >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Save review
                      </button>

                      {canReturn ? (
                        <div className="rounded-xl border border-violet-200/80 bg-violet-50/50 p-4 dark:border-violet-900/40 dark:bg-violet-950/20">
                          <p className="text-xs font-bold uppercase tracking-wide text-violet-900 dark:text-violet-200">
                            Return for revision
                          </p>
                          <textarea
                            className={`${crInputClass} mt-2 min-h-[72px] w-full resize-y`}
                            value={returnNote}
                            onChange={(e) => setReturnNote(e.target.value)}
                            placeholder="Optional note shown to the student"
                          />
                          <button
                            type="button"
                            disabled={saving || !criticalAuthReady}
                            onClick={() => void doReturn()}
                            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-violet-300 bg-card px-4 py-2.5 text-sm font-bold text-violet-900 hover:bg-violet-100/80 dark:border-violet-800 dark:text-violet-100 dark:hover:bg-violet-900/40 sm:w-auto"
                          >
                            <RotateCcw className="h-4 w-4" />
                            Return to student
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-8 text-sm text-muted-foreground">
                      Grading is available after the student submits homework (status SUBMITTED or REVIEWED).
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
