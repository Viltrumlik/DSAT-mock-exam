// Exports the HTML the visual comparison needs (scripts/visual.mjs screenshots it):
// the website's own React components rendered over the same fixtures, in jsdom.
import { defineConfig } from "vitest/config";

import { sharedConfig } from "./vite.config";

const shared = sharedConfig({ reactShim: false });

export default defineConfig({
  ...shared,
  test: {
    environment: "jsdom",
    globals: true,
    env: { TZ: "Asia/Tashkent" },
    include: ["visual/**/*.visual.tsx"],
  },
});
