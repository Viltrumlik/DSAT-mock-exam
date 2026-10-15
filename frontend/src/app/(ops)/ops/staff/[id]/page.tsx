"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { PersonPage } from "@/features/ops/people/PersonPage";

export default function OpsStaffMemberPage() {
  const { id } = useParams<{ id: string }>();
  // useSearchParams (inside PersonPage) needs a Suspense boundary for the production build.
  return (
    <Suspense fallback={null}>
      <PersonPage section="staff" id={Number(id)} />
    </Suspense>
  );
}
