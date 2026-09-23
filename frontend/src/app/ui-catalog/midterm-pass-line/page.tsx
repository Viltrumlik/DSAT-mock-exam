"use client";

/**
 * Preview of the midterm pass line, on invented data. The real panel needs a teacher account,
 * a scheduled midterm and a room that has sat it; this route seeds the panel's query cache and
 * renders the SAME component twice — once for a teacher, once for a student — so the one thing
 * that matters about this feature can be looked at rather than described.
 *
 * Both columns are the real `MidtermPanel`. Nothing here reimplements the table.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { MidtermPanel } from "@/features/classroom/pages/MidtermPanel";
import { capabilitiesFor } from "@/features/classroom/capabilities";

const CLASS_ID = 1;
const MIDTERM_ID = 7;
const KEY = ["classroom-midterm-v2", "panel", CLASS_ID, MIDTERM_ID];

function student(
  id: number, name: string, state: string, submitted: boolean,
  score: number | null, rank: number | null,
) {
  return {
    student_id: id, student_name: name, student_profile_image_url: null,
    state, submitted, score, score_ceiling: 100, score_on_scale: score, rank,
    certificate_code: null, sittings: submitted ? 1 : 0, resit_open: false,
    version_number: null, version_label: null,
    seat_row: null, seat_col: null, side: null, desk_number: null,
  };
}

/** Invented names and scores. This repository is public; no real student appears here. */
const SAMPLE = {
  midterm: { id: MIDTERM_ID, title: "September midterm", subject: "MATH", scoring_scale: "PERCENT", score_ceiling: 100 },
  schedule: {
    starts_at: "2026-09-18T10:00:00+05:00", deadline: null, ignore_start: false,
    results_released: true, available_at: null, is_before_start: false, is_open: false,
    access_code: null, requires_code: false, notified_at: "2026-09-16T09:00:00+05:00",
  },
  students: [
    student(1, "Aziza Karimova", "COMPLETED", true, 92, 1),
    student(2, "Bekzod Tursunov", "COMPLETED", true, 78, 2),
    student(3, "Malika Rahimova", "COMPLETED", true, 70, 3),
    student(4, "Jasur Alimov", "COMPLETED", true, 64, 4),
    student(5, "Nigora Sobirova", "COMPLETED", true, 51, 5),
    // Handed in, not yet scored: no verdict, and that must not read as a fail.
    student(6, "Sardor Yusupov", "SCORING", true, null, null),
    // Never sat it: no verdict either.
    student(7, "Dilnoza Ergasheva", "NOT_STARTED", false, null, null),
  ],
  stats: {
    assigned: 7, completed: 5, average: 71, highest: 92, lowest: 51,
    score_ceiling: 100, mixed_scales: false,
    pass_mark: 70,
  },
  all_finished: false,
  certificates_issued: false,
  has_versions: false,
  versions: [],
};

function Seeded({ role, label }: { role: string; label: string }) {
  // One client per column so the two cannot share a cache — the point of the picture is that
  // the same payload renders differently, and a shared client would hide a bug where it didn't.
  const [qc] = useState(() => {
    const c = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    c.setQueryData(KEY, SAMPLE);
    return c;
  });
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <p style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>
        {label}
      </p>
      <QueryClientProvider client={qc}>
        <MidtermPanel
          classId={CLASS_ID}
          midtermId={MIDTERM_ID}
          title={SAMPLE.midterm.title}
          caps={capabilitiesFor(role as never)}
          onBack={() => {}}
        />
      </QueryClientProvider>
    </div>
  );
}

export default function Page() {
  return (
    <div style={{ padding: 24, display: "flex", gap: 28, alignItems: "flex-start" }}>
      <Seeded role="TEACHER" label="What the teacher sees" />
      <Seeded role="STUDENT" label="What the student sees" />
    </div>
  );
}
