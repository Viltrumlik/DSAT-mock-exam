import { useState, type CSSProperties, type ReactNode } from "react";
import {
  AlertTriangle,
  BookOpen,
  Calculator,
  Calendar,
  ChevronRight,
  Eye,
  Globe,
  Lock,
  LogOut,
  Play,
  PlayCircle,
  RefreshCw,
} from "lucide-react";

import { Alert } from "@/components/ui/Alert";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/lib/useAuth";
import { useResource } from "@/lib/useResource";
import { loadPastpapers, me, myMidterms } from "@/lib/api";
import { native } from "@/lib/native";
import {
  bucketMidterms,
  collectionLabel,
  isRW,
  midtermStatus,
  paperAction,
  sectionTitle,
  subjectLabel,
  type CardState,
  type MidtermCardKind,
  type MidtermRow,
  type PastpaperSection,
} from "@/lib/model";

/**
 * "Your tests" — the app's home, rebuilt on quartz. Midterms (locked down) as rich rows grouped
 * by when they can be sat, then past papers as a booklet-card grid grouped by month — the same
 * two surfaces the website shows, in the app's own material (a white quartz block with a hairline
 * edge, squircle corners and a lift on hover).
 *
 * The timed exam itself is the next phase (the fresh native runner); for now the actionable
 * buttons say so rather than opening a half-built runner or stranding a real attempt.
 */

