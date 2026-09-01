import { actionHref, SETUP_ACTIONS } from "./config";

export type ActionResult =
  | { ok: true; replay: boolean }
  | { ok: false; conflict: boolean; message: string };

async function postForm(
  path: string,
  body: Record<string, string>,
): Promise<ActionResult> {
  const res = await fetch(actionHref(path), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    redirect: "follow",
  });
  if (res.status === 409) {
    return { ok: false, conflict: true, message: "That desk is already bound to a different request." };
  }
  if (res.ok || res.status === 204) {
    return { ok: true, replay: res.status === 200 };
  }
  if (res.status === 401) {
    return {
      ok: false,
      conflict: false,
      message: "Open the magic link from your billing email. Typing an email is not enough.",
    };
  }
  return { ok: false, conflict: false, message: "The request did not complete." };
}

export function approvePair(userCode: string): Promise<ActionResult> {
  return postForm(SETUP_ACTIONS.approve, { user_code: userCode });
}

export function denyPair(userCode: string): Promise<ActionResult> {
  return postForm(SETUP_ACTIONS.deny, { user_code: userCode });
}

export function resendMagicLink(): Promise<ActionResult> {
  return postForm(SETUP_ACTIONS.resend, {});
}

export function logoutSetup(): Promise<ActionResult> {
  return postForm(SETUP_ACTIONS.logout, {});
}

export function openPortal(): Promise<ActionResult> {
  return postForm(SETUP_ACTIONS.portal, {});
}

export function finishCallback(params: URLSearchParams): Promise<ActionResult> {
  const body: Record<string, string> = {};
  params.forEach((value, key) => {
    if (key === "session_id") return;
    body[key] = value;
  });
  return postForm(SETUP_ACTIONS.callback, body);
}
