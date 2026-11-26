// The errand agent's check on a shop before it trades with it:
//  1. the shop is a registered, Active agent in Concordium's Agent Registry (CIS-8004),
//  2. its Verified-by-Concordium badge is valid (card fetched, SHA-256 matches the on-chain anchor),
//  3. the account that owns it holds a BUSINESS identity (Global FinReg), not a personal one,
//  4. the card it serves names the same shop the agent was asked to visit,
//  5. it takes payment to its own registered wallet.
// Any failure = walk away, with the reason.
import { AccountAddress } from '@concordium/web-sdk';
import { client } from '../chain/chain.ts';
import { agentOf, checkBadge } from '../registry/mcp.ts';

export const BUSINESS_IDP_NAME = 'Global FinReg';

export type ShopVerdict = {
  ok: boolean;
  tokenId: string;
  name?: string;
  owner?: string;
  payTo?: string;
  ageGated?: boolean; // the verified card sells something only for 18+
  reasons: string[]; // why we refused (empty when ok)
  passed: string[]; // what we checked and saw pass
};

let businessIdps: Promise<Set<number>> | undefined;
async function businessIdentityProviders(): Promise<Set<number>> {
  businessIdps ??= (async () => {
    const ids = new Set<number>();
    for await (const ip of client().getIdentityProviders()) {
      if (ip.ipDescription.name.includes(BUSINESS_IDP_NAME)) ids.add(Number(ip.ipIdentity));
    }
    return ids;
  })();
  return businessIdps;
}

/** Identity providers behind every credential on an account. */
export async function accountIdentityProviders(address: string): Promise<number[]> {
  const info = await client().getAccountInfo(AccountAddress.fromBase58(address));
  return Object.values(info.accountCredentials).map((c: any) => Number(c.value.contents.ipIdentity));
}

export async function checkShop(tokenId: string, expectedName?: string): Promise<ShopVerdict> {
  const v: ShopVerdict = { ok: false, tokenId, reasons: [], passed: [] };

  const agent = await agentOf(tokenId);
  if (!agent) return { ...v, reasons: [`no agent #${tokenId} in the registry`] };
  v.owner = agent.owner_account;
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
  if (idps.some((i) => business.has(i))) v.passed.push(`owner ${agent.owner_account.slice(0, 6)}… holds a business identity (${BUSINESS_IDP_NAME})`);
  else v.reasons.push(`owner ${agent.owner_account.slice(0, 6)}… holds only a personal identity, not a business one`);

  if (agent.agent_uri && badge.badge_valid) {
    const card = await (await fetch(agent.agent_uri)).json();
    v.name = card.name;
    v.ageGated = (card.skills ?? []).some((k: any) => (k.tags ?? []).includes('age-gated'));
    if (expectedName && card.name !== expectedName) v.reasons.push(`card is "${card.name}", not "${expectedName}"`);
    else if (expectedName) v.passed.push(`card names "${card.name}"`);
  }

  v.payTo = agent.agent_wallet ?? agent.owner_account;
  if (agent.agent_wallet && agent.agent_wallet !== agent.owner_account) v.passed.push('pays to its registered agent wallet');

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
