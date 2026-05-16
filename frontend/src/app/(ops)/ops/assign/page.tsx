"use client";

/**
 * /ops/assign — Pastpaper & mock-exam bulk assignment hub
 *
 * Wraps the BulkAssignWizard component.  Fetches users, pastpaper packs, and
 * mock exams on mount, then hands them to the wizard.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { BookMarked, RefreshCw } from "lucide-react";
import { examsAdminApi } from "@/lib/api";
import { BulkAssignWizard } from "@/components/bulk-assign/BulkAssignWizard";
import type { BulkAssignUserRow } from "@/components/bulk-assign/types";

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 shadow-lg">
      <p className="text-sm font-bold text-emerald-800">{message}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsAssignPage() {
  const [users, setUsers] = useState<BulkAssignUserRow[]>([]);
  const [mockExams, setMockExams] = useState<Array<Record<string, unknown>>>([]);
  const [pastpaperPacks, setPastpaperPacks] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const [intent, setIntent] = useState<"pastpapers" | "mocks" | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersData, mocksData, packsData] = await Promise.all([
        examsAdminApi.getUsers(),
        examsAdminApi.getMockExams(),
        examsAdminApi.getPastpaperPacks(),
      ]);

      // Users: API returns { results: [...] } or plain array
      const rawUsers: unknown[] = Array.isArray(usersData)
        ? usersData
        : Array.isArray(usersData?.results)
          ? usersData.results
          : [];
      setUsers(rawUsers as BulkAssignUserRow[]);

      // Mock exams: already unwrapped by getMockExams
      const rawMocks: unknown[] = Array.isArray(mocksData)
        ? mocksData
        : Array.isArray((mocksData as { items?: unknown[] })?.items)
          ? (mocksData as { items: unknown[] }).items
          : [];
      setMockExams(rawMocks as Array<Record<string, unknown>>);

      // Pastpaper packs: NormalizedList<AdminPastpaperPack>
      const rawPacks: unknown[] = Array.isArray(packsData)
        ? packsData
        : Array.isArray((packsData as { items?: unknown[] })?.items)
          ? (packsData as { items: unknown[] }).items
          : [];
      setPastpaperPacks(rawPacks as Array<Record<string, unknown>>);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not load assignment data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1.5">
            Admin console · Assign
          </p>
          <h1 className="text-xl font-bold text-foreground tracking-tight">
            Assign pastpapers &amp; exams
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Select a pastpaper pack or mock exam, pick students, and assign.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="rounded-2xl border border-border bg-card p-8 flex items-center justify-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm font-semibold text-muted-foreground">Loading users and content…</p>
        </div>
      )}

      {/* Wizard */}
      {!loading && !error && (
        <BulkAssignWizard
          canAssign={true}
          users={users}
          mockExams={mockExams}
          pastpaperPacks={pastpaperPacks}
          loadingUsers={false}
          showToast={(msg) => setToast(msg)}
          onAfterSuccess={() => void loadData()}
          intent={intent}
          onConsumeIntent={() => setIntent(null)}
          defaultPastpaperScope="BOTH"
        />
      )}

      {/* Toast */}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
