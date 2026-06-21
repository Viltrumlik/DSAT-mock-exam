"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { authApi, usersApi } from "@/lib/api";
import { useRouter } from "next/navigation";
import { UserPlus, Sparkles, ShieldCheck, LineChart, User, Mail, Lock, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import TelegramLoginButton, { type TelegramOIDCResult } from "@/components/TelegramLoginButton";
import { Button, Input, Field, Alert, Spinner } from "@/components/ui";

declare global {
    interface Window {
        google?: any;
    }
}

export default function RegisterPage() {
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [showPw, setShowPw] = useState(false);
    const googleButtonRef = useRef<HTMLDivElement>(null);
    const router = useRouter();
    const [telegramCfg, setTelegramCfg] = useState<{ enabled: boolean; bot_username: string | null; client_id: string | null; start_url: string | null } | null>(null);

    useEffect(() => {
        usersApi
            .getTelegramWidgetConfig()
            .then(setTelegramCfg)
            .catch(() => setTelegramCfg({ enabled: false, bot_username: null, client_id: null, start_url: null }));
    }, []);

    const handleTelegramAuth = useCallback(
        async (result: TelegramOIDCResult) => {
            setLoading(true);
            setError("");
            try {
                await authApi.telegramAuth(result.id_token, true);
                router.push("/");
            } catch (err: unknown) {
                const ax = err as { response?: { data?: { detail?: string } } };
                setError(ax?.response?.data?.detail || "Telegram signup failed. Check your connection and try again.");
            } finally {
                setLoading(false);
            }
        },
        [router],
    );

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");
        if (firstName.trim().length < 3 || lastName.trim().length < 3 || username.trim().length < 3) {
            setError("First name, last name, and username must be at least 3 characters.");
            setLoading(false);
            return;
        }
        try {
            await authApi.register(firstName, lastName, username, email, password);
            // Auto login after registration
            await authApi.login(email, password);
            router.push("/");
        } catch (err: unknown) {
            const ax = err as { response?: { status?: number; data?: Record<string, unknown> }; code?: string; message?: string };
            let msg = "Registration failed. Please check your details.";
            if (!ax.response) {
                msg = ax.code === "ECONNABORTED" || ax.message?.includes("timeout")
                    ? "Request timed out. Check your connection and try again."
                    : "Cannot connect to the server. Check your internet connection.";
            } else if (ax.response.status === 429) {
                msg = "Too many attempts. Please wait a minute before trying again.";
            } else if (ax.response.data) {
                const d = ax.response.data;
                if (typeof d.detail === "string") msg = d.detail;
                else if (Array.isArray(d.email)) msg = d.email[0] as string;
                else if (Array.isArray(d.username)) msg = d.username[0] as string;
                else if (Array.isArray(d.first_name)) msg = d.first_name[0] as string;
                else if (Array.isArray(d.last_name)) msg = d.last_name[0] as string;
                else if (Array.isArray(d.password)) msg = d.password[0] as string;
                else if (typeof d === "object" && Object.keys(d).length > 0) {
                    const firstError = Object.values(d)[0];
                    if (Array.isArray(firstError)) msg = firstError[0] as string;
                }
            }
            setError(msg);
        } finally {
            setLoading(false);
        }
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
                    callback: async (response: { credential?: string }) => {
                        if (!response?.credential) return;
                        try {
                            await authApi.googleAuth(response.credential, undefined, true);
                            router.push("/");
                        } catch (err: unknown) {
                            const ax = err as { response?: { data?: { detail?: string } } };
                            setError(ax?.response?.data?.detail || "Google sign up failed. Check your connection and try again.");
                        }
                    },
                });
                el.innerHTML = "";
                window.google.accounts.id.renderButton(el, {
                    theme: "outline",
                    size: "large",
                    shape: "pill",
                    width: 360,
                    text: "signup_with",
                });
            } catch (err) {
                console.warn("Google Sign-Up init failed", err);
            }
        };

        tryInit();
        return () => {
            cancelled = true;
            if (pollTimer !== null) window.clearTimeout(pollTimer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router]);

    return (
        <div className="ds-app flex min-h-screen bg-background text-foreground">
            {/* Brand panel — desktop only */}
            <aside
                className="authbrand relative hidden w-[44%] max-w-xl flex-col justify-between overflow-hidden p-12 text-white lg:flex"
                style={{ background: "linear-gradient(160deg,#2a68c0,#1f4d9a)" }}
            >
                <span aria-hidden className="pointer-events-none absolute -right-[70px] -top-[50px] h-[280px] w-[280px] rounded-full bg-white/10" style={{ animation: "dz-floatA 14s ease-in-out infinite" }} />
                <span aria-hidden className="pointer-events-none absolute -bottom-[90px] right-[60px] h-[200px] w-[200px] bg-white/[0.08]" style={{ borderRadius: 44, animation: "dz-floatB 16s ease-in-out infinite" }} />
                <span aria-hidden className="pointer-events-none absolute bottom-[120px] -left-[60px] h-[150px] w-[150px] rounded-full border-[18px] border-white/[0.11]" style={{ animation: "dz-floatC 13s ease-in-out infinite" }} />
                <span aria-hidden className="pointer-events-none absolute left-[40px] top-[180px] h-4 w-4 rounded-[5px] bg-white/30" style={{ animation: "dz-floatD 11s ease-in-out infinite" }} />
                <span aria-hidden className="pointer-events-none absolute right-[120px] top-[90px] h-[60px] w-[60px] rounded-[18px] bg-white/[0.07]" style={{ animation: "dz-floatD 15s ease-in-out infinite" }} />
                <span aria-hidden className="pointer-events-none absolute -bottom-[40px] left-[140px] h-[120px] w-[120px] rounded-full border-[10px] border-white/[0.08]" style={{ animation: "dz-drift 40s linear infinite" }} />

                <div className="relative flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/images/logo.png" alt="" className="h-12 w-auto object-contain" style={{ filter: "brightness(0) invert(1)" }} />
                    <p className="text-xl font-extrabold tracking-tight">MasterSAT</p>
                </div>

                <div className="relative max-w-sm">
                    <h2 className="text-4xl font-extrabold leading-[1.1] tracking-tight">Start your climb to a higher score.</h2>
                    <p className="mt-4 text-[15px] leading-relaxed opacity-90">
                        Set a goal, build a streak, and watch your readiness rise with every practice set.
                    </p>
                    <ul className="mt-8 flex flex-col gap-4">
                        {[
                            { icon: LineChart, text: "Track progress toward your target score" },
                            { icon: Sparkles, text: "A plan that adapts as you improve" },
                            { icon: ShieldCheck, text: "Full-length, test-day-realistic mocks" },
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

                <p className="relative text-xs opacity-70">© {new Date().getFullYear()} MasterSAT Center</p>
            </aside>

            {/* Form panel */}
            <main className="flex flex-1 items-center justify-center px-5 py-10">
                <div className="w-full max-w-md">
                    <div className="mb-8 text-center lg:hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/images/logo.png" alt="" className="mx-auto h-16 w-16 object-contain" />
                        <h1 className="ds-h2 mt-3">Create account</h1>
                    </div>

                    <div className="mb-6 hidden lg:block">
                        <h1 className="ds-h1">Create your account</h1>
                        <p className="ds-small mt-1">Join the MasterSAT program.</p>
                    </div>

                    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                        {error ? <Alert tone="danger">{error}</Alert> : null}

                        <div className="grid grid-cols-2 gap-3">
                            <Field label="First name" htmlFor="firstName">
                                <Input id="firstName" required placeholder="John" value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={loading} autoComplete="given-name" />
                            </Field>
                            <Field label="Last name" htmlFor="lastName">
                                <Input id="lastName" required placeholder="Doe" value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={loading} autoComplete="family-name" />
                            </Field>
                        </div>
                        <Field label="Username" htmlFor="username">
                            <Input id="username" required placeholder="johndoe123" value={username} onChange={(e) => setUsername(e.target.value)} disabled={loading} autoComplete="username" leftIcon={<User className="h-4 w-4" />} />
                        </Field>
                        <Field label="Email address" htmlFor="email-address">
                            <Input id="email-address" type="email" required placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={loading} autoComplete="email" leftIcon={<Mail className="h-4 w-4" />} />
                        </Field>
                        <Field label="Password" htmlFor="password">
                            <Input
                                id="password"
                                type={showPw ? "text" : "password"}
                                required
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                disabled={loading}
                                autoComplete="new-password"
                                leftIcon={<Lock className="h-4 w-4" />}
                                rightSlot={
                                    <button type="button" tabIndex={-1} aria-label={showPw ? "Hide password" : "Show password"}
                                        onClick={() => setShowPw((v) => !v)}
                                        className="ds-ring flex items-center justify-center rounded-md text-label-foreground hover:text-foreground">
                                        {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                }
                            />
                        </Field>

                        <Button type="submit" loading={loading} fullWidth size="lg" rightIcon={<UserPlus />}>
                            Create account
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
                                <span className="ds-overline">Sign up with Telegram</span>
                                {telegramCfg === null ? (
                                    <Spinner className="h-6 w-6 text-muted-foreground" />
                                ) : telegramCfg.enabled && telegramCfg.start_url ? (
                                    <TelegramLoginButton startUrl={telegramCfg.start_url} next="/" />
                                ) : (
                                    <p className="max-w-sm px-2 text-center text-xs text-muted-foreground">
                                        Telegram signup is not configured yet.
                                    </p>
                                )}
                            </div>
                        </div>
                    </form>

                    <p className="mt-6 text-center text-sm text-muted-foreground">
                        Already have an account?{" "}
                        <Link href="/login" className="font-bold text-primary hover:underline">
                            Sign in
                        </Link>
                    </p>
                </div>
            </main>
        </div>
    );
}
