/**
 * Domain API: Scoring
 * Ops-level access to scoring pipeline health and failure recovery.
 */

import api from "@/lib/api";
import type { GradingMetrics } from "../types";

export async function getGradingMetrics(): Promise<GradingMetrics | null> {
  try {
    const r = await api.get("/assessments/admin/grading/metrics/");
    return r.data as GradingMetrics;
  } catch {
    return null;
  }
}
