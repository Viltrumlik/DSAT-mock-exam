"use client";

import { useQuery } from "@tanstack/react-query";
import { progressApi } from "./progressApi";
import type { PeerResponse, ProgressResponse } from "./progressApi";

export const progressKeys = {
  all: ["progress"] as const,
  peers: ["progress", "peers"] as const,
};

/** The student's per-level attendance + homework progress. */
export function useMyProgress() {
  return useQuery<ProgressResponse>({
    queryKey: progressKeys.all,
    queryFn: () => progressApi.mine(),
  });
}

/** The student beside their group, per subject — its own request, so the ladder never waits. */
export function useMyPeerProgress() {
  return useQuery<PeerResponse>({
    queryKey: progressKeys.peers,
    queryFn: () => progressApi.peers(),
  });
}
