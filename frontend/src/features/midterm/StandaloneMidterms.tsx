"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, ArrowRight, ArrowLeft, UserPlus, Loader2 } from "lucide-react";
import { StudentMultiSelect } from "@/components/access/StudentMultiSelect";
import { midtermApi, subjectLabel } from "@/lib/midtermApi";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";

/**
 * Standalone teacher "Midterms" area: a list of midterms; open one to grant access to
 * individual students and see their Results. Instructor = the granting teacher; NO class
 * ranking (that is the classroom flavor, inside a classroom). Backed by /api/midterms/teacher.
 */

const stateLabel: Record<string, string> = {
  NOT_STARTED: "Not started",
  MODULE_1_ACTIVE: "In progress",
  ACTIVE: "In progress",
  SCORING: "Scoring",
  COMPLETED: "Completed",
};

export function StandaloneMidtermsList() {
  const { data, isLoading } = useQuery({ queryKey: ["midterm", "catalog"], queryFn: midtermApi.catalog });
  const items = data ?? [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-extrabold text-foreground">Midterms</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Give a midterm to individual students and review their results. Each student is auto-graded
        and issued a certificate on submit.
      </p>

      <div className="mt-6 space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            No published midterms yet. Create one in the Builder.
          </p>
        ) : (
          items.map((m) => (
            <Link
              key={m.id}
              href={`/teacher/midterms/${m.id}`}
              className="flex items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 transition hover:border-primary/40"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted-foreground">
                <FileText className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-extrabold text-foreground">{m.title}</p>
                <p className="mt-0.5 text-[13px] font-semibold text-muted-foreground">
                  {subjectLabel(m.subject)} · {m.duration_minutes}m · {m.question_count} questions · /{m.score_ceiling}
                </p>
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

export function StandaloneMidtermDetail({ midtermId }: { midtermId: number }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["midterm", "standalone-results", midtermId],
    queryFn: () => midtermApi.standaloneResults(midtermId),
  });
  const [picked, setPicked] = useState<number[]>([]);

  const grant = useMutation({
    mutationFn: () => midtermApi.grant(midtermId, picked),
    onSuccess: () => {
      pushGlobalToast({ tone: "success", message: `Access granted to ${picked.length} student(s).` });
      setPicked([]);
      qc.invalidateQueries({ queryKey: ["midterm", "standalone-results", midtermId] });
    },
    onError: (e) => pushGlobalToast({ tone: "error", message: normalizeApiError(e).message }),
  });

  const revoke = useMutation({
    mutationFn: (userId: number) => midtermApi.revoke(midtermId, [userId]),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["midterm", "standalone-results", midtermId] }),
    onError: (e) => pushGlobalToast({ tone: "error", message: normalizeApiError(e).message }),
  });

  const midterm = data?.midterm;
  const students = data?.students ?? [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/teacher/midterms" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> All midterms
      </Link>

      <h1 className="mt-3 text-2xl font-extrabold text-foreground">{midterm?.title ?? "Midterm"}</h1>
      {midterm && (
        <p className="mt-1 text-sm text-muted-foreground">
          {subjectLabel(midterm.subject)} · {midterm.duration_minutes}m · /{midterm.score_ceiling}
        </p>
      )}

      {/* Grant access */}
      <section className="mt-6 rounded-2xl border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <UserPlus className="h-4 w-4" /> Give access to students
        </h2>
        <div className="mt-3">
          {/* Standalone = individual students only, no classroom (that's the classroom flavor). */}
          <StudentMultiSelect value={picked} onChange={setPicked} showClassroomFilter={false} />
        </div>
        <button
          onClick={() => grant.mutate()}
          disabled={picked.length === 0 || grant.isPending}
          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {grant.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Grant access
        </button>
      </section>

      {/* Results */}
      <section className="mt-6 rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-bold text-foreground">Results</h2>
        {isLoading ? (
          <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
        ) : students.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No students have access yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2">Student</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2 text-right">Score</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.student_id} className="border-t border-border">
                    <td className="py-2.5 font-semibold text-foreground">{s.student_name}</td>
                    <td className="py-2.5 text-muted-foreground">{stateLabel[s.state] ?? s.state}</td>
                    <td className="py-2.5 text-right font-bold text-foreground">
                      {s.submitted ? `${s.score} / ${s.score_ceiling}` : "—"}
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        onClick={() => revoke.mutate(s.student_id)}
                        disabled={revoke.isPending}
                        className="text-xs font-semibold text-muted-foreground hover:text-destructive disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
