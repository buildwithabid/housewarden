/**
 * Money is stored as integer minor units and shown as major units plus a
 * formatted string ("3,000 PKR", "45.50 USD"). Spoken lines use the currency
 * name where one is known ("3,000 rupees").
 */

export const CURRENCY_SPOKEN_NAMES: Readonly<Record<string, string>> = {
  PKR: "rupees",
  INR: "rupees",
  USD: "dollars",
  CAD: "dollars",
  AUD: "dollars",
  GBP: "pounds",
  EUR: "euros",
};

export function toMinor(amount: number): number {
  return Math.round(amount * 100);
}

export function fromMinor(minor: number): number {
  return minor / 100;
}

function formatNumber(minor: number): string {
  const whole = minor % 100 === 0;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

/** "3,000 PKR" / "45.50 USD" — the string a voice assistant can read as-is. */
export function formatAmount(minor: number, currency: string): string {
  return `${formatNumber(minor)} ${currency}`;
}

/** "3,000 rupees" / "45.50 dollars" / "12 CHF". */
export function spokenAmount(minor: number, currency: string): string {
  const name = CURRENCY_SPOKEN_NAMES[currency] ?? currency;
  return `${formatNumber(minor)} ${name}`;
}
