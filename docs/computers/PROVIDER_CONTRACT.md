# Provider Contract

## Rule

```
route / MCP tool
      ↓
ComputerService
      ↓
ComputerProvider   ← only interface that talks to compute
      ↓
Fake | DockerDev | Daytona | Kata
```

No route or MCP tool may import or call a concrete provider.

## Interface

```ts
interface ComputerProvider {
  readonly name: ComputerProviderName; // "fake" | "docker-dev" | "daytona" (C3)

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
| Daytona      | Production v1         | Linux VM           | Yes          | Yes       | Official `@daytona/sdk`        |
| Kata         | Self-host (Phase 13)  | Kata + Firecracker | Yes          | Yes       | High density                   |

## Daytona notes (for Phase 3)

- Package: `@daytona/sdk`
- Prefer **Linux VM** class (not basic container) for memory-preserving pause/resume, hot snapshots, and forks.
- Computer Use: `computer_use.start()`, mouse/keyboard/screenshot, accessibility tree (AT-SPI).
- VNC / noVNC for human takeover.
- Control plane for lifecycle; Toolbox API inside the sandbox for fs/process/computer_use.
- Constraint: VM sandboxes are currently created from existing VM snapshots → base-image / snapshot pipeline is required before live tests.
- Auth: `DAYTONA_API_KEY`. Never place the key inside a Node or log it.

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
