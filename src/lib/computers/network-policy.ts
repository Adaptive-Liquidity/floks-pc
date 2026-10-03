/**
 * Paid Runloop egress policy.
 *
 * Vendor policy updates are eventually consistent. Accepting a policy id, hash,
 * or revision does not mean the dataplane has already revoked old access.
 *
 * Package registry hostnames are opt-in presets. They are not a safe default.
 * `public-browser` is a distinct, weaker profile: it may allow GitHub hostnames
 * and does not carry governed-GitHub guarantees.
 */

import { z } from "zod";
import { NetworkPolicyRejected } from "./errors.js";
import { sha256Hex } from "./digest.js";
import type { NetworkPolicyAttachment, NetworkPolicyProfile, PackagePreset } from "./types.js";

export const RUNLOOP_CONTROL_PLANE_ORIGIN = "https://api.runloop.ai";
export const NETWORK_POLICY_ENFORCEMENT = "eventually-consistent" as const;

export const PAID_NETWORK_POLICY_ENV = [
  "FLOK_RUNLOOP_NETWORK_POLICY_ID",
  "FLOK_RUNLOOP_NETWORK_PROFILE",
  "FLOK_RUNLOOP_ALLOW_AGENT_GATEWAY",
  "FLOK_RUNLOOP_ALLOW_MCP_GATEWAY",
  "FLOK_RUNLOOP_ALLOW_RUNLOOP_MIRRORS",
] as const;

/** Opt-in exact hosts. Not applied unless FLOK_RUNLOOP_PACKAGE_PRESET selects them. */
export const PACKAGE_PRESET_HOSTS: Readonly<Record<PackagePreset, readonly string[]>> = {
  npm: ["registry.npmjs.org"],
  pypi: ["pypi.org", "files.pythonhosted.org"],
  crates: ["crates.io", "static.crates.io", "index.crates.io"],
  apt: ["archive.ubuntu.com", "security.ubuntu.com"],
};

/**
 * Concrete GitHub API, browser, git, asset, package, and enterprise hosts.
 * A governed profile must not allow any pattern that covers one of these.
 * Blocking only api.github.com is not sufficient.
 */
export const GITHUB_BYPASS_HOSTS = [
  "github.com",
  "www.github.com",
  "api.github.com",
  "uploads.github.com",
  "codeload.github.com",
  "gist.github.com",
  "ssh.github.com",
  "smtp.github.com",
  "alive.github.com",
  "github.githubassets.com",
  "objects.githubusercontent.com",
  "raw.githubusercontent.com",
  "gist.githubusercontent.com",
  "media.githubusercontent.com",
  "private-user-images.githubusercontent.com",
  "avatars.githubusercontent.com",
  "copilot-proxy.githubusercontent.com",
  "github.dev",
  "github.io",
  "ghcr.io",
  "pkg.github.com",
  "npm.pkg.github.com",
  "github.ghe.com",
  "tenant.ghe.com",
] as const;

/** Parents of the concrete hosts above. Subdomains are bypasses too. */
const GITHUB_BYPASS_SUFFIXES = [
  "github.com",
  "githubusercontent.com",
  "githubassets.com",
  "github.dev",
  "github.io",
  "ghcr.io",
  "ghe.com",
] as const;

const METADATA_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
  "metadata.google.com",
  "instance-data",
  "instance-data.ec2.internal",
]);

/**
 * Alternate ways a guest can receive credentials or reach the network.
 * Each entry is blocked or explicitly opted in by this module. This is an
 * inventory, not a claim that every guest-written file is scanned.
 */
