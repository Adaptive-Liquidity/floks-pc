"use client";

import { useState } from "react";
import { Door } from "@/components/Door";
import {
  RESEND_LINK,
  SETUP_COLD,
  SETUP_EXPIRED,
  SETUP_INVALID,
  SETUP_JUST_PAID,
} from "@/lib/copy";
import { resendMagicLink } from "@/lib/setup-client";
import type { GateState } from "@/lib/types";

const COPY: Record<GateState, string> = {
  cold: SETUP_COLD,
  just_paid: SETUP_JUST_PAID,
  expired: SETUP_EXPIRED,
  invalid: SETUP_INVALID,
};

export function SetupGate({
  gate,
  sessionId,
}: {
  gate: GateState;
  sessionId: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function resend() {
    setBusy(true);
    setNote(null);
    const result = await resendMagicLink();
    setBusy(false);
    setNote(
      result.ok
        ? "If that billing email has a seat, another link is on the way."
        : result.message,
    );
  }

  return (
    <Door kicker="Setup" title="The door opens from mail.">
      <p className="lede">{COPY[gate]}</p>
      {sessionId ? (
        <p className="note">
          Checkout session is recorded. It does not sign you in.
        </p>
      ) : null}
      {gate === "expired" ? (
        <div className="actions" style={{ marginTop: 22 }}>
          <button className="btn wide" type="button" disabled={busy} onClick={() => void resend()}>
            {RESEND_LINK}
          </button>
        </div>
      ) : null}
      {note ? <p className="note">{note}</p> : null}
    </Door>
  );
}
