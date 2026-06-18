"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { ClassroomWorkspace } from "@/features/classroom/ClassroomWorkspace";

export default function TeacherClassroomDetailPage() {
  const params = useParams();
  const classId = Number(params?.classId);
  return (
    <Suspense fallback={null}>
      <ClassroomWorkspace classId={classId} />
    </Suspense>
  );
}
