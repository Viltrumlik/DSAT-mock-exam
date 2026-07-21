/** Client for the read-only admin midterm reports (/api/midterms/admin/reports/). */
import api from "@/lib/api";
import { downloadBlob } from "@/lib/download";
import type { ClassroomDetail, ClassroomListRow, MidtermReport } from "./types";

const BASE = "/midterms/admin/reports/classrooms";

export const midtermReportsApi = {
  async classrooms(): Promise<ClassroomListRow[]> {
    const r = await api.get(`${BASE}/`);
    return r.data?.results ?? [];
  },
  async classroom(classroomId: number): Promise<ClassroomDetail> {
    const r = await api.get(`${BASE}/${classroomId}/`);
    return r.data as ClassroomDetail;
  },
  async midterm(classroomId: number, midtermId: number): Promise<MidtermReport> {
    const r = await api.get(`${BASE}/${classroomId}/midterms/${midtermId}/`);
    return r.data as MidtermReport;
  },
  /** Fetch the server-rendered PDF of one midterm's table and hand it to the browser. */
  async downloadPdf(classroomId: number, midtermId: number): Promise<void> {
    const r = await api.get(`${BASE}/${classroomId}/midterms/${midtermId}/pdf/`, {
      responseType: "blob",
    });
    downloadBlob(r.data as Blob, `midterm-report-${classroomId}-${midtermId}.pdf`);
  },
};

/** DRF's `detail` when it sent one, otherwise the caller's fallback. */
export function errText(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return typeof detail === "string" && detail ? detail : fallback;
}
