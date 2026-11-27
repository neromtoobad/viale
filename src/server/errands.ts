// Live errands for the street page. POST starts a real errand (Claude + testnet payments);
// the page follows it step by step over Server-Sent Events. Every step comes from runErrand's own log.
// Guard rails for a public demo: one errand at a time, a few per hour, and small fixed mandate limits.
import type http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { runErrand } from '../agent/errand.ts';
import { checkShop, type ShopVerdict } from '../errand/shop-check.ts';
import { SHOPS } from '../street/shops.ts';
import { CATALOG } from '../street/catalog.ts';
import { liveOpenShops, openMenu, priceList } from '../street/open-shops.ts';
import { AccountAddress } from '@concordium/web-sdk';
import { agentWallet, shopOwnerWallet, sponsorWallet } from '../chain/keys.ts';
import { draftMandate, signMandate, verifyMandate, type SignedMandate } from '../errand/mandate.ts';

const MAX_PER_HOUR = Number(process.env.VIALE_ERRANDS_PER_HOUR ?? 6);
const LIMITS = { budgetEur: 5, maxPaymentEur: 3 };
const MANDATE_MINUTES = 15;
const MANDATE_LIMITS = { ...LIMITS, maxMinutes: 30 };
const usedMandates = new Set<string>();
// Accounts whose keys this server holds (the shop till's key is used once, in tools/set-till). A wallet
// mandate signed by one of them would not show that anyone but Viale agreed, so only the demo path uses one.
const TILL = '3HNiUGKvauG2NZXSabcsQ5eaYRbtqWYfYVUkGtzxJ37kfj64ji';
const vialeHeld = () => new Set([sponsorWallet(), shopOwnerWallet()].map((w) => w.address.address).concat(TILL));
const HELD_BY_VIALE = "That is one of Viale's own accounts: its key is on Viale's server, so its signature can't stand for you. Pick or create an account of your own in your wallet.";
let starting = false;

/** The limits a visitor picked for one errand, kept inside the street's limits. */
export type ErrandOptions = { budgetEur?: unknown; maxPaymentEur?: unknown; minutes?: unknown; allowedShops?: unknown };
function pickLimits(o: ErrandOptions = {}): { budgetEur: number; maxPaymentEur: number; minutes: number; allowedShops?: string[]; error?: string } {
  const num = (v: unknown, d: number) => (v == null || v === '' ? d : Number(v));
  const budgetEur = Math.round(num(o.budgetEur, LIMITS.budgetEur) * 100) / 100;
  const maxPaymentEur = Math.round(num(o.maxPaymentEur, LIMITS.maxPaymentEur) * 100) / 100;
  const minutes = Math.round(num(o.minutes, MANDATE_MINUTES));
  const allowed = Array.isArray(o.allowedShops) ? o.allowedShops.map((x) => String(x).slice(0, 80)).filter(Boolean).slice(0, 10) : undefined;
  if (!(budgetEur > 0 && budgetEur <= LIMITS.budgetEur)) return { budgetEur, maxPaymentEur, minutes, error: `Budget must be between €0.01 and €${LIMITS.budgetEur} on this street.` };
  if (!(maxPaymentEur > 0 && maxPaymentEur <= LIMITS.maxPaymentEur)) return { budgetEur, maxPaymentEur, minutes, error: `The cap per payment must be between €0.01 and €${LIMITS.maxPaymentEur}.` };
  if (maxPaymentEur > budgetEur) return { budgetEur, maxPaymentEur, minutes, error: 'The cap per payment cannot be more than the budget.' };
  if (!(minutes >= 5 && minutes <= MANDATE_LIMITS.maxMinutes)) return { budgetEur, maxPaymentEur, minutes, error: `The mandate must last between 5 and ${MANDATE_LIMITS.maxMinutes} minutes.` };
  return { budgetEur, maxPaymentEur, minutes, ...(allowed?.length ? { allowedShops: allowed } : {}) };
}

