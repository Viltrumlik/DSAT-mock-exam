/**
 * The native app's own API client: JWT tokens in the webview's sandboxed localStorage,
 * requests through Tauri's HTTP client (native, so no browser CORS), one silent refresh on 401.
 *
 * Importers: lib/useAuth.tsx, screens/YourTests.tsx.
 *
 * Endpoints used (all already on the server):
 *   POST /desktop/auth/exchange/   {code, verifier}            → {access, refresh}  (native body)
 *   POST /auth/refresh/            {refresh}                   → {access, refresh}  (native body)
 *   GET  /users/me/                                            → profile brief
 *   GET  /midterms/mine/                                       → {results: MidtermRow[]}
 *   POST /midterms/attempts/       {midterm}                   → {id}
 *   GET  /exams/                                               → PastpaperSection[] | {results}
 *   GET  /exams/attempts/                                      → attempts list
 *   POST /exams/attempts/          {practice_test}             → {id}
 *   GET  /classes/pastpapers/reopened/                         → ReopenedPastpaper[]
 */
import { API_BASE, DEV_MOCK, IS_TAURI, NATIVE_CLIENT_HEADER, NATIVE_CLIENT_VALUE } from "./env";
import {
  groupPastpapers,
  type CardAttempt,
  type MidtermRow,
  type PaperGroup,
  type PastpaperSection,
  type ReopenedPastpaper,
} from "./model";

export interface Me {
  first_name?: string;
  last_name?: string;
}

// ───────────────────────────── token store ─────────────────────────────
// localStorage in the app's local origin is per-app and persists across restarts (WebView2
// keeps it in the app's data folder). Access is kept too so a warm start needs no refresh.

const ACCESS_KEY = "mastersat.access";
const REFRESH_KEY = "mastersat.refresh";

export const tokens = {
  access(): string | null {
    try {
      return localStorage.getItem(ACCESS_KEY);
    } catch {
      return null;
    }
  },
  refresh(): string | null {
    try {
      return localStorage.getItem(REFRESH_KEY);
    } catch {
      return null;
    }
  },
  set(access: string, refresh: string) {
    try {
      localStorage.setItem(ACCESS_KEY, access);
      localStorage.setItem(REFRESH_KEY, refresh);
    } catch {
      /* private mode / blocked storage: tokens live in memory for this run only */
    }
  },
  clear() {
    try {
      localStorage.removeItem(ACCESS_KEY);
      localStorage.removeItem(REFRESH_KEY);
    } catch {
      /* ignore */
    }
  },
  has(): boolean {
    return !!this.refresh();
  },
};

// Signalled when a refresh fails and the session is dropped, so the UI can return to sign-in.
let authLost: (() => void) | null = null;
export function onAuthLost(cb: () => void) {
  authLost = cb;
}

export function signOut() {
  tokens.clear();
}

// ───────────────────────────── transport ─────────────────────────────

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function httpFetch(url: string, init: RequestInit): Promise<Response> {
  if (IS_TAURI) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch(url, init);
  }
  return fetch(url, init);
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function raw(path: string, method: string, body?: unknown, withAuth = true): Promise<any> {
  const headers: Record<string, string> = { [NATIVE_CLIENT_HEADER]: NATIVE_CLIENT_VALUE };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (withAuth) {
    const a = tokens.access();
    if (a) headers["Authorization"] = `Bearer ${a}`;
  }
  const res = await httpFetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const detail = (data && (data.detail || data.message)) || `Request failed (${res.status}).`;
    throw new ApiError(res.status, detail);
  }
  return data;
}

async function tryRefresh(): Promise<boolean> {
  const r = tokens.refresh();
  if (!r) return false;
  try {
    const data = await raw("/auth/refresh/", "POST", { refresh: r }, false);
    if (data?.access) {
      tokens.set(data.access, data.refresh ?? r);
      return true;
    }
  } catch {
    /* fall through to clear */
  }
  tokens.clear();
  authLost?.();
  return false;
}

async function request(path: string, method: string, body?: unknown, withAuth = true): Promise<any> {
  try {
    return await raw(path, method, body, withAuth);
  } catch (e) {
    if (withAuth && e instanceof ApiError && e.status === 401 && tokens.refresh()) {
      if (await tryRefresh()) return raw(path, method, body, withAuth);
    }
    throw e;
  }
}

// ───────────────────────────── auth ─────────────────────────────

/** Redeem the browser's one-time code for a session. Stores the tokens on success. */
export async function exchange(code: string, verifier: string): Promise<void> {
  if (DEV_MOCK) {
    tokens.set("dev-access", "dev-refresh");
    return;
  }
  const data = await raw("/desktop/auth/exchange/", "POST", { code, verifier }, false);
  if (!data?.access || !data?.refresh) {
    throw new ApiError(0, "Sign-in didn't return a session. Please try again.");
  }
  tokens.set(data.access, data.refresh);
}

/** Do we already hold a usable session? (A warm access token, or a refresh that still works.) */
export async function hasSession(): Promise<boolean> {
  if (DEV_MOCK) return tokens.has();
  if (tokens.access()) return true;
  if (tokens.refresh()) return tryRefresh();
  return false;
}

