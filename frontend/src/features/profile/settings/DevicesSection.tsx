"use client";

import { useCallback, useEffect, useState } from "react";
import { AppWindow, Laptop, LogOut, MonitorSmartphone, RefreshCw, Smartphone, Tablet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/components/ToastProvider";
import { Skeleton } from "@/components/ui";
import { ErrorState } from "@/features/classroom/ui";
import { authApi } from "@/lib/api";
import { cn } from "@/lib/cn";

import { profileApi, type AuthSession } from "../profileApi";
import { describeDevice, lastActiveLabel, type DeviceKind } from "../profileModel";
import { IconTile, Panel, PanelHeader, pill, TONE } from "../profileUi";
import type { Load } from "../types";

const KIND_ICON: Record<DeviceKind, LucideIcon> = {
  phone: Smartphone,
  tablet: Tablet,
  computer: Laptop,
  app: AppWindow,
};

/**
 * Where this account is signed in right now — one row per device, named the way a person names
 * it ("Chrome on Windows"), this one first and marked.
 *
 * The list this replaces printed every refresh-token row the server had kept: fifty at a time,
 * revoked and live together, as raw user-agent strings. Signing one out now says what it does —
 * the device stops at its next renewal — and "sign out everywhere" says that it means here too,
 * because it always did: the old button cleared this browser's cookies and left the page
 * pretending nothing had happened.
 */
export function DevicesSection() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [sessions, setSessions] = useState<Load<AuthSession[]>>({ status: "loading" });
  const [busyId, setBusyId] = useState<number | null>(null);
  const [busyOthers, setBusyOthers] = useState(false);
  const [confirmEverywhere, setConfirmEverywhere] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const load = useCallback(async () => {
    setSessions({ status: "loading" });
    try {
      setSessions({ status: "ready", data: await profileApi.sessions() });
    } catch {
      setSessions({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = sessions.status === "ready" ? sessions.data : [];
  const others = rows.filter((s) => !s.is_current);

  const signOutOne = async (session: AuthSession) => {
    setBusyId(session.id);
    try {
      await profileApi.signOutDevice(session.id);
      setSessions((prev) => (prev.status === "ready" ? { status: "ready", data: prev.data.filter((s) => s.id !== session.id) } : prev));
      toast.push({ tone: "success", message: `${describeDevice(session.user_agent).label} is signed out.` });
    } catch {
      toast.push({ tone: "error", message: "That device wasn't signed out. Try again." });
    } finally {
      setBusyId(null);
    }
  };

  const signOutOthers = async () => {
    setBusyOthers(true);
    try {
      const { revoked, keptCurrent } = await profileApi.signOutOtherDevices();
      if (!keptCurrent) {
        // The server couldn't tell which device this is, so it signed this one out as well.
        await authApi.logout(queryClient);
        return;
      }
      toast.push({
        tone: "success",
        message: revoked > 0 ? `Signed out on ${revoked} other ${revoked === 1 ? "device" : "devices"}.` : "No other devices were signed in.",
      });
      await load();
    } catch {
      toast.push({ tone: "error", message: "The other devices weren't signed out. Try again." });
    } finally {
      setBusyOthers(false);
    }
  };

  const signOutEverywhere = async () => {
    setLeaving(true);
    try {
      await profileApi.signOutEverywhere();
    } catch {
      setLeaving(false);
      toast.push({ tone: "error", message: "That didn't go through. You're still signed in everywhere." });
      return;
    }
    // Every session is gone, this one included: finish signing this tab out properly.
    await authApi.logout(queryClient);
  };

  return (
    <Panel>
      <PanelHeader
        icon={MonitorSmartphone}
        tone="rose"
        title="Devices"
        description="Where your account is signed in right now."
        actions={
          <button type="button" onClick={() => void load()} disabled={sessions.status === "loading"} className={pill("quiet", "primary", "sm")}>
            <RefreshCw className={cn("h-3.5 w-3.5", sessions.status === "loading" && "animate-spin")} aria-hidden />
            Refresh
          </button>
        }
      />

      <div className="mt-5">
        {sessions.status === "loading" ? (
          <div className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="squircle h-[66px] [--sq:11px]" />
            ))}
          </div>
        ) : sessions.status === "error" ? (
          // "No devices" here would tell a student nobody is signed in as them — the one thing
          // this list exists to let them check.
          <ErrorState
            title="Your devices didn't load."
            message="Your account is unaffected — only this list failed to load."
            onRetry={() => void load()}
          />
        ) : rows.length === 0 ? (
          <p className={cn("squircle px-4 py-3 text-[13px] font-medium text-muted-foreground [--sq:10px]", TONE.primary.well)}>
            No signed-in devices to show. Sign in again and this one will appear.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {rows.map((session) => {
              const device = describeDevice(session.user_agent);
              return (
                <li key={session.id} className="quartz squircle flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center [--sq:11px]">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <IconTile icon={KIND_ICON[device.kind]} tone={session.is_current ? "emerald" : "sky"} size="sm" />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-[14px] font-extrabold text-foreground">
                        {device.label}
                        {session.is_current ? (
                          <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-extrabold", TONE.emerald.tile)}>
                            This device
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 truncate text-[12.5px] font-medium text-muted-foreground">
                        {[session.is_current ? "Active now" : lastActiveLabel(session.last_seen_at), session.ip].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </div>
                  {session.is_current ? null : (
                    <button
                      type="button"
                      onClick={() => void signOutOne(session)}
                      disabled={busyId === session.id || busyOthers || leaving}
                      className={cn(pill("quiet", "rose", "sm"), "self-start sm:self-auto")}
                    >
                      <LogOut className="h-3.5 w-3.5" aria-hidden />
                      {busyId === session.id ? "Signing out…" : "Sign out"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {sessions.status === "ready" ? (
        <div className="mt-5 flex flex-col gap-3 border-t border-primary/10 pt-4">
          <p className="text-[12.5px] font-medium text-muted-foreground">
            Don&apos;t recognise a device? Sign it out and change your password. A device you sign out stops within a few hours, the next time it renews its sign-in.
          </p>
          {confirmEverywhere ? (
            <div className={cn("squircle flex flex-col gap-3 p-4 sm:flex-row sm:items-center [--sq:11px]", TONE.rose.well)}>
              <p className="flex-1 text-[13px] font-semibold text-foreground">
                This signs you out here too. You&apos;ll need to sign in again on every device.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void signOutEverywhere()} disabled={leaving} className={pill("soft", "rose", "sm")}>
                  {leaving ? "Signing out…" : "Sign out everywhere"}
                </button>
                <button type="button" onClick={() => setConfirmEverywhere(false)} disabled={leaving} className={pill("quiet", "primary", "sm")}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {others.length > 0 ? (
                <button type="button" onClick={() => void signOutOthers()} disabled={busyOthers} className={pill("soft", "rose", "sm")}>
                  <LogOut className="h-3.5 w-3.5" aria-hidden />
                  {busyOthers ? "Signing out…" : `Sign out of ${others.length} other ${others.length === 1 ? "device" : "devices"}`}
                </button>
              ) : null}
              <button type="button" onClick={() => setConfirmEverywhere(true)} className={pill("quiet", "rose", "sm")}>
                Sign out everywhere
              </button>
            </div>
          )}
        </div>
      ) : null}
    </Panel>
  );
}
