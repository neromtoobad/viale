// Open a shop: an outside business puts its own shop agent on Viale's street with its own Concordium wallet.
//   1. register  Viale asks the Registry MCP to build the CIS-8004 `register` call for the owner's account; the
//                owner's wallet signs and sends it (Viale holds no key for it). Viale then reads the finalized
//                transaction: sent by that owner, to the registry, a token minted, and the registry says they own it.
//   2. price list The owner signs their menu once in the wallet (account message signature). Quotes for this
//                shop carry that signed list, so an agent checks every price against the OWNER's keys on chain.
//   3. card      Viale builds the shop's A2A card with the Concordium badge (Registry MCP build_agent_card) and
//                hosts its exact bytes at /agents/<id>.json; the owner's wallet pins the URL + SHA-256 on chain.
// After that the shop is checked like any other: an owner with only a personal identity gets "walk away".
// Payments go to the owner's account (or the agent wallet the registry holds); EUDemo has an allow-list, so a
// payment to an account the token issuer hasn't listed fails at settlement and the errand logs that.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AccountAddress, ContractAddress, getEmbeddedModuleSchema, ContractName, EntrypointName, TransactionHash, verifyMessageSignature, type AccountTransactionSignature } from '@concordium/web-sdk';
import { getUpdateContractParameterSchema, deserializeTypeValue } from '@concordium/web-sdk/schema';
import { client, withRetry } from '../chain/chain.ts';
import { callTool, agentOf } from '../registry/mcp.ts';
import { buildCard, mintedTokenId } from '../registry/register.ts';
import { SITE } from './shops.ts';
import type { Item } from './catalog.ts';

const REGISTRY = { index: 12802, subindex: 0 };
const DIR = path.resolve(import.meta.dirname, '../../data/shops');
export const MAX_OPEN_SHOPS = 25;
export const MAX_PRICE_EUR = 3;
const PRICE_LIST_DAYS = 30;

export type PriceList = {
  v: 1; kind: 'viale-pricelist'; owner: string; token_id: string; name: string; description: string;
  items: { sku: string; name: string; price_eur: number }[]; pay_to: string; issued_at: string; expires_at: string;
};
export type SignedPriceList = { message: string; signature: AccountTransactionSignature };
type Saved = { token_id: string; owner: string; status: 'registered' | 'card' | 'live'; register_tx: string; created_at: string; pricelist?: SignedPriceList; card_sha256?: string; uri_tx?: string; live_at?: string };

const file = (id: string, ext = 'json') => path.join(DIR, `${id}.${ext}`);
function load(id: string): Saved | undefined { try { return JSON.parse(fs.readFileSync(file(id), 'utf8')); } catch { return undefined; } }
function save(s: Saved) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(file(s.token_id), JSON.stringify(s, null, 2)); }
function all(): Saved[] {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter((f) => /^\d+\.json$/.test(f)).flatMap((f) => { try { return [JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))]; } catch { return []; } });
}
const plain = (v: any) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? (x <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(x) : x.toString()) : x)));
const isAccount = (a: unknown) => { try { AccountAddress.fromBase58(String(a)); return true; } catch { return false; } };

export const priceList = (id: string): PriceList | undefined => { const s = load(id); return s?.pricelist ? JSON.parse(s.pricelist.message) : undefined; };
export const signedPriceList = (id: string) => load(id)?.pricelist;
/** Shops opened by their owners that finished all three steps. */
export const liveOpenShops = () => all().filter((s) => s.status === 'live');
/** The hosted card's exact bytes (their SHA-256 is pinned on chain). */
export const cardBytes = (id: string) => { try { return fs.readFileSync(file(id, 'card.json')); } catch { return undefined; } };
export function openMenu(id: string): Item[] | undefined {
  const s = load(id);
  if (s?.status !== 'live' || !s.pricelist) return;
  return (JSON.parse(s.pricelist.message) as PriceList).items.map((i) => ({ sku: i.sku, name: i.name, priceEur: i.price_eur }));
}

