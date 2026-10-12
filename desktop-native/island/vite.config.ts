// Vite build for the two WebView2 islands (architecture.md §2.4, §2.5).
//
//   npm run build  ->  build/island/{content.html, desmos.html, *.js, *.css, KaTeX fonts}
//
// WebView2 serves that folder from the virtual host https://island.mastersat.example/
// (SetVirtualHostNameToFolderMapping), so every URL in the output is relative.
//
// Website modules are imported, not copied: `@website/*` (and the website's own `@/*`, which
// its modules use internally) resolve into ../../frontend/src. Their bare imports (katex,
// dompurify, ...) resolve from THIS package (resolve.dedupe), because the frontend checkout
// has no node_modules of its own here.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin, type UserConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
export const FRONTEND_SRC = resolve(here, "../../frontend/src");
const CONTRACTS = resolve(here, "../contracts");

/** desktop-native/VERSION, plus an optional CI suffix (ISLAND_BUILD_SUFFIX=+sha). */
export function islandBuildId(): string {
  let version = "0.0.0";
  try {
    version = readFileSync(resolve(here, "../VERSION"), "utf8").trim();
  } catch {
    /* keep the placeholder */
  }
  return `island/${version}${process.env.ISLAND_BUILD_SUFFIX ?? ""}`;
}

/**
 * The Desmos key the website uses (`loadDesmos.ts`: NEXT_PUBLIC_DESMOS_API_KEY or its public
 * demo key). Injected at build time from the same variable (architecture.md §2.7, owner Q2).
 */
export const DESMOS_DEMO_KEY = "dcb31709b452b1cf9dc26972add0fda6";

const DESMOS_HOSTS = "https://www.desmos.com https://*.desmos.com";

/** CSP per page (architecture.md §2.5). Injected only into the production build: Vite's dev
 *  server needs inline scripts and a websocket for HMR. */
export const CSP: Record<string, string> = {
  content:
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src blob: data:; font-src 'self'; base-uri 'none'; form-action 'none'",
  // Desmos's calculator.js evaluates generated code: without 'unsafe-eval' it throws while loading,
  // the island reports desmos.failed{script} and native falls back to its own scientific calculator
  // in BOTH tabs (2026-10-12, the owner's laptop). The Desmos page loads nothing but Desmos and our
  // own bundle, and never sees question content, so allowing eval here exposes nothing else.
  desmos:
    `default-src 'none'; script-src 'self' 'unsafe-eval' ${DESMOS_HOSTS}; style-src 'self' 'unsafe-inline' ${DESMOS_HOSTS}; ` +
    `img-src 'self' blob: data: ${DESMOS_HOSTS}; font-src 'self' data: ${DESMOS_HOSTS}; connect-src ${DESMOS_HOSTS}; ` +
    "worker-src 'self' blob:; child-src blob:; base-uri 'none'; form-action 'none'",
};

function cspPlugin(): Plugin {
  return {
    name: "island-csp",
    apply: "build",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const page = ctx.filename.endsWith("desmos.html") ? "desmos" : "content";
        const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP[page]}">`;
        return html.replace("<!--island:csp-->", meta);
      },
    },
  };
}

export function sharedConfig(opts: { reactShim: boolean }): UserConfig {
  const alias: Array<{ find: string | RegExp; replacement: string }> = [
    { find: /^@website\/(.*)$/, replacement: `${FRONTEND_SRC}/$1` },
    { find: /^@\/(.*)$/, replacement: `${FRONTEND_SRC}/$1` },
  ];
  if (opts.reactShim) {
    // The website's MathText.tsx (source of prepareRichText) also defines a React component
    // the island never renders. The shim keeps React out of the island bundle entirely;
    // scripts/check-build.mjs fails the build if React ever leaks in.
    alias.push(
      { find: /^react\/jsx-runtime$/, replacement: resolve(here, "src/website/react-shim.ts") },
      { find: /^react\/jsx-dev-runtime$/, replacement: resolve(here, "src/website/react-shim.ts") },
      { find: /^react$/, replacement: resolve(here, "src/website/react-shim.ts") },
    );
  }
  return {
    resolve: {
      alias,
      dedupe: ["katex", "dompurify", "react", "react-dom", "lucide-react", "zod", "vitest"],
    },
    define: {
      // utils/image.ts reads the website's API origin; the island never fetches, so "".
      "process.env.NEXT_PUBLIC_API_URL": JSON.stringify(""),
      __ISLAND_BUILD__: JSON.stringify(islandBuildId()),
      __DESMOS_API_KEY__: JSON.stringify(process.env.DESMOS_API_KEY || process.env.NEXT_PUBLIC_DESMOS_API_KEY || DESMOS_DEMO_KEY),
    },
  };
}

export default defineConfig(() => {
  const shared = sharedConfig({ reactShim: true });
  return {
    ...shared,
    root: here,
    base: "./",
    publicDir: false,
    plugins: [tailwindcss(), cspPlugin()],
    esbuild: { legalComments: "none" },
    server: {
      port: 5317,
      strictPort: false,
      fs: { allow: [here, FRONTEND_SRC, CONTRACTS] },
    },
    build: {
      outDir: "build/island",
      emptyOutDir: true,
      assetsDir: "",
      // Never inline assets as data: URLs: the content CSP allows fonts only from 'self'
      // (font-src 'self'), so an inlined KaTeX font would be blocked (scripts/visual.mjs
      // caught exactly that in Chromium). Every font ships as a file.
      assetsInlineLimit: 0,
      target: "chrome120",
      sourcemap: false,
      cssCodeSplit: true,
      modulePreload: { polyfill: false },
      reportCompressedSize: false,
      rollupOptions: {
        input: {
          content: resolve(here, "content.html"),
          desmos: resolve(here, "desmos.html"),
        },
        onwarn(warning, warn) {
          // Website modules start with "use client" (a Next.js directive); harmless here.
          if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
          warn(warning);
        },
      },
    },
  };
});
