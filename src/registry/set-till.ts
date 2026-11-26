// Points a shop's payments at its till: the CIS-8004 agent wallet. The shop owner holds a business
// identity, but test euros (EUDemo) can only be paid to accounts on the token's EU allow-list, so
// each honest shop takes payment at an allow-listed till account instead.
// The till's own key signs the registry's canonical message, so nobody can point a shop at a wallet
// they don't control; the shop owner then submits the update.
// Usage: node src/registry/set-till.ts <tokenId> [<tokenId> …]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as ed from '@noble/ed25519';
import { callTool, agentOf } from './mcp.ts';
import { submit } from './register.ts';
import { shopOwnerWallet } from '../chain/keys.ts';
import { txUrl } from '../chain/chain.ts';

export const TILL = '3HNiUGKvauG2NZXSabcsQ5eaYRbtqWYfYVUkGtzxJ37kfj64ji';
const tillKey = () =>
  fs.readFileSync(path.join(process.env.VIALE_KEYS_DIR ?? path.join(os.homedir(), '.viale-keys'), 'till-key.txt'), 'utf8').trim().replace(/^0x/, '');

const owner = shopOwnerWallet();
for (const tokenId of process.argv.slice(2)) {
  if ((await agentOf(tokenId))?.agent_wallet === TILL) { console.log(`#${tokenId} already pays to the till`); continue; }
  const deadline = Date.now() + 15 * 60_000;
  const msg = await callTool<{ bytes_hex: string }>('set_agent_wallet_canonical_bytes', { token_id: tokenId, new_wallet: TILL, deadline_unix_ms: deadline });
  const signature = Buffer.from(await ed.signAsync(Buffer.from(msg.bytes_hex, 'hex'), Buffer.from(tillKey(), 'hex'))).toString('hex');
  const built = await callTool('build_set_agent_wallet', { token_id: tokenId, new_wallet: TILL, deadline_unix_ms: deadline, signature_hex: signature, sender: owner.address.address });
  const { hash } = await submit(owner, built);
  console.log(`#${tokenId} now pays to till ${TILL.slice(0, 6)}…: ${txUrl(hash)}`);
}
