// Class launch offer: 20% off the standard price of every UTME 2027 class plan, applied automatically (no code)
// until Monday 7 December 2026, 11:59 PM WAT. The server (pay-initiate) applies the same rule, so the price shown
// is the price charged. The site is static: pages render the offer and a small script hides it after the deadline.
export const LAUNCH_OFFER_PERCENT = 0.2;
export const LAUNCH_OFFER_END_UTC = Date.parse('2026-12-07T22:59:59Z');
export const LAUNCH_OFFER_END_LABEL = 'Monday 7 December, 11:59 PM';

export const COHORT_STANDARD: Record<string, number> = {
  'cohort-core-standard': 18000, 'cohort-core-earlybird': 18000, 'cohort-core': 18000, core: 18000,
  'cohort-core-monthly': 7000,
  'cohort-mastery-standard': 25000, 'cohort-mastery-earlybird': 25000, 'cohort-mastery': 25000, mastery: 25000,
  'cohort-ultimate': 40000, ultimate: 40000,
};

export const launchOfferActive = (now = Date.now()) => now <= LAUNCH_OFFER_END_UTC;
export const offerPrice = (standard: number) => standard - Math.round(standard * LAUNCH_OFFER_PERCENT);

/** The offer for a server product id, or null when it does not apply / has ended. */
export function launchOfferFor(productId: string, now = Date.now()): { standard: number; final: number; discount: number } | null {
  const standard = COHORT_STANDARD[productId];
  if (!standard || !launchOfferActive(now)) return null;
  const final = offerPrice(standard);
  return { standard, final, discount: standard - final };
}
