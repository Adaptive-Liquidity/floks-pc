/**
 * Local vs remote MCP exposure.
 * Loopback is operator smoke. A remote Grok Bot needs HTTPS + wrapper auth.
 */

import { z } from "zod";
import { ComputerError } from "../computers/errors.js";
import type { McpGatewayConfig } from "./config.js";

const OptionalTrimmed = z
  .string()
  .trim()
  .transform((s) => (s.length === 0 ? undefined : s))
  .optional();
const ExposureConfigSchema = z.object({
  baseUrl: OptionalTrimmed,
  authToken: OptionalTrimmed,
});

export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  const bare = h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
  return (
    bare === "127.0.0.1" ||
    bare === "::1" ||
    bare === "localhost" ||
    bare === "0.0.0.0" ||
    bare === "::" ||
    bare === "::ffff:127.0.0.1" ||
    bare.startsWith("127.") ||
    bare.endsWith(".localhost")
  );
}

function hasWrapperToken(authToken: string | undefined): boolean {
  return Boolean(authToken && authToken.trim().length > 0);
}

/**
 * Fail closed before a public MCP URL is advertised.
 * FLOK_MCP_BASE_URL must be HTTPS, not loopback, and FLOK_MCP_AUTH_TOKEN
 * is mandatory. Does not start a tunnel; the operator supplies TLS.
 */
export function assertRemoteMcpExposure(config: McpGatewayConfig): void {
  const raw: { baseUrl?: string; authToken?: string } = {};
  if (config.baseUrl !== undefined) raw.baseUrl = config.baseUrl;
  if (config.authToken !== undefined) raw.authToken = config.authToken;
  const parsed = ExposureConfigSchema.parse(raw);
  if (!parsed.baseUrl) return;
  let url: URL;
  try {
    url = new URL(parsed.baseUrl);
  } catch {
    throw new ComputerError(
      "MCP_REMOTE_URL_INVALID",
      "FLOK_MCP_BASE_URL must be a valid https:// URL for the Grok Bot connector (not 127.0.0.1)",
    );
  }
  if (url.protocol !== "https:") {
    throw new ComputerError(
      "MCP_REMOTE_URL_NOT_HTTPS",
      "FLOK_MCP_BASE_URL must be https://. localhost/http is not a real remote Grok Bot endpoint",
    );
  }
  if (isLoopbackHostname(url.hostname)) {
    throw new ComputerError(
      "MCP_REMOTE_URL_LOOPBACK",
      "FLOK_MCP_BASE_URL cannot be loopback. 127.0.0.1 is local smoke only; a remote Grok Bot needs authenticated HTTPS",
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ComputerError(
      "MCP_REMOTE_URL_UNSAFE",
      "FLOK_MCP_BASE_URL must not include userinfo, query, or fragment (credentials must not appear in the connector URL)",
    );
  }
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/mcp") {
    throw new ComputerError(
      "MCP_REMOTE_URL_PATH",
      "FLOK_MCP_BASE_URL path must be /mcp (Grok Bot POST /mcp)",
    );
  }
  if (!hasWrapperToken(parsed.authToken)) {
    throw new ComputerError(
      "MCP_REMOTE_AUTH_REQUIRED",
      "FLOK_MCP_AUTH_TOKEN is mandatory for public/non-loopback MCP. Do not expose unauthenticated public MCP",
    );
  }
}