export const NETWORK_PATH_INVENTORY = [
  { id: "guest-env", control: "create and exec env reject control-plane secret keys and values" },
  { id: "exec-output", control: "stdout and stderr redact control-plane secret values before return" },
  { id: "guest-files", control: "filesystem writes that contain control-plane secret values are rejected" },
  { id: "devbox-secrets", control: "create body rejects secrets" },
  { id: "agent-gateway", control: "create body rejects gateways; allow_agent_gateway must be false" },
  { id: "mcp-hub", control: "create body rejects mcp; allow_mcp_gateway must be false" },
  { id: "file-mounts", control: "create body rejects file_mounts" },
  { id: "mounts", control: "create body rejects mounts and code_mounts" },
  { id: "tunnels", control: "create body rejects tunnel; tunnel tokens are not returned" },
  { id: "entrypoint", control: "create body rejects entrypoint scripts" },
  { id: "runloop-mirrors", control: "explicit toggle; off unless a package preset is selected" },
  { id: "devbox-to-devbox", control: "forced off; no toggle can enable it" },
  { id: "blueprint-inheritance", control: "not trusted; launch network_policy_id is required and read back" },
  { id: "resume-body", control: "installed SDK resume(options?) accepts no policy field; none is sent" },
  { id: "control-plane-url", control: "pinned to https://api.runloop.ai; redirects are refused" },
  { id: "package-registries", control: "opt-in preset hosts only; not an automatic allow" },
  { id: "public-browser", control: "weaker profile; GitHub hostnames may be allowed and are not governed" },
  {
    id: "guest-written-credentials",
    control: "platform does not inject them; snapshots can retain user-written files",
  },
] as const;

export const FORBIDDEN_DEVBOX_BODY_KEYS = [
  "secrets",
  "gateways",
  "mcp",
  "file_mounts",
  "code_mounts",
  "mounts",
  "tunnel",
  "entrypoint",
] as const;

const POLICY_ID = /^[A-Za-z0-9_-]{8,128}$/;

const VendorCidrSchema = z
  .object({
    cidr: z.string(),
  })
  .passthrough();

const VendorPolicySchema = z
  .object({
    id: z.string().min(1).max(128),
    update_time_ms: z.number().int().nonnegative(),
    egress: z
      .object({
        allow_all: z.boolean(),
        allow_devbox_to_devbox: z.boolean(),
        allow_agent_gateway: z.boolean(),
        allow_mcp_gateway: z.boolean(),
        allow_runloop_mirrors: z.boolean(),
        allowed_hostnames: z.array(z.string()),
        allowed_cidrs: z.array(VendorCidrSchema),
      })
      .strict(),
  })
  .passthrough();

export interface PaidNetworkPolicyConfig {
  policyId: string;
  profile: NetworkPolicyProfile;
  allowAgentGateway: false;
  allowMcpGateway: false;
  allowRunloopMirrors: boolean;
  packagePreset: PackagePreset | null;
  controlPlaneHosts: readonly string[];
}

export interface LiveProbe {
  id: string;
  /** Hostname the guest should try. Absent for local secret checks. */
  host: string | null;
  expect: "deny" | "allow" | "secret-absent" | "unresolved";
  reason: string;
}

function parseExplicitBoolean(env: NodeJS.ProcessEnv, key: string): boolean {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") {
    throw new NetworkPolicyRejected(
      "NETWORK_POLICY_REQUIRED",
      `${key} must be set explicitly to true or false`,
    );
  }
  const value = raw.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  throw new NetworkPolicyRejected(
    "NETWORK_POLICY_REQUIRED",
    `${key} must be true or false`,
  );
}

export function normalizeHostname(raw: string): string {
  return raw.trim().toLowerCase().replace(/\.$/, "");
}

export function assertSafeHostname(raw: string): string {
  const host = normalizeHostname(raw);
  if (!host || host.length > 253 || host.includes("..") || host.startsWith(".") || host.endsWith(".")) {
    throw new NetworkPolicyRejected("NETWORK_POLICY_UNSAFE", "control-plane hostname is not a DNS name");
  }
  if (host.includes("*") || host.includes("/") || host.includes(":") || host.includes("@") || host.includes(" ")) {
    throw new NetworkPolicyRejected("NETWORK_POLICY_UNSAFE", "control-plane hostname must be an exact DNS name");
  }
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes(".")) {
    throw new NetworkPolicyRejected("NETWORK_POLICY_UNSAFE", "control-plane hostname must be an exact DNS name");
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    throw new NetworkPolicyRejected("NETWORK_POLICY_UNSAFE", "control-plane hostname must not be an IP address");
  }
  if (
    METADATA_HOSTS.has(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new NetworkPolicyRejected("NETWORK_POLICY_UNSAFE", "control-plane hostname is a metadata or local name");
  }
  return host;
}

export function assertRunloopControlPlaneUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NetworkPolicyRejected("NETWORK_POLICY_UNSAFE", "control-plane URL is invalid");
  }
  if (url.username || url.password) {
    throw new NetworkPolicyRejected("NETWORK_POLICY_UNSAFE", "control-plane URL must not carry credentials");
  }
  if (url.protocol !== "https:" || url.hostname !== "api.runloop.ai" || (url.port !== "" && url.port !== "443")) {
    throw new NetworkPolicyRejected(
      "NETWORK_POLICY_UNSAFE",
      "control-plane URL must be https://api.runloop.ai",
    );
  }
  return url;
}

function requestUrl(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input && typeof input === "object" && "url" in input && typeof input.url === "string") {
    return input.url;
  }
  throw new NetworkPolicyRejected("NETWORK_POLICY_UNSAFE", "control-plane URL is invalid");
}

export type ControlPlaneFetch = (input: unknown, init?: RequestInit) => Promise<Response>;

/** Fetch wrapper for the Runloop control plane. Refuses other origins and redirects. */
export function createRunloopControlPlaneFetch(
  inner: (input: string, init?: RequestInit) => Promise<Response> = (input, init) => globalThis.fetch(input, init),
): ControlPlaneFetch {
  return async (input, init) => {
    const url = requestUrl(input);
    assertRunloopControlPlaneUrl(url);
    const response = await inner(url, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      throw new NetworkPolicyRejected(
        "NETWORK_POLICY_UNSAFE",
        "control-plane redirect refused",
      );
    }
    return response;
  };
}

function hostRelated(host: string, root: string): boolean {
  return host === root || host.endsWith(`.${root}`) || root.endsWith(`.${host}`);
}

export function isGithubBypassHost(host: string): boolean {
  const normalized = normalizeHostname(host);
  return GITHUB_BYPASS_SUFFIXES.some((suffix) => hostRelated(normalized, suffix));
}

