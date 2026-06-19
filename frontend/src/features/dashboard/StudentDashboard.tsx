"use client";

/**
 * Student dashboard — a 1:1 implementation of the provided design mockup
 * (~/Downloads/MasterSAT Dashboard.html). The mockup's exact palette, spacing,
 * typography and animations are reproduced via inline styles bound to scoped
 * `--dz-*` tokens + the `.dzboard` keyframe/hover classes in globals.css, wired
 * to real data (useDashboardData + useStudentSchedule). Dark mode is handled by
 * the `.dark .dzboard` token overrides (next-themes).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Target,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  GraduationCap,
  Users,
  ClipboardList,
  FileText,
} from "lucide-react";
import { Button, Card, CardContent, Skeleton } from "@/components/ui";
import type { ScheduleEvent } from "@/lib/api";
import { useDashboardData, type DashboardModel } from "./useDashboardData";
import { gridRange, isoDate, useStudentSchedule } from "./useStudentSchedule";

const GOAL_OPTIONS = [1400, 1500, 1550, 1600];
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export function StudentDashboard({ previewModel }: { previewModel?: DashboardModel }) {
  const live = useDashboardData();
  const router = useRouter();

  const status = previewModel ? "ready" : live.status;
  const model = previewModel ?? live.model;

  if (status === "booting") return <DashboardSkeleton />;

  if (status === "unauthenticated" || !model) {
    return (
      <div className="mx-auto max-w-md py-16">
        <Card>
          <CardContent className="flex flex-col items-center py-10 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <GraduationCap className="h-8 w-8" />
            </div>
            <h1 className="ds-h2">Welcome to MasterSAT</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in to track your progress, resume tests, and see your analytics.
            </p>
            <Button className="mt-6" fullWidth onClick={() => router.push("/login")}>
              Sign in
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <DashboardBody model={model} live={live} isPreview={!!previewModel} />;
}

function DashboardBody({
  model,
  live,
  isPreview,
}: {
  model: DashboardModel;
  live: ReturnType<typeof useDashboardData>;
  isPreview: boolean;
}) {
  const target = model.target ?? 1500;
  const english = Math.round(target / 20) * 10;
  const math = target - english;

  return (
    <div className="dzboard" style={{ maxWidth: 1280, width: "100%", margin: "0 auto" }}>
      <div className="dz-content">
        {/* Header row */}
        <HeaderRow
          name={model.firstName}
          target={target}
          saving={live.savingGoal}
          onSave={async (v) => { if (!isPreview) await live.saveGoal(v); }}
        />

        {/* Score + countdown */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
            alignItems: "stretch",
            marginBottom: 22,
          }}
          className="dz-scoregrid"
        >
          <TargetScoresCard overall={model.target} english={model.target != null ? english : null} math={model.target != null ? math : null} />
          <CountdownCard daysToGo={model.examDaysLeft} examDate={model.examDate} />
        </div>

        {/* Calendar + right column */}
        <ScheduleSection />
      </div>
    </div>
  );
}

