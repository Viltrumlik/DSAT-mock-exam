"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authApi, usersApi } from "@/lib/api";
import { invalidateMe } from "@/hooks/useMe";
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2, LogIn, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import TelegramLoginButton, { type TelegramOIDCResult } from '@/components/TelegramLoginButton';
import type { AuthNoticeRecord } from "@/lib/auth/authTabSync";
import { consumeAuthNotice } from "@/lib/auth/authTabSync";

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

export default function LoginPage() {
    const queryClient = useQueryClient();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isRetryable, setIsRetryable] = useState(false);
    const [loading, setLoading] = useState(false);
    const [rememberMe, setRememberMe] = useState(true);
    const [googleCredential, setGoogleCredential] = useState('');
    const [googleMissing, setGoogleMissing] = useState<string[]>([]);
    const [googleProfile, setGoogleProfile] = useState({ first_name: '', last_name: '', username: '' });
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
        setError('');
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
            setError('');
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
        setError('');
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
                setError('Please complete missing profile fields to continue.');
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
                // GSI script (https://accounts.google.com/gsi/client) is loaded with
                // strategy="afterInteractive"; it may not be ready yet at mount. Poll
                // for up to ~10s so the button still renders after the script lands.
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
                // Replace any prior button (e.g. on hot-reload) before re-rendering.
                el.innerHTML = "";
                window.google.accounts.id.renderButton(el, {
                    theme: "outline",
                    size: "large",
                    shape: "pill",
                    width: 360,
                    text: "continue_with",
                });
            } catch (err) {
                // Surface init failures (e.g. invalid client_id) instead of a silent dead button.
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

    return (
        <div className="min-h-screen app-bg flex items-center justify-center p-6 transition-colors duration-500">
            <div className="w-full max-w-md">
                <div className="text-center mb-7">
                    <img src="/images/logo.png" alt="MasterSAT" className="mx-auto w-20 h-20 object-contain drop-shadow-xl" />
                    <h1 className="mt-4 text-3xl font-black text-slate-900 tracking-tight">MasterSAT</h1>
                    <p className="text-slate-500 mt-2 font-medium">Sign in to continue your preparation</p>
                </div>

                <div className="hero-shell p-8 transition-colors duration-300">
                    <form className="space-y-5" onSubmit={handleSubmit}>
                        {authRouteNotice?.reason === "EXPIRED" && (
                            <div
                                className="flex items-start gap-3 text-amber-900 dark:text-amber-100 text-sm font-medium bg-amber-50 dark:bg-amber-950/40 p-4 rounded-xl border border-amber-200/80 dark:border-amber-800/60 animate-in fade-in slide-in-from-top-2 duration-200"
                                role="status"
                            >
                                <AlertCircle className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400" />
                                <span>Your session has expired. Please sign in again.</span>
                            </div>
                        )}
                        {authRouteNotice?.reason === "NO_SESSION" && (
                            <div
                                className="flex items-start gap-3 text-slate-800 dark:text-slate-200 text-sm font-medium bg-slate-100 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-800 animate-in fade-in slide-in-from-top-2 duration-200"
                                role="status"
                            >
                                <AlertCircle className="w-5 h-5 shrink-0 text-slate-500 dark:text-slate-400" />
                                <span>No active session found. Sign in to continue.</span>
                            </div>
                        )}
                        {authRouteNotice?.reason === "NETWORK" && (
                            <div
                                className="flex items-start gap-3 text-slate-800 dark:text-slate-200 text-sm font-medium bg-slate-100 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-800 animate-in fade-in slide-in-from-top-2 duration-200"
                                role="status"
                            >
                                <AlertCircle className="w-5 h-5 shrink-0 text-slate-500 dark:text-slate-400" />
                                <span>The network was interrupted while loading your profile. Sign in again to continue.</span>
                            </div>
                        )}
                        {authRouteNotice?.reason === "SERVER" && (
                            <div
                                className="flex items-start gap-3 text-slate-800 dark:text-slate-200 text-sm font-medium bg-slate-100 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-800 animate-in fade-in slide-in-from-top-2 duration-200"
                                role="status"
                            >
                                <AlertCircle className="w-5 h-5 shrink-0 text-slate-500 dark:text-slate-400" />
                                <span>The server could not validate your profile. Sign in again, or retry after a short wait.</span>
                            </div>
                        )}
                        {error && (
                            <div className="flex items-start gap-3 text-red-600 dark:text-red-400 text-sm font-medium bg-red-50 dark:bg-red-900/20 p-4 rounded-xl border border-red-100 dark:border-red-900/50 animate-in fade-in slide-in-from-top-2 duration-200">
                                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                    <span>{error}</span>
                                    {isRetryable && (
                                        <button
                                            type="button"
                                            onClick={handleRetry}
                                            disabled={loading}
                                            className="mt-2 flex items-center gap-1.5 text-xs font-bold text-red-700 dark:text-red-300 hover:underline disabled:opacity-50"
                                        >
                                            <RefreshCw className="w-3 h-3" />
                                            Retry
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2 ml-1" htmlFor="email-address">
                                    Email or Username
                                </label>
                                <input
                                    id="email-address"
                                    type="text"
                                    required
                                    className="input-modern font-medium sm:text-sm"
                                    placeholder="name@example.com or username"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    disabled={loading}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2 ml-1" htmlFor="password">
                                    Password
                                </label>
                                <input
                                    id="password"
                                    type="password"
                                    required
                                    className="input-modern font-medium sm:text-sm"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    disabled={loading}
                                />
                            </div>
                            <div className="flex items-center justify-between">
                                <label className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 font-semibold cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={rememberMe}
                                        onChange={(e) => setRememberMe(e.target.checked)}
                                        className="rounded border-border text-primary focus:ring-primary bg-card"
                                    />
                                    Remember me for 1 week
                                </label>
                            </div>
                        </div>

                        <div className="pt-1">
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full btn-primary disabled:opacity-70 disabled:cursor-not-allowed group"
                            >
                                {loading ? (
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                    <>
                                        Sign In to Portal
                                        <LogIn className="w-4 h-4 ml-2 opacity-70 group-hover:opacity-100 transition-opacity" />
                                    </>
                                )}
                            </button>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="h-px bg-slate-200 dark:bg-slate-800 flex-1" />
                            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">or</span>
                            <div className="h-px bg-slate-200 dark:bg-slate-800 flex-1" />
                        </div>
                        <div className="flex flex-col items-center gap-4">
                            <div className="flex justify-center bg-white dark:bg-white rounded-full mx-auto w-fit p-1">
                                <div ref={googleButtonRef} className="dark:mix-blend-normal" />
                            </div>
                            <div className="w-full flex flex-col items-center gap-2">
                                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                                    Sign in with Telegram
                                </span>
                                {telegramCfg === null ? (
                                    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                                ) : telegramCfg.enabled && telegramCfg.start_url ? (
                                    <TelegramLoginButton startUrl={telegramCfg.start_url} next="/" />
                                ) : (
                                    <p className="text-center text-xs text-slate-500 dark:text-slate-400 max-w-sm px-2">
                                        Telegram login is not configured yet. An administrator must set{" "}
                                        <code className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1 rounded">
                                            TELEGRAM_BOT_TOKEN
                                        </code>{" "}
                                        and register the bot with @BotFather for OIDC login on{" "}
                                        <code className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1 rounded">mastersat.uz</code>.
                                    </p>
                                )}
                            </div>
                        </div>
                        {googleMissing.length > 0 && (
                            <div className="space-y-3 pt-2">
                                {googleMissing.includes('first_name') && (
                                    <input
                                        type="text"
                                        placeholder="First name (min 3)"
                                        className="w-full px-4 py-3 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 text-slate-900 dark:text-white rounded-xl focus:outline-none focus:border-blue-500 transition-colors"
                                        value={googleProfile.first_name}
                                        onChange={(e) => setGoogleProfile(prev => ({ ...prev, first_name: e.target.value }))}
                                    />
                                )}
                                {googleMissing.includes('last_name') && (
                                    <input
                                        type="text"
                                        placeholder="Last name (min 3)"
                                        className="w-full px-4 py-3 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 text-slate-900 dark:text-white rounded-xl focus:outline-none focus:border-blue-500 transition-colors"
                                        value={googleProfile.last_name}
                                        onChange={(e) => setGoogleProfile(prev => ({ ...prev, last_name: e.target.value }))}
                                    />
                                )}
                                <button
                                    type="button"
                                    onClick={() => handleGoogleCredential(googleCredential, googleProfile)}
                                    className="w-full py-3 rounded-xl bg-slate-900 dark:bg-slate-800 text-white font-bold hover:bg-slate-800 dark:hover:bg-slate-700 transition-colors"
                                >
                                    Continue with Google profile
                                </button>
                            </div>
                        )}
                    </form>
                    <div className="mt-5 text-center">
                        <span className="text-sm text-slate-500 dark:text-slate-400 font-medium">Don't have an account? </span>
                        <Link href="/register" className="text-sm font-bold text-primary hover:opacity-90 transition-opacity">
                            Register Now
                        </Link>
                    </div>
                </div>
                <p className="mt-6 text-center text-xs text-slate-400 font-medium">© {new Date().getFullYear()} MasterSAT Center</p>
            </div>
        </div>
    );
}
