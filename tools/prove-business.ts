// Publishes a business-name proof for each of our shops (#1526, #1527): a zero-knowledge presentation from the
// owner's Global FinReg business credential that reveals its legal name, country, registration authority and business number, made for
// a challenge naming the agent and its owner (src/identity/business-proof.ts). It is written next to the agent
// card, at public/agents/<id>.business.json, where the shop check looks for it, and checked before it is kept.
//
// Needs the owner's seed and identity object in ~/.viale-keys (made by src/identity/business-id.ts).
// Usage: node tools/prove-business.ts [tokenId ...]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mnemonicToSeedSync } from '@scure/bip39';
import { proveBusiness, verifyBusinessProof } from '../src/identity/business-proof.ts';
import { SHOPS } from '../src/street/shops.ts';

const KEYS = process.env.VIALE_KEYS_DIR ?? path.join(os.homedir(), '.viale-keys');
const ROOT = path.resolve(import.meta.dirname, '..');
const state = JSON.parse(fs.readFileSync(path.join(KEYS, 'shop-identity.json'), 'utf8'));
const shop = JSON.parse(fs.readFileSync(path.join(KEYS, 'shop.json'), 'utf8'));
const seedHex = Buffer.from(mnemonicToSeedSync(fs.readFileSync(path.join(KEYS, 'shop-seed.txt'), 'utf8').trim())).toString('hex');
const attributes = (state.identityObject.value ?? state.identityObject).attributeList;

const ids = process.argv.slice(2).length ? process.argv.slice(2) : SHOPS.filter((s) => s.owner === shop.address).map((s) => String(s.tokenId));
for (const tokenId of ids) {
  const p = await proveBusiness({ tokenId, owner: shop.address, seedHex, identityProvider: shop.ipIdentity, identityIndex: 0, credIndex: 0, attributes });
  const json = p.toString();
  const check = await verifyBusinessProof(json, tokenId, shop.address);
  if (!check.ok) throw new Error(`#${tokenId}: the proof we just made does not verify: ${check.reason}`);
  fs.writeFileSync(path.join(ROOT, 'public/agents', `${tokenId}.business.json`), JSON.stringify(JSON.parse(json), null, 2) + '\n');
  console.log(`#${tokenId}: proves ${check.business.legal_name} (${check.business.country}, ${check.business.registration_authority})`);
}
