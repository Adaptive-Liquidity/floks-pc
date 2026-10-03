/**
 * One visible Chrome on the guest display, and CDP navigation of that same page.
 * Unpaid tests drive these functions with a stub exec. They do not call Runloop.
 */

import { inflateSync } from "node:zlib";
import { z } from "zod";
import type { Action, ActionResult } from "../types.js";
import { UI_BROWSER_DIR } from "./runloop-bot-user.js";

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

/** Guest probe: flok-ui Chrome cmdlines. Marker is for tests. */
export const MANAGED_CHROME_CMDLINE_PROBE_PY = [
  "import os",
  "# flok-managed-chrome-cmdlines",
  "UI_UID=1500",
  "out=[]",
  "try: names=os.listdir('/proc')",
  "except OSError: names=[]",
  "for name in names:",
  "    if not name.isdigit(): continue",
  "    try:",
  "        if os.stat('/proc/'+name).st_uid!=UI_UID: continue",
  "        cmd=open('/proc/%s/cmdline'%name,'rb').read().replace(b'\\x00',b' ').decode('utf-8','replace')",
  "        if 'chrome' in cmd.lower() or '--user-data-dir=' in cmd: out.append(cmd)",
  "    except OSError: continue",
  "print('\\n'.join(out))",
].join("\n");

export function managedChromeCmdlineProbeArgv(): string[] {
  return ["python3", "-c", MANAGED_CHROME_CMDLINE_PROBE_PY];
}

