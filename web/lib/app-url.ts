/**
 * Public site URL. Never hardcode floks-pc.com — that host is down.
 * Prefer APP_URL / NEXT_PUBLIC_SITE_ORIGIN, then the request origin.
 */

export function headerFirst(request: Request, name: string): string | null {
  const raw = request.headers.get(name);
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim();
  return first || null;
}

export function isRetiredPublicHost(value: string): boolean {
  try {
    const host = new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase();
    return host === "floks-pc.com" || host === "www.floks-pc.com";
  } catch {
    return /floks-pc\.com/i.test(value);
  }
}

export function trimOrigin(value: string): string {
  return value.replace(/\/+$/, "");
}

export function configuredAppUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [env.APP_URL, env.NEXT_PUBLIC_SITE_ORIGIN, env.WORKOS_REDIRECT_URI];
  for (const raw of candidates) {
    const value = raw?.trim();
    if (!value) continue;
    try {
      const url = new URL(value.includes("://") ? value : `https://${value}`);
      const origin = trimOrigin(url.origin);
      if (!isRetiredPublicHost(origin)) return origin;
    } catch {
      // try next
    }
  }
  return null;
}

export function requestOrigin(request: Request): string {
  const proto =
    headerFirst(request, "x-forwarded-proto") ??
    (process.env.VERCEL ? "https" : new URL(request.url).protocol.replace(":", ""));
  const host =
    headerFirst(request, "x-forwarded-host") ??
    request.headers.get("host") ??
    new URL(request.url).host;
  return `${proto}://${host}`;
}

/** Checkout success/cancel and other absolute links. */
export function publicAppUrl(request: Request, env: NodeJS.ProcessEnv = process.env): string {
  const configured = configuredAppUrl(env);
  if (configured) return configured;
  const origin = requestOrigin(request);
  if (isRetiredPublicHost(origin)) {
    throw new Error("APP_URL (or NEXT_PUBLIC_SITE_ORIGIN) must be set; floks-pc.com is not a usable origin");
  }
  return origin;
}

export function checkoutReturnUrls(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): { successUrl: string; cancelUrl: string } {
  const base = publicAppUrl(request, env);
  return {
    successUrl: `${base}/setup?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}/pricing?checkout=canceled`,
  };
}
