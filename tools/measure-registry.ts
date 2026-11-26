// Measures the problem Viale checks for: how many agents in Concordium's testnet Agent Registry are owned
// by a business identity (Global FinReg), and how many by a personal one. Reads only; needs no keys.
// Usage: node tools/measure-registry.ts   (writes evidence/registry-owners-<date>.json)
import fs from 'node:fs';
import path from 'node:path';
import { AccountAddress } from '@concordium/web-sdk';
import { client } from '../src/chain/chain.ts';
import { callTool } from '../src/registry/mcp.ts';

const grpc = client();
const business = new Set<number>();
const names = new Map<number, string>();
for await (const ip of grpc.getIdentityProviders()) {
  names.set(Number(ip.ipIdentity), ip.ipDescription.name);
  if (ip.ipDescription.name.includes('Global FinReg')) business.add(Number(ip.ipIdentity));
}

const agents: any[] = [];
let total = Infinity;
while (agents.length < total) {
  const r: any = await callTool('list_agents', { network: 'testnet', status: 'Active', limit: 100, offset: agents.length });
  total = r.total;
  if (!r.agents.length) break;
  agents.push(...r.agents);
}

const owners = new Map<string, { idps: number[]; agents: string[] }>();
for (const a of agents) {
  const o = owners.get(a.owner_account) ?? { idps: [], agents: [] };
  o.agents.push(String(a.token_id));
  owners.set(a.owner_account, o);
}
for (const [addr, o] of owners) {
  const info = await grpc.getAccountInfo(AccountAddress.fromBase58(addr));
  o.idps = [...new Set(Object.values(info.accountCredentials).map((c: any) => Number(c.value.contents.ipIdentity)))];
}

const isBusiness = (o: { idps: number[] }) => o.idps.some((i) => business.has(i));
const bizOwners = [...owners.values()].filter(isBusiness);
const bizAgents = bizOwners.reduce((n, o) => n + o.agents.length, 0);
const byIdp: Record<string, number> = {};
for (const o of owners.values()) for (const i of o.idps) byIdp[`${i} ${names.get(i) ?? ''}`.trim()] = (byIdp[`${i} ${names.get(i) ?? ''}`.trim()] ?? 0) + o.agents.length;

const date = new Date().toISOString().slice(0, 10);
const result = {
  what: 'Active agents in the CIS-8004 Agent Registry <12802,0> on testnet, by the identity behind their owner account',
  measured_at: new Date().toISOString(),
  script: 'tools/measure-registry.ts',
  active_agents: agents.length,
  owner_accounts: owners.size,
  agents_owned_by_business_identity: bizAgents,
  business_owner_accounts: bizOwners.length,
  agents_by_owner_identity_provider: byIdp,
};
fs.writeFileSync(path.join(import.meta.dirname, '..', 'evidence', `registry-owners-${date}.json`), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
