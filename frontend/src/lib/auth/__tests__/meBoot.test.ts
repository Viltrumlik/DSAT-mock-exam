/**
 * `deriveAuthBootState` — the gate that decides whether a student is logged in.
 *
 * It had no tests, which is how the eviction bug below survived: a warm, authenticated tab
 * was logged out by a *background* `/users/me` refetch failing, because the error branch
 * outranked the cached-payload branch. React Query keeps `data` and merely flags the query
 * errored on a background failure, so a 10s timeout or one dropped request ended the session.
 * Nothing on the server returned 401, so it left no trace in any access log.
 *
 * The property these tests pin: **an error only evicts when it has actually established that
 * the credential is dead.**
 */

import { describe, expect, it } from "vitest";
import { deriveAuthBootState, mePayloadValid } from "../meBoot";

const VALID = { id: 42, email: "student@example.com" };

function axiosErrorWithStatus(status: number) {
  return { response: { status }, isAxiosError: true };
}

describe("mePayloadValid", () => {
  it("requires a numeric id", () => {
    expect(mePayloadValid(VALID)).toBe(true);
    expect(mePayloadValid({ email: "no-id@example.com" })).toBe(false);
    expect(mePayloadValid(null)).toBe(false);
    expect(mePayloadValid(undefined)).toBe(false);
  });
});

describe("deriveAuthBootState — the happy paths", () => {
  it("boots while the probe is still in flight", () => {
    expect(deriveAuthBootState({ status: "pending", data: undefined, error: null })).toBe(
      "BOOTING",
    );
  });

  it("authenticates on a valid payload", () => {
    expect(deriveAuthBootState({ status: "success", data: VALID, error: null })).toBe(
      "AUTHENTICATED",
    );
  });

  it("stays authenticated while a background refetch is pending", () => {
    // Cached data present, query re-fetching. The shell must not flash its boot state.
    expect(deriveAuthBootState({ status: "pending", data: VALID, error: null })).toBe(
      "AUTHENTICATED",
    );
  });

  it("is unauthenticated on a 200 that carries no usable session", () => {
    expect(deriveAuthBootState({ status: "success", data: {}, error: null })).toBe(
      "UNAUTHENTICATED",
    );
  });
});

describe("deriveAuthBootState — an error must not evict a session it did not disprove", () => {
  it("KEEPS a warm session when a background refetch times out", () => {
    // The regression this whole file exists for.
    expect(
      deriveAuthBootState({ status: "error", data: VALID, error: { code: "ECONNABORTED" } }),
    ).toBe("AUTHENTICATED");
  });

  it("KEEPS a warm session when the server 500s", () => {
    expect(
      deriveAuthBootState({ status: "error", data: VALID, error: axiosErrorWithStatus(500) }),
    ).toBe("AUTHENTICATED");
  });

  it("KEEPS a warm session when the request never reached the server", () => {
    expect(deriveAuthBootState({ status: "error", data: VALID, error: new Error("offline") })).toBe(
      "AUTHENTICATED",
    );
  });

  it("EVICTS on 401 even with a payload cached — the credential is genuinely dead", () => {
    expect(
      deriveAuthBootState({ status: "error", data: VALID, error: axiosErrorWithStatus(401) }),
    ).toBe("UNAUTHENTICATED");
  });

  it("EVICTS on 403 even with a payload cached", () => {
    expect(
      deriveAuthBootState({ status: "error", data: VALID, error: axiosErrorWithStatus(403) }),
    ).toBe("UNAUTHENTICATED");
  });

  it("is unauthenticated when a cold boot fails with nothing cached", () => {
    // No session to keep, and there is deliberately no terminal ERROR state — the UI must not
    // hang waiting on retries, so an unresolvable cold probe ends at the login screen.
    expect(
      deriveAuthBootState({ status: "error", data: undefined, error: axiosErrorWithStatus(500) }),
    ).toBe("UNAUTHENTICATED");
  });

  it("is unauthenticated when a cold boot errors with an unusable payload", () => {
    expect(deriveAuthBootState({ status: "error", data: {}, error: new Error("offline") })).toBe(
      "UNAUTHENTICATED",
    );
  });
});
