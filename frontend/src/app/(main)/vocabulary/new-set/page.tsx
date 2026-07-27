"use client";

import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { CustomSetBuilder } from "@/features/vocabulary/pages/CustomSetBuilder";

/**
 * The builder reads `?set=` through useSearchParams(), which Next's static
 * prerender only allows under a Suspense boundary.
 */
export default function VocabularyNewSetPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto grid max-w-6xl gap-6 pb-12 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      }
    >
      <CustomSetBuilder />
    </Suspense>
  );
}
