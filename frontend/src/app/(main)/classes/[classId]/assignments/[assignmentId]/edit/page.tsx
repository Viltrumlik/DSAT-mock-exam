"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AssignmentForm from "@/features/classroom/pages/AssignmentForm";
import { homeworkApi } from "@/features/classroom/homeworkApi";
import { classroomKeys } from "@/features/classroom/queryKeys";
import { LoadingState, ErrorState } from "@/features/classroom/ui";

export default function EditAssignmentPage() {
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const classId = Number(params?.classId);
  const assignmentId = Number(params?.assignmentId);

  const detail = `/classes/${classId}/assignments/${assignmentId}`;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...classroomKeys.assignments(classId), "detail", assignmentId],
    queryFn: () => homeworkApi.getAssignment(classId, assignmentId),
    enabled: Number.isFinite(classId) && Number.isFinite(assignmentId),
  });

  return (
    <div className="cr-section px-4 py-6 sm:px-6">
      {isLoading ? (
        <LoadingState label="Loading assignment…" />
      ) : isError || !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <AssignmentForm
          classId={classId}
          editingAssignment={data as unknown as Record<string, unknown>}
          onCancel={() => router.push(detail)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: classroomKeys.assignments(classId) });
            router.push(detail);
          }}
        />
      )}
    </div>
  );
}
