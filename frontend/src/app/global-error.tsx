"use client";

import { CrashScreen } from "@/components/CrashScreen";

/**
 * Catches what `error.tsx` cannot: the root layout itself throwing, or its chunks never
 * arriving. It replaces the whole document, so it brings its own <html> and <body>.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <CrashScreen error={error} reset={reset} />
      </body>
    </html>
  );
}
