"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { vocabularyApi } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { BookOpen, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";

type VocabWord = {
  id: number;
  word: string;
  meaning: string;
  example: string;
  part_of_speech: string;
  difficulty: number;
  created_at: string;
};

const difficultyColor = (d: number) => {
  if (d <= 1) return "text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/40";
  if (d <= 2) return "text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/40";
  return "text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-950/40";
};

export default function VocabularyWordsPage() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [words, setWords] = useState<VocabWord[]>([]);

  const load = async (query: string) => {
    setLoading(true);
    try {
      const data = (await vocabularyApi.listWords({ q: query || undefined })) as VocabWord[];
      setWords(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load("");
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 lg:px-6">

      {/* ═══ Header ══════════════════════════════════════════════════════ */}
      <PageHeader
        eyebrow="Vocabulary"
        title="Word List"
        description="Search and preview words — learning happens in Daily."
        actions={
          <Link
            href="/vocabulary/daily"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <BookOpen className="h-4 w-4" />
            Go to Daily
          </Link>
        }
      />

      {/* ═══ Search ═════════════════════════════════════════════════════ */}
      <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="group relative flex-1">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void load(q.trim()); }}
            placeholder="Search by word or meaning…"
            className="w-full rounded-xl border border-border bg-card py-2.5 pl-11 pr-10 text-sm font-medium shadow-sm outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
          />
          {q && (
            <button
              type="button"
              onClick={() => { setQ(""); void load(""); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load(q.trim())}
          className="rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
        >
          Search
        </button>
      </div>

      {/* ═══ Words Grid ════════════════════════════════════════════════ */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : words.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matching words"
          description="Try adjusting your search or ask an admin to add more vocabulary."
          action={
            q ? (
              <button
                type="button"
                onClick={() => { setQ(""); void load(""); }}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground"
              >
                Clear search
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {words.map((w) => (
            <div
              key={w.id}
              className="group rounded-2xl border border-border bg-card p-5 shadow-sm transition-all hover:border-primary/20 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-lg font-extrabold text-foreground group-hover:text-primary transition-colors">
                  {w.word}
                </h3>
                <span className={cn(
                  "shrink-0 rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                  difficultyColor(w.difficulty),
                )}>
                  Lvl {w.difficulty}
                </span>
              </div>
              <p className="mt-1.5 text-sm font-semibold text-muted-foreground">{w.meaning || "—"}</p>
              {w.example && (
                <p className="mt-3 rounded-xl bg-surface-2/60 px-3 py-2 text-sm italic text-muted-foreground">
                  &ldquo;{w.example}&rdquo;
                </p>
              )}
              <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                {w.part_of_speech}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
