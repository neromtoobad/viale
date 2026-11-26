// Checks every claim in the README against the live site and Concordium testnet. Needs no keys or wallet.
// Prints PASS or FAIL per claim and exits 1 if any claim fails.
// Usage: node tools/check-live.ts            (live site: https://viale.nerom.site)
//        VIALE_SITE=http://localhost:8080 node tools/check-live.ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { AccountAddress, TransactionHash, verifyMessageSignature } from '@concordium/web-sdk';
import { client } from '../src/chain/chain.ts';
import { agentOf } from '../src/registry/mcp.ts';

const SITE = process.env.VIALE_SITE ?? 'https://viale.nerom.site';
const ROOT = path.resolve(import.meta.dirname, '..');
const REGISTRY = '<12802,0>';
const HONEST = ['1526', '1527'];
const IMPOSTOR = '1406';
const TILL = '3HNiUGKvauG2NZXSabcsQ5eaYRbtqWYfYVUkGtzxJ37kfj64ji';
const MAGIC = Buffer.from('VIALE/R1');
const grpc = client();

let failed = 0;
async function claim(id: string, text: string, check: () => Promise<string>) {
  try {
    const detail = await check();
    console.log(`PASS  ${id}  ${text}\n        ${detail}`);
  } catch (err: any) {
    failed++;
    console.log(`FAIL  ${id}  ${text}\n        ${err.message}`);
  }
}
function must(cond: unknown, why: string): asserts cond {
  if (!cond) throw new Error(why);
}
const json = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, init);
  must(r.ok, `${url} returned HTTP ${r.status}`);
  return r.json();
};

let businessIdps: Set<number> | undefined;
async function identityProviders(address: string) {
  if (!businessIdps) {
    businessIdps = new Set();
    for await (const ip of grpc.getIdentityProviders()) if (ip.ipDescription.name.includes('Global FinReg')) businessIdps.add(Number(ip.ipIdentity));
  }
  const info = await grpc.getAccountInfo(AccountAddress.fromBase58(address));
  const idps = Object.values(info.accountCredentials).map((c: any) => Number(c.value.contents.ipIdentity));
  return { idps, business: idps.some((i) => businessIdps!.has(i)) };
}
async function txSummary(hash: string): Promise<any> {
  const s: any = await grpc.getBlockItemStatus(TransactionHash.fromHexString(hash));
  must(s.status === 'finalized', `tx ${hash.slice(0, 10)}… is ${s.status}`);
  // plain JSON: SDK types (token ids, addresses, bigints) become the strings the explorer shows
  return JSON.parse(JSON.stringify(s.outcome.summary, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}
const ok = (s: any) => s.type === 'accountTransaction' ? s.transactionType !== 'failed' : true;

// Evidence: every errand log and run record committed in evidence/.
const evidence = fs.readdirSync(path.join(ROOT, 'evidence')).filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: `evidence/${f}`, data: JSON.parse(fs.readFileSync(path.join(ROOT, 'evidence', f), 'utf8')) }));
function txHashes(v: any, key = '', out = new Set<string>()): Set<string> {
  if (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v) && /(^tx$|_tx$|Tx$|^hash$)/.test(key)) out.add(v);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) txHashes(x, Array.isArray(v) ? key : k, out);
  return out;
}
const steps = (d: any): any[] => d.log ?? d.steps ?? [];

console.log(`Checking ${SITE} and Concordium testnet\n`);

await claim('C1', 'Every shop on the street is an Active agent in the CIS-8004 Agent Registry ' + REGISTRY, async () => {
  const street = await json(`${SITE}/api/street`);
  const ids = street.shops.map((s: any) => s.token_id).sort();
  must(JSON.stringify(ids) === JSON.stringify([IMPOSTOR, ...HONEST].sort()), `street lists ${ids.join(', ')}`);
  for (const id of ids) {
    const a = await agentOf(id);
    must(a?.status === 'Active', `agent #${id} is ${a?.status ?? 'missing'}`);
  }
  return `agents #${ids.join(', #')} are Active in the registry`;
});

