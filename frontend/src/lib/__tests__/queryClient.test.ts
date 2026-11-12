import { MutationObserver } from "@tanstack/react-query";
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import { describe, expect, it, vi } from "vitest";
import { createAppQueryClient, retryTransientOnce } from "../queryClient";

/**
 * A failed write is sent ONCE. Until 2026-11-12 every mutation was retried once (except on
 * 401/403), so one click on "Delete" sent two DELETEs that were both refused with 409, and a POST
 * that failed with a 5xx after the server had saved it was sent again.
 */

const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;

function httpError(status: number): AxiosError {
  return new AxiosError(`Request failed with status code ${status}`, "ERR_BAD_RESPONSE", config, {}, {
    status,
    statusText: "",
    headers: {},
    config,
    data: {},
  });
}

const networkError = () => new AxiosError("Network Error", AxiosError.ERR_NETWORK, config, {});
const cancelled = () => new AxiosError("canceled", AxiosError.ERR_CANCELED, config);

async function callsUntilSettled(
  error: unknown,
  extra: { retry?: (failureCount: number, error: unknown) => boolean } = {},
) {
  const mutationFn = vi.fn().mockRejectedValue(error);
  // retryDelay 0 only shortens the opt-in case; the default has no retry to wait for.
  const observer = new MutationObserver(createAppQueryClient(), { mutationFn, retryDelay: 0, ...extra });
  await expect(observer.mutate(undefined)).rejects.toBe(error);
  return mutationFn.mock.calls.length;
}

describe("app QueryClient: mutations are not retried by default", () => {
  it("has retry: false as the mutation default", () => {
    expect(createAppQueryClient().getDefaultOptions().mutations?.retry).toBe(false);
  });

  it.each([
    ["a 409 (the server refused)", httpError(409)],
    ["a 400", httpError(400)],
    ["a 500 (the write may have happened)", httpError(500)],
    ["a 503", httpError(503)],
    ["a network error (the write may have happened)", networkError()],
  ])("a mutation that fails with %s is sent once", async (_label, error) => {
    expect(await callsUntilSettled(error)).toBe(1);
  });

  it("still retries queries (reads) as before", () => {
    const retry = createAppQueryClient().getDefaultOptions().queries?.retry as (n: number, e: unknown) => boolean;
    expect(retry(0, httpError(500))).toBe(true);
    expect(retry(1, httpError(500))).toBe(true);
    expect(retry(2, httpError(500))).toBe(false);
    expect(retry(0, httpError(401))).toBe(false);
    expect(retry(0, httpError(403))).toBe(false);
  });
});

describe("retryTransientOnce (opt-in for writes the server dedupes)", () => {
  it.each([
    ["a 500", 2, httpError(500)],
    ["a 502", 2, httpError(502)],
    ["a network error", 2, networkError()],
    ["a 409", 1, httpError(409)],
    ["a 400", 1, httpError(400)],
    ["a 429", 1, httpError(429)],
    ["a 401", 1, httpError(401)],
    ["a cancelled request", 1, cancelled()],
    ["an error that is not an HTTP one", 1, new Error("AUTH_TEMPORAL_STALE")],
  ] as const)("after %s the mutation is sent %i time(s) in all", async (_label, calls, error) => {
    expect(await callsUntilSettled(error, { retry: retryTransientOnce })).toBe(calls);
  });

  it("never tries a third time", () => {
    expect(retryTransientOnce(0, httpError(500))).toBe(true);
    expect(retryTransientOnce(1, httpError(500))).toBe(false);
  });
});
