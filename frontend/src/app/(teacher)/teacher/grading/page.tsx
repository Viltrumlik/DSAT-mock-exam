"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TeacherGradingScreen } from "@/features/teacher/grading/TeacherGradingScreen";
import { selectionFromParams } from "@/features/teacher/grading/gradingQueueModel";
import { Card, Skeleton, TeacherPage } from "@/features/teacher/ui";

/**
 * `/teacher/grading` — the one grading screen, and the one the teacher nav points at.
 *
 * It accepts `?class=&homework=&student=`, so the dashboard's queue card and a classroom can
 * link INTO a particular piece of work instead of dropping the teacher at the top of a list.
 */
function Entry() {
  const params = useSearchParams();
  return <TeacherGradingScreen initial={selectionFromParams((key) => params?.get(key) ?? null)} />;
}

/**
 * The frame between the click and the screen's own loading state. `null` here is a blank white
 * page — no title, no nav frame, nothing to say the page is coming — so it wears the same
 * TeacherPage and the same skeletons the screen itself draws a moment later, and the arrival is
 * a fill rather than a flash.
 */
function GradingPageFrame() {
  return (
    <TeacherPage title="Grading">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 300px", minWidth: 0, maxWidth: 400 }}>
          <Card title="Waiting for you" subtitle="Longest waiting first">
            <Skeleton height={48} count={4} />
          </Card>
        </div>
        <div style={{ flex: "3 1 440px", minWidth: 0 }}>
          <Card title="The work">
            <Skeleton height={28} />
            <div style={{ height: 14 }} />
            <Skeleton height={320} />
          </Card>
        </div>
      </div>
    </TeacherPage>
  );
}

export default function TeacherGradingPage() {
  // `useSearchParams` needs a boundary in the app router.
  return (
    <Suspense fallback={<GradingPageFrame />}>
      <Entry />
    </Suspense>
  );
}
