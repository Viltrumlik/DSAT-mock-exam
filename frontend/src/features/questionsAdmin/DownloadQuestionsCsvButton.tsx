"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { buttonClass } from "@/features/console/ui";
import { useMe } from "@/hooks/useMe";
import { downloadBlob } from "@/lib/download";
import { normalizeApiError } from "@/lib/apiError";

/**
 * Download a whole test's questions and answer key for review.
 *
 * **Renders nothing unless the viewer is super_admin.** The server is the gate — every
 * export endpoint is behind `IsSuperAdmin` and answers 403 — and this only avoids showing a
 * button that would fail. A test_admin authoring a set still sees every one of these
 * questions in the builder; what is restricted is the whole key leaving as a file.
 *
 * The filename comes from the server's Content-Disposition, which already sanitises a title
 * containing slashes or quotes. `fallbackName` is used only if the header is missing.
 *
 * In the console's look (the module editor's frame, PR 14a). The set editor moved over too, so the old studio
 * variant went (PR 24).
 */
export function DownloadQuestionsCsvButton({
  fetchCsv, fallbackName, label = "Download CSV", title,
}: {
  fetchCsv: () => Promise<Blob>;
  fallbackName: string;
  label?: string;
  title?: string;
}) {
  const { me } = useMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const role = String(me?.role ?? "").trim().toLowerCase();
  if (!(role === "super_admin" || me?.is_superuser)) return null;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      downloadBlob(await fetchCsv(), `${fallbackName}.csv`);
    } catch (e) {
      setError(normalizeApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        aria-busy={busy || undefined}
        title={title ?? "Download every question and its answer key as a CSV"}
        className={buttonClass({ variant: "secondary", size: "sm" })}
      >
        <Icon name={busy ? "loader" : "download"} size="sm" className={busy ? "animate-ms-spin" : undefined} />
        {label}
      </button>
      {/* A failed download otherwise looks like a button that does nothing. */}
      {error ? <span className="text-[13px] font-medium text-ms-critical-fg">{error}</span> : null}
    </span>
  );
}