export async function me(): Promise<Me> {
  if (DEV_MOCK) return { first_name: "Aziz", last_name: "" };
  return (await request("/users/me/", "GET")) ?? {};
}

// ───────────────────────────── tests ─────────────────────────────

export async function myMidterms(): Promise<MidtermRow[]> {
  if (DEV_MOCK) return MOCK_MIDTERMS;
  const data = await request("/midterms/mine/", "GET");
  return data?.results ?? [];
}

export async function loadPastpapers(): Promise<PaperGroup[]> {
  if (DEV_MOCK) return groupPastpapers(MOCK_SECTIONS, MOCK_ATTEMPTS, MOCK_REOPENED);
  const [sectionsRaw, attemptsRaw, reopenedRaw] = await Promise.all([
    request("/exams/", "GET"),
    request("/exams/attempts/", "GET"),
    request("/classes/pastpapers/reopened/", "GET").catch(() => []),
  ]);
  const sections: PastpaperSection[] = Array.isArray(sectionsRaw) ? sectionsRaw : (sectionsRaw?.results ?? []);
  const attempts: CardAttempt[] = Array.isArray(attemptsRaw)
    ? attemptsRaw
    : (attemptsRaw?.results ?? attemptsRaw?.items ?? []);
  const reopened: ReopenedPastpaper[] = Array.isArray(reopenedRaw) ? reopenedRaw : (reopenedRaw?.results ?? []);
  return groupPastpapers(sections, attempts, reopened);
}

export async function createMidtermAttempt(midtermId: number): Promise<number> {
  const data = await request("/midterms/attempts/", "POST", { midterm: midtermId });
  return data.id as number;
}

export async function startPastpaper(sectionId: number): Promise<number> {
  const data = await request("/exams/attempts/", "POST", { practice_test: sectionId });
  return data.id as number;
}

// ───────────────────────────── dev mock data ─────────────────────────────
// Only ever used under `vite dev` in a browser (DEV_MOCK). Spans the buckets so every
// state of "Your tests" is visible while building it.

const MOCK_MIDTERMS: MidtermRow[] = [
  {
    midterm_id: 1,
    title: "Month 3 Midterm — Reading & Writing",
    subject: "READING_WRITING",
    scoring_scale: "SCALE_800",
    score_ceiling: 800,
    duration_minutes: 64,
    question_count: 54,
    flavor: "CLASSROOM",
    attempt_id: null,
    state: "NOT_STARTED",
    submitted: false,
    is_open: true,
    is_before_start: false,
    awaiting_code: false,
    available_at: null,
    deadline: null,
    results_visible: false,
    score: null,
    certificate: null,
  },
  {
    midterm_id: 2,
    title: "Month 3 Midterm — Mathematics",
    subject: "MATH",
    scoring_scale: "SCALE_800",
    score_ceiling: 800,
    duration_minutes: 70,
    question_count: 44,
    flavor: "CLASSROOM",
    attempt_id: null,
    state: "NOT_STARTED",
    submitted: false,
    is_open: false,
    is_before_start: false,
    awaiting_code: true, // window open, teacher hasn't started it
    available_at: null,
    deadline: null,
    results_visible: false,
    score: null,
    certificate: null,
  },
  {
    midterm_id: 3,
    title: "Month 2 Midterm — Mathematics",
    subject: "MATH",
    scoring_scale: "SCALE_800",
    score_ceiling: 800,
    duration_minutes: 70,
    question_count: 44,
    flavor: "CLASSROOM",
    attempt_id: 91,
    state: "COMPLETED",
    submitted: true,
    is_open: false,
    is_before_start: false,
    awaiting_code: false,
    available_at: null,
    deadline: null,
    results_visible: true,
    score: 710,
    certificate: { available: true, code: "ABC123", download_url: "", rank: 3, cohort_size: 28 },
  },
];

const MOCK_SECTIONS: PastpaperSection[] = [
  { id: 101, title: "", practice_date: "2025-11-01", subject: "READING_WRITING", label: "A", form_type: "INTERNATIONAL", collection_name: "November 2025 Int. A", is_published: true },
  { id: 102, title: "", practice_date: "2025-11-01", subject: "MATH", label: "A", form_type: "INTERNATIONAL", collection_name: "November 2025 Int. A", is_published: true },
  { id: 103, title: "", practice_date: "2025-10-01", subject: "READING_WRITING", label: "B", form_type: "US", collection_name: "October 2025 US B", is_published: true },
  { id: 104, title: "", practice_date: "2025-10-01", subject: "MATH", label: "B", form_type: "US", collection_name: "October 2025 US B", is_published: true },
];

const MOCK_ATTEMPTS: CardAttempt[] = [
  { id: 5001, practice_test: 102, is_completed: true, is_expired: false, score: 680, completed_at: "2025-11-05T10:00:00Z" },
  { id: 5002, practice_test: 103, is_completed: false, is_expired: false, score: null, current_state: "IN_PROGRESS" },
];

const MOCK_REOPENED: ReopenedPastpaper[] = [{ practice_test_id: 104 }];