export function parseManagedChromeCmdlines(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const MANAGED_PROFILE_DIR = `${UI_BROWSER_DIR}/profile`;

/** Kill flok-ui Chrome that is not using the managed profile. Waits for exit. */
export const STALE_MANAGED_CHROME_KILL_PY = [
  "import os,time",
  "# flok-stale-managed-chrome",
  `KEEP=${JSON.stringify(`--user-data-dir=${MANAGED_PROFILE_DIR}`)}`,
  "UI_UID=1500",
  "self=os.getpid()",
  "pids=[]",
  "try: names=os.listdir('/proc')",
  "except OSError: names=[]",
  "for name in names:",
  "    if not name.isdigit() or int(name)==self: continue",
  "    try:",
  "        if os.stat('/proc/'+name).st_uid!=UI_UID: continue",
  "        cmd=open('/proc/%s/cmdline'%name,'rb').read().replace(b'\\x00',b' ').decode('utf-8','replace')",
  "        if KEEP in cmd: continue",
  "        if 'chrome' in cmd.lower() or '--user-data-dir=' in cmd or '--remote-debugging-port=9222' in cmd:",
  "            pids.append(int(name))",
  "    except OSError: continue",
  "for pid in pids:",
  "    try: os.kill(pid, 15)",
  "    except OSError: pass",
  "deadline=time.time()+3",
  "while time.time()<deadline and pids:",
  "    live=[]",
  "    for pid in pids:",
  "        try:",
  "            os.kill(pid, 0); live.append(pid)",
  "        except OSError: pass",
  "    if not live: break",
  "    pids=live; time.sleep(0.1)",
  "else:",
  "    for pid in pids:",
  "        try: os.kill(pid, 9)",
  "        except OSError: pass",
  "    deadline=time.time()+1",
  "    while time.time()<deadline and pids:",
  "        live=[]",
  "        for pid in pids:",
  "            try:",
  "                os.kill(pid, 0); live.append(pid)",
  "            except OSError: pass",
  "        if not live: break",
  "        pids=live; time.sleep(0.05)",
].join("\n");

export function staleManagedChromeKillArgv(): string[] {
  return ["python3", "-c", STALE_MANAGED_CHROME_KILL_PY];
}

function logBrowserEnsure(started: boolean, readyMs: number): void {
  process.stderr.write(`flok-browser ensure started=${started} ready_ms=${readyMs}\n`);
}

async function cdpAnswers(exec: GuestExec): Promise<boolean> {
  const probe = await exec(cdpReadyProbeArgv());
  return probe.exitCode === 0 && probe.stdout.includes("cdp-ready");
}

async function managedChromeUsesNewProfile(exec: GuestExec): Promise<boolean> {
  const { chromeHasUserDataDir } = await import("./runloop-interactive.js");
  const probe = await exec(managedChromeCmdlineProbeArgv());
  if (probe.exitCode !== 0) return false;
  return parseManagedChromeCmdlines(probe.stdout).some(chromeHasUserDataDir);
}

/**
 * Delete a leftover fixture page, then reuse Chrome only if CDP is up and a
 * cmdline matches chromeHasUserDataDir (the flok-ui profile). A leftover
 * workspace-profile Chrome answering on 9222 is killed and relaunched.
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
    if (await managedChromeUsesNewProfile(opts.exec)) {
      const readyMs = Math.max(0, now() - startedAt);
      logBrowserEnsure(false, readyMs);
      return { started: false, readyMs };
    }
    await opts.exec(staleManagedChromeKillArgv());
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

/**
 * Same registrable host and effective port. http to https on the default
 * ports counts. Path, query, and hash are ignored. file: still requires the
 * same path.
 */
export function navigationReached(requested: string, current: string): boolean {
  function normalizePath(path: string): string {
    if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
    return path.length === 0 ? "/" : path;
  }
  function registrableHost(host: string): string {
    const lower = host.toLowerCase();
    return lower.startsWith("www.") ? lower.slice(4) : lower;
  }
  function effectivePort(url: URL): string {
    if (url.port) return url.port;
    if (url.protocol === "http:") return "80";
    if (url.protocol === "https:") return "443";
    return "";
  }
  let want: URL;
  let got: URL;
  try {
    want = new URL(requested);
    got = new URL(current);
  } catch {
    return false;
  }
  if (want.protocol === "file:" || got.protocol === "file:") {
    return (
      want.protocol === "file:" &&
      got.protocol === "file:" &&
      normalizePath(want.pathname) === normalizePath(got.pathname)
    );
  }
  if (registrableHost(want.hostname) !== registrableHost(got.hostname)) return false;
  const wantPort = effectivePort(want);
  const gotPort = effectivePort(got);
  const upgrade =
    want.protocol === "http:" &&
    got.protocol === "https:" &&
    wantPort === "80" &&
    gotPort === "443";
  if (want.protocol !== got.protocol && !upgrade) return false;
  if (!upgrade && wantPort !== gotPort) return false;
  return true;
}

/** Guest copy. Plain JavaScript, not Function.toString(), so a minifier cannot rename it. */
export const NAVIGATION_REACHED_JS = `function navigationReached(requested, current) {
  function normalizePath(path) {
    if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
    return path.length === 0 ? "/" : path;
  }
  function registrableHost(host) {
    const lower = host.toLowerCase();
    return lower.startsWith("www.") ? lower.slice(4) : lower;
  }
  function effectivePort(url) {
    if (url.port) return url.port;
    if (url.protocol === "http:") return "80";
    if (url.protocol === "https:") return "443";
    return "";
  }
  let want, got;
  try {
    want = new URL(requested);
    got = new URL(current);
  } catch {
    return false;
  }
  if (want.protocol === "file:" || got.protocol === "file:") {
    return want.protocol === "file:" && got.protocol === "file:" && normalizePath(want.pathname) === normalizePath(got.pathname);
  }
  if (registrableHost(want.hostname) !== registrableHost(got.hostname)) return false;
  const wantPort = effectivePort(want);
  const gotPort = effectivePort(got);
  const upgrade = want.protocol === "http:" && got.protocol === "https:" && wantPort === "80" && gotPort === "443";
  if (want.protocol !== got.protocol && !upgrade) return false;
  if (!upgrade && wantPort !== gotPort) return false;
  return true;
}
`;

export function navigationFailureMessage(origin: string, href: string | undefined): string {
  const now = href && href.trim().length > 0 ? href.trim() : "unknown";
  return `page did not reach ${origin}; now at ${now}`;
}

export const NavHelperOutputSchema = z
  .object({
    ok: z.boolean(),
    finalUrl: z.string().max(2048).optional(),
    href: z.string().max(2048).optional(),
    errorText: z.string().max(256).optional(),
  })
  .strict();

export function parseNavHelperStdout(stdout: string): z.infer<typeof NavHelperOutputSchema> | null {
  const start = stdout.indexOf("{");
  if (start < 0) return null;
  try {
    const value: unknown = JSON.parse(stdout.slice(start));
    const parsed = NavHelperOutputSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
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

/** True when every pixel is one colour. A decode miss is not treated as blank. */
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
  const firstAt = 0;
  for (let i = 0; i < count; i++) {
    const at = i * bpp;
    for (let c = 0; c < channels; c++) {
      if (pixels[at + c] !== pixels[firstAt + c]) return false;
    }
  }
  return true;
}
