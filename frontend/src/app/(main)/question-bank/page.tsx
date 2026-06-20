"use client";

import { useMemo, useState } from "react";
import { Database, Search, X, CheckCircle2, XCircle, Loader2 } from "lucide-react";

import { MathText } from "@/components/MathText";
import { useDebounce } from "@/hooks/useDebounce";
import {
  usePracticeAnswer,
  usePracticeList,
  usePracticeQuestion,
  usePracticeTaxonomy,
} from "@/domains/questionBankStudent/hooks";
import { resolveMedia, type PracticeFilters, type PracticeResult } from "@/domains/questionBankStudent/api";

const PAGE_SIZE = 30;
const SUBJECTS = ["ENGLISH", "MATH"] as const;
const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;

export default function StudentQuestionBankPage() {
  const [subject, setSubject] = useState("");
  const [domain, setDomain] = useState<number | "">("");
  const [skill, setSkill] = useState<number | "">("");
  const [difficulty, setDifficulty] = useState("");
  const [searchRaw, setSearchRaw] = useState("");
  const [offset, setOffset] = useState(0);
  const [practiceId, setPracticeId] = useState<number | null>(null);
  const search = useDebounce(searchRaw, 300);

  const taxonomy = usePracticeTaxonomy(subject || undefined);
  const filters: PracticeFilters = useMemo(
    () => ({
      subject: subject || undefined,
      domain: domain ? Number(domain) : undefined,
      skill: skill ? Number(skill) : undefined,
      difficulty: difficulty || undefined,
      search: search || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [subject, domain, skill, difficulty, search, offset],
  );
  const { data, isLoading, error } = usePracticeList(filters);
  const rows = data?.results ?? [];
  const count = data?.count ?? 0;
  const skills = (taxonomy.data?.skills ?? []).filter((s) => !domain || s.domain === Number(domain));

  function reset<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setOffset(0);
    };
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground">
          <Database className="h-5 w-5 text-primary" /> Question Bank
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Practice real SAT questions one at a time. Filter by topic and difficulty, answer, and see the
          explanation instantly.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchRaw}
            onChange={(e) => { setSearchRaw(e.target.value); setOffset(0); }}
            placeholder="Search questions…"
            className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>
        <select value={subject} onChange={(e) => { reset(setSubject)(e.target.value); setDomain(""); setSkill(""); }} className="rounded-xl border border-border bg-background px-3 py-2 text-sm font-bold text-foreground outline-none focus:border-primary">
          <option value="">All subjects</option>
          {SUBJECTS.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
        </select>
        <select value={domain} onChange={(e) => { reset<number | "">(setDomain)(e.target.value ? Number(e.target.value) : ""); setSkill(""); }} className="rounded-xl border border-border bg-background px-3 py-2 text-sm font-bold text-foreground outline-none focus:border-primary">
          <option value="">All domains</option>
          {(taxonomy.data?.domains ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={skill} disabled={!domain} onChange={(e) => reset<number | "">(setSkill)(e.target.value ? Number(e.target.value) : "")} className="rounded-xl border border-border bg-background px-3 py-2 text-sm font-bold text-foreground outline-none focus:border-primary disabled:opacity-50">
          <option value="">All skills</option>
          {skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={difficulty} onChange={(e) => reset(setDifficulty)(e.target.value)} className="rounded-xl border border-border bg-background px-3 py-2 text-sm font-bold text-foreground outline-none focus:border-primary">
          <option value="">Any difficulty</option>
          {DIFFICULTIES.map((d) => <option key={d} value={d}>{d.charAt(0) + d.slice(1).toLowerCase()}</option>)}
        </select>
      </div>

      {/* List */}
      {isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="py-10 text-center text-sm text-rose-600">Failed to load questions.</p>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No questions match these filters yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((q) => (
            <li key={q.id}>
              <button type="button" onClick={() => setPracticeId(q.id)} className="w-full rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-surface-2/50">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-bold">{q.subject}</span>
                  {q.domain_name ? <span>{q.domain_name}{q.skill_name ? ` › ${q.skill_name}` : ""}</span> : null}
                  {q.difficulty ? <span className="rounded-md bg-amber-100 px-1.5 py-0.5 font-bold text-amber-700">{q.difficulty}</span> : null}
                </div>
                <MathText text={q.question_text} className="line-clamp-2 text-sm text-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Pagination */}
      {count > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{count} questions</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} className="rounded-lg border border-border bg-card px-3 py-1.5 font-bold text-foreground disabled:opacity-40">Previous</button>
            <button type="button" disabled={offset + PAGE_SIZE >= count} onClick={() => setOffset(offset + PAGE_SIZE)} className="rounded-lg border border-border bg-card px-3 py-1.5 font-bold text-foreground disabled:opacity-40">Next</button>
          </div>
        </div>
      )}

      {practiceId != null && <PracticePanel id={practiceId} onClose={() => setPracticeId(null)} />}
    </div>
  );
}

function PracticePanel({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: q, isLoading } = usePracticeQuestion(id);
  const answerMut = usePracticeAnswer();
  const [selected, setSelected] = useState("");
  const [result, setResult] = useState<PracticeResult | null>(null);

  const isMC = !!q && q.choices.length > 0;

  async function submit() {
    if (!selected.trim()) return;
    try {
      const r = await answerMut.mutateAsync({ id, answer: selected });
      setResult(r);
    } catch {
      /* surfaced below via answerMut.isError */
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="text-sm font-bold text-foreground">{q ? q.qb_id : "Practice"}</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {isLoading || !q ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-4">
              {q.passage_text ? (
                <div className="rounded-xl border border-border bg-surface-2/50 p-4">
                  <MathText text={q.passage_text} className="text-sm leading-relaxed text-foreground" />
                </div>
              ) : null}
              {q.question_prompt ? <MathText text={q.question_prompt} className="text-sm font-semibold text-foreground" /> : null}
              <MathText text={q.question_text} className="text-base text-foreground" />
              {q.question_image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={resolveMedia(q.question_image)} alt="Question" className="max-h-72 rounded-lg border border-border" />
              ) : null}

              {isMC ? (
                <ul className="space-y-2">
                  {q.choices.map((c) => {
                    const isPicked = selected === c.id;
                    const correctId = result && typeof result.correct_answer === "string" ? result.correct_answer.toUpperCase() : null;
                    const showCorrect = !!result && correctId === c.id;
                    const showWrongPick = !!result && isPicked && !result.is_correct;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          disabled={!!result}
                          onClick={() => setSelected(c.id)}
                          className={
                            showCorrect
                              ? "flex w-full items-start gap-3 rounded-xl border border-emerald-400 bg-emerald-50 p-3 text-left"
                              : showWrongPick
                                ? "flex w-full items-start gap-3 rounded-xl border border-rose-400 bg-rose-50 p-3 text-left"
                                : isPicked
                                  ? "flex w-full items-start gap-3 rounded-xl border border-primary bg-primary/10 p-3 text-left"
                                  : "flex w-full items-start gap-3 rounded-xl border border-border bg-background p-3 text-left hover:bg-surface-2"
                          }
                        >
                          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-bold text-muted-foreground">{c.id}</span>
                          <div className="min-w-0">
                            {c.text ? <MathText text={c.text} className="text-sm text-foreground" /> : null}
                            {c.image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={resolveMedia(c.image)} alt={`Option ${c.id}`} className="mt-1 max-h-32 rounded border border-border" />
                            ) : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <input
                  value={selected}
                  disabled={!!result}
                  onChange={(e) => setSelected(e.target.value)}
                  placeholder="Type your answer"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                />
              )}

              {result ? (
                <div className={result.is_correct ? "rounded-xl border border-emerald-200 bg-emerald-50 p-4" : "rounded-xl border border-rose-200 bg-rose-50 p-4"}>
                  <p className={result.is_correct ? "flex items-center gap-1.5 text-sm font-bold text-emerald-800" : "flex items-center gap-1.5 text-sm font-bold text-rose-700"}>
                    {result.is_correct ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    {result.is_correct ? "Correct!" : `Not quite — correct answer: ${String(result.correct_answer)}`}
                  </p>
                  {result.explanation ? <MathText text={result.explanation} className="mt-2 text-sm text-foreground" /> : null}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border p-4">
          <button type="button" onClick={onClose} className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-bold text-muted-foreground hover:bg-surface-2">Close</button>
          {result ? (
            <button type="button" onClick={onClose} className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90">Done</button>
          ) : (
            <button type="button" disabled={!selected.trim() || answerMut.isPending} onClick={() => void submit()} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
              {answerMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Check answer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
