/**
 * C5 pair-code throttle keyed on the MCP *connection* identity
 * (digest of the wrapper Authorization bearer, or unauth+remote address).
 * Never keyed on caller-supplied account_id or MCP session id.
 */

import { sha256Hex } from "../computers/digest.js";
import {
  MCP_PAIR_CONNECTION_FAILURE_LIMIT,
  MCP_PAIR_CONNECTION_WINDOW_MS,
} from "./config.js";

export interface ConnectionIdentity {
  /** Stable non-secret key. Digest of bearer or unauth:ip. */
  connectionId: string;
  /** Whether a wrapper Authorization value was presented. */
  authenticated: boolean;
}

interface Window {
  count: number;
  windowStart: number;
}

export class PairConnectionThrottle {
  private windows = new Map<string, Window>();

  constructor(
    private readonly limit = MCP_PAIR_CONNECTION_FAILURE_LIMIT,
    private readonly windowMs = MCP_PAIR_CONNECTION_WINDOW_MS,
  ) {}

  assert(identity: ConnectionIdentity, now = Date.now()): void {
    this.sweep(now);
    const cur = this.windows.get(identity.connectionId);
    if (cur && now - cur.windowStart <= this.windowMs && cur.count >= this.limit) {
      throw Object.assign(new Error("too many pair attempts"), {
        name: "PairThrottled",
        code: "PAIR_THROTTLED",
      });
    }
  }

  noteFailure(identity: ConnectionIdentity, now = Date.now()): void {
    const cur = this.windows.get(identity.connectionId);
    if (!cur || now - cur.windowStart > this.windowMs) {
      this.windows.set(identity.connectionId, { count: 1, windowStart: now });
      return;
    }
    cur.count += 1;
  }

  reset(): void {
    this.windows.clear();
  }

  private sweep(now: number): void {
    for (const [k, win] of this.windows) {
      if (now - win.windowStart > this.windowMs) this.windows.delete(k);
    }
  }
}

export function connectionIdentityFromAuth(
  authorization: string | undefined,
  remoteAddress: string | undefined,
): ConnectionIdentity {
  const bearer = parseBearer(authorization);
  if (bearer) {
    return { connectionId: sha256Hex(`auth:${bearer}`), authenticated: true };
  }
  const ip = remoteAddress && remoteAddress.length > 0 ? remoteAddress : "unknown";
  return { connectionId: sha256Hex(`unauth:${ip}`), authenticated: false };
}

export function parseBearer(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const trimmed = authorization.trim();
  if (trimmed.length === 0) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  const token = match?.[1]?.trim() ?? trimmed;
  return token.length > 0 ? token : undefined;
}
