"use client";

import { useParams } from "next/navigation";
import ModuleComposer from "@/features/moduleComposer/ModuleComposer";

export default function ModuleQuestionsPageInner() {
  const params = useParams();
  const rawTest = params.testId;
  const rawModule = params.moduleId;
  const testId = Number(Array.isArray(rawTest) ? rawTest[0] : rawTest);
  const moduleId = Number(Array.isArray(rawModule) ? rawModule[0] : rawModule);

  if (!Number.isFinite(testId) || testId <= 0 || !Number.isFinite(moduleId) || moduleId <= 0) {
    return (
      <div className="p-6 text-sm">
        <p className="font-semibold">Invalid URL.</p>
        <p className="mt-1 text-muted-foreground">
          Expected <code className="rounded bg-muted px-1">/questions/tests/…/modules/…</code>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6">
      <ModuleComposer testId={testId} moduleId={moduleId} />
    </div>
  );
}
