"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { vocabularyApi } from "@/lib/api";
import { Flashcard, type VocabWord } from "@/components/vocabulary/Flashcard";
import { QuizPractice } from "@/components/vocabulary/QuizPractice";
import { BookOpen, Flame, RefreshCcw, Target, Trophy } from "lucide-react";
import { Card, CardContent, Badge, Button, Stat, ProgressRing, Progress, EmptyState, SegmentedControl, Spinner, type Segment } from "@/components/ui";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DailyItem = { kind: "new"; word: VocabWord; progress: null } | { kind: "review"; word: VocabWord; progress: any };

type DailyPayload = {
  target: number;
  items: DailyItem[];
  stats: { total_learned: number; accuracy_percent: number; streak_days: number };
};

export default function VocabularyDailyPage() {
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<DailyPayload | null>(null);
  const [idx, setIdx] = useState(0);
  const [mode, setMode] = useState<"flashcards" | "quiz">("flashcards");
  const [submitting, setSubmitting] = useState(false);

  const items = useMemo(() => payload?.items ?? [], [payload]);
  const current = items[idx] ?? null;
  const pool = useMemo(() => items.map((x) => x.word), [items]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = (await vocabularyApi.getDaily({ target: 10 })) as DailyPayload;
      setPayload(data);
      setIdx(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const submit = async (result: "correct" | "wrong") => {
    if (!current) return;
    setSubmitting(true);
    try {
      await vocabularyApi.review({ word_id: current.word.id, result });
      setIdx((i) => Math.min(items.length, i + 1));
    } finally {
      setSubmitting(false);
    }
  };

  const done = idx >= items.length && items.length > 0;
  const progressPct = items.length > 0 ? Math.round((Math.min(idx, items.length) / items.length) * 100) : 0;

  const modeOpts: Segment<"flashcards" | "quiz">[] = [{ value: "flashcards", label: "Flashcards" }, { value: "quiz", label: "Practice quiz" }];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 pb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="ds-overline text-primary">Vocabulary</p>
          <h1 className="ds-h1 mt-1">Daily practice</h1>
          <p className="ds-small mt-1">Reviews first (spaced repetition), then new words. A little every day adds up.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/vocabulary/words"><Button variant="secondary">Browse words</Button></Link>
          <Button variant="secondary" leftIcon={<RefreshCcw />} onClick={() => void load()}>Refresh</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Words learned" value={payload?.stats.total_learned ?? "—"} icon={BookOpen} />
        <Stat label="Accuracy" value={`${payload?.stats.accuracy_percent ?? "—"}%`} icon={Target} />
        <Stat label="Streak" value={`${payload?.stats.streak_days ?? "—"}d`} icon={Flame} />
        <Card><CardContent className="flex items-center gap-4">
          <ProgressRing value={progressPct} size={48} strokeWidth={5} color={done ? "text-success" : "text-primary"} />
          <div><p className="ds-overline">Session</p><p className="ds-num text-xl font-extrabold text-foreground">{Math.min(idx, items.length)}/{items.length}</p></div>
        </CardContent></Card>
      </div>

      <SegmentedControl options={modeOpts} value={mode} onChange={setMode} />

      <Card>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12"><Spinner className="h-8 w-8 text-primary" /></div>
          ) : items.length === 0 ? (
            <EmptyState icon={BookOpen} title="No vocabulary words yet" description="Ask an admin to add words, then come back for your daily session." />
          ) : done ? (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-success-soft"><Trophy className="h-8 w-8 text-success" /></div>
              <h3 className="ds-h3">Session complete</h3>
              <p className="mt-2 text-sm text-muted-foreground">Come back tomorrow for new items and scheduled reviews.</p>
              <Button className="mt-6" variant="secondary" leftIcon={<RefreshCcw />} onClick={() => setIdx(0)}>Review again</Button>
            </div>
          ) : current ? (
            <div>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <p className="text-sm font-bold text-muted-foreground">Item {idx + 1} / {items.length}</p>
                  <Badge variant={current.kind === "review" ? "warning" : "primary"}>{current.kind === "review" ? "Review" : "New"}</Badge>
                </div>
                {submitting ? <p className="animate-pulse text-xs font-bold text-muted-foreground">Saving…</p> : null}
              </div>
              <Progress value={progressPct} tone={done ? "success" : "primary"} size="sm" className="mb-6" />
              {mode === "flashcards" ? (
                <Flashcard word={current.word} onCorrect={() => void submit("correct")} onWrong={() => void submit("wrong")} autoFocusActions />
              ) : (
                <QuizPractice word={current.word} pool={pool} onAnswer={(r) => void submit(r)} />
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
