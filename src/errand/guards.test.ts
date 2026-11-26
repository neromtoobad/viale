import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizePayment, type Ledger, type Mandate } from './guards.ts';
import { quoteTermsProblems, type VerifiedQuote } from './quote-check.ts';
import type { ShopVerdict } from './shop-check.ts';

const mandate: Mandate = { task: 'buy wine', budgetEur: 10, maxPaymentEur: 6, expiresAt: '2099-01-01T00:00:00Z' };
const fresh = (): Ledger => ({ spentEur: 0, payments: [] });
const goodShop: ShopVerdict = { ok: true, tokenId: '1', name: 'The Bottle Shop', owner: '4UVs', payTo: '3HNi', reasons: [], passed: [] };
const impostor: ShopVerdict = { ...goodShop, ok: false, reasons: ['owner holds only a personal identity'] };
const quoteFor = (price: number, extra: Partial<VerifiedQuote> = {}): VerifiedQuote => ({
  v: 1, kind: 'viale-quote', quote_id: 'q-' + price, shop_token_id: '1', shop_owner: '4UVs', pay_to: '3HNi',
  sku: 'house-red', item: 'House red', price_eur: price, expires_at: '2099-01-01T00:00:00Z', verified: true, ...extra,
});
const pay = (amount: number, o: { shop?: ShopVerdict; ledger?: Ledger; m?: Mandate; quote?: VerifiedQuote | null; ageProven?: boolean } = {}) =>
  authorizePayment(o.m ?? mandate, o.ledger ?? fresh(), 'shop' in o ? o.shop : goodShop, amount, {
    ageProven: o.ageProven,
    quote: o.quote === null ? undefined : (o.quote ?? quoteFor(amount)),
  });
const why = (d: ReturnType<typeof pay>) => (d.ok ? '' : d.reasons.join(' | '));

test('pays a checked shop its quoted price within budget', () => {
  assert.deepEqual(pay(5.5), { ok: true });
});

test('refuses a shop that failed its check', () => {
  assert.match(why(pay(2, { shop: impostor })), /failed its check/);
});

test('refuses a shop that was never checked', () => {
  assert.match(why(pay(2, { shop: undefined })), /not been checked/);
});

test('refuses over the single-payment cap', () => {
  assert.equal(pay(6.01).ok, false);
});

test('refuses when the total would pass the budget', () => {
  assert.equal(pay(5.01, { ledger: { spentEur: 5, payments: [] } }).ok, false);
  assert.equal(pay(5, { ledger: { spentEur: 5, payments: [] } }).ok, true);
});

test('refuses after the mandate expires', () => {
  assert.match(why(pay(1, { m: { ...mandate, expiresAt: '2020-01-01T00:00:00Z' } })), /mandate expired/);
});

test('refuses shops off the allowed list', () => {
  assert.match(why(pay(1, { m: { ...mandate, allowedShops: ['Corner Bakery'] } })), /allowed shops/);
});

test('refuses zero, negative and non-numbers', () => {
  for (const x of [0, -1, NaN, Infinity]) assert.equal(pay(x).ok, false);
});

test('refuses an 18+ shop until the age proof passes', () => {
  const bottle = { ...goodShop, ageGated: true };
  assert.match(why(pay(2, { shop: bottle })), /18 or older/);
  assert.equal(pay(2, { shop: bottle, ageProven: true }).ok, true);
});

test('refuses without a verified quote', () => {
  assert.match(why(pay(2, { quote: null })), /no verified price quote/);
  assert.match(why(pay(2, { quote: { ...quoteFor(2), verified: false as any } })), /no verified price quote/);
});

test('pays exactly the quoted price, not what the model asks', () => {
  assert.match(why(pay(3, { quote: quoteFor(2.4) })), /not the quoted price of €2.4/);
  assert.match(why(pay(2, { quote: quoteFor(2.4) })), /not the quoted price/);
  assert.equal(pay(2.4, { quote: quoteFor(2.4) }).ok, true);
});

test("refuses a quote from another shop, to another wallet, expired, or already paid", () => {
  assert.match(why(pay(2, { quote: quoteFor(2, { shop_token_id: '9' }) })), /from shop #9/);
  assert.match(why(pay(2, { quote: quoteFor(2, { pay_to: 'evil' }) })), /registered wallet/);
  assert.match(why(pay(2, { quote: quoteFor(2, { expires_at: '2020-01-01T00:00:00Z' }) })), /quote expired/);
  assert.match(why(pay(2, { ledger: { spentEur: 2, payments: [{ tokenId: '1', amount: 2, tx: 't', quoteId: 'q-2' }] } })), /already been paid/);
});

test('quote terms must match the checked shop', () => {
  const terms = quoteFor(2);
  assert.deepEqual(quoteTermsProblems(terms, goodShop), []);
  assert.match(quoteTermsProblems({ ...terms, shop_owner: '3bV1' }, goodShop).join(), /registry says/);
  assert.match(quoteTermsProblems({ ...terms, price_eur: -1 }, goodShop).join(), /no valid price/);
});
