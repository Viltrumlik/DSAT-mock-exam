/**
 * The midterm lockdown's screens, ported from the site's DesktopScreens.tsx, OffscreenWarning.tsx
 * and DesktopBattery.tsx — same copy, same look (the white exam frame with the Bluebook rule), so
 * the app's exam flow is the site's exam flow. Native-only additions are marked.
 *
 * Importer: exam/midterm/MidtermScreen.tsx.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  BatteryWarning,
  CheckCircle2,
  Download,
  Lock,
  MonitorSmartphone,
  RefreshCw,
  ShieldAlert,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";

import { ApiError, isTransient } from "@/lib/api";
import { native, type BatteryStatus, type PrecheckReport } from "@/lib/native";
import { SatColorRule } from "../SatColorRule";
import { DesktopBlockedError, ProofRefusedError } from "./session";
import { isLowBattery, useBattery } from "./useBattery";
import { PrecheckFailedError } from "./useLockdown";

/** Where the site sends a student for the Windows installer (frontend/src/lib/desktop/routes.ts). */
const DESKTOP_DOWNLOAD_URL = "https://mastersat.uz/downloads/desktop/MasterSAT-Setup.exe";

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-white text-slate-900">
      <SatColorRule />
      <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-8">
        <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-10 shadow-sm">{children}</div>
      </div>
      <SatColorRule />
    </div>
  );
}

