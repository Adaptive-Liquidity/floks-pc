"use client";

import { useEffect, useState } from "react";
import { useChrome } from "@/components/Chrome";
import { PayPills } from "@/components/PayPills";
import { CONNECTOR } from "@/lib/config";
import {
  APPROVE_LABEL,
  DENY_LABEL,
  DENY_NOTE,
  DESK_COPY,
  PAST_DUE,
  PASTE_FALLBACK,
  USER_CODE_LABEL,
  WEBHOOK_LAG,
  ZERO_SEATS,
} from "@/lib/copy";
import { approvePair, denyPair, type ActionResult } from "@/lib/setup-client";
import type { SeatSession } from "@/lib/types";

export function SetupDesk({
  session,
  preview,
}: {
  session: SeatSession;
  preview: boolean;
}) {
  const { setAuthed } = useChrome();
  const [code, setCode] = useState(session.desk?.userCode ?? "");
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setAuthed(true);
    return () => setAuthed(false);
  }, [setAuthed]);

  async function run(kind: "approve" | "deny", fn: () => Promise<ActionResult>) {
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
    setMessage("Request sent.");
  }

  const desk = session.desk;
  const showPay = session.seats === 0 && session.pluginAllowed && !session.webhookPending;
  const live = desk?.state === "running";
  const failed = desk?.state === "failed";
  const showPair = Boolean(desk && (desk.pendingRequest || desk.userCode));

  return (
    <div className="paper rack">
      {preview ? (
        <p className="preview-flag">Preview — not a live seat. session_id did not mint this.</p>
      ) : null}
      <section className="bay">
        <p className="kicker">Desk</p>
        <div className="row">
          <strong>{session.billingEmail}</strong>
          <span className="meta">
            {session.plan ? session.plan : "no plan"}
            {session.periodLabel ? ` · ${session.periodLabel}` : ""}
          </span>
        </div>
      </section>

      {session.flockStatus === "past_due" ? (
        <p className="banner danger">
          {PAST_DUE}
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
        <section className={`bay${live ? " live" : ""}${failed ? " fail" : ""}`}>
          {live ? <span className="lamp" aria-hidden="true" /> : null}
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
          {showPair ? (
            <div className="actions">
              <button
                className="key wide"
                type="button"
                disabled={busy !== null || !code}
                onClick={() => void run("approve", () => approvePair(code))}
              >
                {APPROVE_LABEL}
              </button>
              <button
                className="ghost danger wide"
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

      <section className="bay connector">
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
