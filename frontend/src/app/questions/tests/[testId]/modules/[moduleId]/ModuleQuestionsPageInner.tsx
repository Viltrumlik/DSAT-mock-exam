"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/**
 * Legacy route: /questions/tests/[testId]/modules/[moduleId]
 *
 * Redirects to the canonical builder-namespaced URL:
 *   /builder/pastpapers/[testId]/[moduleId]
 *
 * Sections are now standalone (the PastpaperPack grouping was removed), so the
 * module editor route no longer needs a pack segment.
 */
export default function ModuleQuestionsPageInner() {
  const params = useParams();
  const router = useRouter();

  const rawTest = params.testId;
  const rawModule = params.moduleId;
  const testId = Number(Array.isArray(rawTest) ? rawTest[0] : rawTest);
  const moduleId = Number(Array.isArray(rawModule) ? rawModule[0] : rawModule);

  useEffect(() => {
    if (!Number.isFinite(testId) || testId <= 0 || !Number.isFinite(moduleId) || moduleId <= 0) {
      router.replace("/builder/pastpapers");
      return;
    }
    router.replace(`/builder/pastpapers/${testId}/${moduleId}`);
  }, [testId, moduleId, router]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center p-8 text-center">
      <div>
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm font-semibold text-foreground">Redirecting to new editor…</p>
        <p className="mt-1 text-xs text-muted-foreground">
          This URL has moved to <code className="rounded bg-muted px-1">/builder/pastpapers/…</code>
        </p>
      </div>
    </div>
  );
}
