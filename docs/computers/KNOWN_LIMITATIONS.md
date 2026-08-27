# Known limitations (L3 private beta)

This is fail-closed launch security, not production-ready multi-tenant security. Report bugs with `.github/ISSUE_TEMPLATE/bug_report.md` and the operator debug packet (`GET /operator/v1/debug-packet`). Do not paste wrapper tokens, pair codes, capability tokens, or provider IDs.

- `click_element` is not yet supported (fail-closed until L5).
- Proxies and residential egress are not included.
- Production scale is not proven.
- No guaranteed bot-detection bypass.
- Background jobs run via exec/files; browser computer use is the first lane.
- Takeover / VNC is not included.
- Handoffs are not implemented.
- In-memory ComputerService is local/dev only; private beta requires durable records.

## Cost

Runloop Devboxes are billed by the provider while they exist. FLOKS does not meter or invoice (that is L7). Idle machines auto-shut after the configured TTL. Stop computers you are not using.

## Caps (not L7)

Private beta: approved invite/waitlist, max **1** active Agent Computer per owner by default (`FLOK_BETA_MAX_ACTIVE`, 1–5), idle auto-shutdown (`FLOK_BETA_IDLE_TTL_MS`, default 30 minutes). Durable control-plane store is required when `FLOK_BETA_ENABLED=1`.

Do not add MCP tools. Destroy is operator control-plane, not an MCP tool.
