"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { authApi, usersApi } from "@/lib/api";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Globe,
  Loader2,
  LogOut,
  Monitor,
  RefreshCcw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  X,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";

// ─── Types ────────────────────────────────────────────────────────────────────

type Session = {
  id: number;
  created_at: string | null;
  last_seen_at: string | null;
  ip: string | null;
  user_agent: string | null;
  revoked_at: string | null;
};

type SecurityData = Awaited<ReturnType<typeof usersApi.getSecurity>>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 2) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  } catch { return iso; }
}

function parseUA(ua: string | null): { device: string; browser: string } {
  if (!ua) return { device: "Unknown device", browser: "Unknown browser" };
  const isMobile = /mobile|android|iphone|ipad/i.test(ua);
  let device = isMobile ? "Mobile" : "Desktop";
  if (/ipad/i.test(ua)) device = "iPad";
  else if (/iphone/i.test(ua)) device = "iPhone";
  else if (/android/i.test(ua)) device = "Android";
  let browser = "Unknown browser";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/opr\//i.test(ua)) browser = "Opera";
  else if (/chrome/i.test(ua)) browser = "Chrome";
  else if (/firefox/i.test(ua)) browser = "Firefox";
  else if (/safari/i.test(ua)) browser = "Safari";
  return { device, browser };
}

// ─── Session card ─────────────────────────────────────────────────────────────

