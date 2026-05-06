import axios, { type AxiosError, type AxiosResponse } from 'axios';
import type { TelegramAuthUser } from "@/types/telegramAuth";
import { buildSanitizedAuthCorrelationHeaders } from "@/lib/auth/authCorrelation";
import { evaluateAuthCircuitBreaker, noteTemporalStaleRejection } from "@/lib/auth/authCircuitBreaker";
import {
    getAuthLossVersion,
    markAuthLossDetected,
    shouldBlockMutatingRequests,
    tryScheduleAuthRedirect,
} from "@/lib/auth/authConcurrency";
import { pushGlobalToastOnce } from "@/lib/toastBus";
import type { QueryClient } from "@tanstack/react-query";
import Cookies from 'js-cookie';
import {
    AUTH_NOTICE_STORAGE_KEY,
    broadcastLogoutToOtherTabs,
} from "@/lib/auth/authTabSync";
import { meQueryKey } from "@/lib/auth/meQueryKey";
import type { TestAttempt } from "@/features/examsStudent/testAttemptSchema";
import {
    parseMockExamPublicList,
    parseMockExamPublicPayload,
    parsePracticeTestPublicList,
    parsePracticeTestPublicPayload,
    parseTestAttemptApiPayload,
    parseTestAttemptList,
    type MockExamPublic,
    type NormalizedExamList,
    type PracticeTestPublic,
} from "@/lib/examsPublicContract";
import {
    parseAdminPastpaperPackList,
    parseAssignmentList,
    parseAuthSessionPayload,
    parseBulkAssignResponse,
    parseBulkAssignmentHistoryList,
    parseClassroomList,
    parseCsrfPayload,
    parseUserMePayload,
    type Assignment,
    type BulkAssignmentDispatch,
    type AdminPastpaperPack,
    type Classroom,
    type NormalizedList,
    type UserMe,
} from "@/lib/criticalApiContract";

export type { MockExamPublic, NormalizedExamList, PracticeTestPublic } from "@/lib/examsPublicContract";
export { InvalidApiPayloadError, emptyNormalizedExamList } from "@/lib/examsPublicContract";
export type { Assignment, AdminPastpaperPack, BulkAssignmentDispatch, Classroom, NormalizedList, UserMe } from "@/lib/criticalApiContract";
export { emptyNormalizedList } from "@/lib/criticalApiContract";

/** Tighter budget for bootstrap identity probes (UX: fail faster to login/error path). */
export const ME_REQUEST_TIMEOUT_MS = 10_000;
/**
 * Axios default timeout for all other requests (CSRF/refresh/etc.).
 * Required so a wedged `/auth/refresh/` cannot leave `/users/me` hanging forever behind the 401 interceptor.
 */
export const HTTP_CLIENT_TIMEOUT_MS = 35_000;

const API_URL = '/api';
const IS_PROD = process.env.NODE_ENV === 'production';

function cookieDomain(): string | undefined {
    if (typeof window === "undefined") return undefined;
    const host = window.location.hostname.toLowerCase();
    // Share auth cookies across subdomains in production.
    if (host.endsWith("mastersat.uz")) return ".mastersat.uz";
    return undefined;
}

const AUTH_COOKIE_NAMES = [
    // Legacy JS-readable tokens (removed); still cleared defensively.
    "access_token",
    "refresh_token",
    "is_admin",
    "is_frozen",
    "role",
    "lms_permissions",
    "lms_scope",
    "lms_user",
] as const;

/** Remove JS-readable auth **projection** cookies only (not HttpOnly session cookies). */
export function clearDerivedAuthProjectionCookies() {
    if (typeof window === "undefined") return;
    const host = window.location.hostname;
    const sharedDomain = cookieDomain();
    const domains = [undefined, host, sharedDomain].filter(Boolean) as (string | undefined)[];
    const paths = ["/"];
    const names = ["lms_user", "lms_permissions"] as const;
    for (const name of names) {
        for (const path of paths) {
            Cookies.remove(name, { path });
            for (const domain of domains) {
                Cookies.remove(name, { path, domain });
            }
        }
    }
}

export function clearAuthCookiesEverywhere() {
    if (typeof window === "undefined") return;
    const host = window.location.hostname;
    const sharedDomain = cookieDomain();
    const domains = [undefined, host, sharedDomain].filter(Boolean) as (string | undefined)[];
    const paths = ["/"];

    for (const name of AUTH_COOKIE_NAMES) {
        for (const path of paths) {
            Cookies.remove(name, { path });
            for (const domain of domains) {
                Cookies.remove(name, { path, domain });
            }
        }
    }
}

/** JS-readable projection of GET /users/me/ — not used for authorization decisions */
export function writeLmsUserCacheFromMe(me: unknown, rememberMe: boolean): void {
    if (typeof window === "undefined" || !me || typeof me !== "object") return;
    const m = me as Record<string, unknown>;
    const cookieOptions = {
        secure: IS_PROD,
        sameSite: "lax" as const,
        expires: rememberMe ? 7 : undefined,
        domain: IS_PROD ? cookieDomain() : undefined,
        path: "/" as const,
    };
    const rawPerms = m.permissions;
    const permissions = Array.isArray(rawPerms) ? rawPerms.filter((x) => typeof x === "string") : [];
    Cookies.set(
        "lms_user",
        JSON.stringify({
            id: m.id,
            email: m.email,
            username: m.username,
            first_name: m.first_name,
            last_name: m.last_name,
            role: m.role ? String(m.role).toLowerCase() : "",
            subject: m.subject ? String(m.subject).toLowerCase() : "",
            permissions,
            is_frozen: !!m.is_frozen,
            is_admin: !!m.is_admin,
        }),
        cookieOptions,
    );
    Cookies.remove("lms_subject", { path: "/", domain: IS_PROD ? cookieDomain() : undefined });
}

