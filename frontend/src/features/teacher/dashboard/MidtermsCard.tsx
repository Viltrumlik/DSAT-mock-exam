"use client";

/**
 * The midterms scheduled in the next fortnight, with the mark that counts as a pass.
 *
 * The pass mark is here because a teacher asked to see who clears a midterm in green and who
 * does not in red, and nothing in this panel showed the line at all. Colouring the students
 * belongs on the midterm screens; this is the number that line is drawn at.
 */

import Link from "next/link";
import { Timer } from "lucide-react";
import { Card, DataTable, EmptyState, ErrorState, Skeleton, type Column } from "../ui";
import type { UpcomingMidterm } from "../useTeacherToday";

function dayLabel(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

const COLUMNS: Column<UpcomingMidterm>[] = [
  { key: "title", header: "Midterm", render: (m) => <span style={{ fontWeight: 700 }}>{m.title}</span> },
  {
    key: "class",
    header: "Class",
    render: (m) => (
      <Link
        href={`/teacher/classrooms/${m.classroomId}?tab=midterms`}
        style={{ color: "var(--dz-indigo)", textDecoration: "none", fontWeight: 600 }}
      >
        {m.className}
      </Link>
    ),
  },
  { key: "date", header: "When", render: (m) => dayLabel(m.startsAt) },
  {
    key: "pass",
    header: "Pass mark",
    align: "right",
    width: 120,
    render: (m) => (m.passMark == null ? <span style={{ color: "var(--dz-faint)" }}>Not graded</span> : m.passMark),
  },
];

export function MidtermsCard({ midterms, loading, failed, onRetry }: {
  midterms: UpcomingMidterm[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  return (
    <Card title="Midterms coming" subtitle="The next two weeks" icon={<Timer size={20} aria-hidden />}>
      {loading ? (
        <Skeleton height={40} count={2} />
      ) : failed ? (
        <ErrorState title="The midterm list didn't load" onRetry={onRetry} />
      ) : (
        <DataTable<UpcomingMidterm>
          label="Midterms scheduled in the next two weeks"
          rows={midterms}
          rowKey={(m) => `${m.midtermId}-${m.classroomId}`}
          columns={COLUMNS}
          empty={<EmptyState title="No midterm scheduled" hint="Midterms you schedule for your classes appear here." />}
        />
      )}
    </Card>
  );
}
