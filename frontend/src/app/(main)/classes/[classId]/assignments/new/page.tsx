"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import AssignmentForm from "@/features/classroom/pages/AssignmentForm";
import { classroomKeys } from "@/features/classroom/queryKeys";

export default function NewAssignmentPage() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const classId = Number(params?.classId);

  // Classwork rides this route rather than getting one of its own: it is authored with the
  // identical form, and the shell's full-screen-runner allowlist is a hard-coded regex over
  // these exact paths (components/shell/StudentAppShell.tsx), so a sibling route would render
  // the form inside the scrolling shell instead of as the takeover it is designed to be.
  const kind = search?.get("kind")?.toUpperCase() === "CLASSWORK" ? "CLASSWORK" : "HOMEWORK";

  const back = () => router.push(`/classes/${classId}`);

  return (
    <div className="cr-section px-4 py-6 sm:px-6">
      <AssignmentForm
        classId={classId}
        kind={kind}
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
