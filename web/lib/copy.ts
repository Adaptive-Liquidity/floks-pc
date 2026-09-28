/** Locked public copy. Tests grep this file. Do not reintroduce killed lines. */

import { PLAN_CATALOG } from "./billing/catalog";
import { SUPPORT_EMAIL } from "./config";

export const HOME_KICKER = "The Agent Computer";

export const HOME_HEADLINE = "Your agent has a mind.";

export const HOME_SUB =
  "Give it somewhere to work. An isolated Agent Computer — persistent workspace, dedicated browser, private files, controlled execution, scoped permissions.";

export const HOME_LINE =
  "Not another chat window. Not a temporary sandbox. One Bot, one isolated computer. Work stays in Grok.";

export const HOME_TOOLS =
  "Same eight tools on every desk. Renews monthly until you cancel.";

export const FOOTER_MARK = "Staxions";
export const FOOTER_ORG = "Asentxia Systems";

export const JOIN_LINE = "Create an account. Then buy a computer. We email a 6-digit code.";

export const CREATE_ACCOUNT = "Create account";

export const ACCOUNT_HOME_LINE =
  "An isolated Agent Computer for one Grok Bot. Work stays in Grok.";

export const ACCOUNT_EMPTY =
  "No computer yet. Buy a plan to open a desk. Pairing starts after the seat exists.";

export const SETUP_COLD =
  "Create an account or sign in. We email a 6-digit AuthKit code. Typing an email on this site is not enough.";

export const SETUP_PAID_CHIP = "Paid";

export const SETUP_JUST_PAID =
  "Paid. Sign in with the 6-digit code we email to that Stripe inbox.";

export const SETUP_EXPIRED =
  "That sign-in expired. Sign in again for a new 6-digit code.";

export const SETUP_INVALID = "This sign-in is not valid.";

export const SETUP_WORKOS_ENV =
  "Sign-in failed: the WorkOS API key does not match this Client ID. Preview and Production each need a matching Client ID + API key from the same WorkOS environment (Staging vs Production). See docs/DEPLOY.md.";

export const SETUP_SIGN_IN = "Sign in";

export const OAUTH_LOADING = "Loading…";
export const OAUTH_INVALID = "This client is not valid.";
export const OAUTH_ERROR = "Staxions could not finish that request.";
export const OAUTH_ALREADY = "Already allowed for this customer.";

export const CALLBACK_FLASH = "Signing you in…";

export const OAUTH_TITLE =
  "Allow Staxions to connect this Grok Bot as this paying customer.";

export const OAUTH_BODY =
  "This proves who paid. It does not pick the Bot. Pairing is on /setup.";

export const HONESTY =
  "Hours bill while the computer is initializing, running, suspending, or resuming. Asleep and shutdown do not. Unused hours are not cash back. Copy files while it’s up. The disk is not kept after the subscription ends. Cancel from /setup. At the included-hour cap the computer auto-suspends unless you turn on $1.20/h overage. Idle computers suspend after about 30 minutes.";

export const PLANS = [
  {
    id: "personal" as const,
    name: PLAN_CATALOG.personal.name,
    price: PLAN_CATALOG.personal.priceLabel,
    hours: "10 hours",
    line: "Personal — $29/mo — 10 hours — 1 computer",
    short: PLAN_CATALOG.personal.short,
  },
  {
    id: "pro" as const,
    name: PLAN_CATALOG.pro.name,
    price: PLAN_CATALOG.pro.priceLabel,
    hours: "40 hours",
    line: "Pro — $99/mo — 40 shared hours — 2 computers",
    short: PLAN_CATALOG.pro.short,
  },
  {
    id: "team" as const,
    name: PLAN_CATALOG.team.name,
    price: PLAN_CATALOG.team.priceLabel,
    hours: "30 hours per agent",
    line: "Team — $79 per agent/mo — 30 hours per agent — minimum 3 agents",
    short: PLAN_CATALOG.team.short,
  },
] as const;

export const WEBHOOK_LAG =
  "Payment received. The seat appears when Stripe confirms.";

export const ZERO_SEATS =
  "No seat yet. Buy a computer from this account. Allowing the plugin does not mint a computer.";

export const PAST_DUE = "Card failed. Update billing or the seat stays past due.";

export const DESK_COPY = {
  unused: "Unused. Create a pair key, then approve a pending Bot claim to bind this desk.",
  pairing: "Pairing. The Bot is claiming this desk.",
  provisioning: "Provisioning. The computer is coming up.",
  running: "Running. Hours are billing.",
  sleeping: "Sleeping. Asleep time does not bill.",
  hours_empty: "Hours empty. The computer sleeps until renewal unless overage is on.",
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
export const SERVER_ERROR_ONE_LINE = "Staxions could not finish that request.";

export const LEGAL_DISCLAIMER =
  "Staxions product policy. These pages describe how Staxions works. They are not a statute, SLA, or law-firm letter. Last updated 2026-09-28.";

export const PRODUCT_EYEBROW = "The Agent Computer";
export const PRODUCT_TITLE = "What Staxions is";
export const HOW_EYEBROW = "How it works";
export const HOW_TITLE = "Four moves. Then it occupies the machine.";
export const NOW_EYEBROW = "Available now";
export const NOW_TITLE = "Live. Occupiable. Bounded.";
export const FAQ_EYEBROW = "FAQ";
export const FAQ_TITLE = "Questions";
export const JOIN_TITLE = "Pick the hours";
export const JOIN_SUB =
  "One paid seat: one Grok Bot, one isolated computer. Create an account, then buy. Work stays in Grok.";
export const JOIN_HOURS =
  "Boot and resume burn hours. Asleep and shutdown do not. Extra hours $1.20/h, off by default.";
export const PRICING_TITLE = "Pricing";
export const PRICING_SUB =
  "Personal, Pro, and Team. Enterprise is a conversation. Always-on is not a public plan.";

export const HOW_STEPS = [
  {
    n: "01",
    title: "Create account",
    body: "AuthKit Magic Auth emails a 6-digit code. No password form. Typing an email on the site is not enough.",
  },
  {
    n: "02",
    title: "Buy",
    body: "Signed in, pay Personal, Pro, or Team on /pricing. Payment creates the seat and starts the computer. Return lands on /setup.",
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
  ["What am I buying?", "A Staxions Agent Computer: an isolated machine for a Grok Bot. Work stays in Grok."],
  [
    "What are the plans?",
    "Personal $29/mo · 1 computer · 10 hours. Pro $99/mo · 2 computers · 40 shared hours. Team $79 per agent/mo, minimum 3 agents, 30 hours per agent. Enterprise is contact / pilot only. Extra hours $1.20/h, off by default.",
  ],
  [
    "What burns hours?",
    "Initializing, running, suspending, and resuming. Asleep and shutdown do not. At the included-hour cap the machine suspends unless you opt in to overage. Idle computers suspend after about 30 minutes.",
  ],
  [
    "Does sleep wipe the computer?",
    "No. Sleep does not wipe. When the subscription ends, the disk is not kept. Copy files off while it’s up if you need them.",
  ],
  [
    "How do I start?",
    "Create an account → buy Personal, Pro, or Team → Allow in Grok → Approve on /setup.",
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
  ["Who sells Staxions?", `Adaptive Liquidity, Inc. Support: ${SUPPORT_EMAIL}. These pages are not an SLA.`],
];
