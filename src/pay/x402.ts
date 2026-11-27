// x402 payment in the test euro (EUDemo, a protocol-level token) from the errand agent to a shop, over HTTP:
//   1. POST /shops/<id>/buy with the signed quote  ->  402 Payment Required + PAYMENT-REQUIRED header
//   2. code checks the requirements ask for exactly the quoted price, in EUDemo, to the shop's registered wallet
//   3. the agent signs a sponsored transfer and retries with a PAYMENT-SIGNATURE header
//   4. the shop has Viale's facilitator verify and settle it (the facilitator co-signs and pays the CCD fee,
//      so the agent never holds CCD) and answers 200 with a PAYMENT-RESPONSE header naming the transaction.
import { ExactConcordiumScheme as ClientScheme } from '@x402/concordium/exact/client';
import { CONCORDIUM_TESTNET_CAIP2 } from '@x402/concordium';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { client } from '../chain/chain.ts';
import { agentWallet } from '../chain/keys.ts';
import type { SignedQuote } from '../street/shop-agent.ts';

export const TOKEN = 'EUDemo';
export const DECIMALS = 6;

export const toAtomic = (eur: number) => String(Math.round(eur * 10 ** DECIMALS));

export type Payment = { ok: true; tx: string; amount: number; payTo: string; payer: string; required: PaymentRequirements } | { ok: false; reason: string };

/** Buys against a signed quote at `buyUrl`, paying over x402 only if the 402 asks for exactly `amount` to `payTo`. */
export async function payShop(buyUrl: string, quote: SignedQuote, payTo: string, amount: number): Promise<Payment> {
  const post = (headers: Record<string, string> = {}) =>
    fetch(buyUrl, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ quote }) });

  const first = await post();
  if (first.status !== 402) return { ok: false, reason: `shop answered ${first.status}, not 402: ${(await first.text()).slice(0, 200)}` };
  const header = first.headers.get('payment-required');
  if (!header) return { ok: false, reason: 'shop answered 402 without a PAYMENT-REQUIRED header' };
  const required = decodePaymentRequiredHeader(header);
  const req = required.accepts.find((a) => a.scheme === 'exact' && a.network === CONCORDIUM_TESTNET_CAIP2 && a.asset === TOKEN);
  if (!req) return { ok: false, reason: `shop asks for no payment in ${TOKEN} on Concordium testnet` };
  // The model never sets these: the shop's ask must equal the checked quote and the registry's wallet.
  if (req.amount !== toAtomic(amount)) return { ok: false, reason: `shop asks for ${Number(req.amount) / 10 ** DECIMALS} ${TOKEN}, but the signed quote says ${amount}` };
  if (req.payTo !== payTo) return { ok: false, reason: `shop asks for payment to ${req.payTo.slice(0, 6)}…, not its registered wallet ${payTo.slice(0, 6)}…` };

  const agent = agentWallet();
  const payer = new ClientScheme({ accountAddress: agent.address, signer: agent.signer });
  const partial = await payer.createPaymentPayload(2, req);
  const payload = { x402Version: 2, resource: required.resource, accepted: req, payload: partial.payload } as unknown as PaymentPayload;

  const paid = await post({ 'PAYMENT-SIGNATURE': encodePaymentSignatureHeader(payload) });
  const receipt = paid.headers.get('payment-response');
  if (paid.status !== 200 || !receipt) return { ok: false, reason: `payment not accepted (${paid.status}): ${(await paid.text()).slice(0, 200)}` };
  const settled = decodePaymentResponseHeader(receipt);
  if (!settled.success || !settled.transaction) return { ok: false, reason: `settlement failed: ${settled.errorReason}` };
  return { ok: true, tx: settled.transaction, amount, payTo, payer: agent.address.address, required: req };
}

/** The agent's EUDemo balance in euros. */
export async function agentBalance(): Promise<number> {
  const info = await client().getAccountInfo(agentWallet().address);
  const t = (info.accountTokens ?? []).find((x: any) => String(x.id) === TOKEN);
  return t ? Number(t.state.balance.value) / 10 ** t.state.balance.decimals : 0;
}
