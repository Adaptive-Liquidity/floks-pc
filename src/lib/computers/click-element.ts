/**
 * L5: rewrite click_element to integer click_coordinates from a fresh AX cache.
 * Never guess. Provider never receives elementId.
 */

import type { Action, Observation } from "./types.js";
import { AxNodeSchema, type CdpAxBounds, type CdpAxNode } from "./providers/runloop-cdp.js";

export const AX_CACHE_TTL_MS = 15_000;

export type AxClickCache = {
  cachedAt: number;
  screenWidth: number;
  screenHeight: number;
  nodes: Map<string, CdpAxNode>;
};

export type ClickRewrite =
  | { ok: true; action: Action }
  | { ok: false; code: string; error: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function axCacheFromObservation(observation: Observation, now: number): AxClickCache | null {
  const summary = asRecord(observation.accessibilitySummary);
  if (!summary) return null;
  const rawNodes = summary.nodes;
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) return null;
  const nodes = new Map<string, CdpAxNode>();
  for (const candidate of rawNodes) {
    const parsed = AxNodeSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const node: CdpAxNode = { id: parsed.data.id, role: parsed.data.role };
    if (parsed.data.name !== undefined) node.name = parsed.data.name;
    if (parsed.data.value !== undefined) node.value = parsed.data.value;
    if (parsed.data.focused !== undefined) node.focused = parsed.data.focused;
    if (parsed.data.bounds !== undefined) node.bounds = parsed.data.bounds;
    nodes.set(node.id, node);
  }
  if (nodes.size === 0) return null;
  if (!Number.isInteger(observation.screenWidth) || !Number.isInteger(observation.screenHeight)) {
    return null;
  }
  if (observation.screenWidth < 1 || observation.screenHeight < 1) return null;
  return {
    cachedAt: now,
    screenWidth: observation.screenWidth,
    screenHeight: observation.screenHeight,
    nodes,
  };
}

export function integerClickTarget(bounds: CdpAxBounds): { x: number; y: number } | null {
  const x = bounds.x + Math.floor(bounds.width / 2);
  const y = bounds.y + Math.floor(bounds.height / 2);
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  return { x, y };
}

export function rewriteClickElement(
  action: Action,
  cache: AxClickCache | null,
  now: number,
): ClickRewrite {
  if (action.type !== "click_element") return { ok: true, action };
  const elementId = action.elementId?.trim() ?? "";
  if (!elementId) {
    return { ok: false, code: "ELEMENT_STALE", error: "click_element requires a fresh AX elementId" };
  }
  if (!cache || now - cache.cachedAt > AX_CACHE_TTL_MS) {
    return {
      ok: false,
      code: "ELEMENT_STALE",
      error: "click_element has no fresh AX bounds; observe with include_accessibility first",
    };
  }
  const node = cache.nodes.get(elementId);
  if (!node) {
    return { ok: false, code: "CLICK_ELEMENT_UNMAPPED", error: "click_element elementId is not in the last AX tree" };
  }
  if (!node.bounds) {
    return {
      ok: false,
      code: "CLICK_ELEMENT_UNMAPPED",
      error: "click_element has no box model; refusing to guess",
    };
  }
  const target = integerClickTarget(node.bounds);
  if (!target) {
    return {
      ok: false,
      code: "CLICK_ELEMENT_UNMAPPED",
      error: "click_element bounds are not integer-mappable",
    };
  }
  if (
    target.x < 0 ||
    target.y < 0 ||
    target.x >= cache.screenWidth ||
    target.y >= cache.screenHeight
  ) {
    return { ok: false, code: "CLICK_OFFSCREEN", error: "click_element target is offscreen" };
  }
  return {
    ok: true,
    action: { type: "click_coordinates", x: target.x, y: target.y },
  };
}

export type RewriteSlot =
  | { kind: "forward"; action: Action }
  | { kind: "fail"; action: Action; error: string; code: string };

export function rewriteActSlots(
  actions: Action[],
  cache: AxClickCache | null,
  now: number,
): RewriteSlot[] {
  return actions.map((action) => {
    if (action.type !== "click_element") return { kind: "forward", action };
    const next = rewriteClickElement(action, cache, now);
    if (next.ok) return { kind: "forward", action: next.action };
    return { kind: "fail", action, error: next.error, code: next.code };
  });
}

export function stitchActResults(
  slots: RewriteSlot[],
  providerResults: Array<{ action: Action; success: boolean; error?: string }>,
): {
  results: Array<{ action: Action; success: boolean; error?: string }>;
  failClosed: boolean;
  failCode: string | null;
} {
  let forwarded = 0;
  let failClosed = false;
  let failCode: string | null = null;
  const results: Array<{ action: Action; success: boolean; error?: string }> = [];
  for (const slot of slots) {
    if (slot.kind === "fail") {
      failClosed = true;
      if (failCode === null) failCode = slot.code;
      results.push({ action: slot.action, success: false, error: slot.error });
      continue;
    }
    const row = providerResults[forwarded];
    forwarded += 1;
    if (!row) {
      results.push({ action: slot.action, success: false, error: "provider omitted act result" });
      continue;
    }
    results.push(row.error === undefined ? { action: row.action, success: row.success } : row);
  }
  return { results, failClosed, failCode };
}
