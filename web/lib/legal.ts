import { SELLER, SUPPORT_EMAIL } from "./config";
import { LEGAL_DISCLAIMER } from "./copy";

export type LegalSlug =
  | "index"
  | "terms"
  | "privacy"
  | "aup"
  | "refund"
  | "cancellation"
  | "retention"
  | "support";

export type LegalDoc = {
  slug: LegalSlug;
  path: string;
  title: string;
  headline: string;
  sections: Array<{ heading?: string; paragraphs?: string[]; bullets?: string[] }>;
};

export const FOOTER_NAV: Array<{ href: string; label: string }> = [
  { href: "/legal/terms", label: "Terms" },
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/legal/aup", label: "Acceptable Use" },
  { href: "/legal/refund", label: "Refund" },
  { href: "/legal/cancellation", label: "Cancellation" },
  { href: "/legal/retention", label: "Data retention" },
  { href: "/legal/support", label: "Support" },
];

export const LEGAL_NAV: Array<{ href: string; label: string }> = [
  { href: "/legal", label: "Policies" },
  ...FOOTER_NAV,
];

export const LEGAL_DOCS: Record<LegalSlug, LegalDoc> = {
  index: {
    slug: "index",
    path: "/legal",
    title: "Staxions policies — Staxions",
    headline: "Staxions policies",
    sections: [
      {
        paragraphs: [
          LEGAL_DISCLAIMER,
          `Staxions is sold by ${SELLER} (the name Stripe Checkout already shows).`,
        ],
      },
    ],
  },
  terms: {
    slug: "terms",
    path: "/legal/terms",
    title: "Terms — Staxions",
    headline: "Terms",
    sections: [
      {
        paragraphs: [
          LEGAL_DISCLAIMER,
          `Seller: ${SELLER} (the name Stripe Checkout already shows). Product: Staxions. You buy a paid seat for one Grok Bot to use one isolated Staxions Computer. Work stays in Grok. This site is create account, pay, setup, and status — not a second workspace.`,
        ],
      },
      {
        heading: "What you buy",
        paragraphs: [
          "One paid seat = one Grok Bot = one isolated Staxions Computer. Day-one plans we sell:",
        ],
        bullets: [
          "Personal — $29 / month — 10 included hours — 1 computer. Extra hours $1.20/h, off by default.",
          "Pro — $99 / month — 40 shared hours — 2 computers.",
          "Team — $79 per agent / month — 30 hours per agent — minimum 3 agents.",
          "Enterprise — contact / paid pilot only. No self-serve checkout.",
        ],
      },
      {
        paragraphs: [
          "Same eight tools on every plan. We do not sell a shared box, public VNC, extra tools, or a handoff product.",
        ],
      },
      {
        heading: "What you do not buy",
        paragraphs: [
          "A Staxions Computer is not Grok’s shared native machine. Bot A cannot use Bot B’s Computer. There is no uptime SLA on these pages. If we cannot deliver the Computer, see Refund — we do not invent a 99.9% promise.",
        ],
      },
      {
        heading: "Hours and sleep",
        paragraphs: [
          "Hours are included provider running time (the Computer initializing, running, suspending, or resuming). Once it is asleep (suspended) or shut down, that time is not hours. Remaining hours hit zero → the Computer auto-suspends unless you opted in to $1.20/h overage. Idle computers suspend after about 30 minutes.",
        ],
      },
      {
        heading: "Pair",
        paragraphs: [
          "A one-time pair key binds this Bot to that Computer. OAuth on the site proves the paying customer. It does not prove which Bot is calling.",
        ],
      },
      {
        heading: "Abuse",
        paragraphs: [
          "We may suspend or shut down a Computer used to attack others, run malware, scrape other people’s systems, share a Computer you did not pay a seat for, or break isolation. See Acceptable Use.",
        ],
      },
      {
        heading: "Cancel and refund",
        paragraphs: [
          "Card and cancel: Stripe Customer Portal from /setup. Refunds: see Refund. Cancel: see Cancellation.",
        ],
      },
    ],
  },
  privacy: {
    slug: "privacy",
    path: "/legal/privacy",
    title: "Privacy — Staxions",
    headline: "Privacy",
    sections: [
      {
        paragraphs: [
          LEGAL_DISCLAIMER,
          `${SELLER} operates Staxions. We do not sell personal data.`,
        ],
      },
      {
        heading: "What we handle",
        bullets: [
          "Stripe — payment, customer, subscription, billing email. Stripe keeps its own copies.",
          "Seat email — the Stripe billing email, bound to the signed-in WorkOS user (case-insensitive). A paid seat is required; signing in does not invent one.",
          "WorkOS AuthKit — hosted sign-in with Magic Auth. WorkOS emails the 6-digit code until a custom email domain exists. We do not email a setup URL as the login secret.",
          "Session — an HttpOnly sealed cookie named wos-session. Expired sessions refresh or require sign-in. We never mint a session from a Stripe session_id alone.",
          `Mail we send — From Staxions <${SUPPORT_EMAIL}> when we still send operator mail. WorkOS sends AuthKit codes from its own mailer.`,
          "Runloop — the Computer runtime (disk, screenshot, process) for the seat you paid, when live provision is enabled.",
          "Host — this public Next app is built for Vercel. We do not run Google Analytics, Facebook pixels, or session replay.",
          "Postgres — the seat, pair-reveal, and OAuth records live in the database host named by DATABASE_URL.",
          `Subprocessors — Vercel (hosting), WorkOS (sign-in), Stripe (payments), Runloop (computers), the Postgres host, and the email sender for ${SUPPORT_EMAIL}.`,
          "18+ — Staxions is not directed at children under 13.",
        ],
      },
      {
        paragraphs: [
          "Pair codes and capability tokens are not sent by email. Pair keys are shown once on /setup; we store a hash, not the code, after that reveal.",
          "OAuth proves the customer for MCP connect. It is not Bot identity. Bot identity is the pair.",
          "We do not sell, rent, or trade personal data. Processors above run the product. See Data retention for what stays after cancel.",
        ],
      },
    ],
  },
  aup: {
    slug: "aup",
    path: "/legal/aup",
    title: "Acceptable Use — Staxions",
    headline: "Acceptable Use",
    sections: [
      {
        paragraphs: [
          LEGAL_DISCLAIMER,
          "Use Staxions for the Bot you paid a seat for, on that Bot’s isolated Computer.",
          "Do not:",
        ],
        bullets: [
          "attack other systems, scan or exploit networks, or run malware from a Staxions Computer",
          "scrape or harvest other people’s sites or accounts in a way that abuses them",
          "share one Computer across humans or Grok Bots you did not pay a seat for",
          "use Staxions to break isolation (Bot A using Bot B’s Computer, stealing pair codes, or bypassing pair)",
          "use the Computer to send spam or to evade another service’s rules as the main purpose of the seat",
        ],
      },
      {
        paragraphs: [
          "We may suspend or shut down that Computer, revoke that seat, and refuse further pairing if this policy is broken. That does not revoke a different subscription you still pay for.",
        ],
      },
    ],
  },
  refund: {
    slug: "refund",
    path: "/legal/refund",
    title: "Refund — Staxions",
    headline: "Refund",
    sections: [
      {
        paragraphs: [
          LEGAL_DISCLAIMER,
          "If we cannot deliver the Computer you paid for — provision fails, pair cannot start that box — we refund that payment and shut down that box only. The seat is marked so it cannot be assigned.",
          "We do not promise a 30-day no-questions refund. Hours already used, chargebacks, and other refund requests are at the operator’s discretion. Unused hours in a paid period are not an automatic cash-back.",
          `Ask at ${SUPPORT_EMAIL}. Include the Stripe billing email. Do not paste pair codes or tokens. See Support.`,
        ],
      },
    ],
  },
  cancellation: {
    slug: "cancellation",
    path: "/legal/cancellation",
    title: "Cancellation — Staxions",
    headline: "Cancellation",
    sections: [
      {
        paragraphs: [
          LEGAL_DISCLAIMER,
          "Cancel and update the card in the Stripe Customer Portal. On /setup, use Manage billing.",
          "If the portal sets cancel-at-period-end, the subscription stays until Stripe ends it. You keep that seat until then.",
          "When Stripe sends customer.subscription.deleted, Staxions revokes unused and consumed seats for that subscription only. Those seats are no longer assignable. The Computer for that subscription is shut down. Another subscription on the same customer is not revoked.",
          "Revoke is immediate on that deleted event. It is not “wait until you log out.”",
        ],
      },
    ],
  },
  retention: {
    slug: "retention",
    path: "/legal/retention",
    title: "Data retention — Staxions",
    headline: "Data retention",
    sections: [
      {
        paragraphs: [
          LEGAL_DISCLAIMER,
          "After cancel, we keep Stripe ids (customer, subscription, checkout, event id), the webhook event log, and the seat ledger (revoked). We keep those to prove pay, grant, and revoke. We do not keep the live Computer disk after shutdown. Shutdown ends the Computer.",
          "We do not claim we delete Stripe’s copies, Cloudflare logs, or Vercel logs. Those operators keep what their own products keep.",
          "AuthKit codes expire on WorkOS’s side. Setup cookies end on logout, refresh failure, or expiry. Pair codes are one-time; we store a hash, not the code, after reveal.",
        ],
      },
    ],
  },
  support: {
    slug: "support",
    path: "/legal/support",
    title: "Support — Staxions",
    headline: "Support",
    sections: [
      {
        paragraphs: [
          LEGAL_DISCLAIMER,
          `Email ${SUPPORT_EMAIL}.`,
          "Send:",
        ],
        bullets: [
          "the Stripe billing email",
          "what you paid (Personal / Pro / Team) and about when",
          "what failed (pay, sign-in code, pair, sleep, cancel) in plain words",
        ],
      },
      {
        paragraphs: [
          "Do not paste pair codes, capability tokens, AuthKit codes, cookies, or API keys. If we need a last-4 of a Computer id, we will ask.",
          "Billing changes: Stripe Customer Portal from /setup, not this inbox.",
        ],
      },
    ],
  },
};
