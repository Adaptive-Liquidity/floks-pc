const buckets = new Map<string, { count: number; resetAt: number }>();

export function resetRateLimitsForTests(): void {
  buckets.clear();
}

/** Returns true when the caller is still inside the window. */
export function takeRateLimit(key: string, limit = 8, windowMs = 60_000, now = Date.now()): boolean {
  const row = buckets.get(key);
  if (!row || row.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (row.count >= limit) return false;
  row.count += 1;
  return true;
}

export function clientKey(request: Request, action: string): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || "local";
  return `${action}:${ip}`;
}

export function rateLimitedBody(): { error: "rate_limited" } {
  return { error: "rate_limited" };
}
