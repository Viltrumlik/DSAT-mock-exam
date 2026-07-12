"use client";

/**
 * /teacher/assessments — teachers browse every assessment they can access and
 * open any of them in a student-style practice runner (see ./[setId]/practice).
 * Read-only: the list is the admin set library (GET /assessments/admin/sets/).
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { assessmentsAdminApi } from "@/lib/api";
import { BookOpen, Calculator, ClipboardCheck, Loader2, Play, Search } from "lucide-react";

type SetRow = {
  id: number;
  title?: string | null;
  subject?: string | null;
  level?: string | null;
  category?: string | null;
  description?: string | null;
  is_active?: boolean;
  question_count?: number | null;
  questions?: unknown[] | null;
};

function coerceList(data: unknown): SetRow[] {
  if (Array.isArray(data)) return data as SetRow[];
  const d = data as Record<string, unknown> | null;
  for (const k of ["results", "items", "sets", "data"]) {
    if (d && Array.isArray(d[k])) return d[k] as SetRow[];
  }
  return [];
}

function subjectMeta(subject?: string | null): { label: string; isMath: boolean } {
  const s = (subject || "").toLowerCase();
  if (s === "math") return { label: "Math", isMath: true };
  if (s === "english" || s === "reading_writing") return { label: "English", isMath: false };
  return { label: subject || "General", isMath: false };
}

export default function TeacherAssessmentsPage() {
  const router = useRouter();
  const [sets, setSets] = useState<SetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState<"ALL" | "math" | "english">("ALL");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await assessmentsAdminApi.adminListSets({ limit: 500 });
        if (!cancelled) setSets(coerceList(data));
      } catch {
        if (!cancelled) setError("Could not load assessments.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sets.filter((s) => {
      const subj = (s.subject || "").toLowerCase();
      if (subject === "math" && subj !== "math") return false;
      if (subject === "english" && subj !== "english" && subj !== "reading_writing") return false;
      if (q) {
        const blob = `${s.title ?? ""} ${s.category ?? ""} ${s.description ?? ""} ${subjectMeta(s.subject).label} ${s.level ?? ""}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [sets, query, subject]);

  return (
    <AuthGuard>
      <div className="mx-auto w-full max-w-6xl space-y-5">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground">
            <ClipboardCheck className="h-5 w-5 text-primary" /> Assessments
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every assessment you can access. Open any one to solve it yourself in the same view your students see —
            nothing is saved, it&apos;s just for practice.
          </p>
        </div>

        {!loading && !error && sets.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-md">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search assessments…"
                aria-label="Search assessments"
                className="w-full rounded-xl border border-border bg-card py-2.5 pl-10 pr-3 text-sm font-medium text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div className="inline-flex gap-1 rounded-xl border border-border bg-surface-2 p-1">
              {([["ALL", "All"], ["math", "Math"], ["english", "English"]] as const).map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setSubject(v)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                    subject === v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>
        ) : null}

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : sets.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
            No assessments are available to you yet.
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground">
            No assessments match your search.
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
            {filtered.map((s) => {
              const sm = subjectMeta(s.subject);
              const count = s.question_count ?? s.questions?.length ?? null;
              return (
                <div key={s.id} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
                  <div className="flex flex-1 flex-col gap-2 p-5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${sm.isMath ? "bg-primary/10 text-primary" : "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300"}`}>
                        {sm.isMath ? <Calculator className="h-3 w-3" /> : <BookOpen className="h-3 w-3" />} {sm.label}
                      </span>
                      {s.level ? (
                        <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{s.level}</span>
                      ) : null}
                      {!s.is_active ? (
                        <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Draft</span>
                      ) : null}
                    </div>
                    <h3 className="line-clamp-2 text-[15px] font-extrabold leading-snug text-foreground">{s.title || "Untitled assessment"}</h3>
                    {s.category ? <p className="text-xs text-muted-foreground">{s.category}</p> : null}
                    {count != null ? <p className="mt-auto text-xs text-muted-foreground">{count} question{count !== 1 ? "s" : ""}</p> : null}
                  </div>
                  <div className="border-t border-border bg-surface-2/40 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => router.push(`/teacher/assessments/${s.id}/practice`)}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      <Play className="h-4 w-4" /> Practice
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
