"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Snowflake } from "lucide-react";
import { authApi } from "@/lib/api";

/**
 * Non-dismissible full-screen block shown to a FROZEN student.
 *
 * The student still lands on their dashboard (rendered behind, dimmed + inert),
 * but this overlay covers the screen and cannot be closed — no navigation, no
 * interaction with the app. The only action is signing out. AuthGuard renders it
 * on every guarded page, so the student can't escape it by changing the URL.
 */
export function FrozenOverlay() {
  const queryClient = useQueryClient();
  const btnRef = useRef<HTMLButtonElement>(null);

  // Lock page scroll + keep focus trapped on the overlay (can't Tab underneath).
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    btnRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        btnRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Account frozen"
      onContextMenu={(e) => e.preventDefault()}
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/70 p-6 backdrop-blur-sm"
      style={{ backdropFilter: "blur(6px)" }}
    >
      <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-2xl">
        <img src="/images/logo.png" alt="MasterSAT" className="mx-auto mb-6 h-16 w-16 object-contain" />
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-100 text-sky-600">
          <Snowflake className="h-8 w-8" />
        </div>
        <h1 className="text-2xl font-black text-slate-900">Your account is frozen</h1>
        <p className="mt-3 font-medium leading-relaxed text-slate-600">
          Your access has been temporarily frozen by an administrator. You can’t use the
          platform right now. Please contact your administrator to restore your access.
        </p>
        <button
          ref={btnRef}
          type="button"
          onClick={() => { void authApi.logout(queryClient); }}
          className="mt-8 inline-flex items-center justify-center rounded-xl bg-slate-900 px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
