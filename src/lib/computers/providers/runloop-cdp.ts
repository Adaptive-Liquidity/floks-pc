/**
 * Guest Chrome CDP (loopback only). Mapping is host-side; the helper
 * speaks CDP inside the Devbox. FakeProvider is not involved.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import { navigationReached } from "./runloop-browser.js";
import { RUNLOOP_WORKSPACE_ROOT } from "./runloop-client.js";

export const CDP_DEBUG_PORT = 9222;
export const CDP_DEBUG_ADDRESS = "127.0.0.1";
export const CDP_HELPER_PATH = `${RUNLOOP_WORKSPACE_ROOT}/.flok/cdp-ax.mjs`;
export const CDP_NAV_HELPER_PATH = `${RUNLOOP_WORKSPACE_ROOT}/.flok/cdp-nav.mjs`;
export const CDP_AX_NODE_CAP = 500;
/** Guest helper hard deadline. Under the host exec hint; Runloop optimistic_timeout does not kill. */
export const CDP_AX_HELPER_DEADLINE_MS = 12_000;

export type CdpAxDumpNode = {
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: string;
  name?: string;
  value?: string;
  focused?: boolean;
  contentQuad?: number[];
};

export const CdpAxDumpNodeSchema = z.object({
  backendDOMNodeId: z.number().int().finite().optional(),
  ignored: z.boolean().optional(),
  role: z.string().min(1).max(256).optional(),
  name: z.string().max(4096).optional(),
  value: z.string().max(4096).optional(),
  focused: z.boolean().optional(),
  contentQuad: z.array(z.number().finite()).max(32).optional(),
});

/** Guest Node binary. PATH as flok-ui is not assumed. */
export const CDP_NODE_BIN = "/usr/bin/node";

export const CdpViewportOriginSchema = z.object({
  x: z.number().int().finite(),
  y: z.number().int().finite(),
});

export const CdpAxDumpSchema = z
  .object({
    nodes: z.array(z.unknown()).max(2000),
    viewportOrigin: CdpViewportOriginSchema.optional(),
    devicePixelRatio: z.number().positive().max(8).optional(),
  })
  .strict();

export const AxBoundsSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const AxNodeSchema = z.object({
  id: z.string().min(1).max(64),
  role: z.string().min(1).max(64),
  name: z.string().max(512).optional(),
  value: z.string().max(512).optional(),
  focused: z.boolean().optional(),
  bounds: AxBoundsSchema.optional(),
});

export const AccessibilitySummarySchema = z.object({
  source: z.literal("cdp"),
  nodes: z.array(AxNodeSchema).max(CDP_AX_NODE_CAP),
  viewportOrigin: CdpViewportOriginSchema.optional(),
  devicePixelRatio: z.number().positive().max(8).optional(),
});

export type CdpAxBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CdpAxNode = {
  id: string;
  role: string;
  name?: string;
  value?: string;
  focused?: boolean;
  bounds?: CdpAxBounds;
};

export type CdpViewportOrigin = { x: number; y: number };

export type CdpAxSummary = {
  source: "cdp";
  nodes: CdpAxNode[];
  /** Screen origin of the page viewport, in screen pixels. */
  viewportOrigin?: CdpViewportOrigin;
  devicePixelRatio?: number;
};

export function cdpAxNodeId(backendDOMNodeId: number): string {
  return createHash("sha256")
    .update(String(backendDOMNodeId))
    .digest("hex")
    .slice(0, 16);
}

