"use client";

import { Suspense } from "react";
import { Icon } from "@/components/ui/Icon";
import BuilderSetEditorContainer from "@/features/assessments/builder/BuilderSetEditorContainer";

export default function BuilderSetDetailPage() {
  return (
    <Suspense
      fallback={
        <div aria-busy="true" aria-label="Loading" className="flex min-h-[40vh] items-center justify-center">
          <Icon name="loader" className="size-8 animate-ms-spin text-ms-fg-3" />
        </div>
      }
    >
      <BuilderSetEditorContainer />
    </Suspense>
  );
}
