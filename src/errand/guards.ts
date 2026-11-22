// Hard limits on what the errand agent may pay. The human sets the mandate before the errand starts;
// the language model can't change it. Every payment passes through authorizePayment() in code,
// whatever the model says, so a confused or manipulated model still can't overspend or pay an unchecked shop.
// (Protocol-level account locks replace this in-process check when they reach testnet.)
import type { ShopVerdict } from './shop-check.ts';

export type Mandate = {
  task: string; // what the human asked for, in their words
  budgetEur: number; // total the agent may spend on this errand
  maxPaymentEur: number; // cap on any single payment
  allowedShops?: string[]; // optional: only shops with these card names
  expiresAt: string; // ISO time after which the agent may not pay
};

export type Ledger = { spentEur: number; payments: { tokenId: string; amount: number; tx: string }[] };

export type Decision = { ok: true } | { ok: false; reasons: string[] };

const cents = (x: number) => Math.round(x * 100);

export function authorizePayment(m: Mandate, ledger: Ledger, shop: ShopVerdict | undefined, amountEur: number, opts: { ageProven?: boolean; now?: Date } = {}): Decision {
  const now = opts.now ?? new Date();
  const reasons: string[] = [];
  if (!Number.isFinite(amountEur) || amountEur <= 0) reasons.push(`amount €${amountEur} is not a positive number`);
  if (cents(amountEur) > cents(m.maxPaymentEur)) reasons.push(`€${amountEur} is over the €${m.maxPaymentEur} limit for one payment`);
  if (cents(ledger.spentEur + amountEur) > cents(m.budgetEur))
    reasons.push(`€${amountEur} would take spending to €${(ledger.spentEur + amountEur).toFixed(2)}, over the €${m.budgetEur} budget`);
  if (now > new Date(m.expiresAt)) reasons.push(`the mandate expired at ${m.expiresAt}`);
  if (!shop) reasons.push('this shop has not been checked in this errand');
  else {
    if (!shop.ok) reasons.push(`the shop failed its check: ${shop.reasons.join('; ')}`);
    if (!shop.payTo) reasons.push('the shop has no registered wallet to pay');
    if (shop.ageGated && !opts.ageProven) reasons.push('this shop sells 18+ goods and your human has not proved they are 18 or older');
    if (m.allowedShops && !m.allowedShops.includes(shop.name ?? '')) reasons.push(`"${shop.name}" is not on the human's list of allowed shops`);
  }
  return reasons.length ? { ok: false, reasons } : { ok: true };
}
