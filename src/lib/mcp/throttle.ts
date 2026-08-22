/**
 * C5 pair-code throttle keyed on the MCP *connection* identity
 * (digest of the wrapper Authorization bearer, or unauth+remote address).
 * Never keyed on caller-supplied account_id or MCP session id.
 */

import { sha256Hex } from "../computers/digest.js";
import {
  MCP_PAIR_CONNECTION_FAILURE_LIMIT,
  MCP_PAIR_CONNECTION_WINDOW_MS,
  MCP_PAIR_THROTTLE_MAX_ENTRIES,
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
    private readonly maxEntries = MCP_PAIR_THROTTLE_MAX_ENTRIES,
  ) {}

  assert(identity: ConnectionIdentity, now = Date.now()): void {
    const cur = this.windows.get(identity.connectionId);
    if (!cur) return;
    if (now - cur.windowStart > this.windowMs) {
      this.windows.delete(identity.connectionId);
      return;
    }
    if (cur.count >= this.limit) {
      throw Object.assign(new Error("too many pair attempts"), {
        name: "PairThrottled",
        code: "PAIR_THROTTLED",
      });
    }
  }

  noteFailure(identity: ConnectionIdentity, now = Date.now()): void {
    const cur = this.windows.get(identity.connectionId);
    if (cur && now - cur.windowStart <= this.windowMs) {
      cur.count += 1;
      return;
    }
    if (!cur && this.windows.size >= this.maxEntries) {
      this.evictOldest();
    }
    this.windows.set(identity.connectionId, { count: 1, windowStart: now });
  }

  reset(): void {
    this.windows.clear();
  }

  private evictOldest(): void {
    let oldestKey: string | undefined;
    let oldestStart = Number.POSITIVE_INFINITY;
    for (const [k, win] of this.windows) {
      if (win.windowStart < oldestStart) {
        oldestStart = win.windowStart;
        oldestKey = k;
      }
    }
    if (oldestKey !== undefined) this.windows.delete(oldestKey);
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
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  const token = match?.[1];
  return token && token.length > 0 ? token : undefined;
}