// The registry's schema for an entrypoint's parameter, so the browser wallet can show and sign the call.
let moduleSchema: Promise<any> | undefined;
async function parameterForWallet(receiveName: string, hex: string) {
  moduleSchema ??= (async () => {
    const g = client();
    const inst: any = await withRetry(() => g.getInstanceInfo(ContractAddress.create(REGISTRY.index, REGISTRY.subindex)));
    return getEmbeddedModuleSchema(await withRetry(() => g.getModuleSource(inst.sourceModule)) as any);
  })();
  moduleSchema.catch(() => (moduleSchema = undefined));
  const schema = await moduleSchema;
  const [contract, entry] = receiveName.split('.');
  const ts = getUpdateContractParameterSchema(schema.buffer, ContractName.fromString(contract), EntrypointName.fromString(entry), schema.version);
  const ab = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
  return { json: plain(deserializeTypeValue(ab(Buffer.from(hex, 'hex')), ab(ts))), schema_b64: Buffer.from(ts).toString('base64') };
}
type Built = { contract_address: { index: number; subindex: number }; receive_name: string; parameter_hex: string; suggested_energy: number };
async function forWallet(b: Built) {
  return { contract: b.contract_address, receive_name: b.receive_name, parameter_hex: b.parameter_hex, energy: b.suggested_energy, ...(await parameterForWallet(b.receive_name, b.parameter_hex)) };
}

/** Step 1a: the registry call for the owner's wallet to sign and send. */
export async function registerCall(owner: unknown) {
  if (!isAccount(owner)) return { error: 'Connect a Concordium testnet account first.' };
  if (all().length >= MAX_OPEN_SHOPS) return { error: 'This demo street is full. Try again later.' };
  return forWallet(await callTool<Built>('build_register', { sender: String(owner) }));
}

/** Reads a finalized contract update and checks it was the owner's call to the registry. */
async function ownerCall(tx: unknown, owner: string, entry: string) {
  if (typeof tx !== 'string' || !/^[0-9a-f]{64}$/.test(tx)) throw new Error('Not a transaction hash.');
  const g = client();
  const out: any = await withRetry(() => g.waitForTransactionFinalization(TransactionHash.fromHexString(tx), 120_000) as any);
  const s = out.summary;
  if (s.transactionType === 'failed' || s.rejectReason) throw new Error('The transaction was rejected on chain.');
  if (String(s.sender?.address ?? s.sender) !== owner) throw new Error('That transaction was sent by another account.');
  const ev = (s.events ?? [])[0];
  const addr = ev?.address;
  if (!addr || Number(addr.index) !== REGISTRY.index || Number(addr.subindex) !== REGISTRY.subindex || !String(ev.receiveName?.value ?? ev.receiveName).endsWith(`.${entry}`)) throw new Error(`That transaction is not a ${entry} call to the Agent Registry.`);
  return s;
}

/** Step 1b: the owner's registration finalized. Viale reads the minted token id and the registry record. */
export async function registered(owner: unknown, tx: unknown) {
  if (!isAccount(owner)) return { error: 'Missing owner account.' };
  const s = await ownerCall(tx, String(owner), 'register');
  const tokenId = mintedTokenId(s);
  if (!tokenId) return { error: 'No agent was minted by that transaction.' };
  const rec = await agentOf(tokenId);
  if (rec?.owner_account !== owner) return { error: `The registry does not list ${String(owner).slice(0, 6)}… as the owner of #${tokenId}.` };
  if (!load(tokenId)) save({ token_id: tokenId, owner: String(owner), status: 'registered', register_tx: String(tx), created_at: new Date().toISOString() });
  return { token_id: tokenId, register_tx: tx };
}

/** Step 2a: the price list the owner signs, checked and written by Viale so its fields are well-formed. */
export async function priceListDraft(input: any) {
  const id = String(input?.token_id ?? '');
  const saved = load(id);
  if (!saved || saved.owner !== input?.owner) return { error: 'Register the agent first, from the same account.' };
  const name = String(input?.name ?? '').trim().slice(0, 40);
  const description = String(input?.description ?? '').trim().slice(0, 200);
  if (name.length < 2) return { error: 'Give the shop a name.' };
  const raw: any[] = Array.isArray(input?.items) ? input.items.slice(0, 5) : [];
  const items = raw.map((i, n) => ({ sku: `${String(i?.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'item'}-${n + 1}`, name: String(i?.name ?? '').trim().slice(0, 40), price_eur: Math.round(Number(i?.price_eur) * 100) / 100 }));
  if (!items.length || items.some((i) => !i.name || !(i.price_eur >= 0.1 && i.price_eur <= MAX_PRICE_EUR))) return { error: `Add 1 to 5 items, each with a name and a price from €0.10 to €${MAX_PRICE_EUR}.` };
  const rec = await agentOf(id);
  if (rec?.owner_account !== saved.owner) return { error: 'The registry no longer lists you as the owner.' };
  const now = new Date();
  const terms: PriceList = { v: 1, kind: 'viale-pricelist', owner: saved.owner, token_id: id, name, description, items, pay_to: rec.agent_wallet ?? saved.owner, issued_at: now.toISOString(), expires_at: new Date(now.getTime() + PRICE_LIST_DAYS * 86400_000).toISOString() };
  return { message: JSON.stringify(terms) };
}

