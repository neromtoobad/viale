// Viale's x402 facilitator, served over HTTP in the shape x402's HTTPFacilitatorClient calls:
//   GET  /x402/facilitator/supported
//   POST /x402/facilitator/verify  {x402Version, paymentPayload, paymentRequirements}
//   POST /x402/facilitator/settle  {x402Version, paymentPayload, paymentRequirements}
// It checks the payer's signed EUDemo transfer, co-signs it as sponsor and pays the CCD fee, so the
// paying agent never holds CCD. Shops call it after they answer 402 and get a PAYMENT-SIGNATURE back.
// It verifies payments to a street shop's registered wallet, and settles (spending Viale's CCD on the fee) only a
// payment a Viale shop is selling right now: the shop's /buy registers the exact quote, wallet and amount just
// before it asks to settle, and each registration is used once and expires after two minutes. A stranger who opens
// a shop can't settle their own transfers through it without a live quote and a buyer going through /buy.
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

/** Sales a shop is settling right now: `${payTo}|${amount}` -> expiry times, one per quote in flight. */
const inFlight = new Map<string, number[]>();
/** Called by a shop's /buy right before it asks the facilitator to settle that quote's payment. */
export function expectSettlement(payTo: string, amount: string, ms = 120_000) {
  const k = `${payTo}|${amount}`;
  inFlight.set(k, [...(inFlight.get(k) ?? []).filter((t) => t > Date.now()), Date.now() + ms]);
}
/** Uses up one registered sale for this wallet and amount; false if none is live. */
function takeSettlement(payTo: string, amount: string): boolean {
  const k = `${payTo}|${amount}`;
  const live = (inFlight.get(k) ?? []).filter((t) => t > Date.now());
  if (!live.length) { inFlight.delete(k); return false; }
  live.shift();
  inFlight.set(k, live);
  return true;
}

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
  if (!takeSettlement(req.payTo, req.amount)) return { status: 400, body: { success: false, errorReason: 'no Viale shop is selling this right now: settle only follows a quote going through /shops/<id>/buy', transaction: '', network: req.network } };
  const v = await f.verify(payload, req);
  if (!v.isValid) return { status: 400, body: { success: false, errorReason: v.invalidReason, transaction: '', network: req.network } };
  return { status: 200, body: await f.settle(payload, req) };
}
