"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { examsAdminApi } from "@/features/examsAdmin/api";

/**
 * Legacy route: /questions/tests/[testId]/modules/[moduleId]
 *
 * Redirects to the canonical builder-namespaced URL:
 *   /builder/pastpapers/[packId]/[testId]/[moduleId]
 *
 * If the pack lookup fails, falls back to /builder/pastpapers.
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

    // Find the pack that contains this testId (section id)
    examsAdminApi
      .getPastpaperPacks()
      .then((result) => {
        const pack = result.items.find((p) =>
          p.sections.some((s) => s.id === testId),
        );
        if (pack) {
          router.replace(`/builder/pastpapers/${pack.id}/${testId}/${moduleId}`);
        } else {
          router.replace("/builder/pastpapers");
        }
      })
      .catch(() => {
        router.replace("/builder/pastpapers");
      });
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
