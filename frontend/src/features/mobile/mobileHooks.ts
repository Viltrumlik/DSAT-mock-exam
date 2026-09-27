"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mobileApi, type DiagnosticKind, type ReleasePolicy } from "./mobileApi";

const keys = {
  policy: ["mobile", "policy"] as const,
  diagnostics: (days: number, kind: string, version: string) => ["mobile", "diagnostics", days, kind, version] as const,
  diagnostic: (id: number) => ["mobile", "diagnostic", id] as const,
};

export function useReleasePolicy() {
  return useQuery({ queryKey: keys.policy, queryFn: () => mobileApi.policy() });
}

export function useSaveReleasePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Pick<ReleasePolicy, "latest_version" | "minimum_version" | "update_url" | "message">) =>
      mobileApi.savePolicy(body),
    onSuccess: (policy) => qc.setQueryData(keys.policy, policy),
  });
}

export function useDiagnostics(days: number, kind: DiagnosticKind | "", version: string) {
  return useQuery({
    queryKey: keys.diagnostics(days, kind, version),
    queryFn: () => mobileApi.diagnostics({ days, kind, app_version: version }),
  });
}

export function useDiagnostic(id: number | null) {
  return useQuery({
    queryKey: keys.diagnostic(id ?? 0),
    queryFn: () => mobileApi.diagnostic(id as number),
    enabled: id != null,
  });
}
