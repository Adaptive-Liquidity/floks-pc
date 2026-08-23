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
  lastSeen: number;
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
    if (!cur) {
      // Saturated with live at-limit windows: cannot track this identity, so
      // fail closed instead of leaving it unthrottled.
      if (this.windows.size >= this.maxEntries && !this.hasEvictable(now)) {
        throwThrottled();
      }
      return;
    }
    if (now - cur.windowStart > this.windowMs) {
      this.windows.delete(identity.connectionId);
      return;
    }
    cur.lastSeen = now;
    if (cur.count >= this.limit) {
      throwThrottled();
    }
  }

  noteFailure(identity: ConnectionIdentity, now = Date.now()): void {
    const cur = this.windows.get(identity.connectionId);
    if (cur && now - cur.windowStart <= this.windowMs) {
      cur.count += 1;
      cur.lastSeen = now;
      return;
    }
    if (!cur && this.windows.size >= this.maxEntries) {
      if (!this.evict(now)) return;
    }
    this.windows.set(identity.connectionId, { count: 1, windowStart: now, lastSeen: now });
  }

  reset(): void {
    this.windows.clear();
  }

  /** True when an expired or live non-throttled window can be dropped. */
  private hasEvictable(now: number): boolean {
    for (const win of this.windows.values()) {
      if (now - win.windowStart > this.windowMs) return true;
      if (win.count < this.limit) return true;
    }
    return false;
  }

  /**
   * Prefer expired, then non-throttled live entries with the lowest failure
   * count (LRU as the tie-break). Never evict an unexpired entry that is
   * at/over the throttle limit. Returns false when nothing eligible exists
   * (map is full of live throttled identities).
   */
  private evict(now: number): boolean {
    let expiredKey: string | undefined;
    let expiredSeen = Number.POSITIVE_INFINITY;
    let liveKey: string | undefined;
    let liveSeen = Number.POSITIVE_INFINITY;
    let liveCount = Number.POSITIVE_INFINITY;
    for (const [k, win] of this.windows) {
      if (now - win.windowStart > this.windowMs) {
        if (win.lastSeen < expiredSeen) {
          expiredSeen = win.lastSeen;
          expiredKey = k;
        }
        continue;
      }
      if (win.count >= this.limit) continue;
      // Prefer low-count (new flood identities) then LRU. A near-limit running
      // window is not displaced by distinct new connection identities.
      if (win.count < liveCount || (win.count === liveCount && win.lastSeen < liveSeen)) {
        liveSeen = win.lastSeen;
        liveCount = win.count;
        liveKey = k;
      }
    }
    const victim = expiredKey ?? liveKey;
    if (victim === undefined) return false;
    this.windows.delete(victim);
    return true;
  }
}

function throwThrottled(): never {
  throw Object.assign(new Error("too many pair attempts"), {
    name: "PairThrottled",
    code: "PAIR_THROTTLED",
  });
}

/** `authorization` must be a server-validated wrapper Bearer, never a client-claimed token. */
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