/** The mandate a visitor's wallet signs: their task, this agent, and limits they picked inside the street's. */
export function mandateDraft(task: unknown, human: unknown, options?: ErrandOptions): { message?: string; error?: string } {
  const t = String(task ?? '').trim().slice(0, 300);
  if (!t) return { error: 'Tell the agent what to buy.' };
  const lim = pickLimits(options);
  if (lim.error) return { error: lim.error };
  try { AccountAddress.fromBase58(String(human)); } catch { return { error: 'That is not a Concordium account address.' }; }
  if (vialeHeld().has(String(human))) return { error: HELD_BY_VIALE };
  if (String(human) === agentWallet().address.address) return { error: "That is the errand agent's own account. Pick another account in your wallet: the agent can't sign its own limits." };
  const terms = draftMandate({ task: t, human: String(human), agent: agentWallet().address.address, budgetEur: lim.budgetEur, maxPaymentEur: lim.maxPaymentEur, minutes: lim.minutes, allowedShops: lim.allowedShops });
  return { message: JSON.stringify(terms) };
}

type Signer = { human: string; mandate_id: string; demo: boolean };
type Live = { id: string; task: string; signer: Signer; limits: { budgetEur: number; maxPaymentEur: number; allowedShops?: string[]; expiresAt: string }; steps: any[]; done: boolean; listeners: Set<http.ServerResponse> };
const errands = new Map<string, Live>();
const started: number[] = [];
let running: Live | undefined;

/** Starts an errand under a mandate signed in the visitor's wallet, or, with only a task, under a mandate
 *  signed by Viale's demo account (for visitors without a Concordium wallet). Either way the signature is
 *  checked against the signer's keys on chain before anything runs, and each mandate runs once. */
export async function startErrand(input: { task?: unknown; mandate?: SignedMandate; options?: ErrandOptions }): Promise<{ id?: string; error?: string; status?: number }> {
  if ((running && !running.done) || starting) return { error: 'Another errand is running. Watch it, then try again.', status: 429 };
  const hourAgo = Date.now() - 3600_000;
  while (started.length && started[0] < hourAgo) started.shift();
  if (started.length >= MAX_PER_HOUR) return { error: `The street allows ${MAX_PER_HOUR} errands an hour. Try again later.`, status: 429 };
  starting = true;
  try {
    const agent = agentWallet().address.address;
    let signed = input.mandate;
    const demo = !signed;
    if (signed && (typeof signed.message !== 'string' || !signed.signature || typeof signed.signature !== 'object')) return { error: 'The signed mandate is incomplete.', status: 400 };
    if (!signed) {
      const task = String(input.task ?? '').trim().slice(0, 300);
      if (!task) return { error: 'Tell the agent what to buy.', status: 400 };
      const lim = pickLimits(input.options);
      if (lim.error) return { error: lim.error, status: 400 };
      const viale = sponsorWallet();
      signed = await signMandate(draftMandate({ task, human: viale.address.address, agent, budgetEur: lim.budgetEur, maxPaymentEur: lim.maxPaymentEur, minutes: lim.minutes, allowedShops: lim.allowedShops }), viale);
    }
    const check = await verifyMandate(signed, { agent, limits: MANDATE_LIMITS });
    if (!check.ok) return { error: `Mandate refused: ${check.reasons.join('; ')}`, status: 400 };
    const m = check.mandate;
    if (!demo && vialeHeld().has(m.signed!.human)) return { error: HELD_BY_VIALE, status: 400 };
    if (usedMandates.has(m.signed!.mandateId)) return { error: 'This mandate has already been used. Sign a new one.', status: 400 };
    usedMandates.add(m.signed!.mandateId);
    started.push(Date.now());
    return { id: launch(m, { human: m.signed!.human, mandate_id: m.signed!.mandateId, demo }) };
  } finally {
    starting = false;
  }
}

