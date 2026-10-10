import { useState } from "react";
import { AlertTriangle, ChevronRight, Lock, LogOut, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { useAuth } from "@/lib/useAuth";
import { useResource } from "@/lib/useResource";
import { loadPastpapers, me, myMidterms } from "@/lib/api";
import { native } from "@/lib/native";
import {
  bucketMidterms,
  midtermStatus,
  paperAction,
  sectionTitle,
  subjectLabel,
  type MidtermCardKind,
  type MidtermRow,
} from "@/lib/model";

/**
 * "Your tests" — the app's home. Midterms first (they run locked down), then past papers to
 * practise on. Ported from the website's features/desktop (DesktopHome + homeModel), restyled
 * to the native app's design tokens so it reads as one product with the sign-in screen.
 *
 * The timed exam itself is the next phase (the fresh native runner); for now the actionable
 * buttons say so rather than opening a half-built runner or stranding a real attempt.
 */
export function YourTests() {
  const { signOut } = useAuth();
  const profile = useResource(me);
  const version = useResource(() => native.appInfo());
  const midterms = useResource(myMidterms, { intervalMs: 30_000 });
  const papers = useResource(loadPastpapers);
  const [notice, setNotice] = useState<string | null>(null);

  const comingSoon = () =>
    setNotice("The timed exam opens in the next app update. Your sign-in and test list are ready now.");

  const buckets = bucketMidterms(midterms.data ?? []);
  const midtermCards: { m: MidtermRow; kind: MidtermCardKind }[] = [
    ...buckets.available.map((m) => ({ m, kind: "available" as const })),
    ...buckets.scheduled.map((m) => ({ m, kind: "scheduled" as const })),
    ...buckets.past.map((m) => ({ m, kind: "past" as const })),
    ...buckets.missed.map((m) => ({ m, kind: "missed" as const })),
  ];

  const first = profile.data?.first_name?.trim();

  return (
    <div className="ds-app flex min-h-screen flex-col bg-background text-foreground">
      {/* Frame: wordmark left, student + sign-out right. */}
      <header className="flex items-center justify-between border-b border-border bg-card px-8 py-4">
        <span className="text-xl font-extrabold tracking-tight">MasterSAT</span>
        <div className="flex items-center gap-5 text-sm font-semibold">
          {first ? <span className="text-muted-foreground">{first}</span> : null}
          <button
            type="button"
            onClick={signOut}
            className="ds-ring inline-flex items-center gap-1.5 rounded-md text-muted-foreground transition hover:text-foreground"
          >
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-4xl px-8 py-10">
          <h1 className="text-[32px] font-extrabold tracking-tight text-foreground">
            {first ? `Welcome, ${first}` : "Your tests"}
          </h1>

          {notice ? (
            <div className="mt-5">
              <Alert tone="info" title={notice} />
            </div>
          ) : null}

          <Section
            title="Midterms"
            hint="Midterms run locked down: the app closes everything else until you finish."
          >
            {midterms.error ? (
              <LoadFailed onRetry={midterms.refetch} />
            ) : midterms.loading ? (
              <Empty>Loading your midterms…</Empty>
            ) : midtermCards.length === 0 ? (
              <Empty>No midterms yet. When your teacher gives you one, it appears here.</Empty>
            ) : (
              <ul className="overflow-hidden rounded-2xl border border-border bg-card">
                {midtermCards.map(({ m, kind }) => {
                  const s = midtermStatus(m, kind);
                  const meta = [subjectLabel(m.subject), `${m.duration_minutes} min`, m.question_count ? `${m.question_count} questions` : null]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <Row
                      key={`${m.midterm_id}-${kind}`}
                      title={m.title}
                      meta={meta}
                      locked
                      status={s.actionable ? undefined : s.label}
                      action={s.actionable ? s.label : undefined}
                      onAction={s.actionable ? comingSoon : undefined}
                    />
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="Practice: past papers" hint="Full SAT sections, timed like test day.">
            {papers.error ? (
              <LoadFailed onRetry={papers.refetch} />
            ) : papers.loading ? (
              <Empty>Loading past papers…</Empty>
            ) : (papers.data ?? []).length === 0 ? (
              <Empty>No past papers are available yet.</Empty>
            ) : (
              (papers.data ?? []).map((group) => (
                <div key={group.name} className="mb-6">
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{group.name}</h3>
                  <ul className="overflow-hidden rounded-2xl border border-border bg-card">
                    {group.items.map((row) => {
                      const a = paperAction(row.state);
                      return (
                        <Row
                          key={row.section.id}
                          title={sectionTitle(row.section)}
                          meta={subjectLabel(row.section.subject)}
                          status={a.finished && row.state.score != null ? `Score ${row.state.score}` : undefined}
                          action={a.label}
                          onAction={comingSoon}
                        />
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </Section>
        </div>
      </main>

      {version.data?.version ? (
        <footer className="px-8 py-3 text-xs font-medium text-muted-foreground/70">
          MasterSAT for Windows {version.data.version}
        </footer>
      ) : null}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-bold tracking-tight text-foreground">{title}</h2>
      {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  // A failed fetch is never shown as "nothing here" — the student would think they have no tests.
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-danger/30 bg-danger-soft px-5 py-4 text-sm font-semibold text-danger">
      <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
      <span className="flex-1">This list could not be loaded. Check your internet connection.</span>
      <button type="button" onClick={onRetry} className="ds-ring inline-flex items-center gap-1.5 rounded-md font-bold hover:underline">
        <RefreshCw className="h-4 w-4" aria-hidden /> Try again
      </button>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-border px-5 py-6 text-sm text-muted-foreground">{children}</p>;
}

function Row({
  title,
  meta,
  status,
  action,
  onAction,
  locked,
}: {
  title: string;
  meta: string;
  status?: string;
  action?: string;
  onAction?: () => void;
  locked?: boolean;
}) {
  return (
    <li className="flex items-center gap-4 border-b border-border px-5 py-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-base font-bold text-foreground">
          {locked ? <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Taken locked down" /> : null}
          {title}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">{meta}</p>
      </div>
      {status ? <span className="shrink-0 text-sm font-semibold text-muted-foreground">{status}</span> : null}
      {action && onAction ? (
        <Button
          type="button"
          size="sm"
          onClick={onAction}
          rightIcon={<ChevronRight />}
          className="!rounded-full !bg-[#2a68c0] px-5 hover:!bg-[#21539e]"
        >
          {action}
        </Button>
      ) : null}
    </li>
  );
}
