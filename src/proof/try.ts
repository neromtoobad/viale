// Try the 18+ proof on its own, without the agent: starts the server, opens one request, prints the link,
// and waits for the Concordium Browser Wallet or ID app. A verified wallet proof is saved to evidence/, so
// anyone can re-check it (src/proof/age.test.ts does).
// Usage: node src/proof/try.ts [shop name]
import fs from 'node:fs';
import path from 'node:path';
import { startServer, PUBLIC_URL } from '../server/index.ts';
import { proofRecord, startAgeProof, waitForProof } from './age.ts';

const server = await startServer();
const p = startAgeProof('try', process.argv[2] ?? 'Test shop', Number(process.env.PROOF_TTL_MIN ?? 30), { human: process.env.PROOF_HUMAN });
console.log(`Open ${PUBLIC_URL}/prove/${p.id} and approve in your Concordium wallet (expires ${p.expiresAt})`);
const done = await waitForProof(p.id);
console.log('result:', done.state, done.error ?? '', done.proved?.account ?? '');
if (done.requestTx) console.log('request anchored: https://testnet.ccdexplorer.io/tx/' + done.requestTx);
if (done.verifyTx) console.log('result anchored:  https://testnet.ccdexplorer.io/tx/' + done.verifyTx);
if (done.state === 'verified' && done.proved?.by === 'wallet') {
  const f = path.resolve(import.meta.dirname, `../../evidence/age-proof-wallet-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(f, JSON.stringify({ what: '18+ proof from the Concordium Browser Wallet, checked by src/proof/age.ts', id: done.id, shop_token_id: done.shopTokenId, expires_at: done.expiresAt, ...proofRecord(done) }, null, 2) + '\n');
  console.log('saved', path.relative(process.cwd(), f));
}
server.close();
process.exit(0);
