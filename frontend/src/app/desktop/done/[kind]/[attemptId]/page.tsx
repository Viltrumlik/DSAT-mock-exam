"use client";
import { useParams } from "next/navigation";

import { DesktopDone } from "@/features/desktop/DesktopDone";
import type { DesktopPaperKind } from "@/lib/desktop/routes";

/** "You're all finished!" in the app, for a midterm or a past paper. */
export default function DesktopDonePage() {
  const params = useParams();
  const kind: DesktopPaperKind = params.kind === "midterm" ? "midterm" : "pastpaper";
  return <DesktopDone kind={kind} attemptId={Number(params.attemptId)} />;
}
