"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import AssignmentForm from "@/features/classroom/pages/AssignmentForm";
import { classroomKeys } from "@/features/classroom/queryKeys";

export default function TeacherNewAssignmentPage() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const classId = Number(params?.classId);

  // Mirrors the main-site route: `?kind=classwork` authors classwork with the same form.
  const kind = search?.get("kind")?.toUpperCase() === "CLASSWORK" ? "CLASSWORK" : "HOMEWORK";

  const back = () => router.push(`/teacher/classrooms/${classId}`);

  return (
    <div className="cr-section px-4 py-6 sm:px-6">
      <AssignmentForm
        classId={classId}
        kind={kind}
        onCancel={back}
        onSaved={(assignmentId) => {
          qc.invalidateQueries({ queryKey: classroomKeys.assignments(classId) });
          if (assignmentId) router.push(`/teacher/classrooms/${classId}/assignments/${assignmentId}`);
          else back();
        }}
      />
    </div>
  );
}
