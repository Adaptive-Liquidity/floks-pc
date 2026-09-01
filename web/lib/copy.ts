/** Locked public copy. Tests grep this file. Do not reintroduce killed lines. */

export const HOME_QUESTION =
  "Where does this Bot sit when the shared machine is full?";

export const HOME_KICKER = "Operating layer for bot crews";

export const HOME_SUB =
  "Work stays in Grok. This site is pay, connect, status, revoke.";

export const JOIN_HEADLINE = "Pay for this seat.";

export const JOIN_SUB =
  "Named buy URL. Same three plans. After Stripe, a magic link goes to the billing email — not a cookie from checkout.";

export const SETUP_COLD =
  "Open the magic link from your billing email. Typing an email is not enough.";

export const SETUP_JUST_PAID =
  "Checkout received. Check the inbox for that Stripe billing email. session_id is not login.";

export const SETUP_EXPIRED =
  "This magic link expired. We can send another to the same billing email.";

export const SETUP_INVALID =
  "This magic link is not valid. Open the latest mail from FLOKS, or ask support if it never arrived.";

export const CALLBACK_FLASH = "Signing you in…";

export const OAUTH_TITLE =
  "Allow FLOKS to connect this Grok Bot as this paying customer.";

export const OAUTH_BODY =
  "This proves who paid. It does not pick the Bot. Pair is on /setup.";

export const HONESTY = {
  hours:
    "Hours billed: initializing, running, suspending, resuming. Asleep and shutdown do not. Unused hours are not cash-back.",
  disk:
    "Copy files while the computer is up. Disk is not kept after the subscription ends.",
  cancel:
    "Cancel in the Stripe Customer Portal from /setup. Zero hours auto-suspends. No overage invoice.",
} as const;

export const PLANS = [
  {
    id: "spark" as const,
    name: "Spark",
    price: "$19/mo",
    hours: "8 hours",
    line: "Spark — $19 / month — 8 included hours — 1 isolated computer (renews monthly until you cancel)",
  },
  {
    id: "desk" as const,
    name: "Desk",
    price: "$39/mo",
    hours: "25 hours",
    line: "Desk — $39 / month — 25 included hours — 1 isolated computer (renews monthly until you cancel)",
  },
  {
    id: "shift" as const,
    name: "Shift",
    price: "$69/mo",
    hours: "60 hours",
    line: "Shift — $69 / month — 60 included hours — 1 isolated computer (renews monthly until you cancel)",
  },
] as const;

export const SEAT_RULE = "One paid seat = one Bot = one computer. Same eight tools.";

export const WEBHOOK_LAG =
  "Payment received. The seat appears when Stripe confirms.";

export const ZERO_SEATS =
  "No seat yet. Pay for a plan. Allowing the plugin does not mint a computer.";

export const PAST_DUE = "Card failed. Update billing or the seat stays past due.";

export const DESK_COPY = {
  unused: "Unused. Approve a pending pair to bind this desk.",
  pairing: "Pairing. The Bot is claiming this desk.",
  provisioning: "Provisioning. The computer is coming up.",
  running: "Running. Hours are billing.",
  sleeping: "Sleeping. Asleep time does not bill.",
  hours_empty: "Hours empty. The computer sleeps until renewal. No Always or Crew upsell.",
  shut_down: "Shut down. The subscription ended. Disk is not kept.",
  failed: "This box failed. We refund that payment, that box.",
} as const;

export const APPROVE_LABEL = "Approve";
export const DENY_LABEL = "Deny";
export const DENY_NOTE = "Deny burns the request. The desk stays unused.";
export const USER_CODE_LABEL = "Pair code";
export const PASTE_FALLBACK = "Paste a pair code";
export const MANAGE_BILLING = "Manage billing";
export const LOGOUT = "Logout";
export const RESEND_LINK = "Send another link to the same billing email";

export const ERROR_ONE_LINE = "This page is not on FLOKS.";
export const SERVER_ERROR_ONE_LINE = "FLOKS could not finish that request.";

export const LEGAL_DISCLAIMER =
  "FLOKS product policy. These pages describe how FLOKS works on floks-pc.com. They are not a statute, SLA, or law-firm letter. Last updated 2026-08-30.";
