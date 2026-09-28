import { configuredAppUrl } from "./app-url";
import { BRAND } from "./billing/catalog";

export const SITE_ORIGIN = configuredAppUrl() ?? "";

export const CONNECTOR = {
  mcpUrl: SITE_ORIGIN ? `${SITE_ORIGIN}/mcp` : "/mcp",
  clientId: "staxions",
  clientSecret: "",
  authorizeUrl: SITE_ORIGIN ? `${SITE_ORIGIN}/oauth/authorize` : "/oauth/authorize",
  tokenUrl: SITE_ORIGIN ? `${SITE_ORIGIN}/oauth/token` : "/oauth/token",
  scope: "mcp",
} as const;

export const SUPPORT_EMAIL =
  process.env.SUPPORT_EMAIL?.trim() || process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || "support@staxions.com";
export const SELLER = process.env.NEXT_PUBLIC_SELLER?.trim() || "Adaptive Liquidity, Inc.";
export const BRAND_NAME = BRAND.name;

/** Same-origin setup actions. Do not POST to a foreign live host. */
export const SETUP_ACTIONS = {
  approve: "/api/setup/approve",
  deny: "/api/setup/deny",
  pair: "/api/setup/pair",
  revoke: "/api/setup/revoke",
  portal: "/api/setup/portal",
  billing: "/api/setup/portal",
  checkout: "/api/checkout",
  logout: "/logout",
  resend: "/login",
  connector: "/setup",
  callback: "/callback",
} as const;

export function actionHref(path: string): string {
  return path;
}

export const COOKIE_NAME = "wos-session";

export function planCheckoutHref(
  planId: string,
  options: { signedIn?: boolean } = {},
): string {
  if (!options.signedIn) return "/signup";
  return `/api/checkout?plan=${encodeURIComponent(planId)}`;
}
