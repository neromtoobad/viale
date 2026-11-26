// Minimal client for Concordium's hosted Agent Registry MCP server (streamable HTTP, JSON-RPC 2.0).
// Viale reads the registry through it; it never signs anything.
export const REGISTRY_MCP_URL = process.env.REGISTRY_MCP_URL ?? 'https://agent-registry-mcp.concordium.com/mcp';
export const NETWORK = 'testnet';

let sessionId: string | undefined;
let nextId = 0;

async function rpc(method: string, params?: unknown, notify = false): Promise<any> {
  const res = await fetch(REGISTRY_MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}), ...(notify ? {} : { id: ++nextId }) }),
  });
  sessionId = res.headers.get('mcp-session-id') ?? sessionId;
  const text = await res.text();
  if (notify) return;
  if (!res.ok) throw new Error(`registry MCP ${method}: HTTP ${res.status} ${text.slice(0, 200)}`);
  const sse = text.match(/^data: (.*)$/m);
  const msg = JSON.parse(sse ? sse[1] : text);
  if (msg.error) throw new Error(`registry MCP ${method}: ${msg.error.message}`);
  return msg.result;
}

let ready: Promise<void> | undefined;
function connect() {
  ready ??= (async () => {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'viale', version: '0.1.0' } });
    await rpc('notifications/initialized', undefined, true);
  })();
  return ready;
}

/** Calls one registry tool and returns its parsed JSON result. */
export async function callTool<T = any>(name: string, args: Record<string, unknown>): Promise<T> {
  await connect();
  const result = await rpc('tools/call', { name, arguments: { network: NETWORK, ...args } });
  const text = result?.content?.[0]?.text;
  if (result?.isError) throw new Error(`registry tool ${name}: ${text}`);
  return text ? JSON.parse(text) : result;
}

export type AgentRecord = {
  token_id: string;
  token_address: string;
  owner_account: string;
  agent_uri: string | null;
  metadata_hash_hex: string | null;
  agent_wallet: string | null;
  status: 'Active' | 'Revoked';
};

export type BadgeVerdict = {
  badge_valid: boolean;
  checks: Record<string, boolean | string>;
  issues: (string | { severity?: string; field?: string; message: string })[];
  card_sha256?: string;
};

export const agentOf = (tokenId: string) => callTool<AgentRecord | null>('agent_of', { token_id: tokenId });
export const checkBadge = (badge: string) => callTool<BadgeVerdict>('check_badge', { id: badge });
