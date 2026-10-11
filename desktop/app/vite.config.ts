import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// The built SPA is bundled into the Tauri app (src-tauri/tauri.conf.json → frontendDist),
// served over the app's own protocol — so assets are referenced relatively.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  base: "./",
  build: { outDir: "dist", emptyOutDir: true, target: "chrome105" },
  server: { port: 5190, strictPort: false },
});
