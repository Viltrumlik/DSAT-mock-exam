"use client";

import { Suspense } from "react";
import { ArchivePage } from "@/features/ops/archive/ArchivePage";

export default function OpsArchivePage() {
  // useSearchParams (the open tab) needs a Suspense boundary above it, or the production build's prerender fails.
  return (
    <Suspense fallback={null}>
      <ArchivePage />
    </Suspense>
  );
}
