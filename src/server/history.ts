// Errand history: every errand log this server has run (data/errands, on a Railway volume so it survives
// deploys) plus the runs committed in evidence/. Summaries for the list page, full records for receipts,
// street-wide numbers, and seal checks anyone can run (sha256(receipt || nonce) against the chain).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AccountAddress, TransactionHash, verifyMessageSignature } from '@concordium/web-sdk';
import { client, withRetry } from '../chain/chain.ts';
import { sponsorWallet } from '../chain/keys.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MAGIC = Buffer.from('VIALE/R1');
const SOURCES: [string, RegExp, 'live' | 'evidence'][] = [['data/errands', /\.json$/, 'live'], ['evidence', /^errand-.*\.json$/, 'evidence']];

export type Outcome = 'paid' | 'walked_away' | 'refused' | 'stopped' | 'nothing_bought';
export type Summary = {
  id: string; at: string; task: string; model: string; source: 'live' | 'evidence';
  signer: { human: string; demo: boolean } | null;
  outcome: Outcome; spent_eur: number;
  shops_checked: { token_id: string; ok: boolean; reasons: string[] }[];
  payments: { tx: string; amount_eur: number; item: string; shop: string; token_id: string; pay_to: string; x402: boolean }[];
  seal: string | null; steps: number;
};

let cache: { at: number; records: Map<string, any> } | undefined;

/** Every errand record on disk, newest first (cached for 10 seconds). */
export function records(): Map<string, any> {
  if (cache && Date.now() - cache.at < 10_000) return cache.records;
  const all: any[] = [];
  for (const [dir, re, source] of SOURCES) {
    const d = path.join(ROOT, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!re.test(f)) continue;
      try {
        const r = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
        if (r.id && Array.isArray(r.log) && r.mandate) all.push({ ...r, _source: source });
      } catch { /* a log being written right now */ }
    }
  }
  all.sort((a, b) => String(b.id).localeCompare(String(a.id)));
  const map = new Map<string, any>();
  for (const r of all) if (!map.has(r.id)) map.set(r.id, r);
  cache = { at: Date.now(), records: map };
  return map;
}

export function summarize(r: any): Summary {
  const log: any[] = r.log ?? [];
  const checks = log.filter((s) => s.step === 'check_shop').map((s) => ({ token_id: String(s.token_id), ok: !!s.ok, reasons: s.reasons ?? [] }));
  const payments = log.filter((s) => s.step === 'payment').map((s) => ({ tx: s.tx, amount_eur: s.amount_eur, item: s.item, shop: s.shop, token_id: String(s.token_id), pay_to: s.payTo, x402: !!s.x402 }));
  const failed = log.some((s) => s.step === 'failed' || s.step === 'model_refused') || (!r.report && !r.anchor);
  const outcome: Outcome = payments.length ? 'paid'
    : log.some((s) => s.step === 'payment_refused') ? 'refused'
    : checks.some((c) => !c.ok) ? 'walked_away'
    : failed ? 'stopped' : 'nothing_bought';
  const human = r.mandate?.signed?.human;
  return {
    id: r.id, at: log.find((s) => s.at)?.at ?? '', task: r.mandate?.task ?? '', model: r.model ?? '', source: r._source,
    signer: human ? { human, demo: human === sponsorWallet().address.address } : null,
    outcome, spent_eur: r.ledger?.spentEur ?? payments.reduce((t, p) => t + p.amount_eur, 0),
    shops_checked: checks, payments, seal: r.anchor?.hash ?? null, steps: log.length,
  };
}

export function list(): Summary[] {
  return [...records().values()].map(summarize);
}

/** One errand's full record, as stored (log, mandate, ledger, report, receipt and the seal's nonce). */
export function record(id: string) {
  const r = records().get(id);
  if (!r) return null;
  const { _source, ...rest } = r;
  return { summary: summarize(r), record: rest };
}

