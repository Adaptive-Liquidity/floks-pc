import type { OauthUiState } from "./types";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function parseAuthorizePreflightBody(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

export function oauthUiFromPreflight(
  resOk: boolean,
  raw: unknown,
): { state: Exclude<OauthUiState, "loading">; detail: string | null } {
  const obj = asRecord(raw);
  const error = obj && typeof obj.error === "string" ? obj.error : null;
  const status = obj && typeof obj.status === "string" ? obj.status : null;
  const description =
    obj && typeof obj.error_description === "string" ? obj.error_description : null;
  const ok = obj && typeof obj.ok === "boolean" ? obj.ok : null;

  if (status === "already_allowed" || error === "already_allowed") {
    return { state: "already_allowed", detail: null };
  }
  if (error === "invalid_client") {
    return { state: "invalid_client", detail: null };
  }
  if (error) {
    return { state: "error", detail: description ?? error };
  }
  if (!resOk) {
    return { state: "error", detail: description };
  }
  if (status === "ready" || status === "ok" || ok === true) {
    return { state: "ready", detail: null };
  }
  return { state: "error", detail: null };
}
