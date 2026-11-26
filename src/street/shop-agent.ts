// The shop side of Viale: each shop agent shows its menu and gives signed price quotes.
// A quote is signed with the shop OWNER's Concordium account key (Concordium's account message signing),
// so an errand agent can check, against the owner's keys on chain, that the price really came from
// the account that owns the shop in the Agent Registry, and pay exactly that price to the registered wallet.
// For the demo all shop agents run inside Viale's server, each with its own owner's key.
import crypto from 'node:crypto';
import { signMessage, type AccountTransactionSignature } from '@concordium/web-sdk';
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
