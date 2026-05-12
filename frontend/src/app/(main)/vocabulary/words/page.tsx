"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { vocabularyApi } from "@/lib/api";

type VocabWord = {
  id: number;
  word: string;
  meaning: string;
  example: string;
  part_of_speech: string;
  difficulty: number;
  created_at: string;
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
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-primary">Vocabulary</p>
          <p className="mt-1 text-xl font-extrabold tracking-tight text-foreground">Word list</p>
          <p className="mt-1 text-sm text-muted-foreground">Search and preview words (learning happens in Daily).</p>
        </div>
        <Link
          href="/vocabulary/daily"
          className="inline-flex items-center justify-center rounded-xl border border-border bg-card px-4 py-2 text-sm font-bold hover:bg-surface-2"
        >
          Go to Daily
        </Link>
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by word or meaning…"
            className="ui-input w-full rounded-xl border border-border bg-surface-2/80 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void load(q.trim())}
            className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-bold hover:bg-surface-2"
          >
            Search
          </button>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        ) : words.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No matching words.</p>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {words.map((w) => (
              <div key={w.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <p className="text-lg font-extrabold text-foreground">{w.word}</p>
                <p className="mt-1 text-sm font-semibold text-muted-foreground">{w.meaning || "—"}</p>
                {w.example ? <p className="mt-2 text-sm text-muted-foreground">“{w.example}”</p> : null}
                <p className="mt-3 text-xs font-bold uppercase tracking-wider text-label-foreground">
                  {w.part_of_speech} · Difficulty {w.difficulty}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

