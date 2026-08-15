"use client";

/**
 * Web Push plumbing: register the service worker, ask once, subscribe.
 *
 * Every function here is defensive about the browser lacking the APIs, because a good few
 * do — iOS Safari only supports web push for an installed PWA, and any browser in a private
 * window may report the APIs and then refuse to use them.
 */

const SW_PATH = "/sw.js";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function permissionState(): NotificationPermission | "unsupported" {
  if (!pushSupported()) return "unsupported";
  return Notification.permission;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    // Root scope is required: a worker served from a subdirectory can only control that
    // subdirectory, and push notifications need the whole origin.
    return await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
  } catch {
    return null;
  }
}

/** base64url → Uint8Array, which is the only shape `applicationServerKey` accepts. */
function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  // Allocate the ArrayBuffer explicitly: `new Uint8Array(n)` is typed over ArrayBufferLike,
  // which includes SharedArrayBuffer and is therefore not assignable to BufferSource.
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Ask, then subscribe. Returns the subscription JSON, or null if anything declined.
 *
 * MUST be called from a user gesture — browsers ignore `requestPermission` otherwise, and a
 * "default" result that never resolves looks identical to a bug.
 */
export async function subscribeToPush(publicKey: string): Promise<PushSubscriptionJSON | null> {
  if (!pushSupported() || !publicKey) return null;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  const registration = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  if (!registration) return null;

  try {
    const existing = await registration.pushManager.getSubscription();
    if (existing) return existing.toJSON();
    const subscription = await registration.pushManager.subscribe({
      // Required by Chrome: a push that cannot be shown to the user is refused outright.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    return subscription.toJSON();
  } catch {
    return null;
  }
}

export async function currentEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription?.endpoint ?? null;
  } catch {
    return null;
  }
}
