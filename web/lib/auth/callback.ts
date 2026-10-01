import { configuredAppUrl, isRetiredPublicHost } from "../app-url";
import { AuthNotConfigured } from "./workos";

export function headerFirst(request: Request, name: string): string | null {
  const raw = request.headers.get(name);
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim();
  return first || null;
}

/** Prefer the public host AuthKit redirected to, not a Vercel internal URL. */
export function publicOriginFromRequest(request: Request): string {
  const app = configuredAppUrl();
  if (app) return app;
  const configured = process.env.WORKOS_REDIRECT_URI?.replace(/\/+$/, "") ?? "";
  if (configured && !isRetiredPublicHost(configured)) {
    try {
      return new URL(configured).origin;
    } catch {
      // fall through
    }
  }
  const proto =
    headerFirst(request, "x-forwarded-proto") ??
    (process.env.VERCEL ? "https" : new URL(request.url).protocol.replace(":", ""));
  const host =
    headerFirst(request, "x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  return `${proto}://${host}`;
}

export function cookieSecureFromRequest(request: Request): boolean {
  if (process.env.VERCEL) return true;
  return publicOriginFromRequest(request).startsWith("https://");
}

export function isAuthPrefetch(request: Request): boolean {
  const purpose = `${request.headers.get("purpose") ?? ""} ${request.headers.get("sec-purpose") ?? ""}`.toLowerCase();
  if (purpose.includes("prefetch") || purpose.includes("prerender")) return true;
  if (request.headers.get("next-router-prefetch")) return true;
  if (request.headers.get("x-middleware-prefetch")) return true;
  return false;
}

export function clientIp(request: Request): string | undefined {
  const forwarded = headerFirst(request, "x-forwarded-for");
  return forwarded || headerFirst(request, "x-real-ip") || undefined;
}

export function callbackDestination(state: string | null | undefined): string {
  const raw = state?.trim() ?? "";
  if (raw.startsWith("checkout:")) {
    const checkout = raw.slice("checkout:".length).trim();
    if (checkout) return `/setup?session_id=${encodeURIComponent(checkout)}`;
  }
  return "/setup";
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** GET /callback?code= must not exchange the one-use code. Auto-POST once. */
export function callbackAutoPostHtml(code: string, state: string, action: string): string {
  const safeCode = escapeHtml(code);
  const safeState = escapeHtml(state);
  const safeAction = escapeHtml(action);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="referrer" content="same-origin">
<title>Signing you in…</title>
</head>
<body>
<form id="authkit-finish" method="post" action="${safeAction}">
<input type="hidden" name="code" value="${safeCode}">
<input type="hidden" name="state" value="${safeState}">
<noscript><button type="submit">Continue</button></noscript>
</form>
<script>document.getElementById("authkit-finish").submit()</script>
</body>
</html>`;
}

export function authKitErrorFields(err: unknown): {
  name: string;
  message: string;
  error?: string;
  errorDescription?: string;
  status?: number;
} {
  if (err instanceof AuthNotConfigured) {
    return { name: err.name, message: err.message };
  }
  if (err instanceof Error) {
    const extra = err as Error & {
      error?: unknown;
      errorDescription?: unknown;
      status?: unknown;
    };
    const nested = extra as Error & {
      raw?: { error?: unknown; error_description?: unknown };
      error_description?: unknown;
    };
    const errorCode =
      (typeof extra.error === "string" && extra.error) ||
      (typeof nested.raw?.error === "string" && nested.raw.error) ||
      (/\binvalid_client\b/.test(extra.message) ? "invalid_client" : null);
    const errorDescription =
      (typeof extra.errorDescription === "string" && extra.errorDescription) ||
      (typeof nested.error_description === "string" && nested.error_description) ||
      (typeof nested.raw?.error_description === "string" && nested.raw.error_description) ||
      null;
    const fields: {
      name: string;
      message: string;
      error?: string;
      errorDescription?: string;
      status?: number;
    } = { name: extra.name, message: extra.message };
    if (errorCode) fields.error = errorCode;
    if (errorDescription) fields.errorDescription = errorDescription;
    if (typeof extra.status === "number") fields.status = extra.status;
    return fields;
  }
  return { name: "Error", message: "unknown" };
}

export function logAuthKitFailure(scope: string, err: unknown): void {
  const password = process.env.WORKOS_COOKIE_PASSWORD?.trim() ?? "";
  console.error("[authkit]", scope, {
    ...authKitErrorFields(err),
    cookiePasswordConfigured: password.length > 0,
    cookiePasswordLength: password.length,
  });
}

function isAuthNotConfigured(err: unknown): boolean {
  if (err instanceof AuthNotConfigured) return true;
  return err instanceof Error && err.name === "AuthNotConfigured";
}

/** Config mistakes are not an invalid invitation. Used-up codes look expired. */
export function callbackFailurePath(
  err: unknown,
): "/setup" | "/setup?error=invalid" | "/setup?error=expired" | "/setup?error=workos_env" {
  if (isAuthNotConfigured(err)) return "/setup";
  const fields = authKitErrorFields(err);
  if (fields.error === "invalid_client" || /\binvalid_client\b/.test(fields.message)) {
    return "/setup?error=workos_env";
  }
  if (fields.error === "invalid_grant" || fields.error === "expired_token") return "/setup?error=expired";
  return "/setup?error=invalid";
}

export function workosMismatchHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Sign-in failed — Staxions</title>
<style>
  body { background:#050505; color:#fff; font-family: Manrope, ui-sans-serif, sans-serif; padding:4rem 1.5rem; }
  a { color:#e3f2fd; }
</style>
</head>
<body>
<h1>Sign-in failed</h1>
<p>WorkOS rejected this app as <code>invalid_client</code>: the API key does not match the Client ID. That usually means Preview is using a Production client (or the reverse).</p>
<p>Set <code>WORKOS_CLIENT_ID</code> and <code>WORKOS_API_KEY</code> from the <strong>same</strong> WorkOS environment (both Staging or both Production), then redeploy. See <code>docs/DEPLOY.md</code>.</p>
<p><a href="/setup">Back to account</a></p>
</body>
</html>`;
}
