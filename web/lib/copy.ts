/** Locked public copy. Tests grep this file. Do not reintroduce killed lines. */

export const HOME_QUESTION =
  "Where does this Bot sit when the shared machine is full?";

export const HOME_NEXT = "Pick a desk.";

export const HOME_TOOLS =
  "Same eight tools on every desk. Renews monthly until you cancel.";

export const JOIN_LINE = "Give this URL to the Bot you paid for.";

export const SETUP_COLD =
  "Open the magic link from your billing email. Typing an email is not enough.";

export const SETUP_JUST_PAID =
  "Check the billing email. The payment is in. This tab is not the login.";

export const SETUP_EXPIRED =
  "That link is done. We can send another to the same billing email.";

export const SETUP_INVALID = "That link isn’t valid.";

export const CALLBACK_FLASH = "Signing you in…";

export const OAUTH_TITLE =
  "Allow FLOKS to connect this Grok Bot as this paying customer.";

export const OAUTH_BODY =
  "This proves who paid. It does not pick the Bot. Pairing is on /setup.";

export const HONESTY =
  "Hours bill while the computer is initializing, running, suspending, or resuming. Asleep and shutdown do not. Unused hours are not cash back. Copy files while it’s up. The disk is not kept after the subscription ends. Cancel from /setup. Zero hours auto-suspends. No overage invoice.";

export const PLANS = [
  {
    id: "spark" as const,
    name: "Spark",
    price: "$19/mo",
    hours: "8 hours",
    line: "Spark — $19/mo — 8 hours — 1 computer",
  },
  {
    id: "desk" as const,
    name: "Desk",
    price: "$39/mo",
    hours: "25 hours",
    line: "Desk — $39/mo — 25 hours — 1 computer",
  },
  {
    id: "shift" as const,
    name: "Shift",
    price: "$69/mo",
    hours: "60 hours",
    line: "Shift — $69/mo — 60 hours — 1 computer",
  },
] as const;

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

export const ERROR_ONE_LINE = "This page isn’t here.";
export const SERVER_ERROR_ONE_LINE = "FLOKS could not finish that request.";

export const LEGAL_DISCLAIMER =
  "FLOKS product policy. These pages describe how FLOKS works on floks-pc.com. They are not a statute, SLA, or law-firm letter. Last updated 2026-08-30.";
