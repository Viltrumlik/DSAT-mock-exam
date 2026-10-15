"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { PersonPage } from "@/features/ops/people/PersonPage";

export default function OpsStudentPage() {
  const { id } = useParams<{ id: string }>();
  // useSearchParams (inside PersonPage) needs a Suspense boundary for the production build.
  return (
    <Suspense fallback={null}>
      <PersonPage section="students" id={Number(id)} />
    </Suspense>
  );
}
