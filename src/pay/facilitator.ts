// Viale's x402 facilitator, served over HTTP in the shape x402's HTTPFacilitatorClient calls:
//   GET  /x402/facilitator/supported
//   POST /x402/facilitator/verify  {x402Version, paymentPayload, paymentRequirements}
//   POST /x402/facilitator/settle  {x402Version, paymentPayload, paymentRequirements}
// It checks the payer's signed EUDemo transfer, co-signs it as sponsor and pays the CCD fee, so the
// paying agent never holds CCD. Shops call it after they answer 402 and get a PAYMENT-SIGNATURE back.
// It settles only payments to a street shop's registered wallet, so strangers can't spend Viale's CCD on fees.
import { ExactConcordiumScheme as FacilitatorScheme } from '@x402/concordium/exact/facilitator';
import { CONCORDIUM_TESTNET_CAIP2, toConcordiumFacilitatorSigner } from '@x402/concordium';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { GRPC_HOST, GRPC_PORT } from '../chain/chain.ts';
import { sponsorWallet } from '../chain/keys.ts';

let scheme: FacilitatorScheme | undefined;
function facilitator(): FacilitatorScheme {
  const viale = sponsorWallet();
  scheme ??= new FacilitatorScheme({
    signer: toConcordiumFacilitatorSigner(viale.address.address, viale.signKeyHex, { host: GRPC_HOST, port: GRPC_PORT, useTls: true }),
  });
  return scheme;
}

/** What this facilitator supports, in the x402 /supported shape. */
export function supported() {
  return {
    kinds: [{ x402Version: 2, scheme: 'exact', network: CONCORDIUM_TESTNET_CAIP2, extra: facilitator().getExtra(CONCORDIUM_TESTNET_CAIP2) ?? {} }],
    extensions: [],
    signers: { [CONCORDIUM_TESTNET_CAIP2]: [sponsorWallet().address.address] },
  };
}

/** The `extra` a resource server puts in its payment requirements (the sponsor that pays the fee). */
export const requirementsExtra = () => facilitator().getExtra(CONCORDIUM_TESTNET_CAIP2) ?? {};

type Body = { x402Version?: number; paymentPayload?: PaymentPayload; paymentRequirements?: PaymentRequirements };

/** Handles POST /x402/facilitator/<verify|settle>. `payable` lists the wallets it may settle to. */
export async function facilitate(action: 'verify' | 'settle', body: Body, payable: Set<string>): Promise<{ status: number; body: unknown }> {
  const { paymentPayload: payload, paymentRequirements: req } = body ?? {};
  if (!payload || !req) return { status: 400, body: { error: 'send {x402Version, paymentPayload, paymentRequirements}' } };
  if (req.scheme !== 'exact' || req.network !== CONCORDIUM_TESTNET_CAIP2) {
    const why = `only exact on ${CONCORDIUM_TESTNET_CAIP2}`;
    return { status: 400, body: action === 'verify' ? { isValid: false, invalidReason: why } : { success: false, errorReason: why, transaction: '', network: req.network } };
  }
  if (!payable.has(req.payTo)) {
    const why = 'this facilitator only sponsors payments to shops on the Viale street';
    return { status: 400, body: action === 'verify' ? { isValid: false, invalidReason: why } : { success: false, errorReason: why, transaction: '', network: req.network } };
  }
  const f = facilitator();
  if (action === 'verify') return { status: 200, body: await f.verify(payload, req) };
  const v = await f.verify(payload, req);
  if (!v.isValid) return { status: 400, body: { success: false, errorReason: v.invalidReason, transaction: '', network: req.network } };
  return { status: 200, body: await f.settle(payload, req) };
}
