// Measures the problem Viale checks for: how many agents in Concordium's testnet Agent Registry are owned
// by a business identity (Global FinReg), and how many by a personal one. Reads only; needs no keys.
// Usage: node tools/measure-registry.ts   (writes evidence/registry-owners-<date>.json; the /check page
//        shows the newest of these until the server's own count finishes)
import fs from 'node:fs';
import path from 'node:path';
import { registryOwners } from '../src/registry/owners.ts';

const out = { ...(await registryOwners()), script: 'tools/measure-registry.ts' };
const date = out.measured_at.slice(0, 10);
fs.writeFileSync(path.join(import.meta.dirname, '..', 'evidence', `registry-owners-${date}.json`), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
