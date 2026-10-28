"use client";

import { CrashScreen } from "@/components/CrashScreen";

/** Catches a page that throws while rendering; the root layout stays up. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrashScreen error={error} reset={reset} />;
}
