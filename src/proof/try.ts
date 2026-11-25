// Try the 18+ proof on its own, without the agent: starts the server, opens one request,
// prints the link, and waits for the Concordium ID app.
// Usage: node src/proof/try.ts [shop name]
import { startServer, PUBLIC_URL } from '../server/index.ts';
import { startAgeProof, waitForProof } from './age.ts';

const server = await startServer();
const p = startAgeProof('try', process.argv[2] ?? 'Test shop', Number(process.env.PROOF_TTL_MIN ?? 30));
console.log(`Open ${PUBLIC_URL}/prove/${p.id} and approve in the Concordium ID app (expires ${p.expiresAt})`);
const done = await waitForProof(p.id);
console.log('result:', done.state, done.error ?? '');
if (done.requestTx) console.log('request anchored: https://testnet.ccdexplorer.io/tx/' + done.requestTx);
if (done.verifyTx) console.log('result anchored:  https://testnet.ccdexplorer.io/tx/' + done.verifyTx);
server.close();
