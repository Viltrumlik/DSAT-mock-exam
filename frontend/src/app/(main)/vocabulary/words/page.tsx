"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { vocabularyApi } from "@/lib/api";
import { BookOpen, Search } from "lucide-react";
import { Card, CardContent, Badge, Button, Input, EmptyState, Skeleton, type BadgeVariant } from "@/components/ui";

type VocabWord = {
  id: number;
  word: string;
  meaning: string;
  example: string;
  part_of_speech: string;
  difficulty: number;
  created_at: string;
};

// Higher difficulty = harder, not "bad" — non-red, positive/neutral tones.
const difficultyVariant = (d: number): BadgeVariant => (d <= 1 ? "success" : d <= 2 ? "warning" : "info");

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

  useEffect(() => { void load(""); }, []);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 pb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="ds-overline text-primary">Vocabulary</p>
          <h1 className="ds-h1 mt-1">Word list</h1>
          <p className="ds-small mt-1">Search and preview words — learning happens in Daily.</p>
        </div>
        <Link href="/vocabulary/daily"><Button leftIcon={<BookOpen />}>Go to Daily</Button></Link>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex-1">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void load(q.trim()); }}
            placeholder="Search by word or meaning…"
            leftIcon={<Search />}
          />
        </div>
        <Button variant="secondary" onClick={() => void load(q.trim())}>Search</Button>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>
      ) : words.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matching words"
          description="Try adjusting your search or ask an admin to add more vocabulary."
          action={q ? <Button variant="secondary" onClick={() => { setQ(""); void load(""); }}>Clear search</Button> : undefined}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {words.map((w) => (
            <Card key={w.id} variant="interactive">
              <CardContent>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="ds-h4">{w.word}</h3>
                  <Badge variant={difficultyVariant(w.difficulty)}>Lvl {w.difficulty}</Badge>
                </div>
                <p className="mt-1.5 text-sm font-semibold text-muted-foreground">{w.meaning || "—"}</p>
                {w.example ? <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-sm italic text-muted-foreground">&ldquo;{w.example}&rdquo;</p> : null}
                <p className="ds-overline mt-3">{w.part_of_speech}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
