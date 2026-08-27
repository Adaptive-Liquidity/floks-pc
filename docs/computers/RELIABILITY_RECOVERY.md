# L4 reliability / recovery

Provider workspace recovery. This is **not** control-plane persistence (ComputerRecord / pair / capability / beta roster already shipped in L1/L3).

A bot’s Agent Computer should survive real use. If the machine pauses, wakes, fails to boot, or needs replacement, the workspace should still be there.

## What L4 does

- Create a **checkpoint** of an Agent Computer workspace using provider-native snapshots.
- Track **latest checkpoint** metadata on the durable ComputerRecord (`pending` / `ready` / `failed` / `restoring` / `restored`).
- **Pause / wake** with a health probe. Failed wake → `recovery_failed`, never pretend ready.
- **Recover:** mark recovering → destroy the original VM with the **captured providerRef only** → restore the latest checkpoint → re-ensure the interactive stack → health probe → ready.
- **Retry-safe observe:** paused / waking / recovering / failed states return `OBSERVE_RETRYABLE`. No fake CDP.
- **Stale cleanup:** idle destroy still uses the captured providerRef. If destroy fails, the computer becomes `cleanup_needed` and the operator sees a metadata-only event.

## What a checkpoint is

A checkpoint is a **provider-native snapshot** where the provider supports it:

| Provider | Checkpoint | Restore |
|----------|------------|---------|
| Runloop v1 | `snapshotDisk` | `createFromSnapshot` |
| FakeProvider | in-memory filesystem clone | restore clone onto a new ref |
| DockerDev | volume name only | **unsupported** (`RESTORE_UNSUPPORTED`) |

Checkpoint metadata stores: id, `providerSnapshotRef`, createdAt, status. It does **not** store secrets, pair codes, capability tokens, screenshots, page contents, or provider API keys.

Future/archive format may use `tar + zstd` in object storage. L4 does not add that store.

## Pause / wake / recover

```
pause     → paused (workspace preserved where the provider supports it)
wake      → waking → health probe → ready
            health probe fail → recovery_failed
recover   → recovering → destroy old VM (captured providerRef)
            → restore latest checkpoint → health probe → ready
```

No ready checkpoint → **fail closed** (`CHECKPOINT_REQUIRED`). Do not silently create a blank replacement.

## Failed-boot recovery

1. Mark `recovering`
2. Destroy the original VM using the captured `providerRef` only
3. Provision a replacement from the latest checkpoint
4. Re-ensure the interactive stack (provider restore/wake already does this on Runloop)
5. Health probe
6. Mark `ready`

Failures:

- destroy fails → `cleanup_needed`
- restore fails → `restore_failed`
- health probe fails → `recovery_failed`

## Verify file survival (C8 gate)

Unpaid FakeProvider path:

1. Write `/home/flok/recovery-proof/hello.txt` (Fake jail) / `/home/user/flok/recovery-proof/hello.txt` (Runloop).
2. Checkpoint.
3. Recover (destroys original provider ref, restores latest checkpoint).
4. Read the file: exact content.

Paid Runloop live proof is **opt-in and owner-approved only**. Do not run it from required CI.

## Clean stale machines

- L3 idle sweep still destroys with confirm + captured providerRef.
- Destroy failure records `CLEANUP_FAILED` (metadata only) and sets `cleanup_needed`.
- Retry destroy from the loopback console using the **same captured providerRef**.
- Never list or destroy the whole Runloop account as a product path.

## Errors

| Code | Meaning |
|------|---------|
| `CHECKPOINT_REQUIRED` | Recover without a ready checkpoint. Fail closed. |
| `OBSERVE_RETRYABLE` | Observe while paused/waking/recovering/failed. Wake or recover first. |
| `RESTORE_UNSUPPORTED` | Provider cannot restore (DockerDev). |
| `RESTORE_FAILED` | Provider restore failed after the original VM was torn down. Retry recover. |
| `RECOVERY_FAILED` | Health probe failed after wake or restore. |
| `CLEANUP_FAILED` | Destroy failed. `cleanup_needed`. Retry with captured providerRef only. |

## Operator console (loopback only)

`127.0.0.1:8788/console` shows checkpoint status, latest checkpoint id/time, recovery note, cleanup-needed, paused/waking/recovering/failed. Checkpoint / wake / recover are `/operator/v1` control-plane POSTs. Not MCP. Not the Grok wrapper token. Forwarded clients stay 403.

## What is not claimed

- `click_element` (L5)
- takeover / VNC
- C9 handoffs
- Nexus / AEON / Graphiti
- billing / L7 metering
- extra providers
- public launch or production multi-tenant readiness
- FakeProvider as live Agent Computer proof
- that MCP or `Ctrl+C` destroys a Devbox
- broad account cleanup
