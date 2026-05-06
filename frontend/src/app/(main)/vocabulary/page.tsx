import Link from "next/link";
import { ArrowRight, BookOpen, CalendarDays } from "lucide-react";

export default function VocabularyHubPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-ds-gold">Vocabulary</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-foreground">Build SAT-ready word power</h1>
        <p className="mt-3 max-w-2xl text-base text-muted-foreground">
          Practice daily with spaced repetition, or browse and search the word bank—everything stays in sync with your
          progress.
        </p>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Link
          href="/vocabulary/daily"
          className="group relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card to-primary/5 p-8 shadow-sm transition-all hover:border-primary/35 hover:shadow-md"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/12 ring-1 ring-primary/20">
            <CalendarDays className="h-6 w-6 text-primary" />
          </div>
          <h2 className="mt-6 text-xl font-extrabold text-foreground">Daily practice</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Reviews first, then new words—short sessions that compound into retention.
          </p>
          <span className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-primary">
            Start session
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>

        <Link
          href="/vocabulary/words"
          className="group relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card to-amber-500/5 p-8 shadow-sm transition-all hover:border-amber-500/25 hover:shadow-md"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 ring-1 ring-amber-500/20">
            <BookOpen className="h-6 w-6 text-amber-700 dark:text-amber-400" />
          </div>
          <h2 className="mt-6 text-xl font-extrabold text-foreground">Word list</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Search and preview definitions and examples—perfect before mocks and drills.
          </p>
          <span className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-300">
            Browse words
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      </div>
    </div>
  );
}