async function persistMeCookie(rememberMe: boolean) {
    try {
        const r = await api.get("/users/me/", {
            timeout: ME_REQUEST_TIMEOUT_MS,
        });
        const me = parseUserMePayload(r.data, "GET /users/me/ (persist cookie)");
        writeLmsUserCacheFromMe(me, rememberMe);
    } catch {
        clearDerivedAuthProjectionCookies();
    }
}

const api = axios.create({
    baseURL: API_URL,
    timeout: HTTP_CLIENT_TIMEOUT_MS,
    withCredentials: true,
});

/** POST with retries on 429 (and transient 503): exponential backoff, honors Retry-After when present. */
async function axiosPostWith429Backoff<T>(
    call: () => Promise<AxiosResponse<T>>,
    options?: { maxRetries?: number; baseDelayMs?: number; maxDelayMs?: number },
): Promise<AxiosResponse<T>> {
    const maxRetries = options?.maxRetries ?? 5;
    const baseDelayMs = options?.baseDelayMs ?? 800;
    const maxDelayMs = options?.maxDelayMs ?? 30_000;
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await call();
        } catch (err: unknown) {
            lastError = err;
            const ax = err as AxiosError;
            const status = ax.response?.status;
            const retryable = status === 429 || status === 503;
            if (retryable && attempt < maxRetries) {
                const ra = ax.response?.headers?.['retry-after'];
                const raSec = ra != null ? parseInt(String(ra), 10) : NaN;
                const fromHeader = Number.isFinite(raSec) && raSec > 0 ? raSec * 1000 : null;
                const backoff = fromHeader ?? Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
                await new Promise((r) => setTimeout(r, backoff));
                continue;
            }
            break;
        }
    }
    throw lastError;
}

/** DRF may return a bare array or a paginated ``{ results: [...] }`` object. */
function unwrapAdminList<T>(data: unknown): T[] {
    if (Array.isArray(data)) return data as T[];
    if (data && typeof data === 'object' && Array.isArray((data as { results?: unknown }).results)) {
        return (data as { results: T[] }).results;
    }
    return [];
}

/** Admin exam list payloads always include a numeric primary key. */
type AdminListEntity = { id: number };

function urlSkipsTemporalStaleCheck(relUrl: string): boolean {
    const u = String(relUrl || "").toLowerCase();
    return (
        u.includes("/auth/refresh") ||
        u.includes("/auth/login") ||
        u.includes("/auth/logout") ||
        u.includes("/auth/csrf") ||
        u.includes("/auth/client-telemetry")
    );
}

api.interceptors.request.use((config) => {
    // Auth is cookie-based (HttpOnly access token). Do not attach Authorization header.
    // CSRF hardening: send X-CSRFToken for unsafe methods when csrftoken cookie exists.
    try {
        (config as unknown as Record<string, unknown>).__mastersatEnqueueLossVer = getAuthLossVersion();
        const method = String(config.method || "get").toLowerCase();
        if (shouldBlockMutatingRequests(method, String(config.url || ""))) {
            return Promise.reject(
                Object.assign(new Error("AUTH_CONCURRENCY_BLOCKED"), { __mastersatConcurrencyBlocked: true }),
            );
        }
        const hdrs = buildSanitizedAuthCorrelationHeaders();
        (config.headers as any) = config.headers || {};
        Object.assign(config.headers as Record<string, string>, hdrs);

        const unsafe = method !== "get" && method !== "head" && method !== "options";
        if (unsafe) {
            const csrf = Cookies.get("csrftoken");
            if (csrf) {
                (config.headers as any)["X-CSRFToken"] = csrf;
            }
        }
    } catch {
        // ignore
    }
    return config;
});

