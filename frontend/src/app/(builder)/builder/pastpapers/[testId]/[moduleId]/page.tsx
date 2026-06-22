"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Suspense } from "react";
import ModuleQuestionsPanel from "@/features/questionsAdmin/ModuleQuestionsPanel";
import { examsAdminApi } from "@/features/examsAdmin/api";
import type { AdminPastpaperSection } from "@/lib/api";
import { writeStudioSession } from "@/lib/studioSession";

// ─── Context loader ───────────────────────────────────────────────────────────

function PastpaperModuleEditor({
  testId,
  moduleId,
}: {
  testId: number;
  moduleId: number;
}) {
  const [section, setSection] = useState<AdminPastpaperSection | null>(null);

  // Load section context for breadcrumb enrichment (non-blocking — panel renders immediately)
  useEffect(() => {
    let cancelled = false;
    examsAdminApi.getStandaloneSections().then((sections) => {
      if (cancelled) return;
      const found = sections.find((s) => s.id === testId) ?? null;
      setSection(found);
    });
    return () => { cancelled = true; };
  }, [testId]);

  const moduleEntry = section?.modules?.find((m) => m.id === moduleId) ?? null;
  const collectionTitle = (section?.collection_name && section.collection_name.trim()) || section?.title || undefined;

  // ── Session continuity: persist last-viewed pastpaper module ─────────────
  useEffect(() => {
    const subjectLabel =
      section?.subject === "MATH"
        ? "Mathematics"
        : section?.subject === "READING_WRITING"
        ? "Reading & Writing"
        : null;

    const label = [
      collectionTitle,
      subjectLabel,
      moduleEntry?.module_order != null ? `Module ${moduleEntry.module_order}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    writeStudioSession({
      lastPastpaperModule: {
        testId,
        moduleId,
        label: label || undefined,
      },
    });
  }, [testId, moduleId, collectionTitle, section?.subject, moduleEntry?.module_order]);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col px-4 py-5 md:px-8">
      <ModuleQuestionsPanel
        testId={testId}
        moduleId={moduleId}
        packTitle={collectionTitle}
        sectionSubject={section?.subject ?? undefined}
        moduleOrder={moduleEntry?.module_order != null ? `Module ${moduleEntry.module_order}` : undefined}
      />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BuilderPastpaperModulePage() {
  const params = useParams();

  const testId = Number(Array.isArray(params.testId) ? params.testId[0] : params.testId);
  const moduleId = Number(
    Array.isArray(params.moduleId) ? params.moduleId[0] : params.moduleId,
  );

  if (
    !Number.isFinite(testId) || testId <= 0 ||
    !Number.isFinite(moduleId) || moduleId <= 0
  ) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-8">
        <div className="text-center">
          <p className="font-semibold text-foreground">Invalid route parameters.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Expected <code className="rounded bg-muted px-1">/builder/pastpapers/[testId]/[moduleId]</code>
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
      <PastpaperModuleEditor testId={testId} moduleId={moduleId} />
    </Suspense>
  );
}
