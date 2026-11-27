// The errand agent's check on a shop before it trades with it:
//  1. the shop is a registered, Active agent in Concordium's Agent Registry (CIS-8004),
//  2. its Verified-by-Concordium badge is valid (card fetched, SHA-256 matches the on-chain anchor),
//  3. the account that owns it holds a BUSINESS identity (Global FinReg), not a personal one,
//  4. the card it serves names the same shop the agent was asked to visit,
//  5. it takes payment to its own registered wallet.
// Any failure = walk away, with the reason.
import { AccountAddress } from '@concordium/web-sdk';
import { client, withRetry } from '../chain/chain.ts';
import { agentOf, checkBadge } from '../registry/mcp.ts';

export const BUSINESS_IDP_NAME = 'Global FinReg';

export type ShopVerdict = {
  ok: boolean;
  tokenId: string;
  name?: string;
  owner?: string;
  payTo?: string;
  ageGated?: boolean; // the verified card sells something only for 18+
  badge?: string; // the agent's CIS-2 token address, which is also its Verified-by-Concordium badge id
  agentUri?: string;
  ownerIdentity?: { providers: { id: number; name: string }[]; business: boolean };
  payToIdentity?: { business: boolean }; // identity behind the agent wallet, when it is a separate account
  reasons: string[]; // why we refused (empty when ok)
  passed: string[]; // what we checked and saw pass
};

let idpNames: Promise<Map<number, string>> | undefined;
/** Every identity provider on the network, by id. */
export function identityProviderNames(): Promise<Map<number, string>> {
  idpNames ??= (async () => {
    const names = new Map<number, string>();
    await withRetry(async () => { for await (const ip of client().getIdentityProviders()) names.set(Number(ip.ipIdentity), ip.ipDescription.name); });
    return names;
  })();
  idpNames.catch(() => (idpNames = undefined)); // a failed load is retried on the next check
  return idpNames;
}
async function businessIdentityProviders(): Promise<Set<number>> {
  const names = await identityProviderNames();
  return new Set([...names].filter(([, n]) => n.includes(BUSINESS_IDP_NAME)).map(([id]) => id));
}

/** Fetches an agent card from the URL its owner registered. Any agent can register any URL, so only
 *  public https hosts, a 5 s timeout and 256 kB are allowed. */
export async function fetchCard(uri: string): Promise<any> {
  const u = new URL(uri);
  if (u.protocol !== 'https:') throw new Error('card URL is not https');
  if (/^(localhost|\[.*\]|[\d.]+)$/i.test(u.hostname) || u.hostname.endsWith('.internal') || u.hostname.endsWith('.local')) throw new Error('card URL is not a public host');
  const r = await fetch(u, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!r.ok) throw new Error(`card URL returned HTTP ${r.status}`);
  const text = await r.text();
  if (text.length > 256_000) throw new Error('card is too large');
  return JSON.parse(text);
}

/** Identity providers behind every credential on an account. */
export async function accountIdentityProviders(address: string): Promise<number[]> {
  const info = await withRetry(() => client().getAccountInfo(AccountAddress.fromBase58(address)));
  return Object.values(info.accountCredentials).map((c: any) => Number(c.value.contents.ipIdentity));
}

export async function checkShop(tokenId: string, expectedName?: string): Promise<ShopVerdict> {
  const v: ShopVerdict = { ok: false, tokenId, reasons: [], passed: [] };

  const agent = await agentOf(tokenId);
  if (!agent) return { ...v, reasons: [`no agent #${tokenId} in the registry`] };
  v.owner = agent.owner_account;
  v.badge = agent.token_address;
  v.agentUri = agent.agent_uri ?? undefined;
  if (agent.status !== 'Active') v.reasons.push(`agent #${tokenId} is ${agent.status}`);
  else v.passed.push(`agent #${tokenId} is registered and Active`);

  let badge = await checkBadge(agent.token_address);
  // Concordium's checker fetches the card itself; one failed fetch on its side is retried once.
  if (!badge.badge_valid && badge.checks.card_fetched === false) {
    await new Promise((r) => setTimeout(r, 1500));
    badge = await checkBadge(agent.token_address);
  }
  if (badge.badge_valid) v.passed.push('Verified-by-Concordium badge valid (card hash matches the chain)');
  else v.reasons.push(`badge invalid: ${badge.issues.map((i) => (typeof i === 'string' ? i : i.message)).join('; ') || 'failed checks ' + Object.entries(badge.checks).filter(([, x]) => x === false).map(([k]) => k).join(', ')}`);

  const idps = await accountIdentityProviders(agent.owner_account);
  const business = await businessIdentityProviders();
  const names = await identityProviderNames();
  v.ownerIdentity = { providers: [...new Set(idps)].map((id) => ({ id, name: names.get(id) ?? `provider ${id}` })), business: idps.some((i) => business.has(i)) };
  if (idps.some((i) => business.has(i))) v.passed.push(`owner ${agent.owner_account.slice(0, 6)}… holds a business identity (${BUSINESS_IDP_NAME})`);
  else v.reasons.push(`owner ${agent.owner_account.slice(0, 6)}… holds only a personal identity, not a business one`);

  if (agent.agent_uri && badge.badge_valid) {
    const card = await fetchCard(agent.agent_uri).catch((err) => ({ error: err.message }));
    if (card.error) v.reasons.push(`could not read the card: ${card.error}`);
    v.name = card.name;
    v.ageGated = (card.skills ?? []).some((k: any) => (k.tags ?? []).includes('age-gated'));
    if (expectedName && card.name !== expectedName) v.reasons.push(`card is "${card.name}", not "${expectedName}"`);
    else if (expectedName) v.passed.push(`card names "${card.name}"`);
  }

  v.payTo = agent.agent_wallet ?? agent.owner_account;
  if (agent.agent_wallet && agent.agent_wallet !== agent.owner_account) {
    // The wallet is a separate account with its own identity; say which kind, so a personal-ID till isn't hidden.
    const walletIdps = await accountIdentityProviders(agent.agent_wallet).catch(() => [] as number[]);
    v.payToIdentity = { business: walletIdps.some((i) => business.has(i)) };
    v.passed.push(`pays to its registered agent wallet ${agent.agent_wallet.slice(0, 6)}… (that account holds a ${v.payToIdentity.business ? 'business' : 'personal'} identity)`);
  }

  v.ok = v.reasons.length === 0;
  return v;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [tokenId, name] = process.argv.slice(2);
  const verdict = await checkShop(tokenId, name);
  for (const p of verdict.passed) console.log('  ✓', p);
  for (const r of verdict.reasons) console.log('  ✗', r);
  console.log(verdict.ok ? `TRADE with #${tokenId} (${verdict.name})` : `WALK AWAY from #${tokenId}`);
}
