// "Check any agent": the same shop check Viale's errand agent runs, open to anyone, for any agent in
// Concordium's testnet Agent Registry. Served three ways from one function:
//   GET  /api/check/<tokenId>   JSON verdict
//   GET  /api/registry          who owns the registry's agents (business or personal identity)
//   POST /mcp                   an MCP server (streamable HTTP, JSON responses) with check_agent + registry_owners,
//                               so another agent can check who it is about to pay before it pays.
import type http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { checkShop, type ShopVerdict } from '../errand/shop-check.ts';
import { registryOwners, type RegistryOwners } from '../registry/owners.ts';
import { EXPLORER } from '../chain/chain.ts';

const CHECK_TTL_MS = 5 * 60_000;
const PER_IP_PER_MINUTE = 30;

const checks = new Map<string, { at: number; verdict: Promise<ShopVerdict> }>();
/** One agent's check, at most five minutes old. Concurrent callers share one run. */
export function checkAgent(tokenId: string): Promise<ShopVerdict> {
  const hit = checks.get(tokenId);
  if (hit && Date.now() - hit.at < CHECK_TTL_MS) return hit.verdict;
  const verdict = checkShop(tokenId);
  checks.set(tokenId, { at: Date.now(), verdict });
  verdict.catch(() => checks.delete(tokenId));
  return verdict;
}

export function verdictView(v: ShopVerdict) {
  return {
    token_id: v.tokenId,
    verdict: v.ok ? 'trade' : 'walk_away',
    name: v.name ?? null,
    owner: v.owner ?? null,
    owner_identity: v.ownerIdentity ?? null,
    pays_to: v.payTo ?? null,
    pays_to_identity: v.payToIdentity ?? null,
    badge: v.badge ?? null,
    agent_uri: v.agentUri ?? null,
    passed: v.passed,
    failed: v.reasons,
    explorer: v.owner ? `${EXPLORER}/account/${v.owner}` : null,
    checked: [
      'registered and Active in the CIS-8004 Agent Registry <12802,0>',
      "Verified-by-Concordium badge valid (Concordium's check_badge: card fetched, SHA-256 matches the chain)",
      "owner account holds a business identity (Global FinReg), read from the owner's credentials on chain",
      'card readable',
      "where the payment goes: the agent wallet set in the registry, or the owner's account if none is set",
    ],
  };
}

/** The caller's address. Railway's proxy appends the address it saw to X-Forwarded-For, so the last hop is
 *  the one to trust; earlier values can be set by the client. */
