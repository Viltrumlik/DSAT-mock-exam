import { QueryClient } from "@tanstack/react-query";
import { AxiosError, isAxiosError } from "axios";

function statusOf(error: unknown): number | undefined {
  return (error as { response?: { status?: number } } | null)?.response?.status;
}

/**
 * The app's QueryClient (QueryProvider holds the one instance).
 *
 * Queries retry twice, but not on 401/403: asking for a read again is harmless.
 *
 * Mutations are NOT retried. A write that failed may still have reached the server — a 5xx
 * after the row was saved, a connection dropped after the commit — so sending it again can
 * create a second question, assignment or payment. And a 4xx is the server's answer: the same
 * request gets the same answer a second later (on 2026-11-12 one click on "Delete" sent two
 * DELETEs about 1 s apart, both refused with 409). A write the server dedupes may opt back in
 * with `retry: retryTransientOnce`.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          const status = statusOf(error);
          if (status === 401 || status === 403) return false;
          return failureCount < 2;
        },
        refetchOnWindowFocus: false,
        staleTime: 15_000,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/**
 * A mutation's `retry`, only for a write the server dedupes (a second copy gets the first one's
 * result instead of being done twice). One more try, about 1 s later, when no answer came back
 * (network error, timeout) or the server failed (5xx). Never on a 4xx, a cancelled request, or
 * an error that is not an HTTP one.
 */
export function retryTransientOnce(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  if (!isAxiosError(error)) return false;
  if (error.code === AxiosError.ERR_CANCELED) return false;
  const status = error.response?.status;
  return status === undefined || status >= 500;
}
