"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authApi, usersApi } from "@/lib/api";
import { invalidateMe } from "@/hooks/useMe";
import { useRouter } from "next/navigation";
import { LogIn, RefreshCw, GraduationCap, Sparkles, ShieldCheck, LineChart } from "lucide-react";
import Link from "next/link";
import TelegramLoginButton, { type TelegramOIDCResult } from "@/components/TelegramLoginButton";
import type { AuthNoticeRecord } from "@/lib/auth/authTabSync";
import { consumeAuthNotice } from "@/lib/auth/authTabSync";
import { Button, Input, Field, Checkbox, Alert, Spinner, type AlertTone } from "@/components/ui";

declare global {
    interface Window {
        google?: any;
    }
}

function classifyLoginError(err: unknown): { message: string; retryable: boolean } {
    const ax = err as { response?: { status?: number; data?: { detail?: string; missing_fields?: string[] } }; code?: string; message?: string };
    const status = ax.response?.status;
    const detail = ax.response?.data?.detail;

    if (!ax.response) {
        if (ax.code === "ECONNABORTED" || ax.message?.includes("timeout")) {
            return { message: "Request timed out. Please check your connection and try again.", retryable: true };
        }
        return { message: "Cannot connect to the server. Check your internet connection and try again.", retryable: true };
    }
    if (status === 401 || status === 400) {
        return { message: detail || "The email or password you entered is incorrect.", retryable: false };
    }
    if (status === 403) {
        return { message: detail || "Your account has been restricted. Contact support.", retryable: false };
    }
    if (status === 429) {
        return { message: "Too many login attempts. Please wait a minute before trying again.", retryable: false };
    }
    if (status !== undefined && status >= 500) {
        return { message: "Server error. Please try again in a moment.", retryable: true };
    }
    return { message: detail || "Sign-in failed. Please try again.", retryable: true };
}

function getRedirectTarget(): string {
    const host = typeof window !== "undefined" ? window.location.hostname.toLowerCase() : "";
    if (host.startsWith("admin.")) return "/ops";
    if (host.startsWith("questions.")) return "/builder";
    return "/";
}

const NOTICE_COPY: Record<string, { tone: AlertTone; message: string }> = {
    EXPIRED: { tone: "warning", message: "Your session has expired. Please sign in again." },
    NO_SESSION: { tone: "info", message: "No active session found. Sign in to continue." },
    NETWORK: { tone: "info", message: "The network was interrupted while loading your profile. Sign in again to continue." },
    SERVER: { tone: "info", message: "The server could not validate your profile. Sign in again, or retry after a short wait." },
};

