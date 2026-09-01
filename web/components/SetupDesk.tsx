"use client";

import { useState } from "react";
import { PayPills } from "@/components/PayPills";
import { CONNECTOR } from "@/lib/config";
import {
  APPROVE_LABEL,
  DENY_LABEL,
  DENY_NOTE,
  DESK_COPY,
  LOGOUT,
  MANAGE_BILLING,
  PAST_DUE,
  PASTE_FALLBACK,
  USER_CODE_LABEL,
  WEBHOOK_LAG,
  ZERO_SEATS,
} from "@/lib/copy";
import {
  approvePair,
  denyPair,
  logoutSetup,
  openPortal,
  type ActionResult,
} from "@/lib/setup-client";
import type { SeatSession } from "@/lib/types";

export function SetupDesk({
  session,
  preview,
}: {
  session: SeatSession;
  preview: boolean;
}) {
  const [code, setCode] = useState(session.desk?.userCode ?? "");
  const [busy, setBusy] = useState<"approve" | "deny" | "portal" | "logout" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(
    kind: "approve" | "deny" | "portal" | "logout",
    fn: () => Promise<ActionResult>,
  ) {
    if (busy) return;
    setBusy(kind);
    setMessage(null);
    const result = await fn();
    setBusy(null);
    if (!result.ok) {
      setMessage(
        result.conflict
          ? "That desk is already bound to a different request."
          : result.message,
      );
      return;
    }
    if (kind === "logout") {
      window.location.assign("/setup");
      return;
    }
    if (kind === "portal") {
      setMessage("If the portal is ready, Stripe should open from this host.");
      return;
    }
    setMessage("Request sent.");
  }

  const desk = session.desk;
  const showPay = session.seats === 0 && session.pluginAllowed && !session.webhookPending;

  return (
    <div className="paper column" style={{ width: "min(100%, 40rem)", margin: "0 auto" }}>
      {preview ? (
        <p className="preview-flag">Preview — not a live seat. session_id did not mint this.</p>
      ) : null}
      <header className="module">
        <div className="row">
          <strong>{session.billingEmail}</strong>
          <span className="meta">
            {session.plan ? session.plan : "no plan"}
            {session.periodLabel ? ` · ${session.periodLabel}` : ""}
          </span>
        </div>
        <div className="actions">
          <button
            className="btn wide"
            type="button"
            disabled={busy !== null}
            onClick={() => void run("portal", () => openPortal())}
          >
            {MANAGE_BILLING}
          </button>
          <button
            className="ghost wide"
            type="button"
            disabled={busy !== null}
            onClick={() => void run("logout", () => logoutSetup())}
          >
            {LOGOUT}
          </button>
        </div>
      </header>

      {session.flockStatus === "past_due" ? (
        <p className="banner warn">
          {PAST_DUE} Use {MANAGE_BILLING}.
        </p>
      ) : null}
      {session.webhookPending ? <p className="banner">{WEBHOOK_LAG}</p> : null}
      {showPay ? (
        <>
          <p className="banner">{ZERO_SEATS}</p>
          <PayPills />
        </>
      ) : null}

      {desk ? (
        <section className="module">
          <p className="kicker">{desk.state.replace("_", " ")}</p>
          <p>{DESK_COPY[desk.state]}</p>
          {session.hoursUsed !== null && session.hoursIncluded !== null ? (
            <p className="meta">
              Hours {session.hoursUsed} / {session.hoursIncluded}
            </p>
          ) : null}
          {desk.userCode ? (
            <div>
              <p className="kicker">{USER_CODE_LABEL}</p>
              <p className="user-code">{desk.userCode}</p>
            </div>
          ) : null}
          {desk.pendingRequest || desk.userCode ? (
            <div className="actions">
              <button
                className="btn wide"
                type="button"
                disabled={busy !== null || !code}
                onClick={() => void run("approve", () => approvePair(code))}
              >
                {APPROVE_LABEL}
              </button>
              <button
                className="ghost wide"
                type="button"
                disabled={busy !== null || !code}
                onClick={() => void run("deny", () => denyPair(code))}
              >
                {DENY_LABEL}
              </button>
              <p className="note">{DENY_NOTE}</p>
            </div>
          ) : null}
          <details className="fallback">
            <summary>{PASTE_FALLBACK}</summary>
            <input
              className="code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-label={USER_CODE_LABEL}
            />
          </details>
        </section>
      ) : null}

      <section className="module connector">
        <p className="kicker">Grok plugin connector</p>
        <dl>
          <dt>MCP URL</dt>
          <dd>{CONNECTOR.mcpUrl}</dd>
          <dt>client_id</dt>
          <dd>{CONNECTOR.clientId}</dd>
          <dt>client secret</dt>
          <dd>(empty)</dd>
          <dt>authorize</dt>
          <dd>{CONNECTOR.authorizeUrl}</dd>
          <dt>token</dt>
          <dd>{CONNECTOR.tokenUrl}</dd>
          <dt>scope</dt>
          <dd>{CONNECTOR.scope}</dd>
        </dl>
      </section>
      {message ? <p className="note">{message}</p> : null}
    </div>
  );
}
