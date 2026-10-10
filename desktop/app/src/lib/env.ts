/**
 * Where the native client is running, and how it reaches the server.
 *
 * Importers: lib/native.ts, lib/api.ts, lib/useAuth.tsx. No server contract here.
 */

/** True inside the Tauri shell (the real .exe); false under plain `vite dev` in a browser. */
export const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * In plain-browser dev we serve in-memory mock data so the whole experience — sign-in,
 * "Your tests", every loading / empty / error / offline state — can be built and seen
 * without Rust. The real .exe is always IS_TAURI, so this is never true in production.
 */
export const DEV_MOCK = !IS_TAURI;

/** The production API. Reached through Tauri's HTTP client (native request, no browser CORS). */
export const API_BASE = "https://mastersat.uz/api";

/**
 * Declares a native client: the server then returns JWTs in the response body and lifts
 * cookie-CSRF for this cookie-less caller. See backend/users/auth_cookies.py.
 */
export const NATIVE_CLIENT_HEADER = "X-MasterSAT-Client";
export const NATIVE_CLIENT_VALUE = "desktop";
