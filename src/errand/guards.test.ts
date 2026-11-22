import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizePayment, type Ledger, type Mandate } from './guards.ts';
import type { ShopVerdict } from './shop-check.ts';

const mandate: Mandate = { task: 'buy wine', budgetEur: 10, maxPaymentEur: 6, expiresAt: '2099-01-01T00:00:00Z' };
const fresh = (): Ledger => ({ spentEur: 0, payments: [] });
const goodShop: ShopVerdict = { ok: true, tokenId: '1', name: 'The Bottle Shop', payTo: '3HNi', reasons: [], passed: [] };
const impostor: ShopVerdict = { ...goodShop, ok: false, reasons: ['owner holds only a personal identity'] };

test('pays a checked shop within budget', () => {
  assert.deepEqual(authorizePayment(mandate, fresh(), goodShop, 5.5), { ok: true });
});

test('refuses a shop that failed its check', () => {
  const d = authorizePayment(mandate, fresh(), impostor, 2);
  assert.equal(d.ok, false);
  assert.match((d as any).reasons.join(), /failed its check/);
});

test('refuses a shop that was never checked', () => {
  assert.equal(authorizePayment(mandate, fresh(), undefined, 2).ok, false);
});

test('refuses over the single-payment cap', () => {
  assert.equal(authorizePayment(mandate, fresh(), goodShop, 6.01).ok, false);
});

test('refuses when the total would pass the budget', () => {
  assert.equal(authorizePayment(mandate, { spentEur: 5, payments: [] }, goodShop, 5.01).ok, false);
  assert.equal(authorizePayment(mandate, { spentEur: 5, payments: [] }, goodShop, 5).ok, true);
});

test('refuses after the mandate expires', () => {
  const old = { ...mandate, expiresAt: '2020-01-01T00:00:00Z' };
  assert.equal(authorizePayment(old, fresh(), goodShop, 1).ok, false);
});

test('refuses shops off the allowed list', () => {
  const strict = { ...mandate, allowedShops: ['Corner Bakery'] };
  assert.equal(authorizePayment(strict, fresh(), goodShop, 1).ok, false);
});

test('refuses zero, negative and non-numbers', () => {
  for (const x of [0, -1, NaN, Infinity]) assert.equal(authorizePayment(mandate, fresh(), goodShop, x).ok, false);
});

test('refuses an 18+ shop until the age proof passes', () => {
  const bottle = { ...goodShop, ageGated: true };
  assert.equal(authorizePayment(mandate, fresh(), bottle, 2).ok, false);
  assert.equal(authorizePayment(mandate, fresh(), bottle, 2, { ageProven: true }).ok, true);
});
