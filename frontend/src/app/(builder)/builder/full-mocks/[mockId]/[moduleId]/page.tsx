"use client";

/**
 * /builder/full-mocks/[mockId]/[moduleId]
 *
 * Question editor for one module of a full mock. Renders the SHARED
 * ModuleQuestionsPanel (the same editor pastpapers use) driven by the mocks
 * backend adapter, so full mocks get the identical UI: SAT 27/22 per-module
 * question limit, per-module score caps, math preview, images, DnD reorder.
 */

import { Suspense, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ModuleQuestionsPanel from "@/features/questionsAdmin/ModuleQuestionsPanel";
import { mocksAdminApi, mocksModuleQuestionsApi, type AdminMock } from "@/features/mocksAdmin/api";

function FullMockModuleEditor({ mockId, moduleId }: { mockId: number; moduleId: number }) {
  const [mock, setMock] = useState<AdminMock | null>(null);

  useEffect(() => {
    let cancelled = false;
    mocksAdminApi.getMock(mockId).then((m) => {
      if (!cancelled) setMock(m);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mockId]);

  // Find the module's section (subject drives SAT limits + labels) and order.
  let sectionSubject: string | undefined;
  let moduleOrder: number | undefined;
  for (const section of mock?.sections ?? []) {
    const mod = section.modules.find((m) => m.id === moduleId);
    if (mod) {
      sectionSubject = section.subject;
      moduleOrder = mod.module_order;
      break;
    }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col px-4 py-5 md:px-8">
      <ModuleQuestionsPanel
        testId={mockId}
        moduleId={moduleId}
        api={mocksModuleQuestionsApi}
        packTitle={mock?.title ?? undefined}
        sectionSubject={sectionSubject}
        moduleOrder={moduleOrder != null ? `Module ${moduleOrder}` : undefined}
        backHref={`/builder/full-mocks/${mockId}`}
        backLabel="Full mock"
      />
    </div>
  );
}

export default function BuilderFullMockModulePage() {
  const params = useParams();
  const mockId = Number(Array.isArray(params.mockId) ? params.mockId[0] : params.mockId);
  const moduleId = Number(Array.isArray(params.moduleId) ? params.moduleId[0] : params.moduleId);

  if (!Number.isFinite(mockId) || mockId <= 0 || !Number.isFinite(moduleId) || moduleId <= 0) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-8">
        <div className="text-center">
          <p className="font-semibold text-foreground">Invalid route parameters.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Expected <code className="rounded bg-muted px-1">/builder/full-mocks/[mockId]/[moduleId]</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      }
    >
      <FullMockModuleEditor mockId={mockId} moduleId={moduleId} />
    </Suspense>
  );
}
