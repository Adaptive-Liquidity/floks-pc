# Provider Contract

## Rule

```
route / MCP tool
      ↓
ComputerService
      ↓
ComputerProvider   ← only interface that talks to compute
      ↓
Fake | DockerDev | Runloop | Kata
```

No route or MCP tool may import or call a concrete provider.

## Interface

```ts
interface ComputerProvider {
  readonly name: ComputerProviderName; // "fake" | "docker-dev" | "runloop" (C3)

  capabilities(): ProviderCapabilities;

  provision(spec: ComputerSpec): Promise<ProviderComputer>;
  status(ref: string): Promise<ComputerStatus>;

  wake(ref: string): Promise<void>;
  pause(ref: string): Promise<void>;
  stop(ref: string): Promise<void>;
  destroy(ref: string): Promise<void>;

  exec(ref: string, request: ExecRequest): Promise<ExecResult>;
  filesystem(ref: string, request: FsRequest): Promise<FsResult>;

  observe(ref: string, request: ObserveRequest): Promise<Observation>;
  act(ref: string, request: ActionBatch): Promise<ActionResult>;

  takeover(ref: string): Promise<TakeoverGrant>;

  checkpoint(ref: string): Promise<ProviderCheckpoint>;
  restore(request: RestoreRequest): Promise<ProviderComputer>;
}
```

`ComputerService` records `provider: injected.name`. Do not add a provider factory in C3.


## Capabilities advertisement

```ts
interface ProviderCapabilities {
  linuxVm: boolean;
  windowsVm: boolean;
  computerUse: boolean;
  accessibility: boolean;
  vnc: boolean;
  pauseMemory: boolean;
  snapshots: boolean;
  forks: boolean;
  customImages: boolean;
  networkPolicy: boolean;
}
```

## Provider matrix (target)

| Provider     | Use case              | Isolation          | Memory pause | Snapshots | Notes                          |
|--------------|-----------------------|--------------------|--------------|-----------|--------------------------------|
| Fake         | Unit / contract tests | In-memory          | Simulated    | Simulated | Injectable failures            |
| DockerDev    | Local integration     | Container + volume | No           | Volume    | Forbidden when NODE_ENV=production |
| Runloop      | Provider v1 (Agent Computer backend) | Devbox (C3A/C3B/L0) | Disk only | Yes | Official `@runloop/api-client` 1.28.0. Do not replace for launch. |
| Kata         | Self-host (L8/L9)     | Kata + Firecracker | Yes          | Yes       | Later fabric; not launch        |

## Runloop notes (Phase 3)

- Package: `@runloop/api-client@1.28.0` via **RunloopSDK** (not the legacy client).
- C3A default blueprint: `runloop/universal-ubuntu-24.04-x86_64-dnd`, architecture `x86_64`.
- C3B interactive blueprint: source under `blueprints/runloop-interactive/`. Base `FROM runloop:runloop/universal-ubuntu-24.04-x86_64-dnd` so Docker/Node/Python/Git remain. Graphical stack (Xvfb `:99` 1440×900×24, Openbox, Chrome, xdotool, ImageMagick `import`, localhost x11vnc/noVNC) runs as non-root `flok-ui` (uid 1500). Browserbase and Kernel are not used.
- Workspace jail: `/home/user/flok`.
- `pause` is `suspend` — **disk** is preserved, in-memory process state is not (`pauseMemory: false`). Graphical daemons and Chromium must be restarted after provision, restore, and resume via `ensureInteractiveStack()`.
- `checkpoint` is `snapshotDisk`; restore creates a **new** Devbox from that snapshot (forks supported).
- argv exec: serialize `{argv,cwd,env}` JSON → base64 → Python `os.execvp`. `mode: "shell"` rejected.
- C3B `observe()` screenshots the private display (PNG, temp file deleted).
- L0 / C7 (PR #17): when `include_accessibility` is set, Runloop dumps guest Chrome CDP AX from loopback `127.0.0.1:9222` (helper `/home/user/flok/.flok/cdp-ax.mjs`). Live proof: `accessibility_summary.source === "cdp"` with real nodes. FakeProvider is not proof. **`capabilities().accessibility` stays `false`** until an explicit later lift. Empty dumps fail closed.
- C3B `act()` supports `click_coordinates`, `type`, `key`, `scroll`, `open_url`, `wait`, and allowlisted `launch_application` (browser). `click_element` is fail-closed until **L5** (real CDP/AX bounds; never guessed clicks).
- `takeover()` stays fail-closed. Local noVNC is bound to `127.0.0.1:6080` only. Do not advertise `vnc: true` until authenticated tunnels exist. Never use `auth_mode=open`. Takeover is **not** launch (L1–L3).
- Capabilities: `computerUse: true` after paid C3B live gate `32559415086`; `accessibility: false`, `vnc: false`, `pauseMemory: false`.
- CDP is loopback-only. Never bind `0.0.0.0`. No `--no-sandbox`.
- L1 Agent Computers require blueprint `flok-runloop-interactive` (or equivalent owner-validated interactive stack). Generic `runloop/universal-ubuntu-24.04-x86_64-dnd` is compute-only and must **fail before** the computer is accepted. Missing Xvfb / `flok-ui` is not success. Current `fromEnv()` fallback to DnD is an L1 implementation gap, not product behavior.
- MCP has no stop/destroy tool. Paid cleanup is `POST /v1/devboxes/{id}/shutdown` (see `docs/computers/agent-computer-cloud.md`). Process exit is not destroy.
- Auth: `RUNLOOP_API_KEY`. Never place the key inside a Devbox, exec env, log, or MCP response.
- Do **not** use `runloopai/deploy-agent`. C3 tests Devboxes, not Runloop Agents.
- Live lifetime: `keep_alive_time_seconds=900`. Do not combine with `lifecycle.after_idle`.
- Chromium sandbox is preserved (no `--no-sandbox`) unless a verified Runloop incompatibility is documented.

## MCP notes (Phase 5)

- Target protocol: **2026-07-28** (stateless Streamable HTTP) with a 2025-era `initialize` compatibility path.
- Explicit application-level handles (`computer_handle`, `node_handle`). Do **not** rely on transport sessions for Node identity.
- Eight tools only. xAI guidance favors filtering tools to protect model context.
- Implemented in-tree (`src/lib/mcp`) so pair codes and capability tokens can be redacted and so session IDs cannot become auth. See `docs/computers/MCP.md`.

## Path and execution safety (enforced by ComputerService)

- Prefer `argv[]` over uncontrolled shell strings.
- `mode: "shell"` requires the `shell` capability scope (not granted by default pairing).
- Max runtime, max output, max environment vars, max processes, cwd root.
- Path canonicalization + root jail on every FS operation.
- Long-running commands return an `operation_handle` that can be polled.

Bot-facing `status` / `exec` / `filesystem` / `observe` / `act` / lifecycle methods on `ComputerService` require a valid capability bound to that computer + bird + flock. Shared MCP auth is not an authorization input. The public MCP gateway is C5 and must not be added in C4.

## Failure injection (FakeProvider)

Must support:

- timeout
- provider unavailable
- snapshot failure
- disk full
- computer disappeared

So that chaos tests (Gate G0) can be driven without real infrastructure.
