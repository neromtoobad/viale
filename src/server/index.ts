// Viale's local server: the public site, the shop agents (menus + signed quotes), the 18+ proof page and its API.
// The errand agent runs in the same process so it can wait for the human's proof.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { setting } from '../chain/keys.ts';
import { createRequest, getProof, publicView, verifyPresentation } from '../proof/age.ts';
import { buy, menu, quote, streetWallets } from '../street/shop-agent.ts';
import { SHOPS } from '../street/shops.ts';
import { facilitate, supported } from '../pay/facilitator.ts';
import { followErrand, errandLimits, latestErrand, mandateDraft, startErrand, street } from './errands.ts';
import { EXPLORER } from '../chain/chain.ts';
import { checkAgent, handleMcp, overLimit, registry, registryHistory, verdictView } from './check.ts';
import { list as errandList, record as errandRecord, stats, verifySeal, verifySignature } from './history.ts';
import { latestProof, scheduleProof } from './proof.ts';

export const PORT = Number(process.env.PORT ?? 3000);
export const PUBLIC_URL = process.env.VIALE_PUBLIC_URL ?? `http://localhost:${PORT}`;
const ROOT = path.resolve(import.meta.dirname, '../..');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const expose = Object.keys(headers).length ? { 'access-control-expose-headers': Object.keys(headers).join(', ') } : {};
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers, ...expose });
  res.end(JSON.stringify(body));
}

function file(res: http.ServerResponse, p: string) {
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return send(res, 404, { error: 'not found' });
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(p).pipe(res);
}

async function body(req: http.IncomingMessage): Promise<any> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) throw new Error('body too large');
  }
  return raw ? JSON.parse(raw) : {};
}

