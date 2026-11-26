// Who owns the agents in Concordium's Agent Registry: every Active agent on testnet, grouped by the
// identity provider behind its owner account. Read-only; needs no keys.
import { AccountAddress } from '@concordium/web-sdk';
import { client, withRetry } from '../chain/chain.ts';
import { identityProviderNames, BUSINESS_IDP_NAME } from '../errand/shop-check.ts';
import { callTool } from './mcp.ts';

export type RegistryOwners = {
  what: string;
  measured_at: string;
  active_agents: number;
  owner_accounts: number;
  agents_owned_by_business_identity: number;
  business_owner_accounts: number;
  agents_by_owner_identity_provider: Record<string, number>;
  business_agents: { token_id: string; owner: string; agent_uri: string | null }[];
  newest_agents: { token_id: string; owner: string; agent_uri: string | null; business: boolean }[];
};

export async function registryOwners(): Promise<RegistryOwners> {
  const grpc = client();
  const names = await identityProviderNames();
  const business = new Set([...names].filter(([, n]) => n.includes(BUSINESS_IDP_NAME)).map(([id]) => id));

  const agents: any[] = [];
  let total = Infinity;
  while (agents.length < total) {
    const r: any = await callTool('list_agents', { network: 'testnet', status: 'Active', limit: 100, offset: agents.length });
    total = r.total;
    if (!r.agents?.length) break;
    agents.push(...r.agents);
  }

  const owners = new Map<string, number[]>();
  for (const a of agents) owners.set(a.owner_account, []);
  // The public testnet node rate-limits (HTTP 429) and errands share it, so one lookup at a time, spaced out.
  for (const addr of owners.keys()) {
    const info: any = await withRetry(() => grpc.getAccountInfo(AccountAddress.fromBase58(addr)));
    owners.set(addr, [...new Set(Object.values(info.accountCredentials).map((c: any) => Number(c.value.contents.ipIdentity)))]);
    await new Promise((r) => setTimeout(r, 150));
  }
  const isBusiness = (addr: string) => owners.get(addr)!.some((i) => business.has(i));

  const byIdp: Record<string, number> = {};
  for (const a of agents) for (const i of owners.get(a.owner_account)!) {
    const k = `${i} ${names.get(i) ?? ''}`.trim();
    byIdp[k] = (byIdp[k] ?? 0) + 1;
  }
  const short = (a: any) => ({ token_id: String(a.token_id), owner: a.owner_account, agent_uri: a.agent_uri ?? null });
  const bizAgents = agents.filter((a) => isBusiness(a.owner_account));
  return {
    what: 'Active agents in the CIS-8004 Agent Registry <12802,0> on testnet, by the identity behind their owner account',
    measured_at: new Date().toISOString(),
    active_agents: agents.length,
    owner_accounts: owners.size,
    agents_owned_by_business_identity: bizAgents.length,
    business_owner_accounts: [...owners.keys()].filter(isBusiness).length,
    agents_by_owner_identity_provider: byIdp,
    business_agents: bizAgents.map(short),
    newest_agents: [...agents].sort((a, b) => Number(b.token_id) - Number(a.token_id)).slice(0, 12).map((a) => ({ ...short(a), business: isBusiness(a.owner_account) })),
  };
}
