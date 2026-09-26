"use client";

/**
 * Manual grading, three levels deep: class → homework → the students whose work is waiting.
 *
 * The owner asked for exactly this nesting. The point of the third level is that a teacher
 * can see WHO is waiting without opening anything; the link on each homework goes to the
 * page where the work is actually read and graded.
 *
 * One live class has 134 pieces waiting, so the server caps what it sends (8 homework per
 * class, 12 students per homework) while still reporting the true totals. Where a list is
 * cut, the count says so rather than quietly showing a dozen.
 */

import Link from "next/link";
import { ClipboardPen } from "lucide-react";
import { Card, EmptyState, ErrorState, Pill, Skeleton } from "../ui";
import type { QueueClass } from "../useTeacherToday";

/** "2h ago", "yesterday", "Sep 14" — how long this student's work has been waiting. */
function waitedFor(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const hours = (Date.now() - then) / 3_600_000;
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  if (hours < 48) return "yesterday";
  if (hours < 24 * 7) return `${Math.floor(hours / 24)} days ago`;
  return new Date(then).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function GradingCard({ queue, loading, failed, onRetry }: {
  queue: QueueClass[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const total = queue.reduce((sum, c) => sum + c.waiting, 0);
  return (
    <Card
      title="Waiting for you to check"
      subtitle="Turned in by hand, not yet graded"
      icon={<ClipboardPen size={20} aria-hidden />}
      actions={total > 0 ? <Pill tone="warning">{total} waiting</Pill> : undefined}
      padded={false}
    >
      <div style={{ padding: "6px 24px 20px" }}>
        {loading ? (
          <Skeleton height={54} count={2} />
        ) : failed ? (
          <ErrorState
            title="The grading queue didn't load"
            detail="Nothing was lost — this is only the page failing to read what is waiting."
            onRetry={onRetry}
          />
        ) : queue.length === 0 ? (
          <EmptyState title="Nothing waiting" hint="Work your students turn in by hand shows up here, newest class first." />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {queue.map((klass, i) => (
              <li key={klass.classroomId} style={{ borderTop: "1px solid var(--dz-border)" }}>
                <details open={i === 0}>
                  <summary
                    style={{
                      cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                      padding: "12px 0", fontSize: 15, fontWeight: 800, color: "var(--dz-ink)",
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>{klass.name}</span>
                    <Pill tone="warning">{klass.waiting}</Pill>
                  </summary>

                  <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "2px 0 16px" }}>
                    {klass.assignments.map((asg) => {
                      const shown = asg.students.length;
                      const hidden = Math.max(0, asg.waiting - shown);
                      return (
                        <div key={asg.assignmentId}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                            <Link
                              href={`/teacher/grading?class=${klass.classroomId}&homework=${asg.assignmentId}`}
                              style={{ fontSize: 14, fontWeight: 700, color: "var(--dz-indigo)", textDecoration: "none" }}
                            >
                              {asg.title}
                            </Link>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--dz-mute)" }}>
                              {asg.waiting} to check
                            </span>
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                            {asg.students.map((s) => (
                              <span
                                key={s.id}
                                style={{
                                  display: "inline-flex", alignItems: "baseline", gap: 6,
                                  padding: "4px 10px", borderRadius: 999,
                                  background: "var(--dz-neutral-soft)", fontSize: 13, fontWeight: 600,
                                  color: "var(--dz-ink)",
                                }}
                              >
                                {s.name}
                                {s.submittedAt && (
                                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--dz-mute)" }}>
                                    {waitedFor(s.submittedAt)}
                                  </span>
                                )}
                              </span>
                            ))}
                            {hidden > 0 && (
                              <Link
                                href={`/teacher/grading?class=${klass.classroomId}&homework=${asg.assignmentId}`}
                                style={{
                                  padding: "4px 10px", borderRadius: 999, background: "var(--dz-indigo-soft)",
                                  fontSize: 13, fontWeight: 700, color: "var(--dz-indigo)", textDecoration: "none",
                                }}
                              >
                                +{hidden} more
                              </Link>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
