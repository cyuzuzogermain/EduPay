/**
 * Single source of truth for every currency EduPay knows how to handle - both the currency a
 * student may choose to send in, and the currency an institution may be paid in
 * (`Institution.preferredCurrency`). Keeping both constrained to the same curated list means the
 * FX layer only ever needs to support pairs drawn from here.
 *
 * Major African currencies plus the two most common cross-border sending currencies (USD, EUR).
 */
export const SEND_CURRENCIES = [
  'RWF',
  'KES',
  'NGN',
  'GHS',
  'ZAR',
  'UGX',
  'TZS',
  'XOF',
  'XAF',
  'EGP',
  'MAD',
  'USD',
  'EUR',
] as const;

export type SendCurrency = (typeof SEND_CURRENCIES)[number];

export function isSendCurrency(value: string): value is SendCurrency {
  return (SEND_CURRENCIES as readonly string[]).includes(value);
}
