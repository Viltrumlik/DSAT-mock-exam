"use client";

/**
 * Classes (student) — 1:1 with the provided mockup (~/Downloads/MasterSAT Classes.html).
 * Reuses the `.dzboard` token scope + keyframe/accent classes in globals.css; wired to the
 * real classroom data (useClassrooms / useJoinClass). Students are consumer-only: JOIN + VIEW.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Users, ArrowRight, UserPlus, BookOpen, Calculator, GraduationCap } from "lucide-react";
import { normalizeApiError } from "@/lib/apiError";
import { Button, Dialog, Field, Input, EmptyState, LoadingState, ErrorState } from "../ui";
import { useClassrooms, useJoinClass } from "../hooks";
import type { ClassroomWithRole } from "../types";

/* ── schedule formatting (matches the mockup's "Tue, Thu, Sat · 5:00 PM · Room 204") ── */
function shortDays(d: string | undefined | null): string {
  if (d === "ODD") return "Mon, Wed, Fri";
  if (d === "EVEN") return "Tue, Thu, Sat";
  return d || "";
}
function fmtTime(t: string | undefined | null): string {
  if (!t) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return t.trim();
  let h = Number(m[1]);
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
}
function roomLabel(r: string | undefined | null): string {
  const v = (r || "").trim();
  if (!v) return "";
  return /^room\b/i.test(v) ? v : `Room ${v}`;
}

type Filter = "ALL" | "ENGLISH" | "MATH";

export function ClassesHome() {
  const { data, isLoading, isError, refetch } = useClassrooms();
  const join = useJoinClass();
  const router = useRouter();

  const [filter, setFilter] = useState<Filter>("ALL");
  const [joinOpen, setJoinOpen] = useState(false);
  const [code, setCode] = useState("");
  const [joinErr, setJoinErr] = useState<string | null>(null);

  const classes = useMemo(() => (data?.items ?? []) as ClassroomWithRole[], [data]);
  const counts = useMemo(() => {
    let math = 0, eng = 0;
    for (const c of classes) {
      const s = String((c as { subject?: string }).subject ?? "").toUpperCase();
      if (s === "MATH") math++; else eng++;
    }
    return { all: classes.length, math, eng };
  }, [classes]);

  const shown = useMemo(() => {
    if (filter === "ALL") return classes;
    return classes.filter((c) => String((c as { subject?: string }).subject ?? "").toUpperCase() === filter);
  }, [classes, filter]);

  async function submitJoin() {
    setJoinErr(null);
    try {
      await join.mutateAsync(code);
      setJoinOpen(false);
      setCode("");
    } catch (e) {
      setJoinErr(normalizeApiError(e).message);
    }
  }

  const FILTERS: { key: Filter; label: string; count: number }[] = [
    { key: "ALL", label: "All", count: counts.all },
    { key: "ENGLISH", label: "English", count: counts.eng },
    { key: "MATH", label: "Math", count: counts.math },
  ];

  return (
    <div className="dzboard" style={{ maxWidth: 1280, width: "100%", margin: "0 auto" }}>
      <div className="dz-content">
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 24, flexWrap: "wrap", marginBottom: 22 }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <h1 style={{ margin: 0, fontSize: 38, lineHeight: 1.05, fontWeight: 800, letterSpacing: "-.03em", color: "var(--dz-ink)" }}>
              Classes
            </h1>
          </div>
          <button
            type="button"
            onClick={() => setJoinOpen(true)}
            className="dz-joinbtn2"
            style={{
              display: "flex", alignItems: "center", gap: 9, padding: "13px 20px", borderRadius: 13,
              border: "none", background: "var(--dz-indigo)", fontFamily: "inherit", fontSize: 15,
              fontWeight: 700, color: "#fff", cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            <UserPlus size={18} /> Join class
          </button>
        </div>

        {/* Filter pills */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22, flexWrap: "wrap" }}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className="dz-pill"
                style={{
                  border: active ? "1px solid var(--dz-indigo)" : "1px solid var(--dz-border)",
                  background: active ? "var(--dz-indigo-soft)" : "var(--dz-panel)",
                  color: active ? "var(--dz-indigo)" : "var(--dz-mute)",
                }}
              >
                {f.label}{" "}
                <span style={{ opacity: 0.7, fontWeight: 800 }}>{f.count}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        {isLoading ? (
          <LoadingState label="Loading your classes…" />
        ) : isError ? (
          <ErrorState message="We couldn't load your classes." onRetry={() => refetch()} />
        ) : classes.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="No classes yet"
            description="Join a class with the code your teacher shared."
            action={
              <Button variant="secondary" icon={UserPlus} onClick={() => setJoinOpen(true)}>
                Join with code
              </Button>
            }
          />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(312px, 1fr))", gap: 20 }}>
            {shown.map((c, i) => (
              <ClassCard key={c.id} c={c} index={i} onOpen={() => router.push(`/classes/${c.id}`)} />
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
        title="Join a class"
        description="Enter the code your teacher gave you."
        footer={
          <>
            <Button variant="ghost" onClick={() => setJoinOpen(false)}>Cancel</Button>
            <Button loading={join.isPending} onClick={submitJoin} disabled={!code.trim()}>Join class</Button>
          </>
        }
      >
        <Field label="Class code" error={joinErr}>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. 7QX2KP"
            className="font-mono uppercase tracking-widest"
            onKeyDown={(e) => e.key === "Enter" && submitJoin()}
            autoFocus
          />
        </Field>
      </Dialog>
    </div>
  );
}

function ClassCard({ c, index, onOpen }: { c: ClassroomWithRole; index: number; onOpen: () => void }) {
  const subject = String((c as { subject?: string }).subject ?? "").toUpperCase();
  const isMath = subject === "MATH";
  const Icon = isMath ? Calculator : BookOpen;
  const lessonDays = (c as { lesson_days?: string }).lesson_days;
  const lessonTime = (c as { lesson_time?: string }).lesson_time;
  const room = (c as { room_number?: string }).room_number;
  const schedule = [shortDays(lessonDays), fmtTime(lessonTime), roomLabel(room)].filter(Boolean).join(" · ");
  const count =
    (c as { members_count?: number }).members_count ??
    (c as { student_count?: number }).student_count ??
    0;

  return (
    <div
      className={`dz-card dz-acc-${index % 5}`}
      style={{ animationDelay: `${Math.min(index, 9) * 0.08}s` }}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
    >
      <div className="dz-band">
        <div className="dz-tile"><Icon size={26} /></div>
      </div>
      <div style={{ padding: "16px 18px 18px" }}>
        <div className="clip1" style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-.01em", color: "var(--dz-ink)" }}>{c.name}</div>
        <div style={{ fontSize: 13, color: "var(--dz-mute)", fontWeight: 600, marginTop: 6 }}>{schedule || (isMath ? "Math" : "English")}</div>
        <div style={{ height: 1, background: "var(--dz-border)", margin: "14px 0" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "var(--dz-mute)" }}>
            <Users size={16} /> {count} {count === 1 ? "student" : "students"}
          </span>
          <button
            type="button"
            className="dz-openbtn"
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
          >
            Open <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