api.interceptors.response.use(
    (response: AxiosResponse) => {
        try {
            const cfg = response.config as unknown as Record<string, unknown> | undefined;
            const url = String(cfg?.url ?? "");
            if (!urlSkipsTemporalStaleCheck(url) && typeof cfg?.__mastersatEnqueueLossVer === "number") {
                const enq = cfg.__mastersatEnqueueLossVer as number;
                if (getAuthLossVersion() > enq) {
                    return Promise.reject(
                        Object.assign(new Error("AUTH_TEMPORAL_STALE"), {
                            __mastersatTemporalStale: true,
                            __mastersatStaleResponse: response,
                        }),
                    );
                }
            }
        } catch {
            /* ignore */
        }
        return response;
    },
    async (error) => {
        const ex = error as { message?: string; __mastersatTemporalStale?: boolean };
        if (ex?.message === "AUTH_TEMPORAL_STALE" || ex?.__mastersatTemporalStale) {
            noteTemporalStaleRejection();
            pushGlobalToastOnce(
                "auth.temporal-stale.retry",
                {
                    tone: "neutral",
                    message:
                        "Your session advanced while we were completing that step. Anything already saved stayed saved — please try once more.",
                },
                16_000,
            );
            if (evaluateAuthCircuitBreaker()) {
                window.dispatchEvent(new Event("mastersat-auth-circuit-trip"));
            }
            return Promise.reject(error);
        }

        if (error.response?.status === 403 && error.response?.data?.detail) {
            if (typeof window !== 'undefined') {
                // Avoid blocking alerts (and leaking backend detail strings) in production UX.
                console.warn("Forbidden:", error.response.data.detail);
            }
        }

        // Auth hardening for long-running sessions (exams):
        // On 401, attempt a token refresh once, then retry the original request.
        // Only redirect to /login if refresh fails.
        if (error.response?.status === 401) {
            if (typeof window !== "undefined" && (globalThis as any).__mastersatLogoutInProgress) {
                return Promise.reject(error);
            }
            const original = error.config as any;
            if (original && !original.__isRetryRequest) {
                original.__isRetryRequest = true;
                try {
                    // Shared refresh promise to avoid thundering herd.
                    // Refresh uses HttpOnly cookie `lms_refresh`; no JS-readable tokens.
                    if (!(globalThis as any).__mastersatRefreshPromise) {
                        (globalThis as any).__mastersatRefreshPromise = (async () => {
                            // Use the shared axios instance so CSRF headers apply.
                            await authApi.csrf();
                            await api.post("/auth/refresh/", {});
                            return true;
                        })().finally(() => {
                            (globalThis as any).__mastersatRefreshPromise = null;
                        });
                    }
                    await (globalThis as any).__mastersatRefreshPromise;
                    return api(original);
                } catch {
                    // fall through to logout/redirect
                }
            }

            if (typeof window !== "undefined") {
                const url = String(original?.url ?? "");
                // `/users/me` is bootstrap-only; app layer (`useMe`, `AuthGuard`) decides redirect/session UX.
                if (url.includes("users/me")) {
                    return Promise.reject(error);
                }
                const inExamRunner = String(window.location?.pathname || "").startsWith("/exam/");
                if (inExamRunner) {
                    const e: any = error;
                    e.__mastersatAuthRequired = true;
                    return Promise.reject(e);
                }
                (globalThis as any).__mastersatLogoutInProgress = true;
            }
            clearAuthCookiesEverywhere();
            if (typeof window !== "undefined") {
                markAuthLossDetected("EXPIRED");
                tryScheduleAuthRedirect(() => {
                    window.location.href = "/login";
                });
            }
        }
        return Promise.reject(error);
    }
);

export const usersApi = {
    getMe: async (opts?: { signal?: AbortSignal }): Promise<UserMe> => {
        const signal = opts?.signal;
        const r = await api.get("/users/me/", {
            signal,
            timeout: ME_REQUEST_TIMEOUT_MS,
        });
        if (signal?.aborted) {
            throw new DOMException("Aborted", "AbortError");
        }
        return parseUserMePayload(r.data, "GET /users/me/");
    },
    patchMe: async (data: FormData | Record<string, unknown>): Promise<UserMe> => {
        const r = await api.patch('/users/me/', data);
        return parseUserMePayload(r.data, "PATCH /users/me/");
    },
    /** Public: Telegram widget bot username when TELEGRAM_BOT_TOKEN is set (uses getMe if TELEGRAM_BOT_USERNAME unset). */
    getTelegramWidgetConfig: async (): Promise<{ enabled: boolean; bot_username: string | null }> => {
        const r = await api.get('/users/telegram/config/');
        return r.data;
    },
    /** Link Telegram to the logged-in user (profile). */
    linkTelegram: async (payload: TelegramAuthUser): Promise<UserMe> => {
        const r = await api.post('/users/telegram/link/', payload);
        return parseUserMePayload(r.data, "POST /users/telegram/link/");
    },
    /** Active SAT/exam dates for profile dropdown (admin-managed). */
    listExamDates: async () => {
        const r = await api.get('/users/exam-dates/');
        return r.data;
    },
    getSecurity: async () => {
        const r = await api.get('/users/me/security/');
        return r.data as {
            last_password_change: string | null;
            security_step_up_active: boolean;
            suspicious_login_alerts: number;
            events: Array<{
                id: number;
                event_type: string;
                severity: string;
                ip: string;
                user_agent: string;
                detail: Record<string, unknown>;
                created_at: string;
            }>;
        };
    },
};

