"use client";

import Link from "next/link";
import { useQuestionModuleLinks } from "./hooks";

export default function ModuleUsageModal(props: {
  open: boolean;
  questionId: number | null;
  onClose: () => void;
}) {
  const linksQ = useQuestionModuleLinks(props.questionId, props.open && props.questionId != null);

  if (!props.open || props.questionId == null) return null;

  const rows = linksQ.data || [];

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-sm font-semibold">Question #{props.questionId} — module usage</div>
          <button type="button" className="text-sm underline" onClick={props.onClose}>
            Close
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-4 text-sm">
          {linksQ.isLoading ? (
            <div className="text-muted-foreground">Loading…</div>
          ) : linksQ.isError ? (
            <div className="text-red-600">Failed to load links.</div>
          ) : rows.length === 0 ? (
            <div className="text-muted-foreground">Not assigned to any module.</div>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.module_question_id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                  <div>
                    <div className="font-medium">{r.practice_test_title}</div>
                    <div className="text-xs text-muted-foreground">
                      Module {r.module_order} · {r.subject ?? "—"}
                    </div>
                  </div>
                  <Link
                    href={`/questions/tests/${r.practice_test_id}/modules/${r.module_id}`}
                    className="text-xs font-semibold underline"
                    onClick={props.onClose}
                  >
                    Open in editor
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
