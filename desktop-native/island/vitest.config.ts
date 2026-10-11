// Unit tests (jsdom): the island's own tests plus the website's tests run against the very
// modules the island imports (test/website/*.test.ts re-import them by path).
import { defineConfig } from "vitest/config";

import { sharedConfig } from "./vite.config";

const shared = sharedConfig({ reactShim: false });

export default defineConfig({
  ...shared,
  test: {
    environment: "jsdom",
    globals: true,
    // The website suite pins this zone (frontend/vitest.config.ts); keep it identical.
    env: { TZ: "Asia/Tashkent" },
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    restoreMocks: true,
  },
});
