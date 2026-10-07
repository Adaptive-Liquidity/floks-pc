type PairCall = {
  method?: unknown;
  params?: { name?: unknown; arguments?: Record<string, unknown> };
};

/** Forces computer_pair flock_id, including inside a JSON-RPC batch. Returns false when a call names a different flock. */
export function bindPairFlock(body: unknown, flock: string): boolean {
  const items = Array.isArray(body) ? body : [body];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const call = item as PairCall;
    if (call.method !== "tools/call" || call.params?.name !== "computer_pair") continue;
    const args = call.params.arguments;
    if (!args || typeof args !== "object") continue;
    const given = args.flock_id;
    if (typeof given === "string" && given.length > 0 && given !== flock) return false;
    args.flock_id = flock;
  }
  return true;
}
