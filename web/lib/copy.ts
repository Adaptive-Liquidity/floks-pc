/** Locked public copy. Tests grep this file. Do not reintroduce killed lines. */

export const HOME_KICKER = "The Agent Computer";

export const HOME_HEADLINE = "Your agent has a mind.";

export const HOME_SUB =
  "Give it somewhere to work. An isolated Agent Computer — persistent workspace, dedicated browser, private files, controlled execution, scoped permissions.";

export const HOME_LINE =
  "Not another chat window. Not a temporary sandbox. One Bot, one isolated computer. Work stays in Grok.";

export const HOME_TOOLS =
  "Same eight tools on every desk. Renews monthly until you cancel.";

export const FOOTER_MARK = "FLOKS";
export const FOOTER_ORG = "Asentxia Systems";

export const JOIN_LINE = "Pay here. Then sign in on this site. We email a 6-digit code.";

export const SETUP_COLD =
  "Sign in with the 6-digit code we email. Typing an email on this site is not enough.";

export const SETUP_PAID_CHIP = "Paid";

export const SETUP_JUST_PAID =
  "Paid. Sign in with the 6-digit code we email to that Stripe inbox.";

export const SETUP_EXPIRED =
  "That sign-in expired. Sign in again for a new 6-digit code.";

export const SETUP_INVALID = "This sign-in is not valid.";

export const SETUP_SIGN_IN = "Sign in";

export const OAUTH_LOADING = "Loading…";
export const OAUTH_INVALID = "This client is not valid.";
export const OAUTH_ERROR = "FLOKS could not finish that request.";
export const OAUTH_ALREADY = "Already allowed for this customer.";

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
    short: "Spark · $19/mo · 8h",
  },
  {
    id: "desk" as const,
    name: "Desk",
    price: "$39/mo",
    hours: "25 hours",
    line: "Desk — $39/mo — 25 hours — 1 computer",
    short: "Desk · $39/mo · 25h",
  },
  {
    id: "shift" as const,
    name: "Shift",
    price: "$69/mo",
    hours: "60 hours",
    line: "Shift — $69/mo — 60 hours — 1 computer",
    short: "Shift · $69/mo · 60h",
  },
] as const;

export const WEBHOOK_LAG =
  "Payment received. The seat appears when Stripe confirms.";

export const ZERO_SEATS =
  "No seat yet. Pay for a plan. Allowing the plugin does not mint a computer.";

export const PAST_DUE = "Card failed. Update billing or the seat stays past due.";

export const DESK_COPY = {
  unused: "Unused. Create a pair key, then approve a pending Bot claim to bind this desk.",
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
export const PASTE_FALLBACK = "Approve isn’t working.";
export const MANAGE_BILLING = "Manage billing";
export const LOGOUT = "Logout";
export const CREATE_PAIR = "Create pair key";
export const REVOKE_PAIR = "Revoke pair key";
export const PAIR_REVEAL_ONCE = "Shown once. Lost key → revoke and mint another.";

export const ERROR_ONE_LINE = "This page isn’t here.";
export const SERVER_ERROR_ONE_LINE = "FLOKS could not finish that request.";

export const LEGAL_DISCLAIMER =
  "FLOKS product policy. These pages describe how FLOKS works on floks-pc.com. They are not a statute, SLA, or law-firm letter. Last updated 2026-09-17.";

export const PRODUCT_EYEBROW = "The Agent Computer";
export const PRODUCT_TITLE = "What FLOKS is";
export const HOW_EYEBROW = "How it works";
export const HOW_TITLE = "Four moves. Then it occupies the machine.";
export const NOW_EYEBROW = "Available now";
export const NOW_TITLE = "Live. Occupiable. Bounded.";
export const FAQ_EYEBROW = "FAQ";
export const FAQ_TITLE = "Questions";
export const JOIN_TITLE = "Pick the hours";
export const JOIN_SUB =
  "One paid seat: one Grok Bot, one isolated computer. Stripe Checkout is register. Work stays in Grok.";
export const JOIN_HOURS =
  "Boot and resume burn hours. Asleep and shutdown do not. No overage invoice.";

export const HOW_STEPS = [
  {
    n: "01",
    title: "Pay",
    body: "Pay on / or /join. Stripe Checkout is register. Spark, Desk, or Shift. Payment creates the seat.",
  },
  {
    n: "02",
    title: "Sign in",
    body: "We email a 6-digit AuthKit code to that billing address. No password form. Typing an email on the site is not enough.",
  },
  {
    n: "03",
    title: "Allow in Grok",
    body: "Allow proves the customer, not which Bot. Work stays in Grok.",
  },
  {
    n: "04",
    title: "Approve on /setup",
    body: "Pair keys are shown once. That Bot occupies that computer. There is no public /pair page.",
  },
] as const;

export const FAQ_QA: ReadonlyArray<[string, string]> = [
  ["What am I buying?", "One paid seat: one Grok Bot, one isolated FLOKS Computer. Work stays in Grok."],
  [
    "What are the plans?",
    "Spark $19/mo · 8 hours. Desk $39/mo · 25 hours. Shift $69/mo · 60 hours. Same product on every plan — you pick the hours.",
  ],
  [
    "What burns hours?",
    "Initializing, running, suspending, and resuming. Asleep and shutdown do not. No overage invoice. At zero hours the machine suspends until renewal or upgrade.",
  ],
  [
    "Does sleep wipe the computer?",
    "No. Sleep does not wipe. When the subscription ends, the disk is not kept. Copy files off while it’s up if you need them.",
  ],
  [
    "How do I start?",
    "Pay on / or /join → sign in with the 6-digit code we email → Allow in Grok → Approve on /setup.",
  ],
  [
    "Is there a password?",
    "No. AuthKit Magic Auth emails a 6-digit code. Typing an email on the site is not enough.",
  ],
  ["Can I cancel?", "Yes, from /setup (Stripe Customer Portal). Unused hours are not automatic cash-back."],
  [
    "What’s the refund rule?",
    "If we cannot deliver the Computer you paid for (provision fails / pair cannot start that box), we refund that payment. We do not promise a 30-day no-questions refund. See /legal/refund.",
  ],
  ["Who sells FLOKS?", "Adaptive Liquidity, Inc. Support: support@floks-pc.com. These pages are not an SLA."],
];
