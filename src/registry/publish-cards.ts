// Builds every registered shop's Agent Card via the registry MCP and writes the exact bytes to public/agents/.
// Usage: node src/registry/publish-cards.ts            (write cards, print hashes)
//        node src/registry/publish-cards.ts --pin      (also pin URL + hash on chain, after the site is deployed)
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SHOPS, cardUrl } from '../street/shops.ts';
import { buildCard, setCard } from './register.ts';
import { agentOf } from './mcp.ts';
import { sponsorWallet, type Wallet } from '../../spike/keys.ts';

const pin = process.argv.includes('--pin');
const walletFor = (owner: string): Wallet => {
  const w = sponsorWallet();
  if (w.address.address === owner) return w;
  throw new Error(`no signer wired for owner ${owner}`);
};

fs.mkdirSync('public/agents', { recursive: true });
for (const shop of SHOPS.filter((s) => s.tokenId)) {
  const url = cardUrl(shop.tokenId!);
  const card = await buildCard(shop.owner, shop.tokenId!, url, shop.name, shop.description, shop.skills);
  const local = crypto.createHash('sha256').update(card.json).digest('hex');
  if (local !== card.sha256) throw new Error(`hash mismatch for ${shop.slug}`);
  fs.writeFileSync(`public/agents/${shop.tokenId}.json`, card.json);
  console.log(`${shop.slug} #${shop.tokenId} -> ${url} sha256=${card.sha256}`);
  if (pin) {
    const served = await (await fetch(url, { cache: 'no-store' })).text();
    const servedHash = crypto.createHash('sha256').update(served).digest('hex');
    if (servedHash !== card.sha256) throw new Error(`served card differs from built card for ${shop.slug}; deploy first`);
    const onChain = await agentOf(shop.tokenId!);
    if (onChain?.metadata_hash_hex === card.sha256 && onChain.agent_uri === url) { console.log('  already pinned'); continue; }
    const tx = await setCard(walletFor(shop.owner), shop.tokenId!, url, card.sha256);
    console.log(`  pinned on chain: https://ccdexplorer.io/testnet/transaction/${tx}`);
  }
}