/** Checks a signed price list against the owner's keys on chain and the registry record. */
export async function priceListProblems(signed: SignedPriceList | undefined, tokenId: string, now = new Date()): Promise<string[]> {
  let t: PriceList;
  try { t = JSON.parse(String(signed?.message)); } catch { return ['price list is not readable']; }
  const r: string[] = [];
  if (t.v !== 1 || t.kind !== 'viale-pricelist') r.push('not a Viale price list');
  if (t.token_id !== tokenId) r.push(`price list is for #${t.token_id}, not #${tokenId}`);
  if (!(new Date(t.expires_at) > now)) r.push(`price list expired at ${t.expires_at}`);
  const rec = await agentOf(tokenId);
  if (!rec || rec.owner_account !== t.owner) r.push("price list owner is not the agent's owner in the registry");
  if (rec && t.pay_to !== (rec.agent_wallet ?? rec.owner_account)) r.push("price list pays to a wallet the registry doesn't hold for this agent");
  const info = await withRetry(() => client().getAccountInfo(AccountAddress.fromBase58(t.owner)));
  if (!(await verifyMessageSignature(signed!.message, signed!.signature, info).catch(() => false))) r.unshift("price list signature does not match the owner's keys on chain");
  return r;
}

/** Step 2b + 3a: keep the signed price list, build and host the card, return the pin-the-card call for the wallet. */
export async function publish(input: any) {
  const id = String(input?.token_id ?? '');
  const saved = load(id);
  if (!saved) return { error: 'Register the agent first.' };
  const signed: SignedPriceList = { message: String(input?.pricelist?.message ?? ''), signature: input?.pricelist?.signature };
  const problems = await priceListProblems(signed, id);
  if (problems.length) return { error: problems.join('; ') };
  const t: PriceList = JSON.parse(signed.message);
  const uri = `${SITE}/agents/${id}.json`;
  const card = await buildCard(saved.owner, id, uri, t.name, t.description || `${t.name}, a shop on Viale.`, [{ id: 'sell', name: 'Sell from the menu', description: `Quote and sell: ${t.items.map((i) => i.name).join(', ')}. Prices are signed by the owner in a price list.`, tags: ['shop'] }], t.pay_to !== saved.owner ? t.pay_to : undefined);
  fs.writeFileSync(file(id, 'card.json'), card.json);
  const sha = crypto.createHash('sha256').update(card.json).digest('hex');
  if (sha !== card.sha256) return { error: 'The card hash did not match what the registry tool returned.' };
  save({ ...saved, status: saved.status === 'live' ? 'live' : 'card', pricelist: signed, card_sha256: sha });
  const call = await forWallet(await callTool<Built>('build_set_agent_uri', { token_id: id, agent_uri: uri, metadata_hash_hex: sha, sender: saved.owner }));
  return { card_url: uri, card_sha256: sha, call };
}

/** Step 3b: the owner pinned the card. The shop goes live on the street. */
export async function finish(input: any) {
  const id = String(input?.token_id ?? '');
  const saved = load(id);
  if (!saved?.pricelist || !saved.card_sha256) return { error: 'Sign the price list first.' };
  await ownerCall(input?.tx, saved.owner, 'set_agent_uri');
  save({ ...saved, status: 'live', uri_tx: String(input.tx), live_at: new Date().toISOString() });
  return { token_id: id, live: true };
}

/** Where a visitor's open-a-shop flow stands (to resume after a reload). */
export function progress(owner: string) {
  return all().filter((s) => s.owner === owner).map(({ token_id, status, register_tx, uri_tx, created_at }) => ({ token_id, status, register_tx, uri_tx, created_at }));
}