await claim('C2', "Each shop's Agent Card, served by the site, hashes to the metadata hash pinned on chain", async () => {
  const out: string[] = [];
  for (const id of [IMPOSTOR, ...HONEST]) {
    const a = await agentOf(id);
    must(a?.agent_uri === `${SITE}/agents/${id}.json` || !process.env.VIALE_SITE, `agent #${id} points at ${a?.agent_uri}`);
    const r = await fetch(a!.agent_uri!);
    must(r.ok, `${a!.agent_uri} returned HTTP ${r.status}`);
    const sha = crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex');
    must(sha === a!.metadata_hash_hex, `card #${id} hashes to ${sha.slice(0, 12)}…, chain says ${a!.metadata_hash_hex?.slice(0, 12)}…`);
    out.push(`#${id} ${sha.slice(0, 12)}…`);
  }
  return out.join(', ');
});

await claim('C3', 'The honest shops are owned by a Global FinReg business identity; the impostor by a personal one', async () => {
  const out: string[] = [];
  for (const id of [...HONEST, IMPOSTOR]) {
    const a = await agentOf(id);
    const { idps, business } = await identityProviders(a!.owner_account);
    must(business === (id !== IMPOSTOR), `#${id} owner ${a!.owner_account.slice(0, 6)}… has identity providers ${idps.join(', ')}`);
    out.push(`#${id} owner ${a!.owner_account.slice(0, 6)}… idp ${idps.join(',')} (${business ? 'business' : 'personal'})`);
  }
  return out.join('; ');
});

await claim('C4', 'The live street trades with the two honest shops and walks away from the impostor', async () => {
  const { shops } = await json(`${SITE}/api/street`);
  const by = Object.fromEntries(shops.map((s: any) => [s.token_id, s]));
  for (const id of HONEST) must(by[id].trade === true, `#${id} fails: ${by[id].failed.join('; ')}`);
  must(by[IMPOSTOR].trade === false && by[IMPOSTOR].failed.some((r: string) => /personal identity/.test(r)), `#${IMPOSTOR}: ${JSON.stringify(by[IMPOSTOR].failed)}`);
  return `#1526 and #1527 TRADE; #1406 WALK AWAY ("${by[IMPOSTOR].failed.join('; ')}")`;
});

