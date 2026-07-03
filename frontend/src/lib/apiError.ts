import type { AxiosError } from "axios";

export type ApiError = {
  status: number;
  message: string;
  code?: string;
  fieldErrors?: Record<string, string[]>;
};

function asRecord(x: unknown): Record<string, unknown> | null {
  if (!x || typeof x !== "object") return null;
  return x as Record<string, unknown>;
}

export function normalizeApiError(err: unknown): ApiError {
  const fallback: ApiError = { status: 0, message: "Request failed." };

  const ax = err as AxiosError | undefined;
  const status = (ax as any)?.response?.status;
  const data = (ax as any)?.response?.data;

  if (typeof status === "number") {
    const rec = asRecord(data);
    const detail =
      typeof rec?.detail === "string"
        ? rec.detail
        : typeof (data as any) === "string"
          ? String(data)
          : null;

    const fieldErrors: Record<string, string[]> = {};
    if (rec) {
      for (const [k, v] of Object.entries(rec)) {
        if (k === "detail") continue;
        if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
          fieldErrors[k] = v as string[];
        }
      }
    }

    return {
      status,
      message: detail || (status === 403 ? "Forbidden." : status === 401 ? "Unauthorized." : "Request failed."),
      ...(typeof rec?.code === "string" ? { code: rec.code } : {}),
      ...(Object.keys(fieldErrors).length ? { fieldErrors } : {}),
    };
  }

  if (err instanceof Error && err.message) {
    return { ...fallback, message: err.message };
  }

  return fallback;
}

/**
 * Build a human toast message from an API error, surfacing DRF field errors when
 * present. The builder previously showed only `.message` (usually a generic
 * "Request failed."), so a teacher had no idea *which* field was rejected — e.g.
 * `question_image: The submitted data was not a file`. This exposes up to two
 * field errors ("field: message") so the cause is actionable.
 */
export function formatApiErrorForToast(err: unknown, max = 2): string {
  const e = normalizeApiError(err);
  const fieldErrors = e.fieldErrors;
  if (fieldErrors) {
    const parts = Object.entries(fieldErrors)
      .slice(0, max)
      .map(([field, msgs]) => `${field}: ${(msgs && msgs[0]) || "invalid"}`);
    if (parts.length) {
      return e.message && !/request failed/i.test(e.message)
        ? `${e.message} (${parts.join("; ")})`
        : parts.join("; ");
    }
  }
  return e.message;
}