export const authApi = {
    csrf: async () => {
        // Must be called before login/refresh/logout on hardened CSRF flows.
        const r = await api.get("/auth/csrf/");
        return parseCsrfPayload(r.data, "GET /auth/csrf/");
    },
    register: async (firstName: string, lastName: string, username: string, email: string, password: string) => {
        const response = await api.post('/users/register/', { 
            first_name: firstName,
            last_name: lastName,
            username: username,
            email, 
            password
        });
        return parseAuthSessionPayload(response.data, "POST /users/register/");
    },
    login: async (email: string, password: string, rememberMe = true) => {
        // Avoid "sticky sessions" when old host-only + shared-domain cookies both exist.
        clearAuthCookiesEverywhere();
        await authApi.csrf();
        const response = await api.post('/auth/login/', { email, password, remember_me: rememberMe ? 1 : 0 });
        await persistMeCookie(rememberMe);
        return parseAuthSessionPayload(response.data, "POST /auth/login/");
    },
    googleAuth: async (credential: string, profile?: { first_name?: string; last_name?: string; username?: string }, rememberMe = true) => {
        clearAuthCookiesEverywhere();
        await authApi.csrf();
        const response = await api.post('/users/google/', { credential, ...(profile || {}) });
        await persistMeCookie(rememberMe);
        return parseAuthSessionPayload(response.data, "POST /users/google/");
    },
    telegramAuth: async (
        payload: Record<string, unknown> & {
            id: number;
            auth_date: number;
            hash: string;
        },
        rememberMe = true
    ) => {
        clearAuthCookiesEverywhere();
        await authApi.csrf();
        const response = await api.post('/users/telegram/', payload);
        await persistMeCookie(rememberMe);
        return parseAuthSessionPayload(response.data, "POST /users/telegram/");
    },
    logout: async (queryClient?: QueryClient | null) => {
        try {
            await authApi.csrf();
            await api.post("/auth/logout/", {});
        } catch {
            // ignore
        }
        try {
            localStorage.removeItem(AUTH_NOTICE_STORAGE_KEY);
        } catch {
            /* ignore */
        }
        broadcastLogoutToOtherTabs();
        clearAuthCookiesEverywhere();
        queryClient?.removeQueries({ queryKey: [...meQueryKey] });
        window.location.href = '/login';
    },
    refresh: async (_rememberMe = true) => {
        await authApi.csrf();
        const response = await api.post("/auth/refresh/", {});
        return parseAuthSessionPayload(response.data, "POST /auth/refresh/");
    },
    getSessions: async () => {
        const r = await api.get("/auth/sessions/");
        return r.data as { sessions: any[] };
    },
    revokeSession: async (sessionId: number) => {
        const r = await api.post(`/auth/sessions/${sessionId}/revoke/`, {});
        return r.data;
    },
    revokeAllSessions: async () => {
        const r = await api.post("/auth/sessions/revoke_all/", {});
        return r.data;
    },
};

