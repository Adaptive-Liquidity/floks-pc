import { Door } from "@/components/Door";
import {
  ACCOUNT_HOME_LINE,
  CREATE_ACCOUNT,
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

function withSession(path: string, sessionId?: string | null): string {
  return sessionId ? `${path}?session_id=${encodeURIComponent(sessionId)}` : path;
}

export function SetupGate({
  gate,
  sessionId,
}: {
  gate: GateState;
  sessionId?: string | null;
}) {
  const loginHref = withSession("/login", sessionId);
  const signupHref = withSession("/signup", sessionId);
  return (
    <Door title={COPY[gate]}>
      {gate === "cold" ? <p className="note">{ACCOUNT_HOME_LINE}</p> : null}
      {gate === "just_paid" ? <p className="chip">{SETUP_PAID_CHIP}</p> : null}
      <div className="actions" style={{ marginTop: 22 }}>
        {gate === "just_paid" ? (
          <>
            <a className="key wide" href={loginHref}>
              {SETUP_SIGN_IN}
            </a>
            <a className="ghost wide" href={signupHref}>
              {CREATE_ACCOUNT}
            </a>
          </>
        ) : (
          <>
            <a className="key wide" href={signupHref}>
              {CREATE_ACCOUNT}
            </a>
            <a className="ghost wide" href={loginHref}>
              {SETUP_SIGN_IN}
            </a>
          </>
        )}
      </div>
      {gate === "cold" ? (
        <p className="note">
          <a href="/join">Plans</a> — create an account first, then buy.
        </p>
      ) : null}
    </Door>
  );
}
