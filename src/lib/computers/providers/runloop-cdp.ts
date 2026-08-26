/**
 * Guest Chrome CDP (loopback only). Mapping is host-side; the helper
 * speaks CDP inside the Devbox. FakeProvider is not involved.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import { RUNLOOP_WORKSPACE_ROOT } from "./runloop-client.js";

export const CDP_DEBUG_PORT = 9222;
export const CDP_DEBUG_ADDRESS = "127.0.0.1";
export const CDP_HELPER_PATH = `${RUNLOOP_WORKSPACE_ROOT}/.flok/cdp-ax.mjs`;
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
  contentQuad: z.array(z.number().finite()).max(8).optional(),
});

export const CdpAxDumpSchema = z
  .object({
    nodes: z.array(z.unknown()).max(2000),
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

export type CdpAxSummary = {
  source: "cdp";
  nodes: CdpAxNode[];
};

export function cdpAxNodeId(backendDOMNodeId: number): string {
  return createHash("sha256")
    .update(String(backendDOMNodeId))
    .digest("hex")
    .slice(0, 16);
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

/** Map a guest CDP dump. Nodes without a box model keep no bounds (no guessed clicks). */
export function mapCdpAxDump(dump: unknown): CdpAxSummary {
  const parsed = CdpAxDumpSchema.parse(dump);
  const nodes: CdpAxNode[] = [];
  for (const candidate of parsed.nodes) {
    const rawResult = CdpAxDumpNodeSchema.safeParse(candidate);
    if (!rawResult.success) continue;
    const raw = rawResult.data;
    if (raw.ignored) continue;
    if (typeof raw.backendDOMNodeId !== "number") continue;
    if (typeof raw.role !== "string" || raw.role.length === 0) continue;
    const node: CdpAxNode = {
      id: cdpAxNodeId(raw.backendDOMNodeId),
      role: raw.role.slice(0, 64),
    };
    if (typeof raw.name === "string" && raw.name.length > 0) {
      node.name = raw.name.slice(0, 512);
    }
    if (typeof raw.value === "string" && raw.value.length > 0) {
      node.value = raw.value.slice(0, 512);
    }
    if (raw.focused === true) node.focused = true;
    const bounds = boundsFromQuad(raw.contentQuad);
    if (bounds) node.bounds = bounds;
    nodes.push(node);
    if (nodes.length >= CDP_AX_NODE_CAP) break;
  }
  const summary: CdpAxSummary = { source: "cdp", nodes };
  AccessibilitySummarySchema.parse(summary);
  return summary;
}

/**
 * Guest Node 22 helper. Connects only to 127.0.0.1:9222.
 * Prints `{ nodes: CdpAxDumpNode[] }` on stdout.
 */
export const CDP_AX_HELPER_JS = [
  "import http from 'node:http';",
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
  "async function main() {",
  "  await get(BASE + '/json/version');",
  "  const list = JSON.parse(await get(BASE + '/json'));",
  "  const page = (Array.isArray(list) ? list : []).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);",
  "  if (!page || typeof page.webSocketDebuggerUrl !== 'string') {",
  "    throw new Error('cdp page target missing');",
  "  }",
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
  "  ws.close();",
  "  sock = null;",
  "  clearTimeout(watchdog);",
  "  process.stdout.write(JSON.stringify({ nodes }));",
  "}",
  "main().catch((e) => {",
  "  process.stderr.write(String(e && e.message ? e.message : e));",
  "  process.exit(1);",
  "});",
  "",
].join("\n");
