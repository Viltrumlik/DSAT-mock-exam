"use client";

/**
 * Midterms are sat in the MasterSAT app for Windows. A student without a Windows laptop — a
 * MacBook, a Chromebook — can't run it, so a teacher lets them sit midterms in the browser
 * instead (with the browser's own full-screen rule). Backed by /api/desktop/exemptions/.
 *
 * Granting it mid-paper also rescues a sitting whose laptop died: the server reads the list at
 * every request, so the student can carry on in a browser at once.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, UserMinus } from "lucide-react";

import api from "@/lib/api";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { StudentMultiSelect } from "@/components/access/StudentMultiSelect";
import {
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Skeleton,
  type Column,
} from "@/features/teacher/ui";

export interface BrowserExemption {
  id: number;
  student: { id: number; first_name: string; last_name: string; username: string; email: string };
  reason: string;
  granted_by: string;
  created_at: string;
}

export const browserAccessApi = {
  async list(): Promise<BrowserExemption[]> {
    const r = await api.get("/desktop/exemptions/");
    return (r.data?.results ?? []) as BrowserExemption[];
  },
  async grant(studentIds: number[], reason: string): Promise<void> {
    for (const id of studentIds) {
      await api.post("/desktop/exemptions/", { student_id: id, reason });
    }
  },
  async revoke(id: number): Promise<void> {
    await api.post(`/desktop/exemptions/${id}/revoke/`, {});
  },
};

const KEY = ["desktop", "exemptions"] as const;

function studentName(s: BrowserExemption["student"]): string {
  return [s.first_name, s.last_name].filter(Boolean).join(" ").trim() || s.username || s.email;
}

export function BrowserAccess() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: KEY, queryFn: browserAccessApi.list });
  const [picked, setPicked] = useState<number[]>([]);
  const [reason, setReason] = useState("");
  const [revoking, setRevoking] = useState<BrowserExemption | null>(null);

  const grant = useMutation({
    mutationFn: () => browserAccessApi.grant(picked, reason.trim()),
    onSuccess: () => {
      pushGlobalToast({
        tone: "success",
        message: `${picked.length} student${picked.length === 1 ? "" : "s"} can now take midterms in the browser.`,
      });
      setPicked([]);
      setReason("");
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => pushGlobalToast({ tone: "error", message: normalizeApiError(e).message }),
  });

  const revoke = useMutation({
    mutationFn: (id: number) => browserAccessApi.revoke(id),
    onSuccess: () => {
      setRevoking(null);
      void qc.invalidateQueries({ queryKey: KEY });
      pushGlobalToast({ tone: "success", message: "They will take midterms in the Windows app again." });
    },
    onError: (e) => {
      setRevoking(null);
      pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
    },
  });

  const columns: Column<BrowserExemption>[] = [
    { key: "student", header: "Student", render: (r) => <strong>{studentName(r.student)}</strong> },
    { key: "reason", header: "Reason", render: (r) => r.reason || <span style={{ color: "var(--dz-mute)" }}>—</span> },
    { key: "by", header: "Allowed by", render: (r) => r.granted_by || "—" },
    {
      key: "since",
      header: "Since",
      render: (r) => new Date(r.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => (
        <Button variant="ghost" onClick={() => setRevoking(r)}>
          <UserMinus size={15} aria-hidden /> Back to the app
        </Button>
      ),
    },
  ];

  return (
    <>
      <Card
        title="Let students take midterms in the browser"
        subtitle="Midterms are taken in the MasterSAT app for Windows. Choose students who can't run it — a MacBook or a Chromebook — or whose laptop stopped mid-paper."
        icon={<Monitor size={16} aria-hidden />}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <StudentMultiSelect value={picked} onChange={setPicked} showClassroomFilter={false} />
          <Field label="Reason" htmlFor="browser-access-reason" hint="Optional, e.g. “MacBook”.">
            <input
              id="browser-access-reason"
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                border: "1px solid var(--dz-border)",
                background: "var(--dz-panel)",
                borderRadius: 14,
                padding: "10px 14px",
                fontSize: 14,
                color: "var(--dz-ink)",
                fontFamily: "inherit",
              }}
            />
          </Field>
          <div>
            <Button busy={grant.isPending} disabled={picked.length === 0} onClick={() => grant.mutate()}>
              Allow {picked.length || ""} student{picked.length === 1 ? "" : "s"} to use the browser
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Taking midterms in the browser">
        {list.isError ? (
          <ErrorState detail={normalizeApiError(list.error).message} onRetry={() => void list.refetch()} />
        ) : list.isLoading ? (
          <Skeleton />
        ) : (
          <DataTable
            label="Students taking midterms in the browser"
            columns={columns}
            rows={list.data ?? []}
            rowKey={(r) => r.id}
            empty={
              <EmptyState
                title="Everyone takes midterms in the Windows app"
                hint="Students you allow above will be listed here."
              />
            }
          />
        )}
      </Card>

      <Dialog
        open={revoking !== null}
        tone="danger"
        title="Back to the Windows app?"
        description={
          revoking
            ? `${studentName(revoking.student)} will need the MasterSAT app for Windows for their next midterm.`
            : undefined
        }
        confirmLabel="Back to the app"
        busy={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
        onClose={() => setRevoking(null)}
      />
    </>
  );
}
