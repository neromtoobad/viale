// The shop side of Viale: each shop agent shows its menu and gives signed price quotes.
// A quote is signed with the shop OWNER's Concordium account key (Concordium's account message signing),
// so an errand agent can check, against the owner's keys on chain, that the price really came from
// the account that owns the shop in the Agent Registry, and pay exactly that price to the registered wallet.
// For the demo all shop agents run inside Viale's server, each with its own owner's key.
import crypto from 'node:crypto';
import { AccountAddress, signMessage, verifyMessageSignature, type AccountTransactionSignature } from '@concordium/web-sdk';
import { CONCORDIUM_TESTNET_CAIP2 } from '@x402/concordium';
import { HTTPFacilitatorClient, decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from '@x402/core/http';
import type { PaymentRequired, PaymentRequirements } from '@x402/core/types';
import { client, withRetry } from '../chain/chain.ts';
import { requirementsExtra } from '../pay/facilitator.ts';
import { agentOf } from '../registry/mcp.ts';
import { shopOwnerWallet, sponsorWallet, type Wallet } from '../chain/keys.ts';
import { CATALOG, type Item } from './catalog.ts';

export const QUOTE_MINUTES = 10;

/** The fields a shop commits to. They are signed as this exact JSON string. */
export type QuoteTerms = {
  v: 1;
  kind: 'viale-quote';
  quote_id: string;
  shop_token_id: string;
  shop_owner: string;
  pay_to: string;
  sku: string;
  item: string;
  price_eur: number;
  expires_at: string;
};
export type SignedQuote = { message: string; signature: AccountTransactionSignature };

function ownerSigner(owner: string): Wallet {
  for (const w of [shopOwnerWallet(), sponsorWallet()]) if (w.address.address === owner) return w;
  throw new Error(`this server holds no key for shop owner ${owner}`);
}

export function menu(tokenId: string): Item[] {
  const items = CATALOG[tokenId];
  if (!items) throw new Error(`shop #${tokenId} has no menu`);
  return items;
}

export async function quote(tokenId: string, sku: string, now = new Date()): Promise<SignedQuote> {
  const item = menu(tokenId).find((i) => i.sku === sku);
  if (!item) throw new Error(`shop #${tokenId} does not sell "${sku}"`);
  const agent = await agentOf(tokenId);
  if (!agent) throw new Error(`no agent #${tokenId} in the registry`);
  const terms: QuoteTerms = {
    v: 1,
    kind: 'viale-quote',
    quote_id: crypto.randomUUID(),
    shop_token_id: tokenId,
    shop_owner: agent.owner_account,
    pay_to: agent.agent_wallet ?? agent.owner_account,
    sku: item.sku,
    item: item.name,
    price_eur: item.priceEur,
    expires_at: new Date(now.getTime() + QUOTE_MINUTES * 60_000).toISOString(),
  };
  const message = JSON.stringify(terms);
  const w = ownerSigner(agent.owner_account);
  return { message, signature: await signMessage(w.address, message, w.signer) };
}

// ── Selling over x402 ──────────────────────────────────────────────────────────────────────────────
// POST /shops/<id>/buy {quote} is the shop's paid resource. Without payment it answers HTTP 402 with
// x402 payment requirements built from its own signed quote (exact price, to its registered wallet).
// The buyer retries with a PAYMENT-SIGNATURE header; the shop sends that to the facilitator over HTTP
// to verify and settle, and answers 200 with the order and a PAYMENT-RESPONSE header.

export const TOKEN = 'EUDemo';
export const toAtomic = (eur: number) => String(Math.round(eur * 1e6));
export type Sale = { status: number; headers?: Record<string, string>; body: unknown };

const paidQuotes = new Map<string, string>(); // quote_id -> settled transaction

/** The wallet each street shop is paid at, read from the registry (cached 10 minutes). */
let payable: { at: number; set: Set<string> } | undefined;
export async function streetWallets(): Promise<Set<string>> {
  if (payable && Date.now() - payable.at < 600_000) return payable.set;
  const set = new Set<string>();
  for (const id of Object.keys(CATALOG)) {
    const a = await agentOf(id).catch(() => null);
    if (a) set.add(a.agent_wallet ?? a.owner_account);
  }
  payable = { at: Date.now(), set };
  return set;
}

export async function buy(tokenId: string, signed: SignedQuote | undefined, paymentHeader: string | undefined, resourceUrl: string, facilitatorUrl: string, now = new Date()): Promise<Sale> {
  // 1. Only sell against a quote this shop signed: right shop, its registered owner and wallet, not expired.
  let t: QuoteTerms;
  try { t = JSON.parse(String(signed?.message)); } catch { return { status: 400, body: { error: 'send {quote: {message, signature}} from POST /shops/<id>/quote' } }; }
  if (t.kind !== 'viale-quote' || t.shop_token_id !== tokenId) return { status: 400, body: { error: `not a quote from shop #${tokenId}` } };
  if (!(new Date(t.expires_at) > now)) return { status: 410, body: { error: `quote expired at ${t.expires_at}` } };
  const agent = await agentOf(tokenId);
  if (!agent || t.shop_owner !== agent.owner_account || t.pay_to !== (agent.agent_wallet ?? agent.owner_account)) return { status: 400, body: { error: "quote does not match this shop's registry record" } };
  const ownerInfo = await withRetry(() => client().getAccountInfo(AccountAddress.fromBase58(t.shop_owner)));
  if (!(await verifyMessageSignature(signed!.message, signed!.signature, ownerInfo).catch(() => false))) return { status: 400, body: { error: "quote signature does not match the shop owner's keys on chain" } };
  if (paidQuotes.has(t.quote_id)) return { status: 409, body: { error: 'this quote is already paid', transaction: paidQuotes.get(t.quote_id) } };

  // 2. The price, as x402 payment requirements: exact amount, in EUDemo, to the shop's registered wallet.
  const accepted: PaymentRequirements = {
    scheme: 'exact',
    network: CONCORDIUM_TESTNET_CAIP2,
    asset: TOKEN,
    amount: toAtomic(t.price_eur),
    payTo: t.pay_to,
    maxTimeoutSeconds: 120,
    extra: requirementsExtra(),
  };
  const resource = { url: resourceUrl, description: `${t.item} from shop #${tokenId} (quote ${t.quote_id})`, mimeType: 'application/json' };
  const required = (error: string): Sale => {
    const pr: PaymentRequired = { x402Version: 2, error, resource, accepts: [accepted] } as PaymentRequired;
    return { status: 402, headers: { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(pr) }, body: pr };
  };
  if (!paymentHeader) return required('PAYMENT-SIGNATURE header is required');

  // 3. A payment came back: it must be for exactly these requirements; the facilitator verifies and settles it.
  let payload;
  try { payload = decodePaymentSignatureHeader(paymentHeader); } catch { return required('PAYMENT-SIGNATURE header is not readable'); }
  const a: any = (payload as any).accepted ?? {};
  if (a.amount !== accepted.amount || a.payTo !== accepted.payTo || a.asset !== accepted.asset || a.network !== accepted.network) return required('payment does not match the quoted price and wallet');
  const fac = new HTTPFacilitatorClient({ url: facilitatorUrl });
  const v = await fac.verify(payload, accepted).catch((e: any) => ({ isValid: false, invalidReason: e?.invalidReason ?? e?.message }));
  if (!v.isValid) return required(`facilitator refused the payment: ${v.invalidReason}`);
  const s: any = await fac.settle(payload, accepted).catch((e: any) => ({ success: false, errorReason: e?.errorReason ?? e?.message }));
  if (!s.success) return required(`settlement failed: ${s.errorReason}`);
  paidQuotes.set(t.quote_id, s.transaction);
  return {
    status: 200,
    headers: { 'PAYMENT-RESPONSE': encodePaymentResponseHeader(s) },
    body: { order: { quote_id: t.quote_id, item: t.item, price_eur: t.price_eur, shop_token_id: tokenId }, transaction: s.transaction, payer: s.payer ?? null },
  };
}
