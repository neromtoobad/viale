// x402 payment in the test euro (EUDemo, a protocol-level token) from the errand agent to a shop.
// The agent signs a sponsored transfer; Viale's facilitator verifies it, co-signs and pays the CCD fee,
// so the agent never holds CCD. Same flow as spike/pay.ts, as a function the errand can call.
import { ExactConcordiumScheme as ClientScheme } from '@x402/concordium/exact/client';
import { ExactConcordiumScheme as FacilitatorScheme } from '@x402/concordium/exact/facilitator';
import { CONCORDIUM_TESTNET_CAIP2, toConcordiumFacilitatorSigner } from '@x402/concordium';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { AccountAddress } from '@concordium/web-sdk';
import { GRPC_HOST, GRPC_PORT, client } from '../chain/chain.ts';
import { agentWallet, sponsorWallet } from '../chain/keys.ts';

export const TOKEN = 'EUDemo';
export const DECIMALS = 6;

export const toAtomic = (eur: number) => String(Math.round(eur * 10 ** DECIMALS));

export type Payment = { ok: true; tx: string; amount: number; payTo: string; payer: string } | { ok: false; reason: string };

/** Pays `amount` EUDemo to `payTo` over x402. Returns the settled transfer hash or why it failed. */
export async function payShop(payTo: string, amount: number): Promise<Payment> {
  AccountAddress.fromBase58(payTo); // throws on a malformed address
  const agent = agentWallet();
  const viale = sponsorWallet();
  const facilitator = new FacilitatorScheme({
    signer: toConcordiumFacilitatorSigner(viale.address.address, viale.signKeyHex, { host: GRPC_HOST, port: GRPC_PORT, useTls: true }),
  });
  const requirements: PaymentRequirements = {
    scheme: 'exact',
    network: CONCORDIUM_TESTNET_CAIP2,
    asset: TOKEN,
    amount: toAtomic(amount),
    payTo,
    maxTimeoutSeconds: 120,
    extra: facilitator.getExtra(CONCORDIUM_TESTNET_CAIP2) ?? {},
  };
  const payer = new ClientScheme({ accountAddress: agent.address, signer: agent.signer });
  const partial = await payer.createPaymentPayload(2, requirements);
  const payload = { x402Version: 2, accepted: requirements, payload: partial.payload } as unknown as PaymentPayload;

  const verdict = await facilitator.verify(payload, requirements);
  if (!verdict.isValid) return { ok: false, reason: `facilitator refused: ${verdict.invalidReason}` };
  const settled = await facilitator.settle(payload, requirements);
  if (!settled.success) return { ok: false, reason: `settlement failed: ${settled.errorReason}` };
  return { ok: true, tx: settled.transaction, amount, payTo, payer: agent.address.address };
}

/** The agent's EUDemo balance in euros. */
export async function agentBalance(): Promise<number> {
  const info = await client().getAccountInfo(agentWallet().address);
  const t = (info.accountTokens ?? []).find((x: any) => String(x.id) === TOKEN);
  return t ? Number(t.state.balance.value) / 10 ** t.state.balance.decimals : 0;
}
