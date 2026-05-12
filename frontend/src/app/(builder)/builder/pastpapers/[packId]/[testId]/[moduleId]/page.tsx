"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Suspense } from "react";
import ModuleQuestionsPanel from "@/features/questionsAdmin/ModuleQuestionsPanel";
import { examsAdminApi } from "@/features/examsAdmin/api";
import type { AdminPastpaperPack } from "@/lib/api";
import { writeStudioSession } from "@/lib/studioSession";

// ─── Context loader ───────────────────────────────────────────────────────────

function PastpaperModuleEditor({
  packId,
  testId,
  moduleId,
}: {
  packId: number;
  testId: number;
  moduleId: number;
}) {
  const [pack, setPack] = useState<AdminPastpaperPack | null>(null);

  // Load pack context for breadcrumb enrichment (non-blocking — panel renders immediately)
  useEffect(() => {
    let cancelled = false;
    examsAdminApi.getPastpaperPacks().then((result) => {
      if (cancelled) return;
      const found = result.items.find((p) => p.id === packId) ?? null;
      setPack(found);
    });
    return () => { cancelled = true; };
  }, [packId]);

  const section = pack?.sections.find((s) => s.id === testId) ?? null;
  const module = section?.modules?.find((m) => m.id === moduleId) ?? null;

  // ── Session continuity: persist last-viewed pastpaper module ─────────────
  useEffect(() => {
    const subjectLabel =
      section?.subject === "MATH"
        ? "Mathematics"
        : section?.subject === "READING_WRITING"
        ? "Reading & Writing"
        : null;

    const label = [
      pack?.title,
      subjectLabel,
      module?.module_order != null ? `Module ${module.module_order}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    writeStudioSession({
      lastPastpaperModule: {
        packId,
        testId,
        moduleId,
        label: label || undefined,
      },
    });
  }, [packId, testId, moduleId, pack?.title, section?.subject, module?.module_order]);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col px-4 py-5 md:px-8">
      <ModuleQuestionsPanel
        testId={testId}
        moduleId={moduleId}
        packId={pack?.id}
        packTitle={pack?.title ?? undefined}
        sectionSubject={section?.subject ?? undefined}
        moduleOrder={module?.module_order != null ? `Module ${module.module_order}` : undefined}
      />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BuilderPastpaperModulePage() {
  const params = useParams();

  const packId = Number(Array.isArray(params.packId) ? params.packId[0] : params.packId);
  const testId = Number(Array.isArray(params.testId) ? params.testId[0] : params.testId);
  const moduleId = Number(
    Array.isArray(params.moduleId) ? params.moduleId[0] : params.moduleId,
  );

  if (
    !Number.isFinite(packId) || packId <= 0 ||
    !Number.isFinite(testId) || testId <= 0 ||
    !Number.isFinite(moduleId) || moduleId <= 0
  ) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-8">
        <div className="text-center">
          <p className="font-semibold text-foreground">Invalid route parameters.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Expected <code className="rounded bg-muted px-1">/builder/pastpapers/[packId]/[testId]/[moduleId]</code>
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
      <PastpaperModuleEditor packId={packId} testId={testId} moduleId={moduleId} />
    </Suspense>
  );
}