export const examsPublicApi = {
    getMockExams: async (): Promise<NormalizedExamList<MockExamPublic>> => {
        const res = await api.get('/exams/mock-exams/');
        return parseMockExamPublicList(res.data, "GET /exams/mock-exams/");
    },
    getMockExam: async (id: number): Promise<MockExamPublic> => {
        const res = await api.get(`/exams/mock-exams/${id}/`);
        return parseMockExamPublicPayload(res.data, `GET /exams/mock-exams/${id}/`);
    },
    /** Pastpaper practice library only (standalone tests). Timed mocks: mock-exams APIs + /mock/:id. */
    getPracticeTests: async (): Promise<NormalizedExamList<PracticeTestPublic>> => {
        const res = await api.get('/exams/');
        return parsePracticeTestPublicList(res.data, "GET /exams/");
    },
    getPracticeTest: async (id: number): Promise<PracticeTestPublic> => {
        const res = await api.get(`/exams/${id}/`);
        return parsePracticeTestPublicPayload(res.data, `GET /exams/${id}/`);
    },
    getAttempts: async (): Promise<NormalizedExamList<TestAttempt>> => {
        const res = await api.get('/exams/attempts/');
        return parseTestAttemptList(res.data, "GET /exams/attempts/");
    },
    startTest: async (testId: number): Promise<TestAttempt> => {
        const res = await api.post('/exams/attempts/', { practice_test: testId });
        return parseTestAttemptApiPayload(res.data, "POST /exams/attempts/");
    },
    startModule: async (attemptId: number, moduleId: number): Promise<TestAttempt> => {
        const key = `start_module.${attemptId}.${moduleId}.${Date.now()}`;
        const res = await api.post(
            `/exams/attempts/${attemptId}/start_module/`,
            { module_id: moduleId },
            { headers: { "Idempotency-Key": key } },
        );
        return parseTestAttemptApiPayload(
            res.data,
            `POST /exams/attempts/${attemptId}/start_module/`,
        );
    },
    getAttemptStatus: async (attemptId: number): Promise<TestAttempt> => {
        // Canonical polling endpoint (new exam engine); fall back to legacy retrieve.
        try {
            const r = await api.get(`/exams/attempts/${attemptId}/status/`);
            return parseTestAttemptApiPayload(
                r.data,
                `GET /exams/attempts/${attemptId}/status/`,
            );
        } catch {
            const res = await api.get(`/exams/attempts/${attemptId}/`);
            return parseTestAttemptApiPayload(res.data, `GET /exams/attempts/${attemptId}/`);
        }
    },
    startAttemptEngine: async (attemptId: number, idempotencyKey?: string): Promise<TestAttempt> => {
        const res = await api.post(
            `/exams/attempts/${attemptId}/start/`,
            {},
            { headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined },
        );
        return parseTestAttemptApiPayload(res.data, `POST /exams/attempts/${attemptId}/start/`);
    },
    resumeAttemptEngine: async (attemptId: number, idempotencyKey?: string): Promise<TestAttempt> => {
        const res = await api.post(
            `/exams/attempts/${attemptId}/resume/`,
            {},
            { headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined },
        );
        return parseTestAttemptApiPayload(res.data, `POST /exams/attempts/${attemptId}/resume/`);
    },
    submitModule: async (attemptId: number, answers: object, flagged: number[] = [], options?: { idempotencyKey?: string; expectedVersionNumber?: number }): Promise<TestAttempt> => {
        const headers: Record<string, string> = {};
        if (options?.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
        const payload: Record<string, unknown> = { answers, flagged };
        if (options?.expectedVersionNumber != null) payload.expected_version_number = options.expectedVersionNumber;
        const res = await api.post(`/exams/attempts/${attemptId}/submit_module/`, payload, { headers: Object.keys(headers).length ? headers : undefined });
        return parseTestAttemptApiPayload(
            res.data,
            `POST /exams/attempts/${attemptId}/submit_module/`,
        );
    },
    saveAttempt: async (attemptId: number, answers: object, flagged: number[] = [], options?: { idempotencyKey?: string; expectedVersionNumber?: number }): Promise<TestAttempt> => {
        const headers: Record<string, string> = {};
        if (options?.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
        const payload: Record<string, unknown> = { answers, flagged };
        if (options?.expectedVersionNumber != null) payload.expected_version_number = options.expectedVersionNumber;
        const res = await api.post(`/exams/attempts/${attemptId}/save_attempt/`, payload, { headers: Object.keys(headers).length ? headers : undefined });
        return parseTestAttemptApiPayload(
            res.data,
            `POST /exams/attempts/${attemptId}/save_attempt/`,
        );
    },
    getResults: async (attemptId: number): Promise<TestAttempt> => {
        const res = await api.get(`/exams/attempts/${attemptId}/results/`);
        return parseTestAttemptApiPayload(res.data, `GET /exams/attempts/${attemptId}/results/`);
    },
    getReview: async (attemptId: number, moduleId?: number): Promise<TestAttempt> => {
        const url = moduleId
            ? `/exams/attempts/${attemptId}/review/?module_id=${moduleId}`
            : `/exams/attempts/${attemptId}/review/`;
        const res = await api.get(url);
        return parseTestAttemptApiPayload(res.data, `GET ${url}`);
    }
};

export const classesApi = {
    list: async (): Promise<NormalizedList<Classroom>> => {
        const r = await api.get('/classes/');
        return parseClassroomList(r.data, "GET /classes/");
    },
    /** Single classroom (member only); 404 if not enrolled or invalid id. */
    get: async (classId: number) => {
        const r = await api.get(`/classes/${classId}/`);
        return r.data;
    },
    create: async (data: { name: string; subject: 'ENGLISH' | 'MATH'; lesson_days: 'ODD' | 'EVEN'; lesson_time?: string; lesson_hours?: number; start_date?: string; room_number?: string; telegram_chat_id?: string; teacher?: number; max_students?: number; is_active?: boolean }) => {
        const r = await api.post('/classes/', data);
        return r.data;
    },
    update: async (classId: number, data: Record<string, unknown>) => {
        const r = await api.patch(`/classes/${classId}/`, data);
        return r.data;
    },
    join: async (join_code: string) => {
        const r = await api.post('/classes/join/', { join_code });
        return r.data;
    },
    regenerateCode: async (classId: number) => {
        const r = await api.post(`/classes/${classId}/regenerate_code/`);
        return r.data;
    },
    people: async (classId: number) => {
        const r = await api.get(`/classes/${classId}/people/`);
        return r.data;
    },
    getLeaderboard: async (classId: number) => {
        const r = await api.get(`/classes/${classId}/leaderboard/`);
        return r.data;
    },
    /** Unified activity feed (posts, assignments, submissions), paginated. */
    getStream: async (classId: number, params?: { page?: number; page_size?: number }) => {
        const r = await api.get(`/classes/${classId}/stream/`, { params });
        return r.data;
    },
    /** Student-focused slices: your_assignments (with workflow_status), due_soon, recently_graded, new_posts. */
    getStudentWorkspace: async (classId: number) => {
        const r = await api.get(`/classes/${classId}/student-workspace/`);
        return r.data;
    },
    listComments: async (classId: number, targetType: 'post' | 'assignment', targetId: number) => {
        const r = await api.get(`/classes/${classId}/comments/`, {
            params: { target_type: targetType, target_id: targetId },
        });
        return r.data;
    },
    createComment: async (
        classId: number,
        data: { target_type: 'post' | 'assignment'; target_id: number; content: string; parent?: number | null },
    ) => {
        const r = await api.post(`/classes/${classId}/comments/`, data);
        return r.data;
    },
    /** Class teacher: mock exams + pastpaper tests for homework form (same visibility as portal lists). */
    getAssignmentOptions: async (classId: number) => {
        const r = await api.get(`/classes/${classId}/assignment-options/`);
        return r.data;
    },
    // Stream
    listPosts: async (classId: number) => {
        const r = await api.get(`/classes/${classId}/posts/`);
        return r.data;
    },
    createPost: async (classId: number, data: { content: string }) => {
        const r = await api.post(`/classes/${classId}/posts/`, data);
        return r.data;
    },
    // Assignments
    listAssignments: async (classId: number): Promise<NormalizedList<Assignment>> => {
        const r = await api.get(`/classes/${classId}/assignments/`);
        return parseAssignmentList(r.data, `GET /classes/${classId}/assignments/`);
    },
    createAssignment: async (classId: number, data: any, isFormData = false) => {
        const r = await api.post(`/classes/${classId}/assignments/`, data, isFormData ? {} : {});
        return r.data;
    },
    updateAssignment: async (
        classId: number,
        assignmentId: number,
        data: Record<string, unknown> | FormData,
        isFormData = false,
        options?: { replaceAttachments?: boolean },
    ) => {
        const r = await api.patch(`/classes/${classId}/assignments/${assignmentId}/`, data, {
            ...(isFormData ? {} : {}),
            ...(options?.replaceAttachments ? { params: { replace_attachments: '1' } } : {}),
        });
        return r.data;
    },
    deleteAssignment: async (classId: number, assignmentId: number) => {
        await api.delete(`/classes/${classId}/assignments/${assignmentId}/`);
    },
    submitAssignment: async (classId: number, assignmentId: number, payload: any, isFormData = true) => {
        const r = await axiosPostWith429Backoff(() =>
            api.post(
                `/classes/${classId}/assignments/${assignmentId}/submit/`,
                payload,
                isFormData ? {} : {},
            ),
        );
        return r.data;
    },
    getMySubmission: async (classId: number, assignmentId: number) => {
        const r = await api.get(`/classes/${classId}/assignments/${assignmentId}/my-submission/`);
        return r.data;
    },
    // Admin grading
    listSubmissions: async (classId: number, assignmentId: number) => {
        const r = await api.get(`/classes/${classId}/assignments/${assignmentId}/submissions/`);
        return r.data;
    },
    gradeSubmission: async (
        submissionId: number,
        payload: {
            grade?: string | number | null;
            score?: string | number | null;
            feedback?: string;
            expected_revision?: number;
        },
    ) => {
        const r = await api.post(`/classes/submissions/${submissionId}/grade/`, payload);
        return r.data;
    },
    /** Teacher returns work so the student can edit and resubmit (SUBMITTED or REVIEWED only). */
    returnSubmission: async (submissionId: number, payload?: { note?: string; expected_revision?: number }) => {
        const r = await api.post(`/classes/submissions/${submissionId}/return/`, payload ?? {});
        return r.data;
    },
    getSubmissionAuditLog: async (submissionId: number) => {
        const r = await api.get(`/classes/submissions/${submissionId}/audit-log/`);
        return r.data;
    },
};

export const examsAdminApi = {
    // Users
    getUsers: async () => { const r = await api.get('/users/'); return r.data; },
    createUser: async (data: object) => { const r = await api.post('/users/create/', data); return r.data; },
    updateUser: async (id: number, data: object) => { const r = await api.patch(`/users/${id}/update/`, data); return r.data; },
    deleteUser: async (id: number) => { await api.delete(`/users/${id}/delete/`); },

    listExamDatesAdmin: async () => {
        const r = await api.get('/users/admin/exam-dates/');
        return r.data;
    },
    createExamDate: async (data: {
        exam_date: string;
        label?: string;
        is_active?: boolean;
        sort_order?: number;
    }) => {
        const r = await api.post('/users/admin/exam-dates/', data);
        return r.data;
    },
    updateExamDate: async (
        id: number,
        data: Partial<{ exam_date: string; label: string; is_active: boolean; sort_order: number }>
    ) => {
        const r = await api.patch(`/users/admin/exam-dates/${id}/`, data);
        return r.data;
    },
    deleteExamDate: async (id: number) => {
        await api.delete(`/users/admin/exam-dates/${id}/`);
    },

    // Mock Exams (top-level grouping)
    getMockExams: async () => {
        const r = await api.get('/exams/admin/mock-exams/');
        return unwrapAdminList<AdminListEntity>(r.data);
    },
    createMockExam: async (data: object) => { const r = await api.post('/exams/admin/mock-exams/', data); return r.data; },
    updateMockExam: async (id: number, data: object) => { const r = await api.patch(`/exams/admin/mock-exams/${id}/`, data); return r.data; },
    deleteMockExam: async (id: number) => { await api.delete(`/exams/admin/mock-exams/${id}/`); },
    addTestToExam: async (examId: number, subject: string, label: string = '', formType: string = 'INTERNATIONAL') => {
        const r = await api.post(`/exams/admin/mock-exams/${examId}/add_test/`, { subject, label, form_type: formType });
        return r.data;
    },
    removeTestFromExam: async (examId: number, testId: number) => {
        const r = await api.delete(`/exams/admin/mock-exams/${examId}/remove_test/`, { data: { test_id: testId } });
        return r.data;
    },
    assignStudentsToExam: async (examId: number, userIds: number[]) => {
        const r = await api.post(`/exams/admin/mock-exams/${examId}/assign_users/`, { user_ids: userIds });
        return r.data;
    },
    publishMockExam: async (examId: number) => {
        const r = await api.post(`/exams/admin/mock-exams/${examId}/publish/`);
        return r.data;
    },
    unpublishMockExam: async (examId: number) => {
        const r = await api.post(`/exams/admin/mock-exams/${examId}/unpublish/`);
        return r.data;
    },
    bulkAssignStudents: async (
        examIds: number[],
        userIds: number[],
        assignmentType: string = 'FULL',
        formType?: string,
        practiceTestIds?: number[],
        clientContext?: Record<string, unknown>
    ): Promise<Record<string, unknown>> => {
        const payload: Record<string, unknown> = {
            exam_ids: examIds,
            user_ids: userIds,
            assignment_type: assignmentType,
        };
        if (formType) payload.form_type = formType;
        if (practiceTestIds?.length) payload.practice_test_ids = practiceTestIds;
        if (clientContext && Object.keys(clientContext).length) payload.client_context = clientContext;
        const res = await api.post('/exams/bulk_assign/', payload);
        return parseBulkAssignResponse(res.data, "POST /exams/bulk_assign/");
    },

    listBulkAssignmentHistory: async (): Promise<NormalizedList<BulkAssignmentDispatch>> => {
        const r = await api.get('/exams/assignments/history/');
        return parseBulkAssignmentHistoryList(r.data, "GET /exams/assignments/history/");
    },

    rerunBulkAssignmentDispatch: async (dispatchId: number) => {
        const r = await api.post(`/exams/assignments/history/${dispatchId}/rerun/`);
        return r.data;
    },

    getPastpaperPacks: async (): Promise<NormalizedList<AdminPastpaperPack>> => {
        const r = await api.get('/exams/admin/pastpaper-packs/');
        return parseAdminPastpaperPackList(r.data, "GET /exams/admin/pastpaper-packs/");
    },
    createPastpaperPack: async (data: object) => {
        const r = await api.post('/exams/admin/pastpaper-packs/', data);
        return r.data;
    },
    updatePastpaperPack: async (id: number, data: object) => {
        const r = await api.patch(`/exams/admin/pastpaper-packs/${id}/`, data);
        return r.data;
    },
    deletePastpaperPack: async (id: number) => {
        await api.delete(`/exams/admin/pastpaper-packs/${id}/`);
    },
    addPastpaperPackSection: async (packId: number, subject: 'READING_WRITING' | 'MATH') => {
        const r = await api.post(`/exams/admin/pastpaper-packs/${packId}/add_section/`, { subject });
        return r.data;
    },

    getPracticeTestsAdmin: async (standaloneOnly?: boolean) => {
        const r = await api.get('/exams/admin/tests/', {
            params: standaloneOnly ? { standalone: '1' } : undefined,
        });
        return unwrapAdminList<AdminListEntity>(r.data);
    },
    createPracticeTest: async (data: Record<string, unknown>) => {
        const r = await api.post('/exams/admin/tests/', { mock_exam: null, ...data });
        return r.data;
    },
    updatePracticeTest: async (id: number, data: object) => {
        const r = await api.patch(`/exams/admin/tests/${id}/`, data);
        return r.data;
    },
    deletePracticeTest: async (id: number) => {
        await api.delete(`/exams/admin/tests/${id}/`);
    },

    // Modules
    getModules: async (testId: number) => { const r = await api.get(`/exams/admin/tests/${testId}/modules/`); return r.data; },
    updateModule: async (testId: number, moduleId: number, data: object) => { const r = await api.patch(`/exams/admin/tests/${testId}/modules/${moduleId}/`, data); return r.data; },

    // Questions
    getQuestions: async (testId: number, moduleId: number) => { const r = await api.get(`/exams/admin/tests/${testId}/modules/${moduleId}/questions/`); return r.data; },
    createQuestion: async (testId: number, moduleId: number, data: FormData | object, isFormData = false) => {
        // Let axios set multipart boundary; a bare Content-Type breaks file uploads.
        const r = await api.post(`/exams/admin/tests/${testId}/modules/${moduleId}/questions/`, data, isFormData ? {} : {});
        return r.data;
    },
    updateQuestion: async (testId: number, moduleId: number, questionId: number, data: FormData | object, isFormData = false) => {
        const r = await api.patch(`/exams/admin/tests/${testId}/modules/${moduleId}/questions/${questionId}/`, data, isFormData ? {} : {});
        return r.data;
    },
    deleteQuestion: async (testId: number, moduleId: number, questionId: number) => {
        await api.delete(`/exams/admin/tests/${testId}/modules/${moduleId}/questions/${questionId}/`);
    },
    unlinkQuestionFromModule: async (testId: number, moduleId: number, questionId: number) => {
        const r = await api.post(
            `/exams/admin/tests/${testId}/modules/${moduleId}/questions/${questionId}/unlink-from-module/`,
        );
        return r.data;
    },
    reorderQuestion: async (testId: number, moduleId: number, questionId: number, action: 'up' | 'down') => {
        const r = await api.post(`/exams/admin/tests/${testId}/modules/${moduleId}/questions/${questionId}/reorder/`, { action });
        return r.data;
    },

    // Standalone question bank + categories
    listStandaloneQuestions: async (params?: {
        standalone?: "1";
        composer?: "1";
        exclude_module?: number;
        limit?: number;
        offset?: number;
        q?: string;
        category?: number | "all";
        subject?: "MATH" | "READING_WRITING" | "all";
        is_active?: "1" | "0" | "all";
        status?: "draft" | "review" | "approved" | "archived";
    }) => {
        const r = await api.get("/exams/admin/questions/", { params });
        return unwrapAdminList<AdminListEntity>(r.data);
    },
    updateStandaloneQuestion: async (questionId: number, data: Record<string, unknown>) => {
        const r = await api.patch(`/exams/admin/questions/${questionId}/`, data);
        return r.data;
    },
    createStandaloneQuestion: async (data: Record<string, unknown>) => {
        const r = await api.post("/exams/admin/questions/", data);
        return r.data;
    },
    getStandaloneQuestion: async (questionId: number) => {
        const r = await api.get(`/exams/admin/questions/${questionId}/`);
        return r.data;
    },
    submitStandaloneQuestionForReview: async (questionId: number) => {
        const r = await api.post(`/exams/admin/questions/${questionId}/submit-for-review/`);
        return r.data;
    },
    approveStandaloneQuestion: async (questionId: number) => {
        const r = await api.post(`/exams/admin/questions/${questionId}/approve/`);
        return r.data;
    },
    rejectStandaloneQuestion: async (questionId: number, comment?: string) => {
        const r = await api.post(`/exams/admin/questions/${questionId}/reject/`, {
            comment: comment?.trim() || "",
        });
        return r.data;
    },
    getStandaloneQuestionModuleLinks: async (questionId: number) => {
        const r = await api.get(`/exams/admin/questions/${questionId}/module-links/`);
        return r.data;
    },
    getCategoriesAdmin: async () => {
        const r = await api.get("/exams/admin/categories/");
        return unwrapAdminList<AdminListEntity>(r.data);
    },
    assignStandaloneQuestionToModule: async (testId: number, moduleId: number, payload: { question_id: number; order?: number }) => {
        const r = await api.post(`/exams/admin/tests/${testId}/modules/${moduleId}/assign-question/`, payload);
        return r.data;
    },
};

export const vocabularyApi = {
    listWords: async (params?: { q?: string; difficulty?: number; part_of_speech?: string }) => {
        const r = await api.get("/vocabulary/words/", { params });
        return r.data;
    },
    getDaily: async (params?: { target?: number }) => {
        const r = await api.get("/vocabulary/daily/", { params });
        return r.data;
    },
    review: async (payload: { word_id: number; result: "correct" | "wrong" }) => {
        const r = await api.post("/vocabulary/review/", payload);
        return r.data;
    },
    adminListWords: async () => {
        const r = await api.get("/vocabulary/admin/words/");
        return r.data;
    },
    adminCreateWord: async (payload: {
        word: string;
        meaning?: string;
        example?: string;
        part_of_speech?: string;
        difficulty?: number;
    }) => {
        const r = await api.post("/vocabulary/admin/words/", payload);
        return r.data;
    },
    adminUpdateWord: async (
        id: number,
        payload: Partial<{
            word: string;
            meaning: string;
            example: string;
            part_of_speech: string;
            difficulty: number;
        }>,
    ) => {
        const r = await api.patch(`/vocabulary/admin/words/${id}/`, payload);
        return r.data;
    },
    adminDeleteWord: async (id: number) => {
        await api.delete(`/vocabulary/admin/words/${id}/`);
    },
};

export const assessmentsAdminApi = {
    adminListSets: async (params?: { subject?: "math" | "english"; category?: string }) => {
        const r = await api.get("/assessments/admin/sets/", { params });
        return r.data;
    },
    adminCreateSet: async (payload: {
        subject: "math" | "english";
        category?: string;
        title: string;
        description?: string;
        is_active?: boolean;
    }) => {
        const r = await api.post("/assessments/admin/sets/", payload);
        return r.data;
    },
    adminUpdateSet: async (
        id: number,
        payload: Partial<{
            subject: "math" | "english";
            category: string;
            title: string;
            description: string;
            is_active: boolean;
        }>,
    ) => {
        const r = await api.patch(`/assessments/admin/sets/${id}/`, payload);
        return r.data;
    },
    adminGetSet: async (id: number) => {
        const r = await api.get(`/assessments/admin/sets/${id}/`);
        return r.data;
    },
    adminCreateQuestion: async (
        setId: number,
        payload: {
            order?: number;
            prompt: string;
            question_type: "multiple_choice" | "short_text" | "numeric" | "boolean";
            choices?: any[];
            correct_answer?: any;
            grading_config?: Record<string, unknown>;
            points?: number;
            is_active?: boolean;
        },
    ) => {
        const r = await api.post(`/assessments/admin/sets/${setId}/questions/`, payload);
        return r.data;
    },
    adminUpdateQuestion: async (
        id: number,
        payload: Partial<{
            order: number;
            prompt: string;
            question_type: "multiple_choice" | "short_text" | "numeric" | "boolean";
            choices: any[];
            correct_answer: any;
            grading_config: Record<string, unknown>;
            points: number;
            is_active: boolean;
        }>,
    ) => {
        const r = await api.patch(`/assessments/admin/questions/${id}/`, payload);
        return r.data;
    },
    adminDeleteQuestion: async (id: number) => {
        await api.delete(`/assessments/admin/questions/${id}/`);
    },
    assignHomework: async (
        payload: {
            classroom_id: number;
            set_id: number;
            title?: string;
            instructions?: string;
            due_at?: string | null;
        },
        idempotencyKey?: string,
    ) => {
        const r = await api.post("/assessments/homework/assign/", payload, {
            headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
        });
        return r.data;
    },
};

export default api;
