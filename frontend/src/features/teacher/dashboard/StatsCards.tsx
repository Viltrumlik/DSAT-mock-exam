"use client";

/**
 * The four figures worth a picture on a teacher's first screen.
 *
 * Each one answers a question a teacher actually asks, and each states its numbers in text as
 * well as in colour:
 *
 * 1. Where is my grading backlog?      — a donut over the classes that owe me marking.
 * 2. Who came to class this week?      — present / late / missed per class.
 * 3. Is attendance holding up?         — the share present, day by day, over two weeks.
 * 4. Is homework coming in?            — turned in against expected, per class, over 30 days.
 *
 * "Missed", never "absent": the product does not use punishing words about a student, and the
 * server already renames the stored ABSENT for the same reason.
 */

import { BarRows, Card, Donut, EmptyState, ErrorState, Skeleton, TrendLine, type BarRow, type Slice, type Tone } from "../ui";
import type { AttendanceTrendRow, AttendanceWeekRow, HomeworkRateRow, QueueClass } from "../useTeacherToday";

const QUEUE_TONES: Tone[] = ["info", "warning", "danger", "success", "neutral"];

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

export function StatsCards({ queue, attendanceWeek, homework30d, attendanceTrend, loading, failed, onRetry }: {
  queue: QueueClass[];
  attendanceWeek: AttendanceWeekRow[];
  homework30d: HomeworkRateRow[];
  attendanceTrend: AttendanceTrendRow[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const body = (content: React.ReactNode) =>
    loading ? <Skeleton height={120} /> : failed ? <ErrorState onRetry={onRetry} /> : content;

  // The five classes that owe the most marking, with the rest gathered rather than dropped.
  const ranked = [...queue].sort((a, b) => b.waiting - a.waiting);
  const head = ranked.slice(0, 5);
  const tail = ranked.slice(5).reduce((sum, c) => sum + c.waiting, 0);
  const slices: Slice[] = head.map((c, i) => ({ label: c.name, value: c.waiting, tone: QUEUE_TONES[i % QUEUE_TONES.length] }));
  if (tail > 0) slices.push({ label: `${ranked.length - 5} more classes`, value: tail, tone: "neutral" });
  const waitingTotal = ranked.reduce((sum, c) => sum + c.waiting, 0);

  const attendanceRows: BarRow[] = attendanceWeek.map((r) => {
    const seen = r.present + r.late + r.missed + r.excused;
    return {
      label: r.name,
      note: `${pct(r.present + r.late, seen)}% came`,
      segments: [
        { value: r.present, tone: "success" },
        { value: r.late, tone: "warning" },
        { value: r.missed, tone: "danger" },
      ],
    };
  });

  const trendPoints = attendanceTrend.map((r) => {
    const seen = r.present + r.late + r.missed;
    return { label: new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }), value: pct(r.present + r.late, seen) };
  });

  // Shares, not counts: a class with twice the homework should not get twice the bar. The
  // figures behind the share are spelled out beside it.
  const homeworkRows: BarRow[] = homework30d.map((r) => {
    const rate = pct(r.turnedIn, r.expected);
    return {
      label: r.name,
      note: `${rate}% · ${r.turnedIn}/${r.expected}`,
      segments: [{ value: rate, tone: rate >= 80 ? "success" : rate >= 60 ? "info" : "warning" }],
    };
  });

  return (
    <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
      <Card title="Where the marking sits" subtitle="Work waiting, by class">
        {body(
          <Donut
            slices={slices}
            centerValue={waitingTotal}
            centerLabel="waiting"
            empty={<EmptyState title="Nothing waiting" hint="When students turn work in by hand, it shows here." />}
          />,
        )}
      </Card>

      <Card title="Who came this week" subtitle="Present, late and missed, last 7 days">
        {body(
          <BarRows
            rows={attendanceRows}
            empty={<EmptyState title="No attendance marked yet" hint="Marks from the last seven days appear here." />}
          />,
        )}
      </Card>

      <Card title="Is attendance holding up" subtitle="Share of the class in the room, last 14 days">
        {body(<TrendLine points={trendPoints} suffix="%" />)}
      </Card>

      <Card title="Is homework coming in" subtitle="Turned in against expected, last 30 days">
        {body(
          <BarRows
            rows={homeworkRows}
            max={100}
            empty={<EmptyState title="No homework due yet" hint="Homework due in the last 30 days appears here." />}
          />,
        )}
      </Card>
    </div>
  );
}
