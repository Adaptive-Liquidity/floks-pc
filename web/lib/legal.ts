import { SELLER } from "./config";
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

export const LEGAL_NAV: Array<{ href: string; label: string }> = [
  { href: "/legal", label: "Policies" },
  { href: "/legal/terms", label: "Terms" },
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/legal/aup", label: "Acceptable Use" },
  { href: "/legal/refund", label: "Refund" },
  { href: "/legal/cancellation", label: "Cancellation" },
  { href: "/legal/retention", label: "Data retention" },
  { href: "/legal/support", label: "Support" },
];

export const LEGAL_DOCS: Record<LegalSlug, LegalDoc> = {
  index: {
    slug: "index",
    path: "/legal",
    title: "FLOKS policies — FLOKS",
    headline: "FLOKS policies",
    sections: [
      {
        paragraphs: [
          LEGAL_DISCLAIMER,
          `FLOKS is sold by ${SELLER} (the name Stripe Checkout already shows). Site: floks-pc.com.`,
        ],
      },
    ],
  },
  terms: {
    slug: "terms",
    path: "/legal/terms",
    title: "Terms — FLOKS",
    headline: "Terms",
    sections: [
      {
        paragraphs: [
          LEGAL_DISCLAIMER,
          `Seller: ${SELLER} (the name Stripe Checkout already shows). Product: FLOKS on floks-pc.com. You buy a paid seat for one Grok Bot to use one isolated FLOKS Computer. Work stays in Grok. This site is pay, connect, status, and revoke — not a second workspace.`,
        ],
      },
      {
        heading: "What you buy",
        paragraphs: [
          "One paid seat = one Grok Bot = one isolated FLOKS Computer. Day-one plans we will sell when buy buttons are on:",
        ],
        bullets: [
          "Spark — $19 / month — 8 included hours — 1 computer",
          "Desk — $39 / month — 25 included hours — 1 computer",
          "Shift — $69 / month — 60 included hours — 1 computer",
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
          "A FLOKS Computer is not Grok’s shared native machine. Bot A cannot use Bot B’s Computer. There is no uptime SLA on these pages. If we cannot deliver the Computer, see Refund — we do not invent a 99.9% promise.",
        ],
      },
      {
        heading: "Hours and sleep",
        paragraphs: [
          "Hours are included provider running time (the Computer initializing, running, suspending, or resuming). Once it is asleep (suspended) or shut down, that time is not hours. Remaining hours hit zero → the Computer auto-suspends. We do not send a surprise overage invoice for extra hours.",
        ],
      },
      {
        heading: "Pair",
        paragraphs: [
          "A one-time pair code binds this Bot to that Computer. OAuth on the site proves the paying customer. It does not prove which Bot is calling.",
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
    title: "Privacy — FLOKS",
    headline: "Privacy",
    sections: [
      {
        paragraphs: [
          LEGAL_DISCLAIMER,
          `${SELLER} operates FLOKS. We do not sell personal data.`,
        ],
      },
      {
        heading: "What we handle",
        bullets: [
          "Stripe — payment, customer, subscription, billing email. Stripe keeps its own copies.",
          "Seat email — the Stripe billing email, used to send a magic link after pay. Typing an email on this site is not login.",
          "Magic link — a short-lived hashed token, then an HttpOnly setup cookie. The raw token is not stored.",
          "Mail — From FLOKS <support@floks-pc.com>. SMTP via Gmail. Envelope is support@floks-pc.com.",
          "Runloop — the Computer runtime (disk, screenshot, process) for the seat you paid.",
          "GCP — the floks-pc.com host and our seat ledger.",
          "Cloudflare — HTTPS / tunnel in front of the public site and MCP, and Cloudflare Web Analytics on the public pages (beacon). We do not run Google Analytics, Facebook pixels, or session replay.",
          "18+ — FLOKS is not directed at children under 13.",
        ],
      },
      {
        paragraphs: [
          "Pair codes and capability tokens are not sent by email. The magic-link mail includes the setup URL. Do not forward it. Pair codes are shown once on /setup; we do not put them in logs or public HTML after that reveal.",
          "OAuth proves the customer for MCP connect. It is not Bot identity. Bot identity is the pair.",
          "We do not sell, rent, or trade personal data. Processors above run the product. See Data retention for what stays after cancel.",
        ],
      },
    ],
  },
  aup: {
    slug: "aup",
    path: "/legal/aup",
    title: "Acceptable Use — FLOKS",
    headline: "Acceptable Use",
    sections: [
      {
        paragraphs: [
          LEGAL_DISCLAIMER,
          "Use FLOKS for the Bot you paid a seat for, on that Bot’s isolated Computer.",
          "Do not:",
        ],
        bullets: [
          "attack other systems, scan or exploit networks, or run malware from a FLOKS Computer",
          "scrape or harvest other people’s sites or accounts in a way that abuses them",
          "share one Computer across humans or Grok Bots you did not pay a seat for",
          "use FLOKS to break isolation (Bot A using Bot B’s Computer, stealing pair codes, or bypassing pair)",
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
    title: "Refund — FLOKS",
    headline: "Refund",
    sections: [
      {
        paragraphs: [
          LEGAL_DISCLAIMER,
          "If we cannot deliver the Computer you paid for — provision fails, pair cannot start that box — we refund that payment and shut down that box only. The seat is marked so it cannot be assigned.",
          "We do not promise a 30-day no-questions refund. Hours already used, chargebacks, and other refund requests are at the operator’s discretion. Unused hours in a paid period are not an automatic cash-back.",
          "Ask at support@floks-pc.com. Include the Stripe billing email. Do not paste pair codes or tokens. See Support.",
        ],
      },
    ],
  },
  cancellation: {
    slug: "cancellation",
    path: "/legal/cancellation",
    title: "Cancellation — FLOKS",
    headline: "Cancellation",
    sections: [
      {
        paragraphs: [
          LEGAL_DISCLAIMER,
          "Cancel and update the card in the Stripe Customer Portal. On /setup, use Manage billing.",
          "If the portal sets cancel-at-period-end, the subscription stays until Stripe ends it. You keep that seat until then.",
          "When Stripe sends customer.subscription.deleted, FLOKS revokes unused and consumed seats for that subscription only. Those seats are no longer assignable. The Computer for that subscription is shut down. Another subscription on the same customer is not revoked.",
          "Revoke is immediate on that deleted event. It is not “wait until you log out.”",
        ],
      },
    ],
  },
  retention: {
    slug: "retention",
    path: "/legal/retention",
    title: "Data retention — FLOKS",
    headline: "Data retention",
    sections: [
      {
        paragraphs: [
          LEGAL_DISCLAIMER,
          "After cancel, we keep Stripe ids (customer, subscription, checkout, event id), the webhook event log, and the seat ledger (revoked). We keep those to prove pay, grant, and revoke. We do not keep the live Computer disk after shutdown. Shutdown ends the Computer.",
          "We do not claim we delete Stripe’s copies, Cloudflare logs, or GCP provider logs. Those operators keep what their own products keep.",
          "Magic-link hashes expire. Setup cookies end on logout or expiry. Pair codes are one-time; we store a hash, not the code, after reveal.",
        ],
      },
    ],
  },
  support: {
    slug: "support",
    path: "/legal/support",
    title: "Support — FLOKS",
    headline: "Support",
    sections: [
      {
        paragraphs: [
          LEGAL_DISCLAIMER,
          "Email support@floks-pc.com.",
          "Send:",
        ],
        bullets: [
          "the Stripe billing email",
          "what you paid (Spark / Desk / Shift) and about when",
          "what failed (pay, magic link, pair, sleep, cancel) in plain words",
        ],
      },
      {
        paragraphs: [
          "Do not paste pair codes, capability tokens, magic-link URLs, cookies, or API keys. If we need a last-4 of a Computer id, we will ask.",
          "Billing changes: Stripe Customer Portal from /setup, not this inbox.",
        ],
      },
    ],
  },
};
