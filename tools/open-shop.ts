// Opens a shop through Viale's public /open flow, as an outside owner would, but signing with a key file
// instead of the browser wallet. Every step goes over HTTP to the site; nothing reaches into the server.
// It checks that the JSON + schema the site hands the wallet serialize to the exact parameter bytes the
// Registry MCP built, so the browser wallet signs the same call this script sends.
// Usage: OWNER_KEY_FILE=~/.viale-keys/till-key.txt OWNER=<address> node tools/open-shop.ts [site]
// Writes evidence/open-shop-<token>.json.
import fs from 'node:fs';
import path from 'node:path';
import { AccountAddress, CcdAmount, ContractAddress, Energy, Parameter, ReceiveName, Transaction, TransactionHash, buildBasicAccountSigner, signMessage } from '@concordium/web-sdk';
import { serializeTypeValue } from '@concordium/web-sdk/schema';
import { client, txUrl } from '../src/chain/chain.ts';

const SITE = process.argv[2] ?? 'https://viale.nerom.site';
const OWNER = process.env.OWNER!;
const KEY = fs.readFileSync(String(process.env.OWNER_KEY_FILE).replace(/^~/, process.env.HOME!), 'utf8').trim();
if (!OWNER || !/^[0-9a-f]{64}$/.test(KEY)) throw new Error('set OWNER and OWNER_KEY_FILE (64 hex chars)');
const signer = buildBasicAccountSigner(KEY);
const owner = AccountAddress.fromBase58(OWNER);
const grpc = client();

async function post(step: string, b: unknown) {
  const r = await fetch(`${SITE}/api/open/${step}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${step}: ${j.error}`);
  console.log(`ok  ${step}`);
  return j;
}

/** Sends the call as the wallet would: from the JSON + schema, after checking they match the built bytes. */
async function send(call: any) {
  const bytes = Buffer.from(serializeTypeValue(call.json, Buffer.from(call.schema_b64, 'base64')).buffer).toString('hex');
  if (bytes !== call.parameter_hex) throw new Error(`wallet JSON serializes to ${bytes}, not ${call.parameter_hex}`);
  const { nonce } = await grpc.getNextAccountNonce(owner);
  const tx = Transaction.updateContract({ amount: CcdAmount.zero(), address: ContractAddress.create(call.contract.index, call.contract.subindex), receiveName: ReceiveName.fromString(call.receive_name), message: Parameter.fromHexString(bytes) }, Energy.create(call.energy))
    .addMetadata({ sender: owner, nonce }).build();
  const hash = TransactionHash.toHexString(await grpc.sendTransaction(await Transaction.signAndFinalize(tx, signer)));
  console.log(`    sent ${call.receive_name}: ${txUrl(hash)}`);
  return hash;
}

const reg = await post('register', { owner: OWNER });
const regTx = await send(reg);
const { token_id } = await post('registered', { owner: OWNER, tx: regTx });
console.log(`    agent #${token_id}`);
const { message } = await post('pricelist', { owner: OWNER, token_id, name: 'Corner Kiosk', description: 'Opened through the /open flow by an account with a personal identity only.', items: [{ name: 'Newspaper', price_eur: 0.5 }, { name: 'Gum', price_eur: 0.3 }] });
const signature = await signMessage(owner, message, signer);
const pub = await post('publish', { token_id, pricelist: { message, signature } });
const uriTx = await send(pub.call);
await post('finish', { token_id, tx: uriTx });
const out = { site: SITE, owner: OWNER, token_id, register_tx: regTx, set_agent_uri_tx: uriTx, card_url: pub.card_url, card_sha256: pub.card_sha256, price_list: { message, signature }, at: new Date().toISOString() };
const f = path.resolve(import.meta.dirname, `../evidence/open-shop-${token_id}.json`);
fs.writeFileSync(f, JSON.stringify(out, null, 2));
console.log(`wrote ${path.relative(process.cwd(), f)}\nshop page: ${SITE}/shops/${token_id}`);