export function allowPatternCoversHost(pattern: string, host: string): boolean {
  const normalizedPattern = normalizeHostname(pattern);
  const normalizedHost = normalizeHostname(host);
  if (normalizedPattern === "*" || normalizedPattern === "*.*") return true;
  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(2);
    return normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`);
  }
  return normalizedPattern === normalizedHost;
}

function presetHosts(preset: PackagePreset | null): readonly string[] {
  return preset ? PACKAGE_PRESET_HOSTS[preset] : [];
}

function coversRegistryHost(pattern: string): { preset: PackagePreset; host: string } | null {
  const normalized = normalizeHostname(pattern);
  for (const [preset, hosts] of Object.entries(PACKAGE_PRESET_HOSTS) as Array<
    [PackagePreset, readonly string[]]
  >) {
    for (const host of hosts) {
      if (hostRelated(normalized, host)) return { preset, host };
    }
  }
  return null;
}

function governedCeiling(config: PaidNetworkPolicyConfig): Set<string> {
  return new Set([...config.controlPlaneHosts, ...presetHosts(config.packagePreset)]);
}

function canonicalEgress(egress: z.infer<typeof VendorPolicySchema>["egress"]): string {
  const hostnames = [...new Set(egress.allowed_hostnames.map((host) => normalizeHostname(host)))].sort();
  const cidrs = egress.allowed_cidrs.map((rule) => rule.cidr.trim()).sort();
  return JSON.stringify({
    allow_agent_gateway: egress.allow_agent_gateway,
    allow_all: egress.allow_all,
    allow_devbox_to_devbox: egress.allow_devbox_to_devbox,
    allow_mcp_gateway: egress.allow_mcp_gateway,
    allow_runloop_mirrors: egress.allow_runloop_mirrors,
    allowed_cidrs: cidrs,
    allowed_hostnames: hostnames,
  });
}

export function parsePaidNetworkPolicyConfig(env: NodeJS.ProcessEnv = process.env): PaidNetworkPolicyConfig {
  const policyId = env.FLOK_RUNLOOP_NETWORK_POLICY_ID?.trim() ?? "";
  if (!POLICY_ID.test(policyId)) {
    throw new NetworkPolicyRejected(
      "NETWORK_POLICY_REQUIRED",
      "FLOK_RUNLOOP_NETWORK_POLICY_ID must be a configured Runloop network policy id",
    );
  }
  const profileRaw = env.FLOK_RUNLOOP_NETWORK_PROFILE?.trim() ?? "";
  if (profileRaw !== "governed-github" && profileRaw !== "public-browser") {
    throw new NetworkPolicyRejected(
      "NETWORK_POLICY_REQUIRED",
      "FLOK_RUNLOOP_NETWORK_PROFILE must be governed-github or public-browser",
    );
  }
  const allowAgentGateway = parseExplicitBoolean(env, "FLOK_RUNLOOP_ALLOW_AGENT_GATEWAY");
  const allowMcpGateway = parseExplicitBoolean(env, "FLOK_RUNLOOP_ALLOW_MCP_GATEWAY");
  const allowRunloopMirrors = parseExplicitBoolean(env, "FLOK_RUNLOOP_ALLOW_RUNLOOP_MIRRORS");
  if (allowAgentGateway || allowMcpGateway) {
    throw new NetworkPolicyRejected(
      "NETWORK_POLICY_UNSAFE",
      "agent and MCP gateways are generic credential proxies and are not accepted",
    );
  }
  const presetRaw = env.FLOK_RUNLOOP_PACKAGE_PRESET?.trim() ?? "";
  let packagePreset: PackagePreset | null = null;
  if (presetRaw !== "") {
    if (presetRaw !== "npm" && presetRaw !== "pypi" && presetRaw !== "crates" && presetRaw !== "apt") {
      throw new NetworkPolicyRejected(
        "NETWORK_POLICY_REQUIRED",
        "FLOK_RUNLOOP_PACKAGE_PRESET must be unset or npm, pypi, crates, or apt",
      );
    }
    packagePreset = presetRaw;
  }
  if (allowRunloopMirrors && !packagePreset) {
    throw new NetworkPolicyRejected(
      "NETWORK_POLICY_UNSAFE",
      "Runloop package mirrors require an explicit package preset and are not a default",
    );
  }
  const controlPlaneHosts = (env.FLOK_RUNLOOP_CONTROL_PLANE_HOSTS ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => assertSafeHostname(part));
  if (profileRaw === "governed-github") {
    for (const host of controlPlaneHosts) {
      if (isGithubBypassHost(host)) {
        throw new NetworkPolicyRejected(
          "NETWORK_POLICY_UNSAFE",
          "governed-github control-plane hosts must not cover GitHub bypass hostnames",
        );
      }
    }
  }
  return {
    policyId,
    profile: profileRaw,
    allowAgentGateway: false,
    allowMcpGateway: false,
    allowRunloopMirrors,
    packagePreset,
    controlPlaneHosts,
  };
}

export function isPaidNetworkPolicyConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    parsePaidNetworkPolicyConfig(env);
    return true;
  } catch (err) {
    if (err instanceof NetworkPolicyRejected) return false;
    throw err;
  }
}

export interface PolicyEvaluation {
  ok: true;
  attachment: NetworkPolicyAttachment;
}

export interface PolicyRejection {
  ok: false;
  code: "NETWORK_POLICY_UNSAFE" | "NETWORK_POLICY_DRIFT" | "NETWORK_POLICY_REQUIRED";
  message: string;
}

function rejectHostname(config: PaidNetworkPolicyConfig, pattern: string): string | null {
  if (pattern.includes("*") || pattern === "*" || pattern.startsWith("*.")) {
    return "hostname wildcards are not accepted";
  }
  let host: string;
  try {
    host = assertSafeHostname(pattern);
  } catch {
    return "hostname is not an exact public DNS name";
  }
  const registryHit = coversRegistryHost(host);
  if (
    registryHit &&
    (config.packagePreset !== registryHit.preset || !presetHosts(config.packagePreset).includes(host))
  ) {
    return "package registry hosts require an explicit preset and are not a default";
  }
  if (config.profile === "governed-github") {
    if (isGithubBypassHost(host)) {
      return "governed-github blocks GitHub API, browser, and git hostnames";
    }
    if (!governedCeiling(config).has(host)) {
      return "governed-github only allows the selected preset and explicit control-plane hosts";
    }
  }
  return null;
}

/**
 * Compare a retrieved vendor policy to the operator config.
 * Does not claim the dataplane has applied the revision yet.
 */
export function evaluateVendorNetworkPolicy(
  config: PaidNetworkPolicyConfig,
  vendor: unknown,
  observedAt: string = new Date().toISOString(),
  requireConfiguredId = false,
): PolicyEvaluation | PolicyRejection {
  const parsed = VendorPolicySchema.safeParse(vendor);
  if (!parsed.success) {
    return {
      ok: false,
      code: "NETWORK_POLICY_REQUIRED",
      message: "retrieved network policy did not match the expected vendor shape",
    };
  }
  const view = parsed.data;
  if (view.id.trim() === "") {
    return { ok: false, code: "NETWORK_POLICY_DRIFT", message: "retrieved network policy id was empty" };
  }
  if (requireConfiguredId && view.id !== config.policyId) {
    return {
      ok: false,
      code: "NETWORK_POLICY_DRIFT",
      message: "retrieved network policy is not the configured policy",
    };
  }
  const egress = view.egress;
  if (egress.allow_all) {
    return { ok: false, code: "NETWORK_POLICY_UNSAFE", message: "allow_all must be false" };
  }
  if (egress.allow_devbox_to_devbox) {
    return { ok: false, code: "NETWORK_POLICY_UNSAFE", message: "cross-devbox connectivity must be off" };
  }
  if (egress.allow_agent_gateway !== config.allowAgentGateway || egress.allow_mcp_gateway !== config.allowMcpGateway) {
    return {
      ok: false,
      code: "NETWORK_POLICY_UNSAFE",
      message: "agent and MCP gateways must stay off",
    };
  }
  if (egress.allow_runloop_mirrors !== config.allowRunloopMirrors) {
    return {
      ok: false,
      code: "NETWORK_POLICY_UNSAFE",
      message: "Runloop mirror toggle does not match the explicit operator setting",
    };
  }
  if (egress.allowed_cidrs.length > 0) {
    return {
      ok: false,
      code: "NETWORK_POLICY_UNSAFE",
      message: "CIDR allowlists are rejected because they can bypass hostname blocks",
    };
  }
  for (const pattern of egress.allowed_hostnames) {
    const reason = rejectHostname(config, pattern);
    if (reason) {
      return { ok: false, code: "NETWORK_POLICY_UNSAFE", message: reason };
    }
  }
  const attachment: NetworkPolicyAttachment = {
    profile: config.profile,
    policyId: config.policyId,
    revisionMs: view.update_time_ms,
    contentHash: sha256Hex(canonicalEgress(egress)),
    effectivePolicyId: view.id,
    allowAll: false,
    allowDevboxToDevbox: false,
    allowAgentGateway: false,
    allowMcpGateway: false,
    allowRunloopMirrors: egress.allow_runloop_mirrors,
    packagePreset: config.packagePreset,
    enforcement: NETWORK_POLICY_ENFORCEMENT,
    observedAt,
  };
  return { ok: true, attachment };
}

export function isSafeNetworkAttachment(value: unknown): value is NetworkPolicyAttachment {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<NetworkPolicyAttachment>;
  return (
    (row.profile === "governed-github" || row.profile === "public-browser") &&
    typeof row.policyId === "string" &&
    row.policyId.length > 0 &&
    typeof row.revisionMs === "number" &&
    typeof row.contentHash === "string" &&
    /^[a-f0-9]{64}$/.test(row.contentHash) &&
    typeof row.effectivePolicyId === "string" &&
    row.effectivePolicyId.length > 0 &&
    row.policyId === row.effectivePolicyId &&
    row.allowAll === false &&
    row.allowDevboxToDevbox === false &&
    row.allowAgentGateway === false &&
    row.allowMcpGateway === false &&
    typeof row.allowRunloopMirrors === "boolean" &&
    row.enforcement === "eventually-consistent" &&
    typeof row.observedAt === "string"
  );
}

/** Owner-run probe plan. `unresolved` items are gaps, not passes. */
export function liveProbePlan(
  config: PaidNetworkPolicyConfig,
  allowedHostnames: readonly string[] = [],
): LiveProbe[] {
  const governed = config.profile === "governed-github";
  const allowed = new Set(allowedHostnames.map((host) => normalizeHostname(host)));
  const probes: LiveProbe[] = [
    {
      id: "guest-secret-env",
      host: null,
      expect: "secret-absent",
      reason: "provider credentials must be absent from the guest environment",
    },
  ];
  for (const host of GITHUB_BYPASS_HOSTS) {
    const listed = allowed.has(host);
    probes.push({
      id: `github:${host}`,
      host,
      expect: governed ? "deny" : listed ? "allow" : "deny",
      reason: governed
        ? "governed-github blocks this GitHub API, browser, or git hostname"
        : listed
          ? "public-browser listed this hostname; that profile is weaker than governed-github"
          : "public-browser did not list this hostname, so egress should still fail",
    });
  }
  for (const [preset, hosts] of Object.entries(PACKAGE_PRESET_HOSTS) as Array<
    [PackagePreset, readonly string[]]
  >) {
    for (const host of hosts) {
      const selected = config.packagePreset === preset && allowed.has(host);
      probes.push({
        id: `preset:${host}`,
        host,
        expect: selected ? "allow" : "deny",
        reason: selected
          ? "this preset was explicitly selected and the policy lists the host"
          : "package registries are not an automatic allow",
      });
    }
  }
  probes.push(
    {
      id: "metadata-ip",
      host: "169.254.169.254",
      expect: "deny",
      reason: "link-local metadata addresses are not an allow",
    },
    {
      id: "redirect-follow",
      host: null,
      expect: "unresolved",
      reason: "vendor redirect, DNS, and IP-literal bypass behavior is not observable from configuration",
    },
    {
      id: "cross-devbox",
      host: null,
      expect: "unresolved",
      reason: "cross-devbox is configured off; a second paid devbox is not created by the default probe",
    },
    {
      id: "dataplane-propagation",
      host: null,
      expect: "unresolved",
      reason: "vendor policy changes are eventually consistent and are not an instant revoke",
    },
  );
  return probes;
}

export function assertPinnedRunloopBaseUrl(env: NodeJS.ProcessEnv = process.env): void {
  const raw = env.RUNLOOP_BASE_URL?.trim() ?? "";
  if (raw === "" || raw === RUNLOOP_CONTROL_PLANE_ORIGIN || raw === `${RUNLOOP_CONTROL_PLANE_ORIGIN}/`) {
    return;
  }
  throw new NetworkPolicyRejected(
    "NETWORK_POLICY_UNSAFE",
    "RUNLOOP_BASE_URL must be unset or https://api.runloop.ai",
  );
}
