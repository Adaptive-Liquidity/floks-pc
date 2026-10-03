# Paid Runloop network policy

Paid computers go through `ComputerService` and `ComputerProvider`. Routes do not call the Runloop SDK.

`RunloopProvider.fromEnv()` refuses to start unless the environment below validates. Create and restore send `launch_parameters.network_policy_id`, then read it back from the devbox. If it is missing, the new devbox is shut down and the call fails.

Wake and resume do not send a policy. The installed SDK `resume` method accepts polling options only. Before resume, the provider reads `launch_parameters.network_policy_id` and the policy document. A legacy devbox with no policy, or a policy with `allow_all`, cross-devbox access, a generic gateway, a CIDR allow, or a disallowed hostname, is not resumed. A running legacy devbox is suspended. Nothing in this path attaches an unrestricted policy instead.

The computer record stores the profile, configured policy id, effective policy id, vendor `update_time_ms`, and a hash of the egress rules. `enforcement` is `eventually-consistent`. A successful API write is not an instant revoke.

## Profiles

`governed-github` denies every hostname that covers GitHub's API, website, git, assets, packages, or `*.ghe.com`, not only `api.github.com`. Its allowlist may contain only `FLOK_RUNLOOP_CONTROL_PLANE_HOSTS` and the hosts of an explicit package preset.

`public-browser` is a weaker computer. It may list GitHub hostnames. It still requires `allow_all=false`, cross-devbox off, and no generic credential gateway. It is not a governed GitHub boundary.

Package registry hostnames and `allow_runloop_mirrors` are off unless `FLOK_RUNLOOP_PACKAGE_PRESET` is set. Hostname allows are not method-level read-only controls and are not supply-chain validation.

## Environment

| Name | Required | Safe value |
|---|---|---|
| `FLOK_RUNLOOP_NETWORK_POLICY_ID` | yes | Policy id already created in Runloop |
| `FLOK_RUNLOOP_NETWORK_PROFILE` | yes | `governed-github` or `public-browser` |
| `FLOK_RUNLOOP_ALLOW_AGENT_GATEWAY` | yes | `false` |
| `FLOK_RUNLOOP_ALLOW_MCP_GATEWAY` | yes | `false` |
| `FLOK_RUNLOOP_ALLOW_RUNLOOP_MIRRORS` | yes | `false`, or `true` with a preset |
| `FLOK_RUNLOOP_PACKAGE_PRESET` | no | `npm`, `pypi`, `crates`, `apt` |
| `FLOK_RUNLOOP_CONTROL_PLANE_HOSTS` | no | Exact DNS names, comma-separated |
| `RUNLOOP_BASE_URL` | no | Unset, or `https://api.runloop.ai` |

The control-plane client is pinned to `https://api.runloop.ai` and refuses redirects. Create bodies omit `secrets`, `gateways`, `mcp`, mounts, tunnels, and entrypoints. Guest env, file writes, exec output, and the control-plane snapshot reject raw provider credentials.

## Live probe

`scripts/verify-runloop-network-policy.ts` does nothing unless the owner sets `FLOK_LIVE_NETWORK_POLICY_VERIFY=1`. Adding `FLOK_LIVE_NETWORK_POLICY_CREATE=1` creates one devbox, runs the deny/allow plan, and destroys it. Redirect, DNS, IP-literal, and cross-devbox behavior that this process cannot observe is printed as `UNRESOLVED`, not as a pass.

## Rollback

Unsetting the policy variables, without reverting this code, stops paid create/restore/wake. That does not detach a policy from a devbox that already has one.

Reverting this code restores launch parameters that omit `network_policy_id`. Devboxes created after that revert follow Runloop's default when no other policy is attached. Do not treat a revert as a revoke of an already attached policy. Vendor updates remain eventually consistent.

## Not verified here

No Runloop API credential was available while this change was written. The deployed blueprint's own network policy was not read. No paid devbox was created.
