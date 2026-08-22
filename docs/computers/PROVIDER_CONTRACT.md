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
| Runloop      | Production v1         | Devbox (C3A)       | Disk only    | Yes       | Official `@runloop/api-client` 1.28.0 |
| Kata         | Self-host (Phase 13)  | Kata + Firecracker | Yes          | Yes       | High density                   |

## Runloop notes (Phase 3 / C3A)

- Package: `@runloop/api-client@1.28.0` via **RunloopSDK** (not the legacy client).
- Default blueprint: `runloop/universal-ubuntu-24.04-x86_64-dnd`, architecture `x86_64`.
- Workspace jail: `/home/user/flok`.
- `pause` is `suspend` — **disk** is preserved, in-memory process state is not (`pauseMemory: false`).
- `checkpoint` is `snapshotDisk`; restore creates a **new** Devbox from that snapshot (forks supported).
- argv exec: serialize `{argv,cwd,env}` JSON → base64 → Python `os.execvp`. `mode: "shell"` rejected.
- Native Computer Use / VNC / accessibility are **C3B**, not claimed on C3A.
- Auth: `RUNLOOP_API_KEY`. Never place the key inside a Devbox, exec env, log, or MCP response.
- Do **not** use `runloopai/deploy-agent`. C3 tests Devboxes, not Runloop Agents.
- Live lifetime: `keep_alive_time_seconds=900`. Do not combine with `lifecycle.after_idle`.

## MCP notes (for Phase 5)

- Target protocol: **2026-07-28** (stateless).
- Explicit application-level handles (`computer_handle`, `node_handle`). Do **not** rely on transport sessions for Node identity.
- Streamable HTTP preferred.
- Prefer `@modelcontextprotocol/server` (v2 packages).
- Keep the tool surface small (eight tools). xAI guidance favors filtering tools to protect model context.
- Compatibility path for older clients that still use initialization-era MCP is still required.

## Path and execution safety (enforced by ComputerService)

- Prefer `argv[]` over uncontrolled shell strings.
- `mode: "shell"` requires a stronger capability.
- Max runtime, max output, max environment vars, max processes, cwd root.
- Path canonicalization + root jail on every FS operation.
- Long-running commands return an `operation_handle` that can be polled.

## Failure injection (FakeProvider)

Must support:

- timeout
- provider unavailable
- snapshot failure
- disk full
- computer disappeared

So that chaos tests (Gate G0) can be driven without real infrastructure.