/* ── Header ──────────────────────────────────────────────────────────────── */
function HeaderRow({
  name,
  target,
  saving,
  onSave,
}: {
  name: string;
  target: number;
  saving: boolean;
  onSave: (v: number) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 24,
        flexWrap: "wrap",
        marginBottom: 26,
      }}
    >
      <div style={{ flex: 1, minWidth: 280 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 42,
            lineHeight: 1.05,
            fontWeight: 800,
            letterSpacing: "-.03em",
            color: "var(--dz-ink)",
          }}
        >
          Welcome back, {name}
        </h1>
      </div>
      <div ref={wrapRef} style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="dz-updatebtn"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "13px 18px",
            borderRadius: 13,
            border: "1px solid var(--dz-border)",
            background: "var(--dz-panel)",
            fontFamily: "inherit",
            fontSize: 15,
            fontWeight: 700,
            color: "var(--dz-ink)",
            cursor: "pointer",
          }}
        >
          <span style={{ color: "var(--dz-indigo)", display: "flex" }}>
            <Target size={18} />
          </span>{" "}
          Update goal
        </button>

        {open ? (
          <div
            className="dz-floatup"
            style={{
              position: "absolute",
              top: 60,
              right: 0,
              zIndex: 20,
              width: 300,
              background: "var(--dz-panel)",
              border: "1px solid var(--dz-border)",
              borderRadius: 18,
              boxShadow: "0 24px 60px rgba(15,23,41,.18)",
              padding: 18,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".04em", color: "var(--dz-ink)", marginBottom: 4 }}>
              Set your target score
            </div>
            <div style={{ fontSize: 13, color: "var(--dz-mute)", marginBottom: 14 }}>SAT total, out of 1600.</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {GOAL_OPTIONS.map((g) => {
                const active = g === target;
                return (
                  <button
                    key={g}
                    type="button"
                    disabled={saving}
                    onClick={async () => { await onSave(g); setOpen(false); }}
                    className="dz-goalopt"
                    style={{
                      padding: "13px 0",
                      borderRadius: 12,
                      border: active ? "1px solid var(--dz-indigo)" : "1px solid var(--dz-border)",
                      background: active ? "var(--dz-indigo-soft)" : "var(--dz-panel)",
                      color: active ? "var(--dz-indigo)" : "var(--dz-ink)",
                      fontFamily: "inherit",
                      fontSize: 16,
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    {g}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── Target scores ───────────────────────────────────────────────────────── */
function TargetScoresCard({ overall, english, math }: { overall: number | null; english: number | null; math: number | null }) {
  return (
    <div
      className="dz-lift"
      style={{
        background: "var(--dz-card)",
        border: "1px solid var(--dz-border)",
        borderRadius: 24,
        padding: "30px 34px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 22 }}>
        <span
          style={{
            width: 42,
            height: 42,
            borderRadius: 12,
            background: "var(--dz-indigo-soft)",
            color: "var(--dz-indigo)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Target size={20} />
        </span>
        <div>
          <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-.01em", color: "var(--dz-ink)" }}>Target scores</div>
          <div style={{ fontSize: 13, color: "var(--dz-mute)", fontWeight: 500 }}>Where you&apos;re aiming on test day</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <ScoreBox label="OVERALL" value={overall} primary />
        <ScoreBox label="ENGLISH" value={english} />
        <ScoreBox label="MATH" value={math} />
      </div>
    </div>
  );
}

function ScoreBox({ label, value, primary }: { label: string; value: number | null; primary?: boolean }) {
  return (
    <div
      className={primary ? "dz-scorebox dz-scorebox-p" : "dz-scorebox"}
      style={{
        flex: 1,
        minWidth: 80,
        background: primary ? "var(--dz-indigo-soft)" : "var(--dz-panel)",
        border: primary ? "1px solid var(--dz-indigo)" : "1px solid var(--dz-border)",
        borderRadius: 17,
        padding: "18px 20px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: ".12em",
          color: primary ? "var(--dz-indigo)" : "var(--dz-faint)",
          opacity: primary ? 0.85 : 1,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 33,
          fontWeight: 800,
          letterSpacing: "-.03em",
          color: primary ? "var(--dz-indigo)" : "var(--dz-ink)",
          lineHeight: 1,
          marginTop: 9,
        }}
      >
        {value ?? "—"}
      </div>
    </div>
  );
}

/* ── Countdown ───────────────────────────────────────────────────────────── */
function CountdownCard({ daysToGo, examDate }: { daysToGo: number | null; examDate: string | null }) {
  const label = examDate
    ? new Date(examDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "Set your exam date";
  return (
    <div
      className="dz-countdown"
      style={{
        background: "var(--dz-indigo-deep)",
        borderRadius: 24,
        padding: 28,
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        className="dz-orb"
        style={{ position: "absolute", right: -40, top: -40, width: 160, height: 160, borderRadius: "50%", background: "rgba(255,255,255,.08)" }}
      />
      <div
        className="dz-orb-rev"
        style={{ position: "absolute", left: -30, bottom: -50, width: 130, height: 130, borderRadius: "50%", background: "rgba(255,255,255,.05)" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, fontWeight: 800, letterSpacing: ".14em", opacity: 0.85, position: "relative" }}>
        <CalendarDays size={16} /> SAT COUNTDOWN
      </div>
      <div style={{ marginTop: "auto", position: "relative" }}>
        <div style={{ fontSize: 74, fontWeight: 800, lineHeight: 0.95, letterSpacing: "-.04em" }}>
          {daysToGo == null ? "—" : Math.max(0, daysToGo)}
        </div>
        <div style={{ fontSize: 18, fontWeight: 600, opacity: 0.9, marginTop: 2 }}>days to go</div>
        <div style={{ fontSize: 14, fontWeight: 600, opacity: 0.65, marginTop: 14 }}>{label}</div>
      </div>
    </div>
  );
}

/* ── Schedule (calendar + right column) ──────────────────────────────────── */
function ScheduleSection() {
  const today = useMemo(() => new Date(), []);
  const [viewY, setViewY] = useState(today.getFullYear());
  const [viewM, setViewM] = useState(today.getMonth());
  const [selected, setSelected] = useState<string | null>(null);

  const { byDate, nextLessonDate } = useStudentSchedule(viewY, viewM);

  useEffect(() => {
    if (selected == null && nextLessonDate) setSelected(nextLessonDate);
  }, [selected, nextLessonDate]);

  const monthLabel = new Date(viewY, viewM, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const todayIso = isoDate(today);

  const cells = useMemo(() => {
    const { start } = gridRange(viewY, viewM);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const iso = isoDate(d);
      const events = byDate.get(iso) ?? [];
      return {
        iso,
        day: d.getDate(),
        inMonth: d.getMonth() === viewM,
        isToday: iso === todayIso,
        isSelected: iso === selected,
        isNext: iso === nextLessonDate,
        hasMock: events.some((e) => e.type === "mock" || e.type === "midterm"),
        hasClass: events.some((e) => e.type === "class"),
        hasAssignment: events.some((e) => e.type === "assignment"),
      };
    });
  }, [viewY, viewM, byDate, todayIso, selected, nextLessonDate]);

  const prevMonth = () => setViewM((m) => { if (m === 0) { setViewY((y) => y - 1); return 11; } return m - 1; });
  const nextMonth = () => setViewM((m) => { if (m === 11) { setViewY((y) => y + 1); return 0; } return m + 1; });

  const nextEvents = nextLessonDate ? (byDate.get(nextLessonDate) ?? []) : [];
  const selEvents = selected ? (byDate.get(selected) ?? []) : [];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 20, alignItems: "start" }} className="dz-calgrid">
      {/* Calendar */}
      <div
        className="dz-rise"
        style={{ background: "var(--dz-panel)", border: "1px solid var(--dz-border)", borderRadius: 24, padding: "24px 26px" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <span style={{ color: "var(--dz-indigo)", display: "flex" }}>
            <CalendarRange size={22} />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-.01em", color: "var(--dz-ink)" }}>Lesson calendar</div>
            <div style={{ fontSize: 13, color: "var(--dz-mute)", fontWeight: 500 }}>Tap a day to see what&apos;s on</div>
          </div>
          <CalNavButton dir="l" onClick={prevMonth} />
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--dz-ink)", minWidth: 128, textAlign: "center" }}>{monthLabel}</div>
          <CalNavButton dir="r" onClick={nextMonth} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6, marginBottom: 6 }}>
          {WEEKDAYS.map((wd) => (
            <div key={wd} style={{ textAlign: "center", fontSize: 11, fontWeight: 800, letterSpacing: ".08em", color: "var(--dz-faint)", padding: "4px 0" }}>
              {wd}
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6 }}>
          {cells.map((c) => (
            <DayCell key={c.iso} c={c} onClick={() => c.inMonth && setSelected(c.iso)} />
          ))}
        </div>

        <Legend />
      </div>

      {/* Right column */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <NextLessonCard date={nextLessonDate} event={nextEvents[0] ?? null} />
        <SelectedDayCard selected={selected} events={selEvents} />
      </div>
    </div>
  );
}

function CalNavButton({ dir, onClick }: { dir: "l" | "r"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir === "l" ? "Previous month" : "Next month"}
      className={`dz-navbtn ${dir === "l" ? "dz-navbtn-l" : "dz-navbtn-r"}`}
      style={{
        width: 38,
        height: 38,
        borderRadius: 10,
        border: "1px solid var(--dz-border)",
        background: "var(--dz-panel)",
        color: "var(--dz-mute)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {dir === "l" ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
    </button>
  );
}

type CellModel = {
  iso: string; day: number; inMonth: boolean; isToday: boolean; isSelected: boolean;
  isNext: boolean; hasMock: boolean; hasClass: boolean; hasAssignment: boolean;
};

function DayCell({ c, onClick }: { c: CellModel; onClick: () => void }) {
  const highlight = c.isSelected || c.isNext;
  const num: React.CSSProperties = {
    width: 40,
    height: 40,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 14,
    fontWeight: 700,
  };
  if (highlight) {
    Object.assign(num, { background: "var(--dz-indigo)", color: "#fff", boxShadow: "0 0 0 3px rgba(42,104,192,.18)" });
  } else if (c.hasMock) {
    Object.assign(num, { border: "2px solid var(--dz-amber)", background: "var(--dz-amber-soft)", color: "var(--dz-amber)" });
  } else if (c.hasClass) {
    Object.assign(num, { border: "2px solid var(--dz-indigo)", background: "var(--dz-indigo-soft)", color: "var(--dz-indigo)" });
  } else if (c.isToday) {
    Object.assign(num, { border: "2px dashed var(--dz-indigo)", color: "var(--dz-indigo)" });
  } else if (c.hasAssignment) {
    Object.assign(num, { color: "var(--dz-indigo)" });
  } else {
    Object.assign(num, { color: c.inMonth ? "var(--dz-ink)" : "var(--dz-faint)" });
  }
  return (
    <button
      type="button"
      disabled={!c.inMonth}
      onClick={onClick}
      className="dz-daycell"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: 46,
        border: "none",
        background: "transparent",
        borderRadius: 12,
        cursor: c.inMonth ? "pointer" : "default",
        fontFamily: "inherit",
        opacity: c.inMonth ? 1 : 0.35,
        padding: 0,
      }}
    >
      <span className={highlight ? "dz-daypop" : undefined} style={num}>{c.day}</span>
    </button>
  );
}

function Legend() {
  const items: { sw: React.CSSProperties; label: string }[] = [
    { sw: { border: "2px solid var(--dz-indigo)", background: "var(--dz-indigo-soft)" }, label: "Class" },
    { sw: { border: "2px solid var(--dz-amber)", background: "var(--dz-amber-soft)" }, label: "Mock test" },
    { sw: { background: "var(--dz-indigo)", boxShadow: "0 0 0 3px rgba(42,104,192,.18)" }, label: "Next lesson" },
    { sw: { border: "2px dashed var(--dz-indigo)" }, label: "Today" },
  ];
  return (
    <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--dz-border)" }}>
      {items.map((it) => (
        <div key={it.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600, color: "var(--dz-mute)" }}>
          <span style={{ width: 16, height: 16, borderRadius: "50%", ...it.sw }} />
          {it.label}
        </div>
      ))}
    </div>
  );
}

/* ── Next lesson ─────────────────────────────────────────────────────────── */
function relativeDays(iso: string | null): string {
  if (!iso) return "";
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const d = new Date(iso + "T00:00:00").getTime();
  const days = Math.round((d - t0) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

function NextLessonCard({ date, event }: { date: string | null; event: ScheduleEvent | null }) {
  const cardStyle: React.CSSProperties = {
    background: "var(--dz-card)",
    border: "1px solid var(--dz-border)",
    borderRadius: 24,
    padding: 24,
    position: "relative",
    overflow: "hidden",
  };
  const labelRow = (
    <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12, fontWeight: 800, letterSpacing: ".12em", color: "var(--dz-indigo)", marginBottom: 16 }}>
      <span className="dz-dot" style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--dz-indigo)" }} /> NEXT LESSON
    </div>
  );

  if (!event || !date) {
    return (
      <div className="dz-lift4" style={cardStyle}>
        {labelRow}
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.01em", color: "var(--dz-ink)", lineHeight: 1.2 }}>You&apos;re all caught up</div>
        <div style={{ fontSize: 14, color: "var(--dz-mute)", fontWeight: 500, marginTop: 5 }}>Upcoming lessons will appear here.</div>
      </div>
    );
  }

  const when = new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return (
    <div className="dz-lift4" style={cardStyle}>
      {labelRow}
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.01em", color: "var(--dz-ink)", lineHeight: 1.2 }}>{event.title}</div>
      {event.sub ? <div style={{ fontSize: 14, color: "var(--dz-mute)", fontWeight: 500, marginTop: 5 }}>{event.sub}</div> : null}
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <InfoBox label="WHEN" value={when} />
        <InfoBox label="TIME" value={event.time || "—"} />
      </div>
      <button
        type="button"
        className="dz-joinbtn"
        style={{
          marginTop: 16,
          width: "100%",
          padding: 14,
          borderRadius: 13,
          border: "none",
          background: "var(--dz-indigo)",
          color: "#fff",
          fontFamily: "inherit",
          fontSize: 15,
          fontWeight: 700,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        Join lesson · {relativeDays(date)} <ArrowRight size={18} />
      </button>
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1, background: "var(--dz-panel)", border: "1px solid var(--dz-border)", borderRadius: 13, padding: "12px 14px" }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em", color: "var(--dz-faint)" }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--dz-ink)", marginTop: 4 }}>{value}</div>
    </div>
  );
}

/* ── Selected day ────────────────────────────────────────────────────────── */
function SelectedDayCard({ selected, events }: { selected: string | null; events: ScheduleEvent[] }) {
  const heading = selected
    ? new Date(selected + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    : "Select a day";
  return (
    <div className="dz-lift4" style={{ background: "var(--dz-panel)", border: "1px solid var(--dz-border)", borderRadius: 24, padding: "22px 24px" }}>
      <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".04em", color: "var(--dz-ink)" }}>{heading}</div>
      {events.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
          {events.map((e, i) => <LessonRow key={i} event={e} />)}
        </div>
      ) : (
        <div style={{ marginTop: 14, padding: 20, borderRadius: 14, border: "1px dashed var(--dz-border)", textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--dz-mute)" }}>No lessons scheduled</div>
          <div style={{ fontSize: 13, color: "var(--dz-faint)", marginTop: 3 }}>Use this day for past papers or vocab.</div>
        </div>
      )}
    </div>
  );
}

function lessonVisual(type: ScheduleEvent["type"]) {
  switch (type) {
    case "mock":
    case "midterm":
      return { Icon: ClipboardList, bg: "var(--dz-amber-soft)", color: "var(--dz-amber)" };
    case "assignment":
      return { Icon: FileText, bg: "var(--dz-indigo-soft)", color: "var(--dz-indigo)" };
    default:
      return { Icon: Users, bg: "var(--dz-indigo-soft)", color: "var(--dz-indigo)" };
  }
}

function LessonRow({ event }: { event: ScheduleEvent }) {
  const { Icon, bg, color } = lessonVisual(event.type);
  return (
    <div
      className="dz-lessonrow"
      style={{ display: "flex", gap: 13, alignItems: "flex-start", padding: 13, borderRadius: 14, background: "var(--dz-card)" }}
    >
      <div style={{ width: 40, height: 40, flex: "none", borderRadius: 12, background: bg, color, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={20} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--dz-ink)" }}>{event.title}</div>
        {event.sub ? <div style={{ fontSize: 13, color: "var(--dz-mute)", fontWeight: 500, marginTop: 2 }}>{event.sub}</div> : null}
      </div>
      {event.time ? <div style={{ fontSize: 13, fontWeight: 700, color: "var(--dz-mute)", whiteSpace: "nowrap" }}>{event.time}</div> : null}
    </div>
  );
}

/* ── Skeleton ───────────────────────────────────────────────────────────── */
function DashboardSkeleton() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-12">
      <Skeleton className="h-12 w-72" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-44 rounded-3xl" />
        <Skeleton className="h-44 rounded-3xl" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Skeleton className="h-96 rounded-3xl" />
        <Skeleton className="h-96 rounded-3xl" />
      </div>
    </div>
  );
}