await claim('C5', "A shop's price quote is signed by its owner's account key and names the registry's wallet", async () => {
  const id = '1527';
  const { items } = await json(`${SITE}/shops/${id}/menu`);
  const q = await json(`${SITE}/shops/${id}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sku: items[0].sku }) });
  const terms = JSON.parse(q.message);
  const a = await agentOf(id);
  must(terms.shop_owner === a!.owner_account, 'quote names another owner');
  must(terms.pay_to === a!.agent_wallet, "quote's wallet is not the registry's agent wallet");
  const info = await grpc.getAccountInfo(AccountAddress.fromBase58(a!.owner_account));
  must(await verifyMessageSignature(q.message, q.signature, info), "signature does not match the owner's keys on chain");
  const tampered = JSON.stringify({ ...terms, price_eur: terms.price_eur / 2 });
  must(!(await verifyMessageSignature(tampered, q.signature, info).catch(() => false)), 'a changed price still verifies');
  return `${terms.item} €${terms.price_eur} verifies against ${a!.owner_account.slice(0, 6)}…'s keys; a halved price does not`;
});

await claim('C6', 'Every transaction recorded in evidence/ is finalized on testnet and succeeded', async () => {
  const all = new Set<string>();
  for (const e of evidence) txHashes(e.data, '', all);
  for (const h of all) must(ok(await txSummary(h)), `tx ${h.slice(0, 10)}… failed`);
  return `${all.size} transactions finalized and successful`;
});

await claim('C7', 'Each paid errand paid exactly its signed quote, in EUDemo, to the shop\'s till, with fees paid by Viale', async () => {
  const out: string[] = [];
  for (const e of evidence) {
    const pays = steps(e.data).filter((s) => s.step === 'payment');
    for (const p of pays) {
      const q = steps(e.data).find((s) => s.step === 'quote' && s.quote?.quote_id === p.quote_id);
      if (!q) continue; // the first errand, before signed quotes, has no quote to compare
      const s = await txSummary(p.tx);
      const t = s.events?.find((x: any) => x.tag === 'TokenTransfer');
      must(t?.tokenId === 'EUDemo', `${p.tx.slice(0, 10)}… is not an EUDemo transfer`);
      const amount = Number(t.amount.value) / 10 ** t.amount.decimals;
      must(amount === q.quote.price_eur, `${e.file}: paid ${amount}, quoted ${q.quote.price_eur}`);
      must(t.to.address === q.quote.pay_to && t.to.address === TILL, `${e.file}: paid to ${t.to.address}`);
      must(s.cost === '0' && s.sponsor?.sponsor, `${e.file}: the agent paid a fee`);
      const info = await grpc.getAccountInfo(AccountAddress.fromBase58(q.quote.shop_owner));
      must(await verifyMessageSignature(q.signed.message, q.signed.signature, info), `${e.file}: quote signature fails`);
      out.push(`€${amount} ${q.quote.item} (${p.tx.slice(0, 8)}…)`);
    }
  }
  must(out.length >= 2, `only ${out.length} quoted payments found`);
  return out.join(', ');
});

await claim('C8', 'Each errand log is sealed on chain: sha256(receipt || nonce) recomputed from the log matches the anchor', async () => {
  const out: string[] = [];
  for (const e of evidence.filter((x) => x.data.anchor?.nonce && x.data.receipt)) {
    const digest = crypto.createHash('sha256').update(JSON.stringify(e.data.receipt)).update(Buffer.from(e.data.anchor.nonce, 'hex')).digest();
    const s = await txSummary(e.data.anchor.hash);
    const onChain = Buffer.from(s.dataRegistered?.data ?? '', 'hex');
    must(onChain.equals(Buffer.concat([MAGIC, digest])), `${e.file}: anchor data does not match the log`);
    const changed = crypto.createHash('sha256').update(JSON.stringify({ ...e.data.receipt, edited: true })).update(Buffer.from(e.data.anchor.nonce, 'hex')).digest();
    must(!onChain.equals(Buffer.concat([MAGIC, changed])), 'an edited log still matches');
    out.push(path.basename(e.file, '.json'));
  }
  must(out.length >= 4, `only ${out.length} anchored logs found`);
  return `${out.length} logs match their anchors: ${out.join(', ')}`;
});

await claim('C9', 'The errand sent to the impostor made no payment', async () => {
  const e = evidence.find((x) => x.file.includes('impostor'))!;
  must(!steps(e.data).some((s) => s.step === 'payment'), 'it has a payment step');
  must(e.data.ledger.spentEur === 0, `it spent €${e.data.ledger.spentEur}`);
  return `${e.file}: no payment, spent €0, log anchored ${e.data.anchor.hash.slice(0, 10)}…`;
});

await claim('C10', 'The payment guard tests pass (budget, cap, expiry, checked shop, quoted price, 18+)', async () => {
  const out = execFileSync(process.execPath, ['--test', 'src/errand/guards.test.ts'], { cwd: ROOT, encoding: 'utf8' });
  const pass = out.match(/pass (\d+)/)?.[1], fail = out.match(/fail (\d+)/)?.[1];
  must(fail === '0', `${fail} tests fail`);
  return `${pass} tests pass`;
});

await claim('C11', 'Check any agent: the same check runs on any registry agent, and its owner verdict matches the chain', async () => {
  const reg = await json(`${SITE}/api/registry`);
  const outsider = reg.business_agents.find((a: any) => a.owner !== '4UVsGdSyYk43E2m99Vy3M38u92yknjBUoY7xKQHGSDXZAUiWw5');
  must(outsider, 'no business-owned agent outside Viale in the registry count');
  const out: string[] = [];
  for (const id of ['1010', outsider.token_id, IMPOSTOR]) {
    const v = await json(`${SITE}/api/check/${id}`);
    const { business } = await identityProviders(v.owner);
    must(v.owner_identity.business === business, `#${id}: page says business=${v.owner_identity.business}, chain says ${business}`);
    if (!business) must(v.verdict === 'walk_away', `#${id} has a personal owner but verdict ${v.verdict}`);
    out.push(`#${id} ${v.verdict} (${business ? 'business' : 'personal'} owner)`);
  }
  must((await fetch(`${SITE}/api/check/99999999`).then((r) => r.json())).verdict === 'walk_away', 'an unknown agent is not refused');
  return `${out.join(', ')}, unknown #99999999 walk_away`;
});

await claim('C12', 'Viale serves the check as an MCP server: tools/list and check_agent over JSON-RPC at /mcp', async () => {
  const call = (id: number, method: string, params?: unknown) =>
    json(`${SITE}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
  const init = await call(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check-live', version: '1' } });
  must(init.result?.serverInfo?.name === 'viale', 'initialize failed');
  const tools = (await call(2, 'tools/list')).result.tools.map((t: any) => t.name);
  must(tools.includes('check_agent') && tools.includes('registry_owners'), `tools: ${tools.join(', ')}`);
  const r = (await call(3, 'tools/call', { name: 'check_agent', arguments: { token_id: IMPOSTOR } })).result;
  must(!r.isError && r.structuredContent.verdict === 'walk_away', `check_agent #${IMPOSTOR}: ${JSON.stringify(r).slice(0, 200)}`);
  const ok = (await call(4, 'tools/call', { name: 'check_agent', arguments: { token_id: '1527' } })).result;
  must(ok.structuredContent.verdict === 'trade', `check_agent #1527: ${ok.structuredContent.verdict}`);
  return `tools ${tools.join(', ')}; check_agent #1406 walk_away, #1527 trade`;
});

await claim('C13', "Errands run under a mandate signed by a human's Concordium account key; forged or over-limit mandates are refused", async () => {
  const e = evidence.find((x) => x.data.mandate?.signed)!;
  must(e, 'no evidence errand carries a signed mandate');
  const { message, signature, human } = e.data.mandate.signed;
  const terms = JSON.parse(message);
  const info = await grpc.getAccountInfo(AccountAddress.fromBase58(human));
  must(await verifyMessageSignature(message, signature, info), `${e.file}: signature does not verify against ${human.slice(0, 8)}…'s keys on chain`);
  const forged = JSON.stringify({ ...terms, budget_eur: 50 });
  must(!(await verifyMessageSignature(forged, signature, info)), 'a tampered mandate still verifies');
  const paid = steps(e.data).filter((s) => s.step === 'payment');
  must(paid.length && paid.every((p) => p.amount_eur <= terms.max_payment_eur), 'a payment is over the signed cap');
  must(e.data.ledger.spentEur <= terms.budget_eur, 'spent more than the signed budget');

  // Live site: a fresh mandate with someone else's signature, and one over the street's limits, are both refused.
  const post = async (body: unknown) => {
    for (let i = 0; i < 8; i++) {
      const r = await fetch(`${SITE}/api/errands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j: any = await r.json();
      if (r.status === 429 && /running/.test(j.error)) { await new Promise((ok) => setTimeout(ok, 20_000)); continue; }
      return { status: r.status, error: String(j.error ?? '') , id: j.id };
    }
    throw new Error('the street stayed busy');
  };
  const draft = (await json(`${SITE}/api/mandates/draft`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: 'check-live: should be refused', human }) })).message;
  const a = await post({ mandate: { message: draft, signature } });
  must(a.status === 400 && /signature does not match/.test(a.error) && !a.id, `wrong signature: HTTP ${a.status} ${a.error}`);
  const b = await post({ mandate: { message: JSON.stringify({ ...JSON.parse(draft), budget_eur: 50 }), signature } });
  must(b.status === 400 && /over this street/.test(b.error) && !b.id, `over limit: HTTP ${b.status} ${b.error}`);
  return `${e.file}: signed by ${human.slice(0, 8)}…, verifies on chain, paid ≤ €${terms.max_payment_eur} cap; live site refused a wrong signature and a €50 budget (HTTP 400, no errand)`;
});

console.log(failed ? `\n${failed} claim(s) failed` : '\nAll claims pass');
process.exit(failed ? 1 : 0);
