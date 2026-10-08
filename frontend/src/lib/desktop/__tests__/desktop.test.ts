/**
 * The website's half of the Windows app: binding a sitting to the locked-down window, and
 * reading the server's "take this in the app" refusal so the runner can act on it instead of
 * showing "Could not load the exam".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();

vi.mock("@/lib/api", () => ({
  default: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
  getCachedCsrfToken: () => "csrf",
}));

const invoke = vi.fn();

const {
  bindAttemptToApp,
  clearLockdownSession,
  DesktopBlockedError,
  desktopBlockReason,
  lockdownHeaders,
  LOCKDOWN_HEADER,
} = await import("../lockdownSession");
const { isDesktopShell, shellReportsAway, SHELL_AWAY_EVENT } = await import("../bridge");
const { isLowBattery } = await import("../useBattery");
const { midtermExamApi } = await import("@/features/testing-simulation/services/examApiClient");

function refusal(status: number, reason: string, desktopRequired = true) {
  return Object.assign(new Error("refused"), {
    response: { status, data: { reason, desktop_required: desktopRequired, detail: `detail ${reason}` } },
  });
}

beforeEach(() => {
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { invoke };
});

afterEach(() => {
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  get.mockReset();
  post.mockReset();
  invoke.mockReset();
  clearLockdownSession(7);
});

describe("shell detection", () => {
  it("is the app only when the shell injected its invoke", () => {
    expect(isDesktopShell()).toBe(true);
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    expect(isDesktopShell()).toBe(false);
  });

  it("follows the shell's away signal", () => {
    window.dispatchEvent(new CustomEvent(SHELL_AWAY_EVENT, { detail: { away: true } }));
    expect(shellReportsAway()).toBe(true);
    window.dispatchEvent(new CustomEvent(SHELL_AWAY_EVENT, { detail: { away: false } }));
    expect(shellReportsAway()).toBe(false);
  });
});

describe("binding a sitting to the app", () => {
  it("challenge → shell signs → session; then every request carries the token", async () => {
    post.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith("desktop_challenge/") ? { data: { nonce: "n-1" } } : { data: { lockdown_session: "tok-1" } },
      ),
    );
    invoke.mockResolvedValue({ key_id: "k", mac: "m", app_version: "0.1.0", precheck: "{}" });

    expect(lockdownHeaders(7)).toEqual({});
    await bindAttemptToApp(7);

    expect(invoke).toHaveBeenCalledWith("lockdown_prove", { attemptId: 7, nonce: "n-1" });
    expect(post).toHaveBeenLastCalledWith("/midterms/attempts/7/desktop_session/", {
      nonce: "n-1",
      key_id: "k",
      mac: "m",
      app_version: "0.1.0",
      precheck: "{}",
    });
    expect(lockdownHeaders(7)).toEqual({ [LOCKDOWN_HEADER]: "tok-1" });
    expect(lockdownHeaders(8)).toEqual({});
  });

  it("a refused proof surfaces as DesktopBlockedError with the server's words", async () => {
    post.mockImplementation((url: string) =>
      url.endsWith("desktop_challenge/")
        ? Promise.resolve({ data: { nonce: "n" } })
        : Promise.reject(refusal(426, "desktop_update_required")),
    );
    invoke.mockResolvedValue({ key_id: "k", mac: "m", app_version: "0.0.1", precheck: "{}" });

    const err = await bindAttemptToApp(7).catch((e) => e);
    expect(err).toBeInstanceOf(DesktopBlockedError);
    expect(err.reason).toBe("desktop_update_required");
    expect(err.message).toBe("detail desktop_update_required");
    expect(lockdownHeaders(7)).toEqual({});
  });
});

describe("reading a refusal", () => {
  it("knows the app-binding refusals and nothing else", () => {
    expect(desktopBlockReason(refusal(403, "desktop_required"))).toBe("desktop_required");
    expect(desktopBlockReason(refusal(403, "desktop_session_replaced"))).toBe("desktop_session_replaced");
    // An ordinary 403 (wrong code, early submit) is not ours to handle.
    expect(desktopBlockReason(refusal(403, "code_required", false))).toBeNull();
    expect(desktopBlockReason(refusal(500, "desktop_required"))).toBeNull();
    expect(desktopBlockReason(new Error("network"))).toBeNull();
  });
});

describe("the exam client", () => {
  it("a refused status is DesktopBlockedError, without falling back to the legacy route", async () => {
    get.mockRejectedValue(refusal(403, "desktop_required"));
    const err = await midtermExamApi.getStatus(7).catch((e) => e);
    expect(err).toBeInstanceOf(DesktopBlockedError);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("any other status failure still falls back to the legacy route", async () => {
    get.mockRejectedValueOnce(new Error("timeout")).mockRejectedValueOnce(new Error("timeout"));
    await midtermExamApi.getStatus(7).catch(() => undefined);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1][0]).toBe("/midterms/attempts/7/");
  });

  it("sends the token once the sitting is bound", async () => {
    post.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith("desktop_challenge/") ? { data: { nonce: "n" } } : { data: { lockdown_session: "tok-9" } },
      ),
    );
    invoke.mockResolvedValue({ key_id: "k", mac: "m", app_version: "0.1.0", precheck: "{}" });
    await bindAttemptToApp(7);
    get.mockRejectedValue(new Error("stop here"));
    await midtermExamApi.getStatus(7).catch(() => undefined);
    expect(get.mock.calls[0][1]).toEqual({ headers: { [LOCKDOWN_HEADER]: "tok-9" } });
  });
});

describe("low battery", () => {
  it("warns under 25%, on battery, with a battery", () => {
    expect(isLowBattery({ percent: 24, charging: false, has_battery: true })).toBe(true);
    expect(isLowBattery({ percent: 25, charging: false, has_battery: true })).toBe(false);
    expect(isLowBattery({ percent: 5, charging: true, has_battery: true })).toBe(false);
    expect(isLowBattery({ percent: 5, charging: false, has_battery: false })).toBe(false);
    expect(isLowBattery({ percent: null, charging: false, has_battery: true })).toBe(false);
    expect(isLowBattery(null)).toBe(false);
  });
});