export function stats() {
  const all = list();
  const shops = new Set(all.flatMap((s) => s.shops_checked.map((c) => c.token_id)));
  return {
    errands: {
      total: all.length,
      paid: all.filter((s) => s.outcome === 'paid').length,
      walked_away: all.filter((s) => s.shops_checked.some((c) => !c.ok)).length,
      paid_eur: Math.round(all.reduce((t, s) => t + s.payments.reduce((u, p) => u + p.amount_eur, 0), 0) * 100) / 100,
      payments: all.reduce((t, s) => t + s.payments.length, 0),
      x402_http_payments: all.reduce((t, s) => t + s.payments.filter((p) => p.x402).length, 0),
      sealed: all.filter((s) => s.seal).length,
      wallet_signed: all.filter((s) => s.signer && !s.signer.demo).length,
      shops_checked: shops.size,
      last_at: all[0]?.at ?? null,
    },
  };
}

async function txSummary(hash: string): Promise<any> {
  const s: any = await withRetry(() => client().getBlockItemStatus(TransactionHash.fromHexString(hash)));
  if (s.status !== 'finalized') return { status: s.status };
  const j = JSON.parse(JSON.stringify(s.outcome, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  return { ...j.summary, blockHash: typeof j.blockHash === 'string' ? j.blockHash : j.blockHash?.buffer ? Buffer.from(Object.values(j.blockHash.buffer) as number[]).toString('hex') : null };
}

/** Recomputes an errand log's seal and compares it with the register-data transaction on chain. */
export async function verifySeal(input: any) {
  const receipt = input?.receipt;
  const nonce = input?.anchor?.nonce ?? input?.nonce;
  const tx = input?.anchor?.hash ?? input?.tx;
  if (!receipt || typeof nonce !== 'string' || typeof tx !== 'string') return { ok: false, error: 'Send an errand record with receipt, anchor.nonce and anchor.hash (the JSON from Download log).' };
  if (!/^[0-9a-f]{64}$/.test(tx) || !/^[0-9a-f]+$/.test(nonce)) return { ok: false, error: 'anchor.hash or anchor.nonce is not hex.' };
  const digest = crypto.createHash('sha256').update(JSON.stringify(receipt)).update(Buffer.from(nonce, 'hex')).digest();
  const s = await txSummary(tx).catch((e) => ({ error: e.message }));
  if (s.error || s.status) return { ok: false, error: s.error ?? `transaction is ${s.status}` };
  const onChain = Buffer.from(s.dataRegistered?.data ?? '', 'hex');
  const expected = Buffer.concat([MAGIC, digest]);
  const ok = onChain.equals(expected);
  return {
    ok,
    computed_digest: digest.toString('hex'),
    on_chain_data: onChain.toString('hex'),
    tag: onChain.subarray(0, 8).toString(),
    sealed_by: s.sender ?? null,
    block_hash: s.blockHash ?? null,
    tx,
    why: ok ? 'sha256(receipt ‖ nonce) equals the digest registered on chain after the VIALE/R1 tag: this log is the one that was sealed.' : 'The digest on chain does not match this log: it was edited, or the nonce or transaction is wrong.',
  };
}

/** Checks a Concordium account message signature (a mandate or a quote) against the signer's keys on chain. */
export async function verifySignature(input: any) {
  const message = input?.message;
  const signature = input?.signature;
  if (typeof message !== 'string' || !signature || typeof signature !== 'object') return { ok: false, error: 'Send {message, signature} as signed (a mandate or a quote).' };
  let terms: any;
  try { terms = JSON.parse(message); } catch { return { ok: false, error: 'The message is not JSON.' }; }
  const kind = terms.kind;
  const signer = input.signer ?? (kind === 'viale-mandate' ? terms.human : kind === 'viale-quote' ? terms.shop_owner : kind === 'viale-pricelist' ? terms.owner : undefined);
  if (typeof signer !== 'string') return { ok: false, error: 'Could not tell who signed it. Pass "signer": "<account address>".' };
  let info;
  try { info = await withRetry(() => client().getAccountInfo(AccountAddress.fromBase58(signer))); }
  catch { return { ok: false, error: `${signer.slice(0, 6)}… is not an account on Concordium testnet.` }; }
  const ok = await verifyMessageSignature(message, signature, info).catch(() => false);
  const idps = [...new Set(Object.values((info as any).accountCredentials).map((c: any) => Number(c.value.contents.ipIdentity)))];
  return {
    ok, kind: kind ?? 'unknown', signer, identity_providers: idps,
    terms,
    why: ok ? `The signature matches the keys of ${signer.slice(0, 6)}… read from the chain.` : `The signature does not match the keys of ${signer.slice(0, 6)}… on chain: the text was changed, or someone else signed it.`,
  };
}
