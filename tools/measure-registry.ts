// Measures the problem Viale checks for: how many agents in Concordium's testnet Agent Registry are owned
// by a business identity (Global FinReg), and how many by a personal one. Reads only; needs no keys.
// Usage: node tools/measure-registry.ts   (writes evidence/registry-owners-<date>.json)
import fs from 'node:fs';
import path from 'node:path';
import { registryOwners } from '../src/registry/owners.ts';

const { business_agents, newest_agents, ...result } = await registryOwners();
const out = { ...result, script: 'tools/measure-registry.ts', business_agent_ids: business_agents.map((a) => a.token_id) };
const date = out.measured_at.slice(0, 10);
fs.writeFileSync(path.join(import.meta.dirname, '..', 'evidence', `registry-owners-${date}.json`), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
