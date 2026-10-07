import { SETUP_ACTIONS } from "./config";
import { SETUP_COLD } from "./copy";

export type ActionResult =
  | { ok: true; replay: boolean; revealedPairCode?: string | null }
  | { ok: false; conflict: boolean; message: string };

async function postForm(
  path: string,
  body: Record<string, string>,
): Promise<ActionResult> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body),
    redirect: "follow",
  });
  if (res.status === 409) {
    return { ok: false, conflict: true, message: "That computer is already connected to a different Bot." };
  }
  if (res.ok || res.status === 204) {
    let revealedPairCode: string | null = null;
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const raw = (await res.json()) as { revealedPairCode?: unknown; code?: unknown };
      if (typeof raw.revealedPairCode === "string") revealedPairCode = raw.revealedPairCode;
      else if (typeof raw.code === "string") revealedPairCode = raw.code;
    }
    return { ok: true, replay: res.status === 200, revealedPairCode };
  }
  if (res.status === 401) {
    return {
      ok: false,
      conflict: false,
        message: SETUP_COLD,
    };
  }
  return { ok: false, conflict: false, message: "The request did not complete." };
}

export function resendMagicLink(): Promise<ActionResult> {
  return Promise.resolve({ ok: true, replay: false });
}

export function logoutSetup(): Promise<ActionResult> {
  return postForm(SETUP_ACTIONS.logout, {});
}

/** Stripe Customer Portal is a browser form POST so Location is not swallowed. */
export function openPortal(): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = SETUP_ACTIONS.portal;
  document.body.appendChild(form);
  form.submit();
}

export function callbackFinishPlan(params: URLSearchParams): {
  shouldPost: boolean;
  nextHref: string;
} {
  const code = params.get("code");
  if (code) {
    return { shouldPost: false, nextHref: `/callback?${params.toString()}` };
  }
  const sessionId = params.get("session_id");
  return {
    shouldPost: false,
    nextHref: sessionId ? `/setup?session_id=${encodeURIComponent(sessionId)}` : "/setup",
  };
}

export function finishCallback(_params: URLSearchParams): Promise<ActionResult> {
  return Promise.resolve({ ok: true, replay: false });
}