const BRAND = "#2a68c0"; // primary — Reading & Writing / US accent
const TEAL = "#0d9488"; // Mathematics / International accent

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
  const midtermGroups = (
    [
      { label: "Available now", kind: "available", rows: buckets.available },
      { label: "Scheduled", kind: "scheduled", rows: buckets.scheduled },
      { label: "Past", kind: "past", rows: buckets.past },
      { label: "Missed", kind: "missed", rows: buckets.missed },
    ] as { label: string; kind: MidtermCardKind; rows: MidtermRow[] }[]
  ).filter((g) => g.rows.length > 0);

  const first = profile.data?.first_name?.trim();

  return (
    <div className="ds-app flex min-h-screen flex-col bg-surface-2 text-foreground">
      {/* Frame: logo + wordmark left, student + sign-out right. */}
      <header className="flex items-center justify-between border-b border-border bg-card px-8 py-3.5">
        <div className="flex items-center gap-2.5">
          <img src="/logo.png" alt="" className="h-8 w-8 object-contain" />
          <span className="text-lg font-extrabold tracking-tight">MasterSAT</span>
        </div>
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
        <div className="mx-auto max-w-5xl px-8 py-10">
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-muted-foreground/70">Your tests</p>
          <h1 className="mt-1.5 text-[34px] font-extrabold leading-tight tracking-tight text-foreground">
            {first ? `Welcome back, ${first}` : "Your tests"}
          </h1>

          {notice ? (
            <div className="mt-5">
              <Alert tone="info" title={notice} onClose={() => setNotice(null)} />
            </div>
          ) : null}

          {/* ── Midterms ───────────────────────────────────────────── */}
          <SectionHeader
            title="Midterms"
            hint="Each runs locked down — the app closes everything else until you finish."
          />
          {midterms.error ? (
            <LoadFailed onRetry={midterms.refetch} />
          ) : midterms.loading ? (
            <SkeletonRows />
          ) : midtermGroups.length === 0 ? (
            <Empty>No midterms yet. When your teacher assigns one, it appears here.</Empty>
          ) : (
            <div className="flex flex-col gap-7">
              {midtermGroups.map((g) => (
                <div key={g.kind}>
                  <GroupLabel>{g.label}</GroupLabel>
                  <div className="flex flex-col gap-3">
                    {g.rows.map((m) => (
                      <MidtermRowCard key={`${m.midterm_id}-${g.kind}`} m={m} kind={g.kind} onStart={comingSoon} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Past papers ────────────────────────────────────────── */}
          <SectionHeader title="Practice: past papers" hint="Full SAT sections, timed like test day." className="mt-14" />
          {papers.error ? (
            <LoadFailed onRetry={papers.refetch} />
          ) : papers.loading ? (
            <SkeletonCards />
          ) : (papers.data ?? []).length === 0 ? (
            <Empty>No past papers are available yet.</Empty>
          ) : (
            <div className="flex flex-col gap-8">
              {(papers.data ?? []).map((group) => (
                <div key={group.name}>
                  <GroupLabel>{group.name}</GroupLabel>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-4">
                    {group.items.map((row) => (
                      <BookletCard key={row.section.id} section={row.section} state={row.state} onOpen={comingSoon} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {version.data?.version ? (
        <footer className="px-8 py-3 text-xs font-medium text-muted-foreground/60">
          MasterSAT for Windows {version.data.version}
        </footer>
      ) : null}
    </div>
  );
}

// ─────────────────────────── midterm row ───────────────────────────

const MIDTERM_BADGE: Record<MidtermCardKind, { label: string; color: string; bg: string }> = {
  available: { label: "Available", color: BRAND, bg: "rgba(42,104,192,.1)" },
  scheduled: { label: "Scheduled", color: "#64748b", bg: "rgba(100,116,139,.12)" },
  past: { label: "Completed", color: "#059669", bg: "rgba(5,150,105,.12)" },
  missed: { label: "Missed", color: "#dc2626", bg: "rgba(220,38,38,.1)" },
};

function MidtermRowCard({ m, kind, onStart }: { m: MidtermRow; kind: MidtermCardKind; onStart: () => void }) {
  const s = midtermStatus(m, kind);
  const badge = MIDTERM_BADGE[kind];
  const math = !isRW(m.subject);
  const accent = math ? TEAL : BRAND;
  const Icon = math ? Calculator : BookOpen;
  const meta = [subjectLabel(m.subject), `${m.duration_minutes} min`, m.question_count ? `${m.question_count} questions` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="quartz squircle flex items-center gap-4 p-4 pr-5" style={sq(18)}>
      <div
        className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
        style={{ background: `color-mix(in srgb, ${accent} 12%, transparent)`, color: accent }}
      >
        <Icon className="h-[22px] w-[22px]" />
        <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-card text-muted-foreground shadow-[0_0_0_1px_rgba(15,23,42,.08)]">
          <Lock className="h-3 w-3" aria-label="Locked down" />
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[15px] font-extrabold text-foreground">{m.title}</p>
          <Badge color={badge.color} bg={badge.bg}>
            {badge.label}
          </Badge>
        </div>
        <p className="mt-0.5 truncate text-[13px] font-semibold text-muted-foreground">{meta}</p>
      </div>

      {kind === "available" ? (
        <ActionButton onClick={onStart} tone={accent} icon={s.label === "Resume" ? <PlayCircle /> : <Play />}>
          {s.label === "Resume" ? "Resume" : "Start"}
        </ActionButton>
      ) : kind === "past" && m.results_visible && m.score != null ? (
        <div className="shrink-0 text-right leading-none">
          <span className="text-[22px] font-extrabold text-foreground">{m.score}</span>
          <span className="text-[13px] font-semibold text-muted-foreground"> / {m.score_ceiling}</span>
        </div>
      ) : (
        <span className="max-w-[46%] shrink-0 text-right text-[13px] font-semibold text-muted-foreground">{s.label}</span>
      )}
    </div>
  );
}

// ─────────────────────────── booklet card ───────────────────────────

const PAPER_STATUS: Record<CardState["status"], { label: string; color: string; bg: string; dot: string }> = {
  new: { label: "Not started", color: "#64748b", bg: "rgba(100,116,139,.1)", dot: "#94a3b8" },
  progress: { label: "In progress", color: "#d97706", bg: "rgba(217,119,6,.12)", dot: "#d97706" },
  reopened: { label: "Assigned again", color: BRAND, bg: "rgba(42,104,192,.1)", dot: BRAND },
  completed: { label: "Completed", color: "#059669", bg: "rgba(5,150,105,.12)", dot: "#059669" },
};

function BookletCard({ section, state, onOpen }: { section: PastpaperSection; state: CardState; onOpen: () => void }) {
  const isUS = section.form_type === "US";
  const rw = isRW(section.subject);
  const subjAccent = rw ? BRAND : TEAL;
  const SubjIcon = rw ? BookOpen : Calculator;
  const status = PAPER_STATUS[state.status];
  const a = paperAction(state);
  const spine = state.status === "completed" ? "#059669" : state.status === "progress" ? "#d97706" : isUS ? BRAND : TEAL;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="quartz squircle quartz-float group relative flex cursor-pointer flex-col overflow-hidden text-left"
      style={sq(20)}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ background: spine }} />
      <div className="flex flex-1 flex-col p-5 pl-7">
        <div className="flex items-center justify-between gap-2">
          <Badge color={status.color} bg={status.bg} dot={status.dot}>
            {status.label}
          </Badge>
          <Badge color={isUS ? BRAND : TEAL} bg={isUS ? "rgba(42,104,192,.1)" : "rgba(13,148,136,.12)"}>
            <Globe className="h-3 w-3" /> {isUS ? "US" : "International"}
          </Badge>
        </div>

        <div className="mt-3">
          <Badge color={subjAccent} bg={rw ? "rgba(42,104,192,.1)" : "rgba(13,148,136,.12)"}>
            <SubjIcon className="h-3 w-3" /> {subjectLabel(section.subject)}
          </Badge>
        </div>

        <p className="mt-3 line-clamp-1 text-[17px] font-extrabold tracking-tight text-foreground">
          {sectionTitle(section)}
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" /> {collectionLabel(section)}
        </p>

        <div className="my-4 h-px bg-border" />

        {state.status === "completed" || (state.status === "reopened" && state.score != null) ? (
          <div className="mb-3">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground/70">
              {state.status === "completed" ? "Your score" : "Last score"}
            </p>
            <p className="mt-0.5 flex items-baseline gap-1.5">
              <span className="text-[30px] font-extrabold leading-none tracking-tight text-foreground">{state.score ?? "—"}</span>
              <span className="text-sm font-bold text-muted-foreground/70">/ 800</span>
            </p>
          </div>
        ) : null}

        <div className="mt-auto">
          <ActionButton
            onClick={onOpen}
            full
            tone={a.finished ? "transparent" : state.status === "progress" ? "#d97706" : BRAND}
            outline={a.finished}
            icon={a.finished ? <Eye /> : state.status === "progress" ? <PlayCircle /> : <Play />}
          >
            {a.label}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── shared pieces ───────────────────────────

function sq(px: number): CSSProperties {
  return { "--sq": `${px}px` } as CSSProperties;
}

function SectionHeader({ title, hint, className = "" }: { title: string; hint?: string; className?: string }) {
  return (
    <div className={`mb-5 mt-12 ${className}`}>
      <h2 className="text-xl font-extrabold tracking-tight text-foreground">{title}</h2>
      {hint ? <p className="mt-1 text-sm font-medium text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <span className="text-[12px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground">{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function Badge({
  children,
  color,
  bg,
  dot,
}: {
  children: ReactNode;
  color: string;
  bg: string;
  dot?: string;
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-extrabold"
      style={{ color, background: bg }}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} /> : null}
      {children}
    </span>
  );
}

function ActionButton({
  children,
  onClick,
  tone,
  icon,
  full,
  outline,
}: {
  children: ReactNode;
  onClick: () => void;
  tone: string;
  icon?: ReactNode;
  full?: boolean;
  outline?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`ds-ring inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl text-[13px] font-extrabold transition active:scale-[0.98] ${
        full ? "w-full py-2.5" : "px-4 py-2"
      } ${outline ? "border border-border text-foreground hover:bg-surface-2" : "text-white hover:brightness-[1.06]"}`}
      style={outline ? undefined : { background: tone }}
    >
      {icon ? <span className="[&_svg]:h-4 [&_svg]:w-4">{icon}</span> : null}
      {children}
      {!full && !outline ? <ChevronRight className="h-4 w-4" /> : null}
    </button>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="quartz squircle px-5 py-6 text-sm font-medium text-muted-foreground" style={sq(18)}>
      {children}
    </p>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  // A failed fetch is never shown as "nothing here" — the student would think they have no tests.
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-danger/30 bg-danger-soft px-5 py-4 text-sm font-semibold text-danger">
      <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
      <span className="flex-1">This list couldn’t be loaded. Check your internet connection.</span>
      <button type="button" onClick={onRetry} className="ds-ring inline-flex items-center gap-1.5 rounded-md font-bold hover:underline">
        <RefreshCw className="h-4 w-4" aria-hidden /> Try again
      </button>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="quartz squircle flex items-center gap-4 p-4" style={sq(18)}>
          <div className="h-12 w-12 shrink-0 animate-pulse rounded-2xl bg-surface-2" />
          <div className="flex-1">
            <div className="h-3.5 w-1/3 animate-pulse rounded bg-surface-2" />
            <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-surface-2" />
          </div>
          <Spinner className="h-5 w-5 text-muted-foreground/60" />
        </div>
      ))}
    </div>
  );
}

function SkeletonCards() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="quartz squircle h-[230px] animate-pulse" style={sq(20)} />
      ))}
    </div>
  );
}