function SessionCard({
  session, isCurrent, onRevoke, revoking,
}: {
  session: Session; isCurrent: boolean;
  onRevoke: (id: number) => void; revoking: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const { device, browser } = parseUA(session.user_agent);
  const isActive = !session.revoked_at;
  const isMobile = /mobile|android|iphone|ipad/i.test(session.user_agent ?? "");
  const DeviceIcon = isMobile ? Smartphone : Monitor;

  return (
    <div className={`rounded-2xl border p-4 transition-colors ${
      isCurrent ? "border-primary/30 bg-primary/5"
      : isActive ? "border-border bg-card"
      : "border-border bg-surface-2/40 opacity-60"
    }`}>
      <div className="flex items-start gap-3">
        <div className={`shrink-0 rounded-xl p-2 ${
          isCurrent ? "bg-primary/10 text-primary"
          : "bg-surface-2 text-muted-foreground"
        }`}>
          <DeviceIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-extrabold text-foreground">{browser} on {device}</p>
            {isCurrent && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-black text-primary">
                Current session
              </span>
            )}
            {!isActive && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-black text-muted-foreground">
                Revoked
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {session.ip && (
              <span className="flex items-center gap-1">
                <Globe className="h-3 w-3 shrink-0" />{session.ip}
              </span>
            )}
            <span>{isActive ? "Active" : "Last seen"} {relativeTime(session.last_seen_at)}</span>
            <span>Signed in {relativeTime(session.created_at)}</span>
          </div>
          {session.user_agent && (
            <p className="mt-1 truncate text-[11px] text-muted-foreground/60" title={session.user_agent}>
              {session.user_agent}
            </p>
          )}
        </div>
        {isActive && !isCurrent && (
          <div className="shrink-0">
            {confirm ? (
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => { onRevoke(session.id); setConfirm(false); }}
                  disabled={revoking}
                  className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50 transition-colors">
                  {revoking ? <Loader2 className="h-3 w-3 animate-spin" /> : "Revoke"}
                </button>
                <button type="button" onClick={() => setConfirm(false)}
                  className="rounded-xl border border-border bg-card p-1.5 text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirm(true)}
                className="rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold text-muted-foreground hover:border-red-200 hover:bg-red-50 hover:text-red-700 transition-colors">
                Revoke
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SecurityPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [secLoading, setSecLoading] = useState(true);
  const [secErr, setSecErr] = useState<string | null>(null);
  const [secData, setSecData] = useState<SecurityData | null>(null);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessLoading, setSessLoading] = useState(true);
  const [sessErr, setSessErr] = useState<string | null>(null);

  const [revoking, setRevoking] = useState<number | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);
  const [showRevoked, setShowRevoked] = useState(false);
  const [eventsExpanded, setEventsExpanded] = useState(false);

  // Load security summary
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await usersApi.getSecurity();
        if (!cancelled) setSecData(d);
      } catch (e: unknown) {
        if (!cancelled) setSecErr(e instanceof Error ? e.message : "Could not load security data.");
      } finally {
        if (!cancelled) setSecLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load sessions
  const loadSessions = useCallback(async () => {
    setSessLoading(true);
    setSessErr(null);
    try {
      const d = await authApi.getSessions();
      setSessions(Array.isArray(d.sessions) ? d.sessions : []);
    } catch (e: unknown) {
      setSessErr(e instanceof Error ? e.message : "Could not load sessions.");
    } finally {
      setSessLoading(false);
    }
  }, []);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  const handleRevoke = async (sessionId: number) => {
    setRevoking(sessionId);
    try {
      await authApi.revokeSession(sessionId);
      await loadSessions();
    } catch {
      setSessErr("Could not revoke session. Please try again.");
    } finally {
      setRevoking(null);
    }
  };

  const handleRevokeAll = async () => {
    setRevokingAll(true);
    try {
      await authApi.revokeAllSessions();
      queryClient.clear();
      router.replace("/login");
    } catch {
      setSessErr("Could not sign out of all sessions. Please try again.");
      setRevokingAll(false);
    }
  };

  const activeSessions = sessions.filter((s) => !s.revoked_at);
  const revokedSessions = sessions.filter((s) => !!s.revoked_at);
  // Identify current session: active session with the most recent last_seen_at
  const currentSessionId =
    activeSessions.length > 0
      ? activeSessions.reduce((a, b) =>
          new Date(a.last_seen_at ?? 0) > new Date(b.last_seen_at ?? 0) ? a : b,
        ).id
      : null;

  return (
    <AuthGuard>
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-8 md:px-8">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Security</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage active login sessions and review account security events.
          </p>
        </div>

        {/* Summary cards */}
        {secLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />Loading security…
          </div>
        ) : secErr ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{secErr}</div>
        ) : secData ? (
          <section className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Active sessions</p>
              <p className="mt-2 text-2xl font-extrabold text-foreground tabular-nums">{activeSessions.length}</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Suspicious activity (7d)</p>
              <p className="mt-2 flex items-center gap-2 text-2xl font-extrabold">
                {secData.suspicious_login_alerts > 0 ? (
                  <span className="flex items-center gap-1.5 text-amber-600">
                    <ShieldAlert className="h-5 w-5" />{secData.suspicious_login_alerts}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-emerald-600">
                    <ShieldCheck className="h-5 w-5" />0
                  </span>
                )}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Last password change</p>
              <p className="mt-2 text-sm font-semibold text-foreground">
                {secData.last_password_change ? relativeTime(secData.last_password_change) : "Never changed"}
              </p>
              {secData.last_password_change && (
                <p className="text-[11px] text-muted-foreground">{fmt(secData.last_password_change)}</p>
              )}
            </div>
          </section>
        ) : null}

        {/* Step-up warning */}
        {secData?.security_step_up_active && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-400/40 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-600/30 dark:bg-amber-950/30 dark:text-amber-100">
            <ShieldOff className="h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-bold">Additional sign-in required</p>
              <p className="mt-0.5">
                Unusual activity was detected. Sign out and sign back in with your password or social login to restore full access.
              </p>
            </div>
          </div>
        )}

        {/* ── Active sessions ──────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-extrabold text-foreground">Active sessions</h2>
              <p className="text-xs text-muted-foreground">Devices currently signed in to your account.</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void loadSessions()} disabled={sessLoading}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold text-muted-foreground hover:bg-surface-2 disabled:opacity-50 transition-colors">
                <RefreshCcw className={`h-3.5 w-3.5 ${sessLoading ? "animate-spin" : ""}`} />
                Refresh
              </button>
              {activeSessions.length > 1 && (
                confirmRevokeAll ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-red-700">Sign out everywhere?</span>
                    <button type="button" onClick={() => void handleRevokeAll()} disabled={revokingAll}
                      className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50 transition-colors">
                      {revokingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : "Sign out all"}
                    </button>
                    <button type="button" onClick={() => setConfirmRevokeAll(false)}
                      className="rounded-xl border border-border bg-card p-1.5 text-muted-foreground hover:bg-surface-2">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirmRevokeAll(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 transition-colors">
                    <LogOut className="h-3.5 w-3.5" />
                    Sign out all devices
                  </button>
                )
              )}
            </div>
          </div>

          {sessErr && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />{sessErr}
            </div>
          )}

          {sessLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-7 w-7 animate-spin text-primary/40" />
            </div>
          ) : activeSessions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">
              <Shield className="mx-auto mb-2 h-8 w-8 opacity-30" />
              <p className="text-sm font-semibold">No active sessions found.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {activeSessions.map((s) => (
                <SessionCard key={s.id} session={s} isCurrent={s.id === currentSessionId}
                  onRevoke={(id) => void handleRevoke(id)} revoking={revoking === s.id} />
              ))}
            </div>
          )}

          {revokedSessions.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowRevoked((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
                {showRevoked ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {showRevoked ? "Hide" : "Show"} {revokedSessions.length} revoked session{revokedSessions.length !== 1 ? "s" : ""}
              </button>
              {showRevoked && (
                <div className="mt-2 space-y-2">
                  {revokedSessions.map((s) => (
                    <SessionCard key={s.id} session={s} isCurrent={false} onRevoke={() => {}} revoking={false} />
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── Security events ──────────────────────────────────────────── */}
        {secData && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-extrabold text-foreground">Security events</h2>
                <p className="text-xs text-muted-foreground">Recent login activity and account changes.</p>
              </div>
              {secData.events.length > 5 && (
                <button type="button" onClick={() => setEventsExpanded((v) => !v)}
                  className="text-xs font-semibold text-primary hover:underline">
                  {eventsExpanded ? "Show less" : `Show all ${secData.events.length}`}
                </button>
              )}
            </div>

            {secData.events.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">
                <CheckCircle2 className="mx-auto mb-2 h-8 w-8 opacity-30" />
                <p className="text-sm font-semibold">No security events recorded yet.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <div className="divide-y divide-border">
                  {(eventsExpanded ? secData.events : secData.events.slice(0, 5)).map((ev: any) => {
                    const isBad = ev.severity === "warning" || ev.severity === "critical";
                    return (
                      <div key={ev.id} className={`flex items-start gap-3 px-4 py-3 ${isBad ? "bg-amber-50/50 dark:bg-amber-950/10" : ""}`}>
                        <div className={`mt-0.5 shrink-0 ${isBad ? "text-amber-500" : "text-muted-foreground/40"}`}>
                          {isBad ? <ShieldAlert className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <p className="text-sm font-semibold text-foreground">
                              {String(ev.event_type).replace(/_/g, " ")}
                            </p>
                            <p className="shrink-0 text-xs text-muted-foreground">{relativeTime(ev.created_at)}</p>
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                            <span className={`font-semibold ${isBad ? "text-amber-600" : ""}`}>{ev.severity}</span>
                            {ev.ip && <span>{ev.ip}</span>}
                            <span title={fmt(ev.created_at)}>{fmt(ev.created_at)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </AuthGuard>
  );
}
