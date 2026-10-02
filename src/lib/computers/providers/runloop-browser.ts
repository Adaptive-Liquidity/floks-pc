/**
 * One visible Chrome on the guest display, and CDP navigation of that same page.
 * Unpaid tests drive these functions with a stub exec. They do not call Runloop.
 */

import { inflateSync } from "node:zlib";
import type { Action, ActionResult } from "../types.js";

export const BROWSER_START_URL = "about:blank";
const CDP_VERSION_URL = "http://127.0.0.1:9222/json/version";

export type GuestExecResult = { exitCode: number; stdout: string; stderr: string };
export type GuestExec = (argv: string[]) => Promise<GuestExecResult>;

export class BrowserNotReady extends Error {
  constructor() {
    super("chrome did not answer on 127.0.0.1:9222");
    this.name = "BrowserNotReady";
  }
}

export class NavigationFailed extends Error {
  readonly code = "NAVIGATION_FAILED" as const;
  constructor(message: string) {
    super(message);
    this.name = "NavigationFailed";
  }
}

export function fixtureCleanupArgv(): string[] {
  return [
    "bash",
    "-lc",
    "rm -f /home/user/flok/.flok/fixture.html; pkill -u flok-ui -f '[.]flok/fixture[.]html' || true",
  ];
}

export function cdpReadyProbeArgv(): string[] {
  return [
    "python3",
    "-c",
    [
      "import urllib.request,sys",
      "try:",
      `    urllib.request.urlopen(${JSON.stringify(CDP_VERSION_URL)}, timeout=1)`,
      "    print('cdp-ready')",
      "except Exception:",
      "    print('cdp-down')",
      "    sys.exit(1)",
      "",
    ].join("\n"),
  ];
}

function logBrowserEnsure(started: boolean, readyMs: number): void {
  process.stderr.write(`flok-browser ensure started=${started} ready_ms=${readyMs}\n`);
}

async function cdpAnswers(exec: GuestExec): Promise<boolean> {
  const probe = await exec(cdpReadyProbeArgv());
  return probe.exitCode === 0 && probe.stdout.includes("cdp-ready");
}

/**
 * Delete a leftover fixture page, then reuse Chrome if CDP is already up.
 * Otherwise launch exactly one about:blank Chrome and wait for port 9222.
 * Cleanup runs before the CDP probe so a fixture process cannot look ready.
 */
export async function ensureManagedBrowser(opts: {
  exec: GuestExec;
  launchArgv: string[];
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<{ started: boolean; readyMs: number }> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const pollMs = opts.pollMs ?? 500;
  const startedAt = now();
  await opts.exec(fixtureCleanupArgv());
  if (await cdpAnswers(opts.exec)) {
    const readyMs = Math.max(0, now() - startedAt);
    logBrowserEnsure(false, readyMs);
    return { started: false, readyMs };
  }
  const launched = await opts.exec(opts.launchArgv);
  if (launched.exitCode !== 0) {
    throw new Error("chrome launch failed");
  }
  while (now() - startedAt < timeoutMs) {
    await sleep(pollMs);
    if (await cdpAnswers(opts.exec)) {
      const readyMs = Math.max(0, now() - startedAt);
      logBrowserEnsure(true, readyMs);
      return { started: true, readyMs };
    }
  }
  logBrowserEnsure(true, Math.max(0, now() - startedAt));
  throw new BrowserNotReady();
}

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path.length === 0 ? "/" : path;
}

function registrableHost(host: string): string {
  const lower = host.toLowerCase();
  return lower.startsWith("www.") ? lower.slice(4) : lower;
}

/** Origin and path match. A trailing slash and a www host redirect still match. */
export function navigationReached(requested: string, current: string): boolean {
  let want: URL;
  let got: URL;
  try {
    want = new URL(requested);
    got = new URL(current);
  } catch {
    return false;
  }
  if (normalizePath(want.pathname) !== normalizePath(got.pathname)) return false;
  if (want.protocol === "file:" || got.protocol === "file:") {
    return want.protocol === got.protocol;
  }
  if (want.protocol !== got.protocol) return false;
  return registrableHost(want.hostname) === registrableHost(got.hostname);
}

export function navigationFailureMessage(origin: string, href: string | undefined): string {
  const now = href && href.trim().length > 0 ? href.trim() : "unknown";
  return `page did not reach ${origin}; now at ${now}`;
}

export function parseNavHelperStdout(stdout: string): {
  ok: boolean;
  finalUrl?: string;
  href?: string;
  errorText?: string;
} | null {
  const start = stdout.indexOf("{");
  if (start < 0) return null;
  try {
    const value: unknown = JSON.parse(stdout.slice(start));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const parsed: { ok: boolean; finalUrl?: string; href?: string; errorText?: string } = {
      ok: row.ok === true,
    };
    if (typeof row.finalUrl === "string") parsed.finalUrl = row.finalUrl;
    if (typeof row.href === "string") parsed.href = row.href;
    if (typeof row.errorText === "string") parsed.errorText = row.errorText;
    return parsed;
  } catch {
    return null;
  }
}

function requestedOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** Drive the already-open page. Never starts a second Chrome. */
export async function navigateManagedPage(opts: {
  url: string;
  ensureBrowser: () => Promise<void>;
  exec: GuestExec;
  navArgv: string[];
}): Promise<{ finalUrl: string }> {
  await opts.ensureBrowser();
  const result = await opts.exec(opts.navArgv);
  const parsed = parseNavHelperStdout(result.stdout);
  const origin = requestedOrigin(opts.url);
  const href = parsed?.href && parsed.href.length > 0 ? parsed.href : parsed?.finalUrl;
  if (result.exitCode !== 0 || !parsed || !parsed.ok || !parsed.finalUrl) {
    throw new NavigationFailed(navigationFailureMessage(origin, href));
  }
  if (!navigationReached(opts.url, parsed.finalUrl)) {
    throw new NavigationFailed(navigationFailureMessage(origin, parsed.finalUrl));
  }
  return { finalUrl: parsed.finalUrl };
}

/** Focus the managed browser. No URL and no second process. */
export async function bringManagedBrowserToFront(opts: {
  ensureBrowser: () => Promise<void>;
  exec: GuestExec;
  frontArgv: string[];
}): Promise<void> {
  await opts.ensureBrowser();
  const result = await opts.exec(opts.frontArgv);
  if (result.exitCode !== 0) {
    throw new Error("browser focus failed");
  }
}

export async function runValidatedActions(
  actions: Action[],
  validate: (action: Action) => string | null,
  run: (action: Action) => Promise<{ finalUrl?: string } | void>,
): Promise<ActionResult> {
  const results: ActionResult["results"] = [];
  let ok = true;
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]!;
    const err = validate(action);
    if (err) {
      ok = false;
      results.push({ action, success: false, error: err });
      for (const rest of actions.slice(i + 1)) {
        results.push({ action: rest, success: false, error: "not executed" });
      }
      break;
    }
    try {
      const out = await run(action);
      const row: ActionResult["results"][number] = { action, success: true };
      if (out?.finalUrl) row.finalUrl = out.finalUrl;
      results.push(row);
    } catch (e) {
      ok = false;
      const row: ActionResult["results"][number] = {
        action,
        success: false,
        error: e instanceof Error ? e.message : "action failed",
      };
      if (e instanceof NavigationFailed) row.code = e.code;
      results.push(row);
      for (const rest of actions.slice(i + 1)) {
        results.push({ action: rest, success: false, error: "not executed" });
      }
      break;
    }
  }
  return { ok, results };
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const dl = Math.abs(estimate - left);
  const du = Math.abs(estimate - up);
  const dul = Math.abs(estimate - upLeft);
  if (dl <= du && dl <= dul) return left;
  if (du <= dul) return up;
  return upLeft;
}

function unfilterScanlines(data: Buffer, width: number, height: number, bpp: number): Buffer | null {
  const stride = width * bpp;
  const expected = height * (stride + 1);
  if (data.length < expected) return null;
  const out = Buffer.alloc(height * stride);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = data[src++];
    if (filter === undefined || filter > 4) return null;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const raw = data[src++];
      if (raw === undefined) return null;
      const left = x >= bpp ? out[row + x - bpp]! : 0;
      const up = y > 0 ? out[row - stride + x]! : 0;
      const upLeft = y > 0 && x >= bpp ? out[row - stride + x - bpp]! : 0;
      let value = raw;
      if (filter === 1) value = (raw + left) & 255;
      else if (filter === 2) value = (raw + up) & 255;
      else if (filter === 3) value = (raw + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) value = (raw + paeth(left, up, upLeft)) & 255;
      out[row + x] = value;
    }
  }
  return out;
}

/** True when sampled pixels are one colour. A decode miss is not treated as blank. */
export function screenIsBlank(png: Buffer): boolean {
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIG)) return false;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let bitDepth = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > png.length) return false;
    const data = png.subarray(dataStart, dataEnd);
    if (type === "IHDR" && data.length >= 13) {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? -1;
      interlace = data[12] ?? 0;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  if (width < 1 || height < 1 || bitDepth !== 8 || interlace !== 0) return false;
  const bpp = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : colorType === 4 ? 2 : 0;
  if (bpp < 1) return false;
  const channels = bpp >= 3 ? 3 : 1;
  let inflated: Buffer;
  try {
    inflated = inflateSync(Buffer.concat(idat));
  } catch {
    return false;
  }
  const pixels = unfilterScanlines(inflated, width, height, bpp);
  if (!pixels) return false;
  const count = width * height;
  const stride = Math.max(1, Math.floor(count / 200));
  const firstAt = 0;
  for (let i = 0; i < count; i += stride) {
    const at = i * bpp;
    for (let c = 0; c < channels; c++) {
      if (pixels[at + c] !== pixels[firstAt + c]) return false;
    }
  }
  const last = (count - 1) * bpp;
  for (let c = 0; c < channels; c++) {
    if (pixels[last + c] !== pixels[firstAt + c]) return false;
  }
  return true;
}
