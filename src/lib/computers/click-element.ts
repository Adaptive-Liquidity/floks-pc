/**
 * L5: rewrite click_element to integer click_coordinates from a fresh AX cache.
 * Never guess. Provider never receives elementId.
 *
 * AX bounds are CSS pixels inside the page viewport. The screen click adds the
 * viewport origin from Browser.getWindowForTarget plus chrome insets, times
 * devicePixelRatio. That origin is viewportOrigin, in screen pixels. xdotool
 * receives the screen point. A stubbed origin of +0,+30 clicks 30 pixels below
 * the CSS point.
 */

import type { Action, ActionResult, Observation } from "./types.js";
import { AxNodeSchema, CDP_AX_NODE_CAP, type CdpAxBounds, type CdpAxNode } from "./providers/runloop-cdp.js";

export const AX_CACHE_TTL_MS = 15_000;

export type AxClickCache = {
  cachedAt: number;
  screenWidth: number;
  screenHeight: number;
  nodes: Map<string, CdpAxNode>;
  /** Screen origin of the page viewport. Defaults to 0,0. */
  viewportOrigin?: { x: number; y: number };
  devicePixelRatio?: number;
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
    if (nodes.size >= CDP_AX_NODE_CAP) break;
  }
  if (nodes.size === 0) return null;
  if (!Number.isInteger(observation.screenWidth) || !Number.isInteger(observation.screenHeight)) {
    return null;
  }
  if (observation.screenWidth < 1 || observation.screenHeight < 1) return null;
  const cache: AxClickCache = {
    cachedAt: now,
    screenWidth: observation.screenWidth,
    screenHeight: observation.screenHeight,
    nodes,
  };
  const origin = asRecord(summary.viewportOrigin);
  if (origin && typeof origin.x === "number" && typeof origin.y === "number") {
    cache.viewportOrigin = { x: Math.round(origin.x), y: Math.round(origin.y) };
  }
  if (typeof summary.devicePixelRatio === "number" && summary.devicePixelRatio > 0) {
    cache.devicePixelRatio = summary.devicePixelRatio;
  }
  return cache;
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
  const css = integerClickTarget(node.bounds);
  if (!css) {
    return {
      ok: false,
      code: "CLICK_ELEMENT_UNMAPPED",
      error: "click_element bounds are not integer-mappable",
    };
  }
  const origin = cache.viewportOrigin ?? { x: 0, y: 0 };
  const dpr = cache.devicePixelRatio ?? 1;
  const target = {
    x: Math.round(origin.x + css.x * dpr),
    y: Math.round(origin.y + css.y * dpr),
  };
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

function mayChangePage(action: Action): boolean {
  return action.type !== "wait" && action.type !== "click_element";
}

export function rewriteActSlots(
  actions: Action[],
  cache: AxClickCache | null,
  now: number,
): RewriteSlot[] {
  let pageMayHaveChanged = false;
  return actions.map((action) => {
    if (action.type === "click_element") {
      if (pageMayHaveChanged) {
        return {
          kind: "fail",
          action,
          code: "ELEMENT_STALE",
          error: "click_element must not follow a mutating action in the same batch; observe first",
        };
      }
      const next = rewriteClickElement(action, cache, now);
      if (next.ok) {
        pageMayHaveChanged = true;
        return { kind: "forward", action: next.action };
      }
      return { kind: "fail", action, error: next.error, code: next.code };
    }
    if (mayChangePage(action)) pageMayHaveChanged = true;
    return { kind: "forward", action };
  });
}

export function stitchActResults(
  slots: RewriteSlot[],
  providerResults: Array<{
    action: Action;
    success: boolean;
    error?: string;
    code?: string;
    finalUrl?: string;
  }>,
): {
  results: ActionResult["results"];
  failClosed: boolean;
  failCode: string | null;
} {
  let forwarded = 0;
  let failClosed = false;
  let failCode: string | null = null;
  const results: ActionResult["results"] = [];
  for (const slot of slots) {
    if (slot.kind === "fail") {
      failClosed = true;
      if (failCode === null) failCode = slot.code;
      const failed: ActionResult["results"][number] = {
        action: slot.action,
        success: false,
        error: slot.error,
      };
      if (slot.code) failed.code = slot.code;
      results.push(failed);
      continue;
    }
    const row = providerResults[forwarded];
    forwarded += 1;
    if (!row) {
      results.push({ action: slot.action, success: false, error: "provider omitted act result" });
      continue;
    }
    const copied: ActionResult["results"][number] = { action: slot.action, success: row.success };
    if (row.error !== undefined) copied.error = row.error;
    if (row.code !== undefined) copied.code = row.code;
    if (row.finalUrl !== undefined) copied.finalUrl = row.finalUrl;
    results.push(copied);
  }
  return { results, failClosed, failCode };
}
