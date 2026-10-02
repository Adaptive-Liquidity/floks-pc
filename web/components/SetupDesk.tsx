"use client";

import { useEffect, useState } from "react";
import { useChrome } from "@/components/Chrome";
import { PayPills } from "@/components/PayPills";
import { ComputerManageSection } from "@/components/computer/ComputerManageSection";
import { dashboardStatusFromDesk } from "@/lib/computers/owner";
import { publicConnector, SETUP_ACTIONS } from "@/lib/config";
import { ACCOUNT_EMPTY, ACCOUNT_HOME_LINE, PAST_DUE, WEBHOOK_LAG, ZERO_SEATS } from "@/lib/copy";
import type { SeatSession } from "@/lib/types";

export function SetupDesk({
  session,
  preview,
  connector = publicConnector(),
}: {
  session: SeatSession;
  preview: boolean;
  connector?: ReturnType<typeof publicConnector>;
}) {
  const { setAuthed } = useChrome();
  const desks = session.desks.length ? session.desks : session.desk ? [session.desk] : [];
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setAuthed(true);
  }, [setAuthed]);

  const showPay = session.seats === 0 && !session.webhookPending;
  const emptyAccount = session.seats === 0;

  return (
    <div className="paper rack">
      {preview ? (
        <p className="preview-flag">Preview. This is not a live computer.</p>
      ) : null}
      <section className="bay">
        <p className="kicker">Account</p>
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
      {desks.map((desk, index) => (
          <section key={desk.id} className="bay">
            <h2>{`Computer ${index + 1}`}</h2>
            <p>{session.plan ?? "no plan"}</p>
            <p>{desk.state.replaceAll("_", " ")}</p>
            <p>
              {desk.botName
                ? desk.lastUsedLabel
                  ? `Bot: ${desk.botName} · last used ${desk.lastUsedLabel}`
                  : `Bot: ${desk.botName}`
                : "Bot: none"}
            </p>
            {desk.computerId ? (
              <ComputerManageSection
                computerId={desk.computerId}
                preview={preview}
                initialStatus={dashboardStatusFromDesk(desk.state)}
              />
            ) : null}
            {desk.computerId ? (
              <button
                className="ghost wide"
                type="button"
                onClick={() => {
                  const computerId = desk.computerId ?? "";
                  void fetch(SETUP_ACTIONS.disconnect, {
                    method: "POST",
                    credentials: "include",
                    headers: {
                      "content-type": "application/x-www-form-urlencoded",
                      Accept: "application/json",
                    },
                    body: new URLSearchParams({ computer_id: computerId }),
                  }).then((res) => {
                    if (res.ok) window.location.assign("/setup");
                    else setMessage("Disconnect did not complete.");
                  });
                }}
              >
                Disconnect
              </button>
            ) : null}
          </section>
        ))}

      <section className="bay connector">
        <p className="kicker">Grok plugin connector</p>
        <dl>
          <dt>MCP URL</dt>
          <dd>{connector.mcpUrl}</dd>
        </dl>
      </section>
      </>
      )}
      {message ? <p className="note">{message}</p> : null}
    </div>
  );
}
