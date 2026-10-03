/**
 * Internal unapproved draft figures. Not founder-locked prices.
 * Do not import this module from pages, components, copy, legal, metadata, or email.
 * Checkout charges the Stripe Price ID configured on the environment, not these numbers.
 */

export const INTERNAL_DRAFT_PRICE_MONTHLY_CENTS = {
  personal: 2900,
  pro: 9900,
  team: 7900,
} as const;

/** Personal, Pro, and Team draft overage. Enterprise draft was 110 cents. */
export const INTERNAL_DRAFT_OVERAGE_PER_HOUR_CENTS = 120;
export const INTERNAL_DRAFT_ENTERPRISE_OVERAGE_PER_HOUR_CENTS = 110;