export default function LoginPage() {
    const queryClient = useQueryClient();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [isRetryable, setIsRetryable] = useState(false);
    const [loading, setLoading] = useState(false);
    const [rememberMe, setRememberMe] = useState(true);
    const [googleCredential, setGoogleCredential] = useState("");
    const [googleMissing, setGoogleMissing] = useState<string[]>([]);
    const [googleProfile, setGoogleProfile] = useState({ first_name: "", last_name: "", username: "" });
    const googleButtonRef = useRef<HTMLDivElement>(null);
    const router = useRouter();
    const [telegramCfg, setTelegramCfg] = useState<{
        enabled: boolean;
        bot_username: string | null;
        client_id: string | null;
        start_url: string | null;
    } | null>(null);
    const lastSubmitRef = useRef<(() => void) | null>(null);

    const [authRouteNotice, setAuthRouteNotice] = useState<AuthNoticeRecord | null>(null);

    useEffect(() => {
        const rec = consumeAuthNotice();
        if (rec) setAuthRouteNotice(rec);
    }, []);

    useEffect(() => {
        usersApi
            .getTelegramWidgetConfig()
            .then(setTelegramCfg)
            .catch(() => setTelegramCfg({ enabled: false, bot_username: null, client_id: null, start_url: null }));
    }, []);

    const completeLogin = useCallback(async () => {
        try {
            await usersApi.getMe().catch(() => null);
        } catch { /* identity probe is best-effort */ }
        void invalidateMe(queryClient);
        router.push(getRedirectTarget());
    }, [queryClient, router]);

    const handleSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!email.trim() || !password) return;
        setLoading(true);
        setError("");
        setIsRetryable(false);
        lastSubmitRef.current = () => void handleSubmit();
        try {
            await authApi.login(email, password, rememberMe);
            await completeLogin();
        } catch (err: unknown) {
            const { message, retryable } = classifyLoginError(err);
            setError(message);
            setIsRetryable(retryable);
        } finally {
            setLoading(false);
        }
    };

    const handleTelegramAuth = useCallback(
        async (result: TelegramOIDCResult) => {
            setLoading(true);
            setError("");
            setIsRetryable(false);
            lastSubmitRef.current = () => void handleTelegramAuth(result);
            try {
                await authApi.telegramAuth(result.id_token, rememberMe);
                await completeLogin();
            } catch (err: unknown) {
                const { message, retryable } = classifyLoginError(err);
                setError(message);
                setIsRetryable(retryable);
            } finally {
                setLoading(false);
            }
        },
        [rememberMe, completeLogin],
    );

    const handleGoogleCredential = async (credential: string, profile?: { first_name?: string; last_name?: string; username?: string }) => {
        setLoading(true);
        setError("");
        setIsRetryable(false);
        lastSubmitRef.current = () => void handleGoogleCredential(credential, profile);
        try {
            await authApi.googleAuth(credential, profile, rememberMe);
            await completeLogin();
        } catch (err: unknown) {
            const ax = err as { response?: { data?: { missing_fields?: string[] } } };
            const missing = ax.response?.data?.missing_fields;
            if (Array.isArray(missing) && missing.length) {
                setGoogleCredential(credential);
                setGoogleMissing(missing);
                setError("Please complete missing profile fields to continue.");
                setIsRetryable(false);
            } else {
                const { message, retryable } = classifyLoginError(err);
                setError(message);
                setIsRetryable(retryable);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleRetry = () => {
        if (lastSubmitRef.current) lastSubmitRef.current();
    };

    useEffect(() => {
        const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
        if (!clientId || clientId.includes("your-google-web-client-id")) return;

        let cancelled = false;
        let pollTimer: number | null = null;

        const tryInit = () => {
            if (cancelled) return;
            const el = googleButtonRef.current;
            if (!window.google?.accounts?.id || !el) {
                pollTimer = window.setTimeout(tryInit, 200);
                return;
            }
            try {
                window.google.accounts.id.initialize({
                    client_id: clientId,
                    callback: (response: { credential?: string }) => {
                        if (response?.credential) {
                            void handleGoogleCredential(response.credential);
                        }
                    },
                });
                el.innerHTML = "";
                window.google.accounts.id.renderButton(el, {
                    theme: "outline",
                    size: "large",
                    shape: "pill",
                    width: 360,
                    text: "continue_with",
                });
            } catch (err) {
                console.warn("Google Sign-In init failed", err);
            }
        };

        tryInit();
        return () => {
            cancelled = true;
            if (pollTimer !== null) window.clearTimeout(pollTimer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const notice = authRouteNotice?.reason ? NOTICE_COPY[authRouteNotice.reason] : null;

    return (
        <div className="ds-app flex min-h-screen bg-background text-foreground">
            {/* Brand panel — desktop only */}
            <aside className="relative hidden w-[44%] max-w-xl flex-col justify-between overflow-hidden bg-primary p-12 text-primary-foreground lg:flex">
                <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15">
                        <GraduationCap className="h-6 w-6" />
                    </span>
                    <div>
                        <p className="text-lg font-extrabold tracking-tight">MasterSAT</p>
                        <p className="text-[11px] font-bold uppercase tracking-[0.16em] opacity-80">Learning OS</p>
                    </div>
                </div>

                <div className="max-w-sm">
                    <h2 className="text-4xl font-extrabold leading-[1.1] tracking-tight">Your digital SAT, mastered.</h2>
                    <p className="mt-4 text-[15px] leading-relaxed opacity-90">
                        Pick up where you left off, track your readiness, and practice with full test-day realism.
                    </p>
                    <ul className="mt-8 flex flex-col gap-4">
                        {[
                            { icon: LineChart, text: "Live readiness and score trends" },
                            { icon: Sparkles, text: "Recommendations tuned to your goal" },
                            { icon: ShieldCheck, text: "Realistic, distraction-free testing" },
                        ].map(({ icon: Icon, text }) => (
                            <li key={text} className="flex items-center gap-3 text-[15px] font-medium">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
                                    <Icon className="h-4 w-4" />
                                </span>
                                {text}
                            </li>
                        ))}
                    </ul>
                </div>

                <p className="text-xs opacity-70">© {new Date().getFullYear()} MasterSAT Center</p>
            </aside>

            {/* Form panel */}
            <main className="flex flex-1 items-center justify-center px-5 py-10">
                <div className="w-full max-w-md">
                    <div className="mb-8 text-center lg:hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/images/logo.png" alt="" className="mx-auto h-16 w-16 object-contain" />
                        <h1 className="ds-h2 mt-3">MasterSAT</h1>
                    </div>

                    <div className="mb-6 hidden lg:block">
                        <h1 className="ds-h1">Welcome back</h1>
                        <p className="ds-small mt-1">Sign in to continue your preparation.</p>
                    </div>

                    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                        {notice ? <Alert tone={notice.tone}>{notice.message}</Alert> : null}
                        {error ? (
                            <Alert tone="danger" title={error}>
                                {isRetryable ? (
                                    <button
                                        type="button"
                                        onClick={handleRetry}
                                        disabled={loading}
                                        className="ds-ring mt-1 inline-flex items-center gap-1.5 rounded-md text-xs font-bold underline disabled:opacity-50"
                                    >
                                        <RefreshCw className="h-3 w-3" /> Retry
                                    </button>
                                ) : null}
                            </Alert>
                        ) : null}

                        <Field label="Email or username" htmlFor="email-address">
                            <Input
                                id="email-address"
                                type="text"
                                required
                                placeholder="name@example.com or username"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                disabled={loading}
                                autoComplete="username"
                            />
                        </Field>
                        <Field label="Password" htmlFor="password">
                            <Input
                                id="password"
                                type="password"
                                required
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                disabled={loading}
                                autoComplete="current-password"
                            />
                        </Field>

                        <Checkbox
                            id="remember"
                            label="Remember me for 1 week"
                            checked={rememberMe}
                            onChange={(e) => setRememberMe(e.target.checked)}
                        />

                        <Button type="submit" loading={loading} fullWidth size="lg" rightIcon={<LogIn />}>
                            Sign in
                        </Button>

                        <div className="flex items-center gap-3 py-1">
                            <span className="h-px flex-1 bg-border" />
                            <span className="ds-overline">or</span>
                            <span className="h-px flex-1 bg-border" />
                        </div>

                        <div className="flex flex-col items-center gap-4">
                            <div className="mx-auto w-fit rounded-full bg-white p-1">
                                <div ref={googleButtonRef} />
                            </div>
                            <div className="flex w-full flex-col items-center gap-2">
                                <span className="ds-overline">Sign in with Telegram</span>
                                {telegramCfg === null ? (
                                    <Spinner className="h-6 w-6 text-muted-foreground" />
                                ) : telegramCfg.enabled && telegramCfg.start_url ? (
                                    <TelegramLoginButton startUrl={telegramCfg.start_url} next="/" />
                                ) : (
                                    <p className="max-w-sm px-2 text-center text-xs text-muted-foreground">
                                        Telegram login is not configured yet.
                                    </p>
                                )}
                            </div>
                        </div>

                        {googleMissing.length > 0 ? (
                            <div className="flex flex-col gap-3 pt-1">
                                {googleMissing.includes("first_name") ? (
                                    <Input
                                        placeholder="First name (min 3)"
                                        value={googleProfile.first_name}
                                        onChange={(e) => setGoogleProfile((p) => ({ ...p, first_name: e.target.value }))}
                                    />
                                ) : null}
                                {googleMissing.includes("last_name") ? (
                                    <Input
                                        placeholder="Last name (min 3)"
                                        value={googleProfile.last_name}
                                        onChange={(e) => setGoogleProfile((p) => ({ ...p, last_name: e.target.value }))}
                                    />
                                ) : null}
                                <Button type="button" variant="secondary" fullWidth onClick={() => handleGoogleCredential(googleCredential, googleProfile)}>
                                    Continue with Google profile
                                </Button>
                            </div>
                        ) : null}
                    </form>

                    <p className="mt-6 text-center text-sm text-muted-foreground">
                        Don&apos;t have an account?{" "}
                        <Link href="/register" className="font-bold text-primary hover:underline">
                            Register now
                        </Link>
                    </p>
                </div>
            </main>
        </div>
    );
}
