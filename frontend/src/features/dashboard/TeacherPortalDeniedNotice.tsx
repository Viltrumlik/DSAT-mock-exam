"use client";

import { useEffect } from "react";

/**
 * Shows a one-time permission notice after an unauthorized user is bounced from the
 * Teacher Portal (AuthGuard redirects to `${MAIN_SITE_URL}/?denied=teacher-portal`).
 * Fires the global toast (see ToastProvider's `mastersat-toast` listener) and strips
 * the query param so a refresh doesn't re-trigger it. Renders nothing itself.
 */
export function TeacherPortalDeniedNotice() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("denied") !== "teacher-portal") return;

    window.dispatchEvent(
      new CustomEvent("mastersat-toast", {
        detail: {
          tone: "error",
          message: "You do not have permission to access the Teacher Portal.",
        },
      }),
    );

    // Clean the URL so the notice doesn't reappear on refresh / back-forward.
    params.delete("denied");
    const qs = params.toString();
    const next = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
    window.history.replaceState(null, "", next);
  }, []);

  return null;
}
