import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    /**
     * The school's own timezone, so a date reads in a test the way the school reads it.
     *
     * Every fixture here writes its datetimes in `+05:00`, and the components render them
     * through `toLocaleDateString`, which answers in the *machine's* zone. Left unpinned, a
     * 09:00 Tashkent session is the previous day for anyone at UTC-7 or further west — the
     * support report's "waiting since Aug 13, 2026" becomes "Aug 12, 2026" — and the suite
     * starts failing on where it was run rather than on what changed. That it passes on a
     * developer's machine here and in a UTC CI is luck: both sit east of that line.
     */
    env: { TZ: "Asia/Tashkent" },
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
