export function parseAuthorizePreflightBody(text: string): { status?: string; error?: string; ok?: boolean } | null {
  try {
    const raw = JSON.parse(text) as { status?: unknown; error?: unknown; ok?: unknown };
    return {
      ...(typeof raw.status === "string" ? { status: raw.status } : {}),
      ...(typeof raw.error === "string" ? { error: raw.error } : {}),
      ...(typeof raw.ok === "boolean" ? { ok: raw.ok } : {}),
    };
  } catch {
    return null;
  }
}

export function oauthUiFromPreflight(
  ok: boolean,
  raw: { status?: string; error?: string; ok?: boolean } | null,
): {
  state: "ready" | "invalid_client" | "already_allowed" | "error" | "signed_out" | "no_plan";
  detail: string | null;
} {
  if (raw?.error === "invalid_client") return { state: "invalid_client", detail: null };
  if (raw?.error === "already_allowed" || raw?.status === "already_allowed") {
    return { state: "already_allowed", detail: null };
  }
  if (!ok || !raw) return { state: "error", detail: null };
  if (raw.status === "signed_out") return { state: "signed_out", detail: null };
  if (raw.status === "no_plan") return { state: "no_plan", detail: null };
  if (raw.ok === false) return { state: "error", detail: null };
  if (raw.status === "ready" || raw.status === "ok" || raw.ok === true) return { state: "ready", detail: null };
  return { state: "error", detail: null };
}
