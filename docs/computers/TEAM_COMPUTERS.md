# Shared Team Computers (deferred)

**Status:** Design note only. **Do not implement** unless real private-beta users ask for it **and** the owner explicitly says to build it.

Default product remains **one bot = one isolated Agent Computer**. Shared mode is optional and opt-in. It must not replace or weaken that default.

This is not L5, L6, L7, L8, or G0. It is not on the private-beta critical path.

## Question

Can FLOKS support more than one Grok Bot on a single Agent Computer, similar to how the Grok Bots app already works with teams?

**Today: no.** `ComputerService.requestComputer` enforces one computer per `bird_id` (`DuplicateComputer`). Pairing, capability tokens, browser profile, files, exec, and L4 checkpoint/recovery all assume that 1:1 binding.

**Later, if users ask: yes, as opt-in shared-trust — not as hard per-bot isolation on one VM.**

## Desired product

A user can create one shared Agent Computer for a whole team of bots.

- Team A has one Agent Computer shared by multiple bots.
- Team B has another Agent Computer.
- A customer could run ten teams, each with its own computer.

That reduces cost versus one computer per bot and matches a “team workspace” mental model.

Keep both modes:

| Mode | Binding | Default? |
|------|---------|----------|
| Isolated | one bot = one Agent Computer | **Yes. Do not weaken.** |
| Shared-trust | one team = one Agent Computer | Opt-in only, clearly labeled |

## A. Simple shared-trust (possible later MVP)

Multiple bots are allowed to use the same `computer_handle` / `providerRef` / workspace. They share:

- browser profile
- cookies
- files
- terminal / workspace
- checkpoint / recovery state

Treat this as **one trust boundary**: team = shared blast radius.

No new provider. No new MCP tools. Control-plane layer only:

- Keep **Agent Computer** as the machine.
- Add **Team Binding** as a control-plane record under the same owner / workspace / team.
- Many `bird_id` values can be members of one binding.
- Each bot gets its own capability token. All tokens point at the same computer.
- Metadata-only event log records actor `bird_id` on every action.
- Mutating actions acquire a **per-computer operation lock**:
  - `computer_act`
  - `computer_exec`
  - `computer_fs` write / delete / mkdir
  - checkpoint / wake / pause / recover / destroy
- Read-only observe / status may stay concurrent or lightly throttled.
- Operator console shows: owner / team, member bots, active actor, last actor, locked / unlocked, recent events by actor.

L4 already serializes pause / wake / checkpoint / recover / destroy per computer. Shared-trust would extend that lock to act / exec / fs mutations and would allow multiple `bird_id` members. FakeProvider stays unpaid contract test only; it is not product proof.

## B. Hard isolated (do not build now)

Multiple bots share one provider VM but have isolated browser profiles, files, env, and permissions. That needs:

- per-bot browser profiles
- per-bot filesystem sandboxes
- per-bot env / secret isolation
- scheduling / locks
- stronger event attribution
- likely UI changes
- likely future billing / cost allocation (L7 — not L3 caps)

Too large. Not an MVP. Do not start it.

## Recommendation

**Do not build now.** Run one real private-beta bot on the default isolated path first.

Then choose from evidence:

- If **cost / team workflow** is the blocker → build simple shared-trust Team Computers (A).
- If **clicking** is the blocker → build L5 `click_element`.
- If neither → keep operating beta.

Do not start Team Computers before the first real private-beta run unless the owner explicitly says to.

## Risks of version A

- Bots can fight over the browser / mouse / keyboard.
- Shared cookies mean shared account / session risk.
- Shared files mean one bot can overwrite another bot’s work.
- Shared exec means one bot can affect the whole team workspace.
- Recovery / checkpoint restores the **whole team workspace**, not one bot’s state.
- Audit / event log must identify which bot did what.
- A team-level lock is required for browser / exec / fs mutations.

Label the mode in the console: **shared trust, shared blast radius**.

## Constraints if it is ever built

- Keep exactly eight MCP tools.
- Do not create a new provider.
- Do not weaken default one-bot-one-machine isolation.
- Shared mode is opt-in and clearly labeled.
- Captured `providerRef` cleanup only.
- Loopback operator console only.
- Remote MCP stays authenticated HTTPS.
- No billing ledger, worker queue, OpenTelemetry, extra providers, object-storage tar+zstd, VNC / takeover, or Nexus / AEON / Graphiti as part of this.
