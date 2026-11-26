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

const MAX_PER_HOUR = Number(process.env.VIALE_ERRANDS_PER_HOUR ?? 6);
const LIMITS = { budgetEur: 5, maxPaymentEur: 3 };

type Live = { id: string; task: string; steps: any[]; done: boolean; listeners: Set<http.ServerResponse> };
const errands = new Map<string, Live>();
const started: number[] = [];
let running: Live | undefined;

export function startErrand(task: string): { id?: string; error?: string } {
  task = String(task ?? '').trim().slice(0, 300);
  if (!task) return { error: 'Tell the agent what to buy.' };
  if (running && !running.done) return { error: 'Another errand is running. Watch it, then try again.' };
  const hourAgo = Date.now() - 3600_000;
  while (started.length && started[0] < hourAgo) started.shift();
  if (started.length >= MAX_PER_HOUR) return { error: `The street allows ${MAX_PER_HOUR} errands an hour. Try again later.` };
  started.push(Date.now());

  const live: Live = { id: crypto.randomBytes(6).toString('hex'), task, steps: [], done: false, listeners: new Set() };
  errands.set(live.id, live);
  running = live;
  const push = (e: any) => {
    live.steps.push(e);
    for (const res of live.listeners) res.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  const mandate = { task, ...LIMITS, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
  runErrand(mandate, { onStep: push })
    .then((r) => push({ at: new Date().toISOString(), step: 'finished', errand_id: r.id, spentEur: r.ledger.spentEur, anchor: r.anchor?.hash }))
    .catch((err) => push({ at: new Date().toISOString(), step: 'failed', error: err.message }))
    .finally(() => {
      live.done = true;
      for (const res of live.listeners) res.end();
      live.listeners.clear();
    });
  return { id: live.id };
}

/** Server-Sent Events: replays the steps so far, then streams new ones until the errand ends. */
export function followErrand(id: string, res: http.ServerResponse) {
  const live = errands.get(id);
  if (!live) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write(`data: ${JSON.stringify({ step: 'task', task: live.task, limits: LIMITS })}\n\n`);
  for (const e of live.steps) res.write(`data: ${JSON.stringify(e)}\n\n`);
  if (live.done) return res.end();
  live.listeners.add(res);
  res.on('close', () => live.listeners.delete(res));
}

let streetCache: { at: number; shops: any[] } | undefined;
let refreshing: Promise<any[]> | undefined;

async function checkStreet() {
  const shops = await Promise.all(
    SHOPS.filter((s) => s.tokenId).map(async (s) => {
      const v: ShopVerdict = await checkShop(s.tokenId!, s.name);
      return {
        token_id: s.tokenId, name: s.name, slug: s.slug, owner: v.owner, pay_to: v.payTo,
        trade: v.ok, passed: v.passed, failed: v.reasons, age_gated: v.ageGated ?? false, menu: CATALOG[s.tokenId!] ?? [],
      };
    }),
  );
  streetCache = { at: Date.now(), shops };
  return shops;
}

/** The street as the agent would see it: every shop with its live check from the registry and the chain.
 *  Checks are at most a minute old; an older result is served while a fresh check runs in the background. */
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
  const steps = [
    { step: 'task', task: r.mandate.task, limits: { budgetEur, maxPaymentEur } },
    ...r.log,
    ...(r.anchor?.hash ? [{ at: r.log.at(-1)?.at, step: 'log_anchored', tx: r.anchor.hash, ok: r.anchor.ok }] : []),
    { at: r.log.at(-1)?.at, step: 'finished', errand_id: r.id, spentEur: r.ledger?.spentEur, anchor: r.anchor?.hash },
  ];
  return { recorded: true, id: r.id, steps };
}
