"use client";

import { useEffect, useState } from "react";
import { useChrome } from "@/components/Chrome";
import { PayPills } from "@/components/PayPills";
import { CONNECTOR } from "@/lib/config";
import {
  ACCOUNT_EMPTY,
  ACCOUNT_HOME_LINE,
  APPROVE_LABEL,
  CREATE_PAIR,
  DENY_LABEL,
  DENY_NOTE,
  DESK_COPY,
  PAIR_REVEAL_ONCE,
  PAST_DUE,
  PASTE_FALLBACK,
  REVOKE_PAIR,
  USER_CODE_LABEL,
  WEBHOOK_LAG,
  ZERO_SEATS,
} from "@/lib/copy";
import {
  approvePair,
  createPairKey,
  denyPair,
  revokePairKey,
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
  const { setAuthed } = useChrome();
  const desks = session.desks.length ? session.desks : session.desk ? [session.desk] : [];
  const first = desks[0];
  const [code, setCode] = useState(session.revealedPairCode ?? first?.userCode ?? "");
  const [busy, setBusy] = useState<"approve" | "deny" | "pair" | "revoke" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(session.revealedPairCode);

  useEffect(() => {
    setAuthed(true);
  }, [setAuthed]);

  async function run(kind: "approve" | "deny" | "pair" | "revoke", fn: () => Promise<ActionResult>) {
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
    if (result.revealedPairCode) {
      setRevealed(result.revealedPairCode);
      setCode(result.revealedPairCode);
      setMessage(PAIR_REVEAL_ONCE);
      return;
    }
    setMessage("Request sent.");
  }

  const showPay = session.seats === 0 && !session.webhookPending;
  const emptyAccount = session.seats === 0;

  return (
    <div className="paper rack">
      {preview ? (
        <p className="preview-flag">Preview — not a live seat. session_id did not mint this.</p>
      ) : null}
      <section className="bay">
        <p className="kicker">{emptyAccount ? "Account" : "Desk"}</p>
        <div className="row">
          <strong>{session.billingEmail}</strong>
          <span className="meta">
            {session.plan ? session.plan : "no plan"}
            {session.periodLabel ? ` · ${session.periodLabel}` : ""}
          </span>
        </div>
        {emptyAccount ? <p>{ACCOUNT_HOME_LINE}</p> : null}
      </section>

      {session.flockStatus === "past_due" ? <p className="banner danger">{PAST_DUE}</p> : null}
      {session.webhookPending ? <p className="banner">{WEBHOOK_LAG}</p> : null}
      {showPay ? (
        <>
          <p className="banner">{ZERO_SEATS}</p>
          <p className="note">{ACCOUNT_EMPTY}</p>
          <PayPills email={session.billingEmail} />
        </>
      ) : null}

      {emptyAccount ? null : (

      <>
      {desks.map((desk) => {
        const live = desk.state === "running";
        const failed = desk.state === "failed";
        const showPair = Boolean(desk.pendingRequest || desk.userCode || revealed);
        return (
          <section key={desk.id} className={`bay${live ? " live" : ""}${failed ? " fail" : ""}`}>
            {live ? <span className="lamp" aria-hidden="true" /> : null}
            <p className="kicker">{desk.state.replace("_", " ")}</p>
            <p>{DESK_COPY[desk.state]}</p>
            {desk.hoursUsed !== null && desk.hoursIncluded !== null ? (
              <p className="meta">
                Hours {desk.hoursUsed} / {desk.hoursIncluded}
              </p>
            ) : null}
            {revealed ? (
              <div>
                <p className="kicker">{USER_CODE_LABEL}</p>
                <p className="user-code">{revealed}</p>
                <p className="note">{PAIR_REVEAL_ONCE}</p>
              </div>
            ) : null}
            <div className="actions">
              <button
                className="key wide"
                type="button"
                disabled={busy !== null}
                onClick={() => void run("pair", () => createPairKey(desk.id))}
              >
                {CREATE_PAIR}
              </button>
              <button
                className="ghost wide"
                type="button"
                disabled={busy !== null}
                onClick={() => void run("revoke", () => revokePairKey(desk.id))}
              >
                {REVOKE_PAIR}
              </button>
            </div>
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
        );
      })}

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
      </>
      )}
      {message ? <p className="note">{message}</p> : null}
    </div>
  );
}
