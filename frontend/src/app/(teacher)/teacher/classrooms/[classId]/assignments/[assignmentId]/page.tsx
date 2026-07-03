"use client";

import { useParams } from "next/navigation";
import { AssignmentDetailPage } from "@/features/classroom/pages/AssignmentDetail";

export default function TeacherClassAssignmentPage() {
  const params = useParams();
  const classId = Number(params?.classId);
  const assignmentId = Number(params?.assignmentId);
  // Teacher portal is scoped to /teacher/* by middleware — keep every link there.
  return (
    <AssignmentDetailPage
      classId={classId}
      assignmentId={assignmentId}
      basePath={`/teacher/classrooms/${classId}`}
    />
  );
}
