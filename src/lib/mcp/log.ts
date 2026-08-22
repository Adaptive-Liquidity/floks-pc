/**
 * Redacting logger. Pair codes, capability tokens, Authorization headers,
 * and provider API keys must never appear in MCP logs.
 */

const SECRET_KEY =
  /^(capability_token|capabilityToken|pair_code|pairCode|authorization|token|code|bearer|api[_-]?key|runloop_api_key|authToken|account_id)$/i;

export interface McpLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export class RecordingLogger implements McpLogger {
  readonly lines: string[] = [];

  info(event: string, fields?: Record<string, unknown>): void {
    this.lines.push(serialize("info", event, fields));
  }
  warn(event: string, fields?: Record<string, unknown>): void {
    this.lines.push(serialize("warn", event, fields));
  }
  error(event: string, fields?: Record<string, unknown>): void {
    this.lines.push(serialize("error", event, fields));
  }

  blob(): string {
    return this.lines.join("\n");
  }
}

export const silentLogger: McpLogger = {
  info() {},
  warn() {},
  error() {},
};

export function redactValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : redactValue(v);
    }
    return out;
  }
  return "[unserializable]";
}

function serialize(
  level: string,
  event: string,
  fields?: Record<string, unknown>,
): string {
  return JSON.stringify({
    level,
    event,
    ...(fields ? (redactValue(fields) as Record<string, unknown>) : {}),
  });
}

export function blobContainsSecret(blob: string, secret: string): boolean {
  if (secret.length === 0) return false;
  return blob.includes(secret);
}