function Badge({ children, tone = "blue" }: { children: ReactNode; tone?: "blue" | "red" }) {
  return (
    <div
      className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${
        tone === "red" ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-700"
      }`}
    >
      {children}
    </div>
  );
}

const primaryButton =
  "inline-flex w-full items-center justify-center gap-2 rounded-full bg-blue-700 px-8 py-3 text-base font-bold text-white transition-colors hover:bg-blue-800 disabled:opacity-50";
const outlineButton =
  "inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-300 px-8 py-3 text-base font-bold text-slate-800 hover:bg-slate-50";
const linkButton = "inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-slate-800";

// ── Pre-check ─────────────────────────────────────────────────────────────────

type RowState = "ok" | "fix" | "warn";

function CheckRow({ state, title, hint, action }: { state: RowState; title: string; hint?: string; action?: ReactNode }) {
  const icon =
    state === "ok" ? (
      <CheckCircle2 className="h-5 w-5 text-green-700" aria-hidden />
    ) : state === "warn" ? (
      <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden />
    ) : (
      <XCircle className="h-5 w-5 text-red-600" aria-hidden />
    );
  return (
    <li className="flex items-start gap-3 py-3">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-slate-900">{title}</span>
        {hint ? <span className="mt-0.5 block text-sm text-slate-600">{hint}</span> : null}
      </span>
      {action}
    </li>
  );
}

const PROOF_INVALID = "The app could not prove it is locked down. Restart the MasterSAT app and try again.";
const NETWORK = "That didn't go through. Check your internet connection and try again.";

/** What to say under the checklist when "Lock and start" fails. */
function precheckErrorText(e: unknown): string {
  if (e instanceof DesktopBlockedError) return e.message;
  // The shell refused to sign — a local failure, never "check your connection" (site gap #4).
  if (e instanceof ProofRefusedError) return PROOF_INVALID;
  if (isTransient(e)) return NETWORK;
  if (e instanceof ApiError && e.message) return e.message;
  return NETWORK;
}

/**
 * The last screen before a midterm: what must change on this computer, fixed in place, and the one
 * button that locks it down. The check re-runs every two seconds, so closing Telegram or unplugging
 * a projector turns its row green without a click.
 */
export function PrecheckScreen({
  resume,
  onContinue,
  onBack,
}: {
  /** The paper is already running (the app was reopened mid-midterm, or the lock was lost). */
  resume: boolean;
  /** Lock the machine and continue. Throws when the machine fails or the server refuses. */
  onContinue: () => Promise<void>;
  onBack?: () => void;
}) {
  const [report, setReport] = useState<PrecheckReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const battery = useBattery();

  const refresh = useCallback(async () => {
    try {
      setReport(await native.lockdownPrecheck());
    } catch {
      setError("This computer could not be checked. Close the MasterSAT app and open it again.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 2000);
    return () => clearInterval(t);
  }, [refresh]);

  const closeApp = async (exe: string) => {
    setClosing(exe);
    try {
      await native.lockdownCloseApp(exe);
    } catch {
      /* the next check shows whether it closed */
    } finally {
      setClosing(null);
      void refresh();
    }
  };

  const proceed = async () => {
    setBusy(true);
    setError(null);
    try {
      await onContinue();
    } catch (e) {
      if (e instanceof PrecheckFailedError) setReport(e.report);
      else setError(precheckErrorText(e));
      setBusy(false);
    }
  };

  const apps = report?.apps ?? [];
  const lowBattery = isLowBattery(battery);

  return (
    <Frame>
      <Badge>
        <Lock className="h-7 w-7" />
      </Badge>
      <h1 className="mt-4 text-center text-2xl font-bold tracking-tight text-slate-900">
        {resume ? "Resume your midterm" : "Get this computer ready"}
      </h1>
      <p className="mt-2 text-center text-sm font-medium text-slate-500">
        When you continue, MasterSAT locks this computer until your midterm ends. Other apps, notifications,
        screenshots and copying are turned off.
      </p>

      <ul className="mt-6 divide-y divide-slate-100 border-y border-slate-100" aria-live="polite">
        {report === null ? (
          <li className="flex items-center gap-3 py-3 text-sm font-semibold text-slate-500">
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> Checking this computer…
          </li>
        ) : (
          <>
            <CheckRow
              state={report.displays <= 1 ? "ok" : "fix"}
              title={report.displays <= 1 ? "One screen" : `${report.displays} screens connected`}
              hint={report.displays <= 1 ? undefined : "Disconnect the second monitor or projector."}
            />
            {report.remote ? (
              <CheckRow
                state="fix"
                title="Remote Desktop session"
                hint="Take the midterm on this computer itself, not over Remote Desktop."
              />
            ) : null}
            {report.vm ? (
              <CheckRow state="fix" title="Virtual machine" hint="Midterms can't be taken inside a virtual machine." />
            ) : null}
            {apps.length === 0 ? (
              <CheckRow state="ok" title="No chat or screen-sharing apps open" />
            ) : (
              apps.map((app) => (
                <CheckRow
                  key={app.exe}
                  state="fix"
                  title={`Close ${app.name}`}
                  hint={app.closable ? undefined : `Close ${app.name} from the system tray, then come back.`}
                  action={
                    app.closable ? (
                      <button
                        type="button"
                        onClick={() => void closeApp(app.exe)}
                        disabled={closing === app.exe}
                        className="shrink-0 rounded-full border border-slate-300 px-4 py-1.5 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {closing === app.exe ? "Closing…" : "Close"}
                      </button>
                    ) : null
                  }
                />
              ))
            )}
            {battery ? (
              <CheckRow
                state={lowBattery ? "warn" : "ok"}
                title={battery.charging ? `Battery ${battery.percent ?? "—"}%, charging` : `Battery ${battery.percent ?? "—"}%`}
                hint={lowBattery ? "Plug in your charger before you start." : undefined}
              />
            ) : null}
          </>
        )}
      </ul>

      {error ? <p className="mt-4 text-center text-sm font-semibold text-red-600">{error}</p> : null}

      <button type="button" onClick={() => void proceed()} disabled={!report?.ok || busy} className={`${primaryButton} mt-7`}>
        <Lock className="h-5 w-5" />
        {busy ? "Locking…" : resume ? "Lock and resume" : "Lock and start"}
      </button>
      {onBack ? (
        <div className="mt-4 text-center">
          <button type="button" onClick={onBack} className={linkButton}>
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        </div>
      ) : null}
    </Frame>
  );
}

// ── Something only the student or the app can resolve ───────────────────────

export function SessionMovedScreen({ onHome }: { onHome: () => void }) {
  return (
    <Frame>
      <Badge>
        <MonitorSmartphone className="h-7 w-7" />
      </Badge>
      <h1 className="mt-4 text-center text-2xl font-bold tracking-tight text-slate-900">
        This midterm was opened in another window
      </h1>
      <p className="mt-2 text-center text-sm font-medium text-slate-500">
        Your answers are saved. Continue in the MasterSAT window where it is open now.
      </p>
      <button type="button" onClick={onHome} className={`${primaryButton} mt-7`}>
        Back to my tests
      </button>
    </Frame>
  );
}

/**
 * NATIVE COPY: the site says "Close the app and open it again — it updates itself", but this app
 * has no updater yet, so it points at the download instead.
 */
export function AppUpdateRequiredScreen({ onHome }: { onHome: () => void }) {
  return (
    <Frame>
      <Badge>
        <RefreshCw className="h-7 w-7" />
      </Badge>
      <h1 className="mt-4 text-center text-2xl font-bold tracking-tight text-slate-900">Update the MasterSAT app</h1>
      <p className="mt-2 text-center text-sm font-medium text-slate-500">
        This version can&apos;t start midterms any more. Download the latest MasterSAT app and open it again — your
        work is saved.
      </p>
      <button type="button" onClick={() => void native.openExternal(DESKTOP_DOWNLOAD_URL)} className={`${primaryButton} mt-7`}>
        <Download className="h-5 w-5" /> Download for Windows
      </button>
      <button type="button" onClick={onHome} className={`${outlineButton} mt-3`}>
        Back to my tests
      </button>
    </Frame>
  );
}

/** NATIVE: a failure screen that is never a dead end — there is always a way back (site gap #1). */
export function LockErrorScreen({
  title,
  body,
  onRetry,
  onHome,
}: {
  title: string;
  body: string;
  onRetry?: () => void;
  onHome: () => void;
}) {
  return (
    <Frame>
      <Badge tone="red">
        <AlertTriangle className="h-7 w-7" />
      </Badge>
      <h1 className="mt-4 text-center text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
      <p className="mt-2 text-center text-sm font-medium text-slate-500">{body}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className={`${primaryButton} mt-7`}>
          <RefreshCw className="h-5 w-5" /> Try again
        </button>
      ) : null}
      <button type="button" onClick={onHome} className={`${onRetry ? outlineButton : primaryButton} ${onRetry ? "mt-3" : "mt-7"}`}>
        Back to my tests
      </button>
    </Frame>
  );
}

// ── The off-screen rule ───────────────────────────────────────────────────────

/**
 * Full-cover warning the moment the student leaves the exam window. Deliberately unmissable and
 * un-dismissable: the only way out is to come back, which the guard detects itself. No "Return to
 * full screen" button — the app's window is fullscreen at the OS level, never page-level.
 */
export function OffscreenWarning({ secondsLeft, chancesLeft }: { secondsLeft: number; chancesLeft: number }) {
  const seconds = Math.max(0, secondsLeft);
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Return to your exam"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-red-950/90 px-6"
    >
      <div className="w-full max-w-lg rounded-3xl bg-white p-8 text-center shadow-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50">
          <AlertTriangle className="h-7 w-7 text-red-600" />
        </div>
        <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">Come back to your exam</h2>
        <p className="mt-2 text-sm font-medium text-slate-500">
          You left the exam window. Midterms are proctored — return now or your paper will be taken in and submitted
          as it stands.
        </p>
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4" role="timer" aria-live="assertive">
          <div className="text-4xl font-bold tabular-nums text-red-700">{seconds}</div>
          <p className="mt-1 text-sm font-bold text-red-800">{seconds === 1 ? "second" : "seconds"} to return</p>
        </div>
        <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-1.5 text-sm font-bold text-slate-700">
          <ShieldAlert className="h-4 w-4 text-slate-500" />
          {chancesLeft === 0 ? "No chances left" : `${chancesLeft} ${chancesLeft === 1 ? "chance" : "chances"} left`}
        </p>
      </div>
    </div>
  );
}

/** After the student came back in time: what it cost, so the warning isn't a mystery once gone. */
export function OffscreenNotice({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-[80] flex justify-center px-6">
      <div className="pointer-events-auto flex max-w-xl items-center gap-4 rounded-xl border border-red-200 bg-white px-5 py-3 shadow-xl">
        <ShieldAlert className="h-5 w-5 shrink-0 text-red-600" aria-hidden />
        <p className="text-sm font-semibold text-slate-800">{text}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-bold text-white hover:bg-slate-800"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

/**
 * The sitting the off-screen rule ended. The paper was submitted BY THE SERVER on the terminating
 * offence — this screen never submits anything; it explains, then moves on by itself.
 */
export function OffscreenTerminatedScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white px-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50">
          <ShieldAlert className="h-7 w-7 text-red-600" />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">Your exam was submitted</h1>
        <p className="mt-3 text-sm font-medium text-slate-500">
          You left the exam window too many times, so your midterm was taken in and graded as it stood. Your answers up
          to that point were all saved.
        </p>
        <button
          type="button"
          onClick={onContinue}
          className="mt-7 inline-flex w-full items-center justify-center rounded-full bg-blue-700 px-6 py-3 text-base font-bold text-white transition-colors hover:bg-blue-800"
        >
          See your result
        </button>
      </div>
    </div>
  );
}

// ── In the runner: battery + connection ────────────────────────────────────────

/** Top-right battery reading, as Bluebook shows it. Renders nothing without a battery. */
export function BatteryIndicator({ battery }: { battery: BatteryStatus | null }) {
  if (!battery || battery.percent == null) return null;
  const low = isLowBattery(battery);
  const Icon = battery.charging
    ? BatteryCharging
    : low
      ? BatteryWarning
      : battery.percent >= 60
        ? BatteryFull
        : battery.percent >= 30
          ? BatteryMedium
          : BatteryLow;
  return (
    <div
      role="status"
      aria-label={`Battery ${battery.percent}%${battery.charging ? ", charging" : ""}`}
      className={`flex flex-col items-center gap-0.5 text-xs font-semibold tabular-nums ${low ? "text-red-600" : "text-slate-900"}`}
    >
      <Icon className="h-5 w-5" aria-hidden />
      {battery.percent}%
    </div>
  );
}

/** Under the header while the laptop is unplugged below the threshold. Plugging in clears it. */
export function LowBatteryBanner({ battery }: { battery: BatteryStatus | null }) {
  const low = isLowBattery(battery);
  const [dismissed, setDismissed] = useState(false);
  // A new low spell (charged, then unplugged again) warns again.
  useEffect(() => {
    if (!low) setDismissed(false);
  }, [low]);
  if (!low || dismissed || !battery) return null;
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center justify-center gap-3 border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm font-semibold text-amber-900"
    >
      <BatteryWarning className="h-4 w-4" aria-hidden />
      <span>Your battery is low ({battery.percent}%). Plug in your device.</span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss battery warning"
        className="rounded p-1 hover:bg-amber-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/** NATIVE: a non-blocking note while answers are waiting for the connection to come back. */
export function ConnectionBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-center gap-3 border-b border-slate-200 bg-slate-50 px-6 py-2 text-sm font-semibold text-slate-700"
    >
      <WifiOff className="h-4 w-4" aria-hidden />
      <span>Reconnecting… Keep working — your answers will save as soon as the connection is back.</span>
    </div>
  );
}