export function startServer(): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', PUBLIC_URL);
      const parts = url.pathname.split('/').filter(Boolean);

      if (url.pathname === '/api/config') {
        const projectId = setting('WALLETCONNECT_PROJECT_ID');
        if (!projectId) return send(res, 500, { error: 'WALLETCONNECT_PROJECT_ID is not set (env or ~/.viale-keys/keys.env)' });
        return send(res, 200, { network: 'testnet', walletConnectProjectId: projectId });
      }
      if (parts[0] === 'api' && parts[1] === 'proof' && parts[2]) {
        const p = getProof(parts[2]);
        if (!p) return send(res, 404, { error: 'No such proof request' });
        if (req.method === 'GET' && !parts[3]) return send(res, 200, publicView(p));
        if (req.method === 'POST' && parts[3] === 'create') {
          const { connectionId } = await body(req);
          if (typeof connectionId !== 'string' || !connectionId) return send(res, 400, { error: 'connectionId missing' });
          return send(res, 200, await createRequest(p.id, connectionId));
        }
        if (req.method === 'POST' && parts[3] === 'verify') {
          const { presentation } = await body(req);
          return send(res, 200, await verifyPresentation(p.id, presentation));
        }
        return send(res, 405, { error: 'method not allowed' });
      }
      // Check any agent in the registry (same check the errand agent runs), as JSON, as an MCP tool, and as a page.
      if (parts[0] === 'api' && parts[1] === 'check' && parts[2]) {
        if (!/^\d{1,10}$/.test(parts[2])) return send(res, 400, { error: 'token id must be a number' });
        if (overLimit(req)) return send(res, 429, { error: 'Too many checks from this address. Try again in a minute.' });
        return send(res, 200, verdictView(await checkAgent(parts[2])));
      }
      if (url.pathname === '/api/registry') return send(res, 200, await registry());
      if (url.pathname === '/mcp') {
        if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type, accept, mcp-protocol-version, mcp-session-id' }).end(); return; }
        if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST', 'content-type': 'application/json' }).end(JSON.stringify({ error: 'POST JSON-RPC to this MCP endpoint' })); return; }
        let msg: any;
        try { msg = await body(req); } catch { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
        return handleMcp(req, res, msg);
      }
      if (parts[0] === 'check' && parts.length <= 2) return file(res, path.join(ROOT, 'public/check.html'));
      if (url.pathname === '/api/street') return send(res, 200, { shops: await street(), explorer: EXPLORER, limits: errandLimits });
      if (url.pathname === '/api/errands/latest') return send(res, 200, latestErrand());
      // A mandate for the visitor's wallet to sign (Concordium Browser Wallet signMessage).
      if (url.pathname === '/api/mandates/draft' && req.method === 'POST') {
        const { task, human, options } = await body(req);
        const r = mandateDraft(task, human, options);
        return send(res, r.error ? 400 : 200, r);
      }
      // Start an errand: { mandate: { message, signature } } signed by the visitor, or { task } for the demo signer.
      if (url.pathname === '/api/errands' && req.method === 'POST') {
        const { task, mandate, options } = await body(req);
        const r = await startErrand({ task, mandate, options });
        return send(res, r.error ? (r.status ?? 400) : 200, r.error ? { error: r.error } : { id: r.id });
      }
      if (parts[0] === 'api' && parts[1] === 'errands' && parts[2] && parts[3] === 'events') return followErrand(parts[2], res);
      // Errand history: every errand this server ran (data/errands, kept on a volume) plus the committed runs.
      if (url.pathname === '/api/errands' && req.method === 'GET') {
        const outcome = url.searchParams.get('outcome');
        const all = errandList();
        return send(res, 200, { errands: outcome ? all.filter((e) => e.outcome === outcome) : all, total: all.length });
      }
      if (parts[0] === 'api' && parts[1] === 'errands' && parts[2] && !parts[3]) {
        const r = errandRecord(parts[2]);
        return r ? send(res, 200, r) : send(res, 404, { error: 'No errand with that id' });
      }
      if (url.pathname === '/api/stats') {
        const reg = await registry();
        return send(res, 200, { ...stats(), registry: { active: reg.active_agents, business: reg.agents_owned_by_business_identity, owner_accounts: reg.owner_accounts, measured_at: reg.measured_at }, shops: SHOPS.filter((s) => s.tokenId).length });
      }
      if (url.pathname === '/api/registry/history') return send(res, 200, { points: registryHistory() });
      if (url.pathname === '/api/proof') return send(res, 200, latestProof());
      // Audit desk: anyone can re-check a seal or a signature against the chain.
      if (url.pathname === '/api/verify/seal' && req.method === 'POST') {
        if (overLimit(req)) return send(res, 429, { error: 'Too many checks from this address. Try again in a minute.' });
        return send(res, 200, await verifySeal(await body(req)));
      }
      if (url.pathname === '/api/verify/signature' && req.method === 'POST') {
        if (overLimit(req)) return send(res, 429, { error: 'Too many checks from this address. Try again in a minute.' });
        return send(res, 200, await verifySignature(await body(req)));
      }
      if (parts[0] === 'api' && parts[1] === 'shops' && /^\d{1,10}$/.test(parts[2] ?? '') && !parts[3]) {
        const shop = (await street()).find((s: any) => s.token_id === parts[2]);
        const sales = errandList().flatMap((e) => e.payments.filter((p) => p.token_id === parts[2]).map((p) => ({ ...p, errand: e.id, at: e.at })));
        const visits = errandList().filter((e) => e.shops_checked.some((c) => c.token_id === parts[2])).length;
        const card = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'public/agents', `${parts[2]}.json`), 'utf8')); } catch { return null; } })();
        const meta = SHOPS.find((s) => s.tokenId === parts[2]);
        if (!shop && !card) return send(res, 404, { error: 'Not a shop on this street. Use /check/<id> for any registry agent.' });
        return send(res, 200, { shop: shop ?? null, card, impostor: !!meta?.impostor, description: meta?.description ?? null, sales, visits });
      }
      // Shop agents: GET /shops/<tokenId>/menu, POST /shops/<tokenId>/quote {sku} -> quote signed by the shop owner.
      if (parts[0] === 'shops' && /^\d+$/.test(parts[1] ?? '')) {
        if (req.method === 'GET' && parts[2] === 'menu') return send(res, 200, { shop_token_id: parts[1], items: menu(parts[1]) });
        if (req.method === 'POST' && parts[2] === 'quote') {
          const { sku } = await body(req);
          if (typeof sku !== 'string' || !sku) return send(res, 400, { error: 'sku missing' });
          return send(res, 200, await quote(parts[1], sku));
        }
        // x402: the shop's paid resource. No PAYMENT-SIGNATURE header -> 402 with the payment requirements.
        if (req.method === 'POST' && parts[2] === 'buy') {
          const { quote: q } = await body(req);
          const sale = await buy(parts[1], q, req.headers['payment-signature'] as string | undefined, `${PUBLIC_URL}/shops/${parts[1]}/buy`, `${PUBLIC_URL}/x402/facilitator`);
          return send(res, sale.status, sale.body, sale.headers);
        }
        return send(res, 404, { error: 'not found' });
      }
      // Viale's x402 facilitator (verify, settle, supported), called by the shops over HTTP.
      if (parts[0] === 'x402' && parts[1] === 'facilitator') {
        if (req.method === 'GET' && parts[2] === 'supported') return send(res, 200, supported());
        if (req.method === 'POST' && (parts[2] === 'verify' || parts[2] === 'settle')) {
          const r = await facilitate(parts[2], await body(req), await streetWallets());
          return send(res, r.status, r.body);
        }
        return send(res, 404, { error: 'not found' });
      }
      // Pages (clean URLs). /shops/<id> with nothing after it is the shop's page; its APIs are below it.
      const PAGES: Record<string, string> = { errands: 'errands', shops: 'shops', verify: 'verify', developers: 'developers', registry: 'registry', mainnet: 'mainnet', proof: 'proof', account: 'account', open: 'open' };
      if (req.method === 'GET' && parts.length === 1 && PAGES[parts[0]]) return file(res, path.join(ROOT, `public/${PAGES[parts[0]]}.html`));
      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'errands') return file(res, path.join(ROOT, 'public/errand.html'));
      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'shops' && /^\d+$/.test(parts[1])) return file(res, path.join(ROOT, 'public/shop.html'));
      if (parts[0] === 'prove' && parts[1] === 'app.js') return file(res, path.join(ROOT, 'dist/prove/app.js'));
      if (parts[0] === 'prove' && parts[1] === 'app.css') return file(res, path.join(ROOT, 'dist/prove/app.css'));
      if (parts[0] === 'prove' && parts[1]) return file(res, path.join(ROOT, 'web/prove.html'));

      const rel = path.normalize(url.pathname === '/' ? '/index.html' : url.pathname);
      const target = path.join(ROOT, 'public', rel);
      if (!target.startsWith(path.join(ROOT, 'public'))) return send(res, 403, { error: 'forbidden' });
      return file(res, target);
    } catch (err: any) {
      console.error(`${req.method} ${req.url}: ${err.message}`);
      send(res, 500, { error: err.message });
    }
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startServer();
  console.log(`Viale server on ${PUBLIC_URL}`);
  // First live registry count, after the street's first check has had the node to itself.
  setTimeout(() => registry().catch((err) => console.error('registry count failed:', err.message)), 30_000);
  // Keeps the census fresh (registry() recounts when the last count is 6 hours old) and runs the live checker.
  setInterval(() => registry().catch(() => {}), 3600_000);
  if (process.env.VIALE_PROOF_RUNS !== 'off' && !PUBLIC_URL.includes('localhost')) scheduleProof(PUBLIC_URL);
}