export function cdpAxFallbackId(role: string, name: string | undefined, index: number): string {
  return createHash("sha256")
    .update(`${index}:${role}:${name ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

/** Pull the helper JSON object out of mixed guest stdout. No dump text in errors. */
export function parseCdpAxHelperStdout(stdout: string): unknown {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("cdp ax helper returned non-JSON");
  }
  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch {
    throw new Error("cdp ax helper returned non-JSON");
  }
}

function stringValue(raw: unknown): string | undefined {
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (raw && typeof raw === "object" && "value" in raw) {
    const v = (raw as { value: unknown }).value;
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/** Counts-only diagnostics. Never pass helper stdout or a CDP dump. */
export function sanitizeCdpAxHint(text: string, max = 80): string {
  return text
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function logCdpAxObserve(event: string, fields: Record<string, string | number | boolean>): void {
  const parts = Object.entries(fields).map(([k, v]) => `${k}=${v}`);
  process.stderr.write(`flok-cdp-ax ${event} ${parts.join(" ")}\n`);
}

function boundsFromQuad(quad: number[] | undefined): CdpAxBounds | undefined {
  if (!quad || quad.length < 8) return undefined;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < 8; i += 2) {
    const x = quad[i];
    const y = quad[i + 1];
    if (typeof x !== "number" || typeof y !== "number") return undefined;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    xs.push(x);
    ys.push(y);
  }
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const x = Math.floor(minX);
  const y = Math.floor(minY);
  const width = Math.floor(maxX) - x;
  const height = Math.floor(maxY) - y;
  if (x < 0 || y < 0 || width < 1 || height < 1) return undefined;
  return { x, y, width, height };
}

function coerceDumpNode(candidate: unknown, index: number): CdpAxNode | undefined {
  if (!candidate || typeof candidate !== "object") return undefined;
  const o = candidate as Record<string, unknown>;
  if (o.ignored === true) return undefined;
  const role = stringValue(o.role);
  if (!role) return undefined;
  const name = stringValue(o.name);
  const value = stringValue(o.value);
  const id =
    typeof o.backendDOMNodeId === "number" && Number.isFinite(o.backendDOMNodeId)
      ? cdpAxNodeId(o.backendDOMNodeId)
      : cdpAxFallbackId(role, name, index);
  const node: CdpAxNode = { id, role: role.slice(0, 64) };
  if (name) node.name = name.slice(0, 512);
  if (value) node.value = value.slice(0, 512);
  if (o.focused === true) node.focused = true;
  const quad = Array.isArray(o.contentQuad)
    ? o.contentQuad.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    : undefined;
  const bounds = boundsFromQuad(quad);
  if (bounds) node.bounds = bounds;
  return node;
}

/** Map a guest CDP dump. Nodes without a box model keep no bounds (no guessed clicks). */
export function mapCdpAxDump(dump: unknown): CdpAxSummary {
  const parsed = CdpAxDumpSchema.parse(dump);
  if (parsed.nodes.length === 0) {
    throw new Error("cdp ax tree empty");
  }
  const nodes: CdpAxNode[] = [];
  for (let i = 0; i < parsed.nodes.length; i++) {
    const node = coerceDumpNode(parsed.nodes[i], i);
    if (!node) continue;
    nodes.push(node);
    if (nodes.length >= CDP_AX_NODE_CAP) break;
  }
  if (nodes.length === 0) {
    throw new Error("cdp ax tree empty");
  }
  const summary: CdpAxSummary = { source: "cdp", nodes };
  if (parsed.viewportOrigin) summary.viewportOrigin = parsed.viewportOrigin;
  if (parsed.devicePixelRatio !== undefined) summary.devicePixelRatio = parsed.devicePixelRatio;
  AccessibilitySummarySchema.parse(summary);
  return summary;
}

export type CdpPageTarget = {
  id?: string;
  type?: string;
  webSocketDebuggerUrl?: string;
};

/** Prefer the root-written active target, otherwise the first page target. */
export function selectPageTarget<T extends CdpPageTarget>(
  list: readonly T[],
  preferredId?: string,
): T | undefined {
  const pages = list.filter((target) => target.type === "page" && typeof target.webSocketDebuggerUrl === "string");
  if (preferredId) {
    const hit = pages.find((target) => target.id === preferredId);
    if (hit) return hit;
  }
  return pages[0];
}

/** Guest copy of selectPageTarget. Both CDP helpers embed this text. */
export const SELECT_PAGE_TARGET_JS = [
  "const CDP_DIR = '/run/flok-cdp';",
  "const ACTIVE_TARGET = CDP_DIR + '/active-target';",
  "function readPreferredId() {",
  "  let fd;",
  "  try {",
  "    fd = openSync(ACTIVE_TARGET, constants.O_RDONLY | constants.O_NOFOLLOW);",
  "    const buf = Buffer.alloc(128);",
  "    const n = readSync(fd, buf, 0, buf.length, 0);",
  "    return buf.subarray(0, n).toString('utf8').trim();",
  "  } catch {",
  "    return '';",
  "  } finally {",
  "    if (fd !== undefined) { try { closeSync(fd); } catch {} }",
  "  }",
  "}",
  "function selectPageTarget(list) {",
  "  const pages = (Array.isArray(list) ? list : []).filter((t) => t && t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string');",
  "  const preferred = readPreferredId();",
  "  if (preferred) {",
  "    const hit = pages.find((t) => t.id === preferred);",
  "    if (hit) return hit;",
  "  }",
  "  return pages[0];",
  "}",
  "function rememberTarget(id) {",
  "  if (typeof id !== 'string' || !id) return;",
  "  const tmp = CDP_DIR + '/active-' + process.pid + '-' + Date.now();",
  "  let fd;",
  "  try {",
  "    fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);",
  "    writeSync(fd, id);",
  "    closeSync(fd);",
  "    fd = undefined;",
  "    renameSync(tmp, ACTIVE_TARGET);",
  "  } catch {",
  "    if (fd !== undefined) { try { closeSync(fd); } catch {} }",
  "  }",
  "}",
].join("\n");

/**
 * Guest Node 22 helper. Connects only to 127.0.0.1:9222.
 * Prints `{ nodes: CdpAxDumpNode[] }` on stdout.
 */
export const CDP_AX_HELPER_JS = [
  "import http from 'node:http';",
  "import { closeSync, constants, openSync, readSync, renameSync, writeSync } from 'node:fs';",
  "const BASE = 'http://127.0.0.1:9222';",
  `const DEADLINE_MS = ${CDP_AX_HELPER_DEADLINE_MS};`,
  "const reqs = new Set();",
  "let sock = null;",
  "function abortHelper() {",
  "  for (const r of reqs) { try { r.destroy(); } catch {} }",
  "  reqs.clear();",
  "  if (sock) { try { sock.close(); } catch {} sock = null; }",
  "}",
  "const watchdog = setTimeout(() => {",
  "  abortHelper();",
  "  process.stderr.write('cdp helper deadline');",
  "  process.exit(1);",
  "}, DEADLINE_MS);",
  "function get(url) {",
  "  return new Promise((resolve, reject) => {",
  "    const req = http.get(url, (res) => {",
  "      const chunks = [];",
  "      res.on('data', (c) => chunks.push(c));",
  "      res.on('end', () => {",
  "        reqs.delete(req);",
  "        const body = Buffer.concat(chunks).toString('utf8');",
  "        if (res.statusCode !== 200) reject(new Error('cdp http ' + res.statusCode));",
  "        else resolve(body);",
  "      });",
  "    });",
  "    reqs.add(req);",
  "    req.on('error', (e) => { reqs.delete(req); reject(e); });",
  "  });",
  "}",
  "function rpc(ws) {",
  "  let next = 1;",
  "  const pending = new Map();",
  "  const failAll = (err) => {",
  "    for (const { reject } of pending.values()) reject(err);",
  "    pending.clear();",
  "  };",
  "  ws.addEventListener('message', (ev) => {",
  "    let msg;",
  "    try { msg = JSON.parse(String(ev.data)); } catch { return; }",
  "    if (msg.id == null || !pending.has(msg.id)) return;",
  "    const { resolve, reject } = pending.get(msg.id);",
  "    pending.delete(msg.id);",
  "    if (msg.error) reject(new Error(JSON.stringify(msg.error)));",
  "    else resolve(msg.result);",
  "  });",
  "  ws.addEventListener('close', () => failAll(new Error('cdp ws closed')));",
  "  return (method, params) => new Promise((resolve, reject) => {",
  "    const id = next++;",
  "    pending.set(id, { resolve, reject });",
  "    ws.send(JSON.stringify({ id, method, params }));",
  "  });",
  "}",
  "function assertLoopbackWs(wsUrl) {",
  "  const u = new URL(wsUrl);",
  "  if (u.protocol !== 'ws:' || u.hostname !== '127.0.0.1' || u.port !== '9222') {",
  "    throw new Error('cdp websocket is not loopback');",
  "  }",
  "}",
  SELECT_PAGE_TARGET_JS,
  "async function pageViewport(call) {",
  "  try {",
  "    const win = await call('Browser.getWindowForTarget', {});",
  "    const metrics = await call('Runtime.evaluate', { expression: 'JSON.stringify({iw:innerWidth,ih:innerHeight,ow:outerWidth,oh:outerHeight,dpr:devicePixelRatio||1})', returnByValue: true });",
  "    const raw = metrics && metrics.result ? metrics.result.value : '';",
  "    const m = JSON.parse(String(raw || '{}'));",
  "    const dpr = Number(m.dpr);",
  "    if (!(dpr > 0) || dpr > 8) return null;",
  "    const chromeTop = Number(m.oh) - Number(m.ih);",
  "    const chromeLeft = (Number(m.ow) - Number(m.iw)) / 2;",
  "    const b = (win && win.bounds) || {};",
  "    const left = Number(b.left) || 0;",
  "    const top = Number(b.top) || 0;",
  "    if (!Number.isFinite(chromeTop) || !Number.isFinite(chromeLeft)) return null;",
  "    return {",
  "      viewportOrigin: { x: Math.round((left + chromeLeft) * dpr), y: Math.round((top + chromeTop) * dpr) },",
  "      devicePixelRatio: dpr,",
  "    };",
  "  } catch { return null; }",
  "}",
  "async function main() {",
  "  await get(BASE + '/json/version');",
  "  const list = JSON.parse(await get(BASE + '/json'));",
  "  const page = selectPageTarget(list);",
  "  if (!page || typeof page.webSocketDebuggerUrl !== 'string') {",
  "    throw new Error('cdp page target missing');",
  "  }",
  "  if (typeof page.id === 'string') rememberTarget(page.id);",
  "  assertLoopbackWs(page.webSocketDebuggerUrl);",
  "  const ws = new WebSocket(page.webSocketDebuggerUrl);",
  "  sock = ws;",
  "  await new Promise((resolve, reject) => {",
  "    ws.addEventListener('open', resolve);",
  "    ws.addEventListener('error', () => reject(new Error('cdp ws error')));",
  "  });",
  "  const call = rpc(ws);",
  "  await call('DOM.enable', {});",
  "  await call('DOM.getDocument', { depth: 0 });",
  "  await call('Accessibility.enable', {});",
  "  const tree = await call('Accessibility.getFullAXTree', {});",
  "  if (!tree || !Array.isArray(tree.nodes)) throw new Error('cdp ax tree missing nodes');",
  "  const raw = tree.nodes;",
  "  const candidates = [];",
  "  for (const n of raw) {",
  "    if (n.ignored) continue;",
  "    const role = n.role && n.role.value;",
  "    if (!role) continue;",
  "    if (typeof n.backendDOMNodeId !== 'number') continue;",
  "    candidates.push(n);",
  `    if (candidates.length >= ${CDP_AX_NODE_CAP}) break;`,
  "  }",
  "  const ids = candidates.map((n) => n.backendDOMNodeId).filter((id) => typeof id === 'number');",
  "  const boxes = new Map();",
  "  const chunk = 16;",
  "  for (let i = 0; i < ids.length; i += chunk) {",
  "    const slice = ids.slice(i, i + chunk);",
  "    const got = await Promise.all(slice.map(async (backendNodeId) => {",
  "      try {",
  "        const box = await call('DOM.getBoxModel', { backendNodeId });",
  "        return [backendNodeId, box && box.model && box.model.content];",
  "      } catch (e) {",
  "        const msg = String(e && e.message ? e.message : e);",
  "        if (msg.includes('Could not compute box model') || msg.includes('Could not find node')) {",
  "          return [backendNodeId, undefined];",
  "        }",
  "        throw e;",
  "      }",
  "    }));",
  "    for (const [id, quad] of got) boxes.set(id, quad);",
  "  }",
  "  const nodes = candidates.map((n) => {",
  "    const row = { backendDOMNodeId: n.backendDOMNodeId, ignored: false, role: String(n.role.value) };",
  "    if (n.name && n.name.value != null) row.name = String(n.name.value).slice(0, 512);",
  "    if (n.value && n.value.value != null) row.value = String(n.value.value).slice(0, 512);",
  "    const props = Array.isArray(n.properties) ? n.properties : [];",
  "    if (props.some((p) => p && p.name === 'focused' && p.value && p.value.value === true)) row.focused = true;",
  "    const quad = boxes.get(n.backendDOMNodeId);",
  "    if (Array.isArray(quad)) row.contentQuad = quad;",
  "    return row;",
  "  });",
  "  const viewport = await pageViewport(call);",
  "  const out = { nodes };",
  "  if (viewport) {",
  "    out.viewportOrigin = viewport.viewportOrigin;",
  "    out.devicePixelRatio = viewport.devicePixelRatio;",
  "  }",
  "  ws.close();",
  "  sock = null;",
  "  clearTimeout(watchdog);",
  "  process.stdout.write(JSON.stringify(out));",
  "}",
  "main().catch((e) => {",
  "  process.stderr.write(String(e && e.message ? e.message : e));",
  "  process.exit(1);",
  "});",
  "",
].join("\n");

/**
 * Guest navigation helper. Loopback CDP only. URL is argv, never a shell string.
 * Prints `{ ok, finalUrl | href }` on stdout.
 */
export const CDP_NAV_HELPER_JS = [
  "import http from 'node:http';",
  "import { closeSync, constants, openSync, readSync, renameSync, writeSync } from 'node:fs';",
  "const BASE = 'http://127.0.0.1:9222';",
  "const reqs = new Set();",
  "let sock = null;",
  "function get(url) {",
  "  return new Promise((resolve, reject) => {",
  "    const req = http.get(url, (res) => {",
  "      const chunks = [];",
  "      res.on('data', (c) => chunks.push(c));",
  "      res.on('end', () => {",
  "        reqs.delete(req);",
  "        const body = Buffer.concat(chunks).toString('utf8');",
  "        if (res.statusCode !== 200) reject(new Error('cdp http ' + res.statusCode));",
  "        else resolve(body);",
  "      });",
  "    });",
  "    reqs.add(req);",
  "    req.on('error', (e) => { reqs.delete(req); reject(e); });",
  "  });",
  "}",
  "function rpc(ws) {",
  "  let next = 1;",
  "  const pending = new Map();",
  "  ws.addEventListener('message', (ev) => {",
  "    let msg;",
  "    try { msg = JSON.parse(String(ev.data)); } catch { return; }",
  "    if (msg.id == null || !pending.has(msg.id)) return;",
  "    const { resolve, reject } = pending.get(msg.id);",
  "    pending.delete(msg.id);",
  "    if (msg.error) reject(new Error(JSON.stringify(msg.error)));",
  "    else resolve(msg.result);",
  "  });",
  "  ws.addEventListener('close', () => {",
  "    for (const { reject } of pending.values()) reject(new Error('cdp ws closed'));",
  "    pending.clear();",
  "  });",
  "  return (method, params) => new Promise((resolve, reject) => {",
  "    const id = next++;",
  "    pending.set(id, { resolve, reject });",
  "    ws.send(JSON.stringify({ id, method, params }));",
  "  });",
  "}",
  "function assertLoopbackWs(wsUrl) {",
  "  const u = new URL(wsUrl);",
  "  if (u.protocol !== 'ws:' || u.hostname !== '127.0.0.1' || u.port !== '9222') {",
  "    throw new Error('cdp websocket is not loopback');",
  "  }",
  "}",
  SELECT_PAGE_TARGET_JS,
  navigationReached.toString(),
  "async function hrefOf(call) {",
  "  const ev = await call('Runtime.evaluate', { expression: 'location.href', returnByValue: true });",
  "  const value = ev && ev.result ? ev.result.value : '';",
  "  return typeof value === 'string' ? value : '';",
  "}",
  "async function main() {",
  "  const arg = process.argv[2];",
  "  if (!arg) throw new Error('missing nav argv');",
  "  await get(BASE + '/json/version');",
  "  const list = JSON.parse(await get(BASE + '/json'));",
  "  const page = selectPageTarget(list);",
  "  if (!page || typeof page.webSocketDebuggerUrl !== 'string') throw new Error('cdp page target missing');",
  "  assertLoopbackWs(page.webSocketDebuggerUrl);",
  "  const ws = new WebSocket(page.webSocketDebuggerUrl);",
  "  sock = ws;",
  "  await new Promise((resolve, reject) => {",
  "    ws.addEventListener('open', resolve);",
  "    ws.addEventListener('error', () => reject(new Error('cdp ws error')));",
  "  });",
  "  const call = rpc(ws);",
  "  if (arg === '--href') {",
  "    const href = await hrefOf(call);",
  "    process.stdout.write(JSON.stringify({ ok: true, href }));",
  "    return;",
  "  }",
  "  if (arg === '--front') {",
  "    await call('Page.bringToFront', {});",
  "    if (typeof page.id === 'string') rememberTarget(page.id);",
  "    process.stdout.write(JSON.stringify({ ok: true }));",
  "    return;",
  "  }",
  "  await call('Page.enable', {});",
  "  const nav = await call('Page.navigate', { url: arg });",
  "  if (nav && nav.errorText) {",
  "    process.stdout.write(JSON.stringify({ ok: false, href: '', errorText: String(nav.errorText) }));",
  "    return;",
  "  }",
  "  await call('Page.bringToFront', {});",
  "  const started = Date.now();",
  "  let href = '';",
  "  while (Date.now() - started < 15000) {",
  "    try {",
  "      href = await hrefOf(call);",
  "    } catch {",
  "      await new Promise((r) => setTimeout(r, 250));",
  "      continue;",
  "    }",
  "    if (href.startsWith('chrome-error://')) {",
  "      process.stdout.write(JSON.stringify({ ok: false, href, errorText: 'navigation error page' }));",
  "      return;",
  "    }",
  "    if (navigationReached(arg, href)) {",
  "      if (typeof page.id === 'string') rememberTarget(page.id);",
  "      process.stdout.write(JSON.stringify({ ok: true, finalUrl: href }));",
  "      return;",
  "    }",
  "    await new Promise((r) => setTimeout(r, 250));",
  "  }",
  "  process.stdout.write(JSON.stringify({ ok: false, href }));",
  "}",
  "const watchdog = setTimeout(() => {",
  "  process.stdout.write(JSON.stringify({ ok: false, href: '' }));",
  "  process.exit(0);",
  "}, 18000);",
  "main().then(() => {",
  "  clearTimeout(watchdog);",
  "  if (sock) { try { sock.close(); } catch {} }",
  "}).catch((e) => {",
  "  clearTimeout(watchdog);",
  "  process.stderr.write(String(e && e.message ? e.message : e));",
  "  process.exit(1);",
  "});",
  "",
].join("\n");
