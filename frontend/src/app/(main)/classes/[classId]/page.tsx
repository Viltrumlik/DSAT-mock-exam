"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { ClassroomWorkspace } from "@/features/classroom/ClassroomWorkspace";

export default function ClassDetailPage() {
  const params = useParams();
  const classId = Number(params?.classId);
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      {/* mastersat.uz is the student site — force the consumer view (no teacher management). */}
      <ClassroomWorkspace classId={classId} consumer />
    </Suspense>
  );
}
