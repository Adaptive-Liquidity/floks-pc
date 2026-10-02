export type AuthorizeComputer = { id: string };

export function parseAuthorizePreflightBody(text: string): {
  status?: string;
  error?: string;
  ok?: boolean;
  needsComputer?: boolean;
  computers?: AuthorizeComputer[];
} | null {
  try {
    const raw = JSON.parse(text) as {
      status?: unknown;
      error?: unknown;
      ok?: unknown;
      needs_computer?: unknown;
      computers?: unknown;
    };
    const computers = Array.isArray(raw.computers)
      ? raw.computers.flatMap((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return [];
          const id = (item as { id?: unknown }).id;
          return typeof id === "string" && id ? [{ id }] : [];
        })
      : [];
    return {
      ...(typeof raw.status === "string" ? { status: raw.status } : {}),
      ...(typeof raw.error === "string" ? { error: raw.error } : {}),
      ...(typeof raw.ok === "boolean" ? { ok: raw.ok } : {}),
      ...(raw.needs_computer === true ? { needsComputer: true } : {}),
      ...(computers.length > 0 ? { computers } : {}),
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
