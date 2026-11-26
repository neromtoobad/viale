// Gets a BUSINESS identity from Global FinReg (Concordium's company identity provider on testnet)
// for a new shop-owner wallet, then opens an account on it. This is what lets an honest shop pass
// the "owner holds a business identity" check in src/errand/shop-check.ts.
//
// It does in code what the Concordium wallet does when you add an identity:
//   1. make a fresh seed phrase for the shop owner (kept in ~/.viale-keys, never in the repo),
//   2. build an identity request from that seed and send the human to Global FinReg's page,
//   3. Global FinReg redirects back to a local page with a link to the finished identity,
//   4. from that identity, deploy a credential on chain, which opens the shop owner's account.
//
// Usage: node src/identity/business-id.ts start    (prints the Global FinReg link, waits for the redirect)
//        node src/identity/business-id.ts finish   (polls the identity, opens the account)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { generateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import {
  ConcordiumHdWallet,
  createIdentityRequest,
  createCredentialPayload,
  signCredentialTransaction,
  serializeCredentialDeploymentPayload,
  getAccountAddress,
  TransactionExpiry,
} from '@concordium/web-sdk';
import { client } from '../chain/chain.ts';

const KEYS = process.env.VIALE_KEYS_DIR ?? path.join(os.homedir(), '.viale-keys');
const SEED_FILE = path.join(KEYS, 'shop-seed.txt');
const STATE_FILE = path.join(KEYS, 'shop-identity.json');
const SHOP_FILE = path.join(KEYS, 'shop.json');
const WALLET_PROXY = 'https://wallet-proxy.testnet.concordium.com';
const PROVIDER = 'Global FinReg';
const PORT = Number(process.env.IDP_CALLBACK_PORT ?? 3004);
const REDIRECT = `http://localhost:${PORT}/idp-callback`;

type State = { codeUri?: string; identityObject?: any; address?: string };
const readState = (): State => (fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {});
const writeState = (s: State) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), { mode: 0o600 });

function seedPhrase(): string {
  if (!fs.existsSync(SEED_FILE)) fs.writeFileSync(SEED_FILE, generateMnemonic(wordlist, 256) + '\n', { mode: 0o600 });
  return fs.readFileSync(SEED_FILE, 'utf8').trim();
}
const seedHex = () => Buffer.from(mnemonicToSeedSync(seedPhrase())).toString('hex');

async function provider() {
  const all: any[] = await (await fetch(`${WALLET_PROXY}/v2/ip_info`)).json();
  const p = all.find((x) => x.ipInfo.ipDescription.name.includes(PROVIDER));
  if (!p) throw new Error(`${PROVIDER} is not listed by the testnet wallet proxy`);
  return p as { ipInfo: any; arsInfos: Record<string, any>; metadata: { issuanceStart: string } };
}

async function start() {
  const p = await provider();
  const globalContext = await client().getCryptographicParameters();
  const idObjectRequest = createIdentityRequest({
    ipInfo: p.ipInfo,
    arsInfos: p.arsInfos,
    globalContext,
    seed: seedHex(),
    net: 'Testnet',
    identityIndex: 0,
    arThreshold: Math.min(Object.keys(p.arsInfos).length - 1, 255),
  });
  const params = new URLSearchParams({
    scope: 'identity',
    response_type: 'code',
    redirect_uri: REDIRECT,
    state: JSON.stringify({ idObjectRequest }),
  });
  const res = await fetch(`${p.metadata.issuanceStart}?${params}`);
  const url = res.redirected ? res.url : `${p.metadata.issuanceStart}?${params}`;
  if (!res.ok) throw new Error(`${PROVIDER} answered ${res.status}: ${(await res.text()).slice(0, 300)}`);

  // Global FinReg sends the browser back to REDIRECT#code_uri=…; a fragment never reaches a server,
  // so the page reads it and posts it back here.
  const server = http.createServer((req, rsp) => {
    if (req.method === 'POST' && req.url === '/idp-callback/save') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const hash = new URLSearchParams(body.replace(/^#/, ''));
        const codeUri = hash.get('code_uri');
        const error = hash.get('error');
        rsp.end(codeUri ? 'ok' : 'missing');
        if (codeUri) {
          writeState({ ...readState(), codeUri });
          console.log(`identity on its way: ${codeUri}`);
          server.close();
        } else console.log(`provider returned: ${body}`, error ?? '');
      });
      return;
    }
    rsp.setHeader('content-type', 'text/html');
    rsp.end(`<!doctype html><meta charset="utf-8"><title>Viale · business ID</title>
<body style="font:16px system-ui;padding:40px"><p id="m">Saving your business identity…</p>
<script>fetch('/idp-callback/save',{method:'POST',body:location.hash||location.search}).then(r=>r.text()).then(t=>{document.getElementById('m').textContent=t==='ok'?'Done. You can close this tab.':'Global FinReg did not return an identity: '+decodeURIComponent(location.hash||location.search)})</script>`);
  });
  server.listen(PORT, () => {
    console.log(`Open this link and complete Global FinReg's steps:\n${url}`);
  });
}

async function finish() {
  const s = readState();
  if (!s.codeUri) throw new Error('no identity link saved yet: run `start` and complete Global FinReg first');
  if (!s.identityObject) {
    for (;;) {
      const r: any = await (await fetch(s.codeUri)).json();
      if (r.status === 'done') { s.identityObject = r.token.identityObject.value; writeState(s); break; }
      if (r.status === 'error') throw new Error(`${PROVIDER} refused the identity: ${r.detail}`);
      console.log('identity still pending…');
      await new Promise((ok) => setTimeout(ok, 10_000));
    }
  }
  const p = await provider();
  const grpc = client();
  const globalContext = await grpc.getCryptographicParameters();
  const expiry = TransactionExpiry.futureMinutes(10);
  const credNumber = 0;
  const payload = createCredentialPayload(
    {
      ipInfo: p.ipInfo,
      arsInfos: p.arsInfos,
      globalContext,
      idObject: s.identityObject,
      revealedAttributes: [],
      seedAsHex: seedHex(),
      net: 'Testnet',
      identityIndex: 0,
      credNumber,
    },
    expiry,
  );
  const hd = ConcordiumHdWallet.fromHex(seedHex(), 'Testnet');
  const signKey = hd.getAccountSigningKey(p.ipInfo.ipIdentity, 0, credNumber).toString('hex');
  const signature = await signCredentialTransaction(payload, signKey);
  const address = getAccountAddress(payload.unsignedCdi.credId).address;
  const tx = await grpc.sendCredentialDeploymentTransaction(serializeCredentialDeploymentPayload([signature], payload), expiry);
  fs.writeFileSync(SHOP_FILE, JSON.stringify({ address, signKey, ipIdentity: p.ipInfo.ipIdentity }, null, 2), { mode: 0o600 });
  writeState({ ...s, address });
  console.log(`account ${address} opening on testnet, tx ${Buffer.from(tx.buffer).toString('hex')}`);
}

const cmd = process.argv[2];
if (cmd === 'start') await start();
else if (cmd === 'finish') await finish();
else throw new Error('usage: node src/identity/business-id.ts start|finish');
