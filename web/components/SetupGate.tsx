import { Door } from "@/components/Door";
import {
  SETUP_COLD,
  SETUP_EXPIRED,
  SETUP_INVALID,
  SETUP_JUST_PAID,
  SETUP_PAID_CHIP,
  SETUP_SIGN_IN,
} from "@/lib/copy";
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
  sessionId?: string | null;
}) {
  const loginHref = sessionId ? `/login?session_id=${encodeURIComponent(sessionId)}` : "/login";
  return (
    <Door title={COPY[gate]}>
      {gate === "just_paid" ? <p className="chip">{SETUP_PAID_CHIP}</p> : null}
      <div className="actions" style={{ marginTop: 22 }}>
        <a className="key wide" href={loginHref}>
          {SETUP_SIGN_IN}
        </a>
      </div>
    </Door>
  );
}
