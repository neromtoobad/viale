// Viale's check as an A2A agent: an agent card at /.well-known/agent-card.json and JSON-RPC `message/send`
// at /a2a. Another agent sends a token id (as a data part {token_id} or in text) and gets the verdict back
// as a Message with a text summary and the full verdict as a data part. Only message/send is served:
// no streaming, no long-running tasks (a check takes a few seconds).
import crypto from 'node:crypto';
import { checkAgent, verdictView } from './check.ts';

export function agentCard(base: string) {
  return {
    protocolVersion: '0.3.0',
    name: 'Viale agent check',
    description: "Checks an agent in Concordium's Agent Registry (CIS-8004, testnet) before you pay it: registered and Active, Verified-by-Concordium badge valid, owner account holds a business identity (Global FinReg), and which wallet takes its payments. Verdict 'trade' or 'walk_away' with reasons.",
    url: `${base}/a2a`,
    preferredTransport: 'JSONRPC',
    version: '1.0.0',
    provider: { organization: 'Viale', url: base },
    documentationUrl: `${base}/developers`,
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['application/json', 'text/plain'],
    defaultOutputModes: ['application/json', 'text/plain'],
    skills: [{
      id: 'check_agent',
      name: 'Check an agent before paying it',
      description: 'Send the agent token id, e.g. {"token_id":"1527"} as a data part, or "check 1527" as text.',
      tags: ['concordium', 'cis-8004', 'kyb', 'payments', 'trust'],
      examples: ['check 1527', '{"token_id":"1406"}'],
      inputModes: ['application/json', 'text/plain'],
      outputModes: ['application/json'],
    }],
  };
}

function tokenIdFrom(message: any): string | undefined {
  for (const p of message?.parts ?? []) {
    const kind = p.kind ?? p.type;
    if (kind === 'data' && p.data?.token_id != null) return String(p.data.token_id).trim();
    if (kind === 'text' && typeof p.text === 'string') { const m = p.text.match(/\b(\d{1,10})\b/); if (m) return m[1]; }
  }
}

/** One JSON-RPC 2.0 request. Returns the reply object, or null for a notification. */
export async function a2aRpc(msg: any) {
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg?.id ?? null, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg?.id ?? null, error: { code, message } });
  if (msg?.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'invalid request');
  if (msg.method !== 'message/send') return fail(-32601, `method ${msg.method} not supported here (only message/send)`);
  const incoming = msg.params?.message;
  const id = tokenIdFrom(incoming);
  const out = (parts: unknown[]) => reply({ kind: 'message', role: 'agent', messageId: crypto.randomUUID(), contextId: incoming?.contextId ?? crypto.randomUUID(), parts });
  if (!id) return out([{ kind: 'text', text: 'Send the agent token id to check, e.g. {"token_id":"1527"} or "check 1527".' }]);
  const v = verdictView(await checkAgent(id));
  const text = v.verdict === 'trade'
    ? `Agent #${id}${v.name ? ` (${v.name})` : ''}: trade. Every check passed; pay ${v.pays_to}.`
    : `Agent #${id}${v.name ? ` (${v.name})` : ''}: walk away. ${v.failed.join('; ')}`;
  return out([{ kind: 'text', text }, { kind: 'data', data: v }]);
}
