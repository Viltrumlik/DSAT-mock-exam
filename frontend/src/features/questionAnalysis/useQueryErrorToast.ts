"use client";

import { useEffect } from "react";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";

/**
 * Toast a failed query once, with the server's own message.
 *
 * The toast is the *second* place the failure shows up, never the only one: every panel on
 * this page renders an explicit error branch as well. A dropped request that only produced a
 * toast would leave the page below it looking like a class with nothing to go over.
 */
export function useQueryErrorToast(error: unknown, context: string): void {
  useEffect(() => {
    if (!error) return;
    pushGlobalToast({ tone: "error", message: `${context}: ${normalizeApiError(error).message}` });
  }, [error, context]);
}
