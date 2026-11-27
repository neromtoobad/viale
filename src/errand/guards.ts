// Hard limits on what the errand agent may pay. The human signs the mandate before the errand starts
// (src/errand/mandate.ts checks the signature on chain); the language model can't change it. Every payment passes through authorizePayment() in code,
// whatever the model says, so a confused or manipulated model still can't overspend or pay an unchecked shop.
// (Protocol-level account locks replace this in-process check when they reach testnet.)
import type { ShopVerdict } from './shop-check.ts';
import type { VerifiedQuote } from './quote-check.ts';

export type Mandate = {
  task: string; // what the human asked for, in their words
  budgetEur: number; // total the agent may spend on this errand
  maxPaymentEur: number; // cap on any single payment
  allowedShops?: string[]; // optional: only shops with these card names
  expiresAt: string; // ISO time after which the agent may not pay
  signed?: { mandateId: string; human: string; message: string; signature: unknown }; // the human's signed mandate
  verified?: true; // set only by verifyMandate(), after the signature checked out against the human's keys on chain
};

export type Ledger = { spentEur: number; payments: { tokenId: string; amount: number; tx: string; quoteId?: string }[] };

/** Other registry agents whose cards use the same shop name: the ones this errand checked, and the ones it didn't. */
export type Namesakes = { checked: ShopVerdict[]; unchecked: string[] };

export type Decision = { ok: true } | { ok: false; reasons: string[] };

const cents = (x: number) => Math.round(x * 100);

export function authorizePayment(m: Mandate, ledger: Ledger, shop: ShopVerdict | undefined, amountEur: number, opts: { ageProven?: boolean; quote?: VerifiedQuote; now?: Date; namesakes?: Namesakes } = {}): Decision {
  const now = opts.now ?? new Date();
  const reasons: string[] = [];
  if (m.verified !== true || !m.signed) reasons.push('the mandate is not signed by a human, so nothing can be paid');
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
    // Two agents can use one shop name. Pay only when every agent using it was checked, and all that passed
    // proved the same business; if two businesses claim the name, the agent can't tell which one the human meant.
    const ns = opts.namesakes;
    if (ns?.unchecked.length) reasons.push(`other agents also call themselves "${shop.name}" (#${ns.unchecked.join(', #')}) and were not checked yet`);
    const businesses = new Map<string, string>();
    for (const s of [shop, ...(ns?.checked ?? [])]) if (s.ok && s.operator) businesses.set(`${s.operator.legal_name}|${s.operator.country}`, `${s.operator.legal_name} (#${s.tokenId})`);
    if (businesses.size > 1) reasons.push(`more than one business claims the name "${shop.name}": ${[...businesses.values()].join(' and ')}`);
    // The price comes from the shop's signed quote, never from the model.
    const q = opts.quote;
    if (!q || q.verified !== true) reasons.push('there is no verified price quote from this shop');
    else {
      if (q.shop_token_id !== shop.tokenId) reasons.push(`the quote is from shop #${q.shop_token_id}, not #${shop.tokenId}`);
      if (q.pay_to !== shop.payTo) reasons.push("the quote's payment wallet is not the shop's registered wallet");
      if (cents(amountEur) !== cents(q.price_eur)) reasons.push(`€${amountEur} is not the quoted price of €${q.price_eur}`);
      if (!(new Date(q.expires_at) > now)) reasons.push(`the quote expired at ${q.expires_at}`);
      if (ledger.payments.some((p) => p.quoteId === q.quote_id)) reasons.push('this quote has already been paid');
    }
  }
  return reasons.length ? { ok: false, reasons } : { ok: true };
}
