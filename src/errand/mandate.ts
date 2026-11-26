// The human's mandate for one errand, signed with the human's Concordium account key.
// It names the task, the agent account that may spend, the budget, the cap per payment, optional allowed
// shops and an expiry. The errand only starts, and code only pays, under a mandate whose signature matches
// the signer's account keys read from the chain (Concordium account message signing, the same scheme the
// Concordium Browser Wallet's signMessage uses). The model never sees or sets these numbers except as text.
import crypto from 'node:crypto';
import { AccountAddress, signMessage, verifyMessageSignature, type AccountTransactionSignature } from '@concordium/web-sdk';
import { client, withRetry } from '../chain/chain.ts';
import type { Mandate } from './guards.ts';

export type MandateTerms = {
  v: 1;
  kind: 'viale-mandate';
  mandate_id: string;
  human: string; // the account that signs: the person sending the agent out
  agent: string; // the only account allowed to spend under this mandate
  task: string;
  budget_eur: number;
  max_payment_eur: number;
  allowed_shops?: string[];
  issued_at: string;
  expires_at: string;
};
export type SignedMandate = { message: string; signature: AccountTransactionSignature };
export type MandateCheck = { ok: true; mandate: Mandate } | { ok: false; reasons: string[] };

/** The limits a mandate may set on this server (the public demo keeps them small). */
export type MandateLimits = { budgetEur: number; maxPaymentEur: number; maxMinutes: number };

export function draftMandate(o: { task: string; human: string; agent: string; budgetEur: number; maxPaymentEur: number; minutes: number; allowedShops?: string[]; now?: Date }): MandateTerms {
  const now = o.now ?? new Date();
  return {
    v: 1,
    kind: 'viale-mandate',
    mandate_id: crypto.randomUUID(),
    human: o.human,
    agent: o.agent,
    task: o.task,
    budget_eur: o.budgetEur,
    max_payment_eur: o.maxPaymentEur,
    ...(o.allowedShops?.length ? { allowed_shops: o.allowedShops } : {}),
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + o.minutes * 60_000).toISOString(),
  };
}

/** Field checks that need no chain access (kept separate so tests can run them offline). */
export function mandateTermsProblems(t: MandateTerms, o: { agent: string; limits: MandateLimits; now?: Date }): string[] {
  const now = o.now ?? new Date();
  const r: string[] = [];
  const money = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x > 0;
  if (t?.v !== 1 || t.kind !== 'viale-mandate') return ['not a Viale mandate'];
  if (typeof t.mandate_id !== 'string' || !t.mandate_id) r.push('mandate has no id');
  if (typeof t.human !== 'string' || !t.human) r.push('mandate names no signer');
  if (t.human === o.agent) r.push('the agent cannot sign its own mandate: sign with a different account');
  if (t.agent !== o.agent) r.push(`mandate is for agent ${String(t.agent).slice(0, 6)}…, not this agent ${o.agent.slice(0, 6)}…`);
  if (typeof t.task !== 'string' || !t.task.trim()) r.push('mandate has no task');
  if (!money(t.budget_eur)) r.push('mandate has no valid budget');
  if (!money(t.max_payment_eur)) r.push('mandate has no valid cap per payment');
  if (money(t.budget_eur) && t.budget_eur > o.limits.budgetEur) r.push(`budget €${t.budget_eur} is over this street's €${o.limits.budgetEur} limit`);
  if (money(t.max_payment_eur) && t.max_payment_eur > o.limits.maxPaymentEur) r.push(`cap €${t.max_payment_eur} is over this street's €${o.limits.maxPaymentEur} limit`);
  const issued = Date.parse(t.issued_at), expires = Date.parse(t.expires_at);
  if (!(expires > now.getTime())) r.push(`mandate expired at ${t.expires_at}`);
  if (!(issued <= now.getTime() + 60_000)) r.push('mandate is issued in the future');
  if (expires - issued > o.limits.maxMinutes * 60_000) r.push(`mandate runs longer than ${o.limits.maxMinutes} minutes`);
  if (t.allowed_shops !== undefined && !(Array.isArray(t.allowed_shops) && t.allowed_shops.every((s) => typeof s === 'string'))) r.push('allowed shops is not a list of names');
  return r;
}

/** Checks a signed mandate: readable, sensible terms, for this agent, and signed by the named human's keys on chain. */
export async function verifyMandate(sm: SignedMandate, o: { agent: string; limits: MandateLimits; now?: Date }): Promise<MandateCheck> {
  let t: MandateTerms;
  try { t = JSON.parse(sm.message); } catch { return { ok: false, reasons: ['mandate is not readable'] }; }
  const reasons = mandateTermsProblems(t, o);
  if (reasons.length) return { ok: false, reasons };
  let info;
  try {
    info = await withRetry(() => client().getAccountInfo(AccountAddress.fromBase58(t.human)));
  } catch {
    return { ok: false, reasons: [`signer ${t.human.slice(0, 6)}… is not an account on Concordium testnet`] };
  }
  const signed = await verifyMessageSignature(sm.message, sm.signature, info).catch(() => false);
  if (!signed) return { ok: false, reasons: [`signature does not match the keys of ${t.human.slice(0, 6)}… on chain`] };
  return {
    ok: true,
    mandate: {
      task: t.task,
      budgetEur: t.budget_eur,
      maxPaymentEur: t.max_payment_eur,
      ...(t.allowed_shops ? { allowedShops: t.allowed_shops } : {}),
      expiresAt: t.expires_at,
      signed: { mandateId: t.mandate_id, human: t.human, message: sm.message, signature: sm.signature },
      verified: true,
    },
  };
}

/** Signs a mandate with a key this process holds (the demo signer, or the CLI's). */
export async function signMandate(terms: MandateTerms, signer: { address: AccountAddress.Type; signer: Parameters<typeof signMessage>[2] }): Promise<SignedMandate> {
  const message = JSON.stringify(terms);
  return { message, signature: await signMessage(signer.address, message, signer.signer) };
}