function launch(mandate: import('../errand/guards.ts').Mandate, signer: Signer): string {
  const task = mandate.task;
  const live: Live = { id: crypto.randomBytes(6).toString('hex'), task, signer, limits: { budgetEur: mandate.budgetEur, maxPaymentEur: mandate.maxPaymentEur, allowedShops: mandate.allowedShops, expiresAt: mandate.expiresAt }, steps: [], done: false, listeners: new Set() };
  errands.set(live.id, live);
  running = live;
  const push = (e: any) => {
    live.steps.push(e);
    for (const res of live.listeners) res.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  runErrand(mandate, { onStep: push })
    .then((r) => push({ at: new Date().toISOString(), step: 'finished', errand_id: r.id, spentEur: r.ledger.spentEur, anchor: r.anchor?.hash }))
    .catch((err) => push({ at: new Date().toISOString(), step: 'failed', error: err.message }))
    .finally(() => {
      live.done = true;
      for (const res of live.listeners) res.end();
      live.listeners.clear();
    });
  return live.id;
}

/** Server-Sent Events: replays the steps so far, then streams new ones until the errand ends. */
export function followErrand(id: string, res: http.ServerResponse) {
  const live = errands.get(id);
  if (!live) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write(`data: ${JSON.stringify({ step: 'task', task: live.task, limits: live.limits, signer: live.signer })}\n\n`);
  for (const e of live.steps) res.write(`data: ${JSON.stringify(e)}\n\n`);
  if (live.done) return res.end();
  live.listeners.add(res);
  res.on('close', () => live.listeners.delete(res));
}

let streetCache: { at: number; shops: any[] } | undefined;
let refreshing: Promise<any[]> | undefined;

async function checkStreet() {
  const shops = await Promise.all(
    [...SHOPS.filter((s) => s.tokenId).map((s) => ({ tokenId: s.tokenId!, name: s.name, slug: s.slug, outside: false })),
     ...liveOpenShops().map((s) => ({ tokenId: s.token_id, name: priceList(s.token_id)?.name ?? `Shop #${s.token_id}`, slug: `open-${s.token_id}`, outside: true }))]
    .map(async (s) => {
      const v: ShopVerdict = await checkShop(s.tokenId, s.name);
      return {
        token_id: s.tokenId, name: s.name, slug: s.slug, owner: v.owner, pay_to: v.payTo, outside: s.outside,
        trade: v.ok, passed: v.passed, failed: v.reasons, age_gated: v.ageGated ?? false, menu: CATALOG[s.tokenId] ?? openMenu(s.tokenId) ?? [],
      };
    }),
  );
  streetCache = { at: Date.now(), shops };
  return shops;
}

/** The street as the agent would see it: every shop with its live check from the registry and the chain.
 *  Checks are at most a minute old; an older result is served while a fresh check runs in the background. */
export function forgetStreet() { streetCache = undefined; }
export async function street() {
  const fresh = streetCache && Date.now() - streetCache.at < 60_000;
  if (!fresh && !refreshing) refreshing = checkStreet().finally(() => (refreshing = undefined));
  if (streetCache) { refreshing?.catch(() => {}); return streetCache.shops; }
  return refreshing!;
}

export const errandLimits = LIMITS;

const ROOT = path.resolve(import.meta.dirname, '../..');

/** The errand the page should show on load: the one running (or last run) on this server, else the newest
 *  errand log on disk (this server's data/errands, then the committed evidence/ runs), replayed as recorded. */
export function latestErrand() {
  if (running) return { id: running.id, live: !running.done };
  const logs: string[] = [];
  for (const [dir, re] of [['data/errands', /\.json$/], ['evidence', /^errand-.*\.json$/]] as const) {
    const d = path.join(ROOT, dir);
    if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (re.test(f)) logs.push(path.join(d, f));
  }
  const runs = logs.flatMap((f) => { try { return [JSON.parse(fs.readFileSync(f, 'utf8'))]; } catch { return []; } })
    .filter((r) => r.id && Array.isArray(r.log) && r.mandate)
    .sort((a, b) => String(b.id).localeCompare(String(a.id)));
  const r = runs[0];
  if (!r) return { none: true };
  const { budgetEur, maxPaymentEur } = r.mandate;
  const signer = r.mandate.signed ? { human: r.mandate.signed.human, mandate_id: r.mandate.signed.mandateId, demo: r.mandate.signed.human === sponsorWallet().address.address } : null;
  const steps = [
    { step: 'task', task: r.mandate.task, limits: { budgetEur, maxPaymentEur }, signer },
    ...r.log,
    ...(r.anchor?.hash ? [{ at: r.log.at(-1)?.at, step: 'log_anchored', tx: r.anchor.hash, ok: r.anchor.ok }] : []),
    { at: r.log.at(-1)?.at, step: 'finished', errand_id: r.id, spentEur: r.ledger?.spentEur, anchor: r.anchor?.hash },
  ];
  return { recorded: true, id: r.id, steps };
}
