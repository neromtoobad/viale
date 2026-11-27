// The errand agent's check on a price quote before it may pay:
//  1. the signature is valid for the shop OWNER's account keys, read from the chain (not from the quote);
//     for a shop opened by an outside owner, the quote carries the owner's signed price list instead, and the
//     item and price must be on it (src/street/open-shops.ts, priceListProblems),
//  2. the quote is for the shop that passed check_shop, from that shop's registered owner,
//  3. it asks for payment to the wallet the Agent Registry holds for that shop,
//  4. it has not expired and its price is a positive amount.
// Only a quote that passes every point can be paid, and only for exactly its price.
import type { ShopVerdict } from './shop-check.ts';
import { quoteSignatureProblems, type QuoteTerms, type SignedQuote } from '../street/shop-agent.ts';

export type VerifiedQuote = QuoteTerms & { verified: true; signed_as?: 'quote' | 'price_list' };
export type QuoteCheck = { ok: true; quote: VerifiedQuote } | { ok: false; reasons: string[] };

/** Field checks that need no chain access (kept separate so tests can run them offline). */
export function quoteTermsProblems(t: QuoteTerms, shop: ShopVerdict, now = new Date()): string[] {
  const r: string[] = [];
  if (t.v !== 1 || t.kind !== 'viale-quote') r.push('not a Viale quote');
  if (t.shop_token_id !== shop.tokenId) r.push(`quote is from shop #${t.shop_token_id}, not #${shop.tokenId}`);
  if (t.shop_owner !== shop.owner) r.push(`quote names owner ${t.shop_owner?.slice(0, 6)}…, but the registry says ${shop.owner?.slice(0, 6)}…`);
  if (t.pay_to !== shop.payTo) r.push(`quote asks for payment to ${t.pay_to?.slice(0, 6)}…, not the shop's registered wallet ${shop.payTo?.slice(0, 6)}…`);
  if (!(typeof t.price_eur === 'number' && t.price_eur > 0 && Number.isFinite(t.price_eur))) r.push('quote has no valid price');
  if (!(new Date(t.expires_at) > now)) r.push(`quote expired at ${t.expires_at}`);
  return r;
}

export async function checkQuote(q: SignedQuote, shop: ShopVerdict | undefined, now = new Date()): Promise<QuoteCheck> {
  if (!shop?.ok || !shop.owner) return { ok: false, reasons: ['ask for a quote only from a shop that passed check_shop'] };
  let terms: QuoteTerms;
  try { terms = JSON.parse(q.message); } catch { return { ok: false, reasons: ['quote is not readable'] }; }
  const reasons = quoteTermsProblems(terms, shop, now);
  reasons.unshift(...(await quoteSignatureProblems(q, terms, shop.owner, now)));
  return reasons.length ? { ok: false, reasons } : { ok: true, quote: { ...terms, verified: true, signed_as: q.price_list ? 'price_list' : 'quote' } };
}
