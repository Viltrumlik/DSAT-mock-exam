"use client";

import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import AssignmentForm from "@/features/classroom/pages/AssignmentForm";
import { classroomKeys } from "@/features/classroom/queryKeys";

export default function NewAssignmentPage() {
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const classId = Number(params?.classId);

  const back = () => router.push(`/classes/${classId}`);

  return (
    <div className="cr-section px-4 py-6 sm:px-6">
      <AssignmentForm
        classId={classId}
        onCancel={back}
        onSaved={(assignmentId) => {
          qc.invalidateQueries({ queryKey: classroomKeys.assignments(classId) });
          if (assignmentId) router.push(`/classes/${classId}/assignments/${assignmentId}`);
          else back();
        }}
      />
    </div>
  );
}
