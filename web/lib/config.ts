export const SITE_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/+$/, "") ?? "https://floks-pc.com";

export const STRIPE_LINKS = {
  spark:
    process.env.NEXT_PUBLIC_STRIPE_SPARK_URL ??
    "https://buy.stripe.com/dRm5kv54s8FO5NR0ES6wE00",
  desk:
    process.env.NEXT_PUBLIC_STRIPE_DESK_URL ??
    "https://buy.stripe.com/dRm00b9kI2hqfor3R46wE01",
  shift:
    process.env.NEXT_PUBLIC_STRIPE_SHIFT_URL ??
    "https://buy.stripe.com/eVq28j7cA5tCccf1IW6wE02",
} as const;

export const CONNECTOR = {
  mcpUrl: `${SITE_ORIGIN}/mcp`,
  clientId: "floks-pc",
  clientSecret: "",
  authorizeUrl: `${SITE_ORIGIN}/oauth/authorize`,
  tokenUrl: `${SITE_ORIGIN}/oauth/token`,
  scope: "mcp",
} as const;

export const SUPPORT_EMAIL = "support@floks-pc.com";
export const SELLER = "Adaptive Liquidity, Inc.";

/** Same-origin setup actions. Do not POST to a foreign live host. */
export const SETUP_ACTIONS = {
  approve: "/api/setup/approve",
  deny: "/api/setup/deny",
  pair: "/api/setup/pair",
  revoke: "/api/setup/revoke",
  portal: "/api/setup/portal",
  billing: "/api/setup/portal",
  logout: "/logout",
  resend: "/login",
  connector: "/setup",
  callback: "/callback",
} as const;

export function actionHref(path: string): string {
  return path;
}

export const COOKIE_NAME = "wos-session";

export const PLAN_HOURS = {
  spark: 8,
  desk: 25,
  shift: 60,
} as const;
