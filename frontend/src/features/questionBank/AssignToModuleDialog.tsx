"use client";

import { useMemo, useState } from "react";
import { useQuestionBankModules, useQuestionBankTests } from "./hooks";

const RECENT_KEY = "mastersat.qbank.recentModules";

export type RecentModulePick = {
  testId: number;
  moduleId: number;
  testTitle: string;
  moduleOrder: number;
};

function loadRecent(): RecentModulePick[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    return Array.isArray(p) ? (p as RecentModulePick[]) : [];
  } catch {
    return [];
  }
}

function pushRecent(r: RecentModulePick) {
  if (typeof window === "undefined") return;
  const prev = loadRecent().filter((x) => !(x.testId === r.testId && x.moduleId === r.moduleId));
  prev.unshift(r);
  localStorage.setItem(RECENT_KEY, JSON.stringify(prev.slice(0, 10)));
}

export default function AssignToModuleDialog(props: {
  open: boolean;
  onClose: () => void;
  /** One or more standalone questions to assign to the same module */
  questionIds: number[];
  onAssign: (args: { testId: number; moduleId: number; questionId: number }) => Promise<{ status?: string } | void>;
}) {
  const [testId, setTestId] = useState<number>(0);
  const [moduleId, setModuleId] = useState<number>(0);
  const [testSearch, setTestSearch] = useState("");
  const [moduleSearch, setModuleSearch] = useState("");
  const [recent, setRecent] = useState<RecentModulePick[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const testsQ = useQuestionBankTests();
  const modulesQ = useQuestionBankModules(testId);

  const tests = testsQ.data || [];
  const modules = modulesQ.data || [];

  const filteredTests = useMemo(() => {
    const q = testSearch.trim().toLowerCase();
    if (!q) return tests;
    return tests.filter((t) => {
      const title = String((t as { title?: string }).title || "").toLowerCase();
      return title.includes(q) || String(t.id).includes(q);
    });
  }, [tests, testSearch]);

  const filteredModules = useMemo(() => {
    const q = moduleSearch.trim().toLowerCase();
    if (!q) return modules;
    return modules.filter((m) => {
      const mo = `module ${m.module_order}`;
      return mo.includes(q) || String(m.id).includes(q);
    });
  }, [modules, moduleSearch]);

  const canSubmit = testId > 0 && moduleId > 0 && props.questionIds.length > 0 && !busy;

  const selectedTestTitle = useMemo(() => {
    const t = tests.find((x) => x.id === testId);
    return (t && typeof (t as { title?: string }).title === "string"
      ? (t as { title?: string }).title
      : `Test #${testId}`) as string;
  }, [tests, testId]);

  const openRecentPicker = () => {
    setRecent(loadRecent());
  };

  if (!props.open) return null;

  const applyRecent = (r: RecentModulePick) => {
    setTestId(r.testId);
    setModuleId(r.moduleId);
    setModuleSearch("");
  };

  const runAssign = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      for (const qid of props.questionIds) {
        await props.onAssign({ testId, moduleId, questionId: qid });
      }
      pushRecent({
        testId,
        moduleId,
        testTitle: selectedTestTitle,
        moduleOrder: modules.find((m) => m.id === moduleId)?.module_order ?? 0,
      });
      props.onClose();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(typeof d === "string" ? d : "Assign failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded border bg-white p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-semibold">
              Assign to module
              {props.questionIds.length > 1 ? (
                <span className="text-muted-foreground"> ({props.questionIds.length} questions)</span>
              ) : null}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">Pick a practice test and module. Recent picks below.</div>
          </div>
          <button type="button" className="text-sm underline" onClick={props.onClose}>
            Close
          </button>
        </div>

        <div className="mt-3">
          <button
            type="button"
            className="text-xs font-semibold underline"
            onClick={() => {
              openRecentPicker();
            }}
          >
            Refresh recent
          </button>
          <div className="mt-2 flex flex-wrap gap-2">
            {(recent.length ? recent : loadRecent()).slice(0, 8).map((r) => (
              <button
                key={`${r.testId}-${r.moduleId}`}
                type="button"
                className="rounded border px-2 py-1 text-left text-xs hover:bg-muted"
                onClick={() => applyRecent(r)}
              >
                <div className="font-medium">{r.testTitle}</div>
                <div className="text-muted-foreground">
                  Mod {r.moduleOrder} · #{r.moduleId}
                </div>
              </button>
            ))}
          </div>
        </div>

        {err ? <div className="mt-3 text-xs text-red-600">{err}</div> : null}

        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-semibold">Search tests</label>
            <input
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={testSearch}
              onChange={(e) => setTestSearch(e.target.value)}
              placeholder="Filter by title or id…"
            />
          </div>

          <div>
            <label className="text-xs font-semibold">Practice test</label>
            <select
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={String(testId || 0)}
              onChange={(e) => {
                const v = Number(e.target.value);
                setTestId(Number.isFinite(v) ? v : 0);
                setModuleId(0);
              }}
            >
              <option value="0">Select…</option>
              {filteredTests.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {(t as { title?: string }).title ? String((t as { title?: string }).title) : `Test #${t.id}`}
                </option>
              ))}
            </select>
            {testsQ.isLoading ? <div className="mt-1 text-xs">Loading tests…</div> : null}
            {testsQ.isError ? <div className="mt-1 text-xs text-red-600">Failed to load tests.</div> : null}
          </div>

          <div>
            <label className="text-xs font-semibold">Search modules</label>
            <input
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={moduleSearch}
              onChange={(e) => setModuleSearch(e.target.value)}
              placeholder="Filter by order or id…"
              disabled={testId <= 0}
            />
          </div>

          <div>
            <label className="text-xs font-semibold">Module</label>
            <select
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={String(moduleId || 0)}
              onChange={(e) => setModuleId(Number(e.target.value) || 0)}
              disabled={testId <= 0}
            >
              <option value="0">{testId > 0 ? "Select…" : "Select test first"}</option>
              {filteredModules.map((m) => (
                <option key={m.id} value={String(m.id)}>
                  Module {m.module_order} (id {m.id})
                </option>
              ))}
            </select>
            {modulesQ.isFetching ? <div className="mt-1 text-xs">Loading modules for {selectedTestTitle}…</div> : null}
            {modulesQ.isError ? <div className="mt-1 text-xs text-red-600">Failed to load modules.</div> : null}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="rounded border px-3 py-2 text-sm" onClick={props.onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="rounded border bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
              disabled={!canSubmit}
              onClick={() => void runAssign()}
            >
              {busy ? "Assigning…" : "Assign"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