export function clientAddress(req: http.IncomingMessage): string {
  const hops = String(req.headers['x-forwarded-for'] ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  return hops.at(-1) ?? req.socket.remoteAddress ?? '';
}

const hits = new Map<string, number[]>();
/** True when this address has asked for more than 30 checks in the last minute. */
export function overLimit(req: http.IncomingMessage): boolean {
  const ip = clientAddress(req);
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > PER_IP_PER_MINUTE;
}

/** The newest count committed in evidence/ (made by tools/measure-registry.ts), for a server that just started. */
function committedCount(): RegistryOwners | undefined {
  const dir = path.resolve(import.meta.dirname, '../../evidence');
  const f = fs.readdirSync(dir).filter((n) => /^registry-owners-.*\.json$/.test(n)).sort().at(-1);
  if (!f) return;
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  return d.business_agents && d.newest_agents ? d : undefined;
}

// Each live count is kept (data/registry, on the volume) so the census can show the trend over time.
const SNAP_DIR = path.resolve(import.meta.dirname, '../../data/registry');
type Point = { at: string; active: number; business: number; owner_accounts: number; business_owner_accounts: number; by_idp: Record<string, number> };
const point = (d: RegistryOwners): Point => ({ at: d.measured_at, active: d.active_agents, business: d.agents_owned_by_business_identity, owner_accounts: d.owner_accounts, business_owner_accounts: d.business_owner_accounts, by_idp: d.agents_by_owner_identity_provider });
function saveSnapshot(d: RegistryOwners) {
  try {
    fs.mkdirSync(SNAP_DIR, { recursive: true });
    fs.writeFileSync(path.join(SNAP_DIR, `${d.measured_at.replace(/[:.]/g, '-')}.json`), JSON.stringify(point(d)));
  } catch (err: any) { console.error('registry snapshot not saved:', err.message); }
}
/** Every registry count: the ones committed in evidence/ and every live count this server has made. */
export function registryHistory(): Point[] {
  const pts: Point[] = [];
  const ev = path.resolve(import.meta.dirname, '../../evidence');
  for (const f of fs.readdirSync(ev).filter((n) => /^registry-owners-.*\.json$/.test(n))) {
    try { const d = JSON.parse(fs.readFileSync(path.join(ev, f), 'utf8')); if (d.measured_at) pts.push(point(d)); } catch {}
  }
  if (fs.existsSync(SNAP_DIR)) for (const f of fs.readdirSync(SNAP_DIR)) {
    try { pts.push(JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8'))); } catch {}
  }
  const seen = new Set<string>();
  return pts.filter((p) => !seen.has(p.at) && seen.add(p.at)).sort((a, b) => a.at.localeCompare(b.at));
}

let owners: { data?: RegistryOwners; live?: boolean; running?: Promise<RegistryOwners> } = {};
/** Registry owners. Counted live in the background every 6 hours (a count takes a few minutes, because the
 *  public node limits requests); until the first live count is done, the newest committed count is served. */
export function registry(): Promise<RegistryOwners & { source: string }> {
  const stale = !owners.live || Date.now() - Date.parse(owners.data!.measured_at) > 6 * 3600_000;
  if (stale && !owners.running) {
    owners.running = registryOwners()
      .then((d) => { owners.data = d; owners.live = true; saveSnapshot(d); return d; })
      .finally(() => (owners.running = undefined));
    owners.running.catch((err) => console.error('registry count failed:', err.message));
  }
  owners.data ??= committedCount();
  if (owners.data) return Promise.resolve({ ...owners.data, source: owners.live ? 'live count by this server' : 'committed count in evidence/ (a live count is running)' });
  return owners.running!.then((d) => ({ ...d, source: 'live count by this server' }));
}

// ---- MCP (JSON-RPC 2.0 over HTTP POST, JSON responses, no sessions) ----

const TOOLS = [
  {
    name: 'check_agent',
    title: 'Check an agent before paying it',
    description:
      "Checks an agent in Concordium's testnet Agent Registry (CIS-8004 <12802,0>) before you trade with or pay it: " +
      'is it registered and Active, is its Verified-by-Concordium badge valid, does the account that owns it hold a ' +
      'business identity (Global FinReg) or only a personal one, and which wallet takes its payments. ' +
      "Returns verdict 'trade' only if every check passes, else 'walk_away' with the reasons.",
    inputSchema: {
      type: 'object',
      properties: { token_id: { type: 'string', description: 'The agent token id in the registry, e.g. "1527"' } },
      required: ['token_id'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'registry_owners',
    title: "Who owns the registry's agents",
    description:
      "Counts every Active agent in Concordium's testnet Agent Registry by the identity behind its owner account, " +
      'and lists the agents owned by a business identity. Refreshed every 6 hours.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];

async function rpc(msg: any): Promise<any | undefined> {
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'invalid request');
  if (msg.id === undefined) return undefined; // a notification, e.g. notifications/initialized
  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'viale', title: 'Viale agent check', version: '1.0.0' },
        instructions: 'Call check_agent with an agent token id before paying that agent. Only trade when verdict is "trade".',
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      const { name, arguments: args } = msg.params ?? {};
      try {
        if (name === 'check_agent') {
          const id = String(args?.token_id ?? '').trim();
          if (!/^\d{1,10}$/.test(id)) return reply({ content: [{ type: 'text', text: 'token_id must be a number, e.g. "1527"' }], isError: true });
          const v = verdictView(await checkAgent(id));
          return reply({ content: [{ type: 'text', text: JSON.stringify(v, null, 2) }], structuredContent: v, isError: false });
        }
        if (name === 'registry_owners') {
          const { newest_agents, ...r } = await registry();
          return reply({ content: [{ type: 'text', text: JSON.stringify(r, null, 2) }], structuredContent: r, isError: false });
        }
        return fail(-32602, `unknown tool ${name}`);
      } catch (err: any) {
        return reply({ content: [{ type: 'text', text: `check failed: ${err.message}` }], isError: true });
      }
    }
    default:
      return fail(-32601, `method ${msg.method} not found`);
  }
}

export async function handleMcp(req: http.IncomingMessage, res: http.ServerResponse, body: any) {
  const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*' };
  const batch = Array.isArray(body);
  const calls: any[] = batch ? body : [body];
  const replies = (await Promise.all(calls.map((m) =>
    m?.method === 'tools/call' && m.id !== undefined && overLimit(req)
      ? { jsonrpc: '2.0', id: m.id, error: { code: -32000, message: `more than ${PER_IP_PER_MINUTE} checks a minute from this address; try again shortly` } }
      : rpc(m)))).filter(Boolean);
  if (!replies.length) { res.writeHead(202, headers).end(); return; }
  res.writeHead(200, headers).end(JSON.stringify(batch ? replies : replies[0]));
}
