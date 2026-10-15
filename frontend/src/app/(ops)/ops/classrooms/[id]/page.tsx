"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { ClassroomPage } from "@/features/ops/classrooms/ClassroomPage";

export default function OpsClassroomPage() {
  const { id } = useParams<{ id: string }>();
  // useSearchParams (inside ClassroomPage) needs a Suspense boundary for the production build.
  return (
    <Suspense fallback={null}>
      <ClassroomPage id={Number(id)} />
    </Suspense>
  );
}
