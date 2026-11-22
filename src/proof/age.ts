// 18+ proofs with Concordium Verify & Access. A shop that sells age-restricted goods asks the errand agent
// to prove its human is 18 or older. Viale creates a proof request with Concordium's credential
// verification service (anchored on chain), the human approves a zero-knowledge proof in the
// Concordium ID app, and the service checks the presentation (anchored again). Nobody sees the birthday.
import crypto from 'node:crypto';
import { client } from '../chain/chain.ts';
import { BUSINESS_IDP_NAME } from '../errand/shop-check.ts';

export const VERIFIER_URL = process.env.VERIFIER_SERVICE_URL ?? 'http://127.0.0.1:8000';
export const REQUIRED_AGE = 18;

export type ProofState = 'waiting' | 'requested' | 'verified' | 'failed' | 'expired';

export type AgeProof = {
  id: string;
  shopTokenId: string;
  shopName: string;
  question: string;
  state: ProofState;
  createdAt: string;
  expiresAt: string;
  requestTx?: string; // Verification Request Anchor
  verifyTx?: string; // Verification Audit Anchor
  error?: string;
  request?: unknown; // the VPR sent to the ID app
};

const proofs = new Map<string, AgeProof>();
const waiters = new Map<string, ((p: AgeProof) => void)[]>();

/** Latest birthday that is 18+ today, YYYYMMDD. */
export function dobUpperBound(now = new Date(), age = REQUIRED_AGE): string {
  const d = new Date(Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate()));
  return d.toISOString().slice(0, 10).replaceAll('-', '');
}

let personalIssuers: Promise<string[]> | undefined;
/** Every testnet identity provider that issues personal IDs (all except the business one). */
function issuers(): Promise<string[]> {
  personalIssuers ??= (async () => {
    const out: string[] = [];
    for await (const ip of client().getIdentityProviders()) {
      if (!ip.ipDescription.name.includes(BUSINESS_IDP_NAME)) out.push(`did:ccd:testnet:idp:${ip.ipIdentity}`);
    }
    return out;
  })();
  return personalIssuers;
}

export function startAgeProof(shopTokenId: string, shopName: string, ttlMinutes = 10): AgeProof {
  const id = crypto.randomBytes(9).toString('base64url');
  const now = new Date();
  const p: AgeProof = {
    id,
    shopTokenId,
    shopName,
    question: `${shopName} asks: is the person behind this agent 18 or older?`,
    state: 'waiting',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
  };
  proofs.set(id, p);
  return p;
}

export function getProof(id: string): AgeProof | undefined {
  const p = proofs.get(id);
  if (p && p.state !== 'verified' && p.state !== 'failed' && new Date() > new Date(p.expiresAt)) settle(p, 'expired');
  return p;
}

/** Public view for the page: no raw request or presentation. */
export const publicView = ({ request, ...p }: AgeProof) => p;

function settle(p: AgeProof, state: ProofState, error?: string) {
  p.state = state;
  if (error) p.error = error;
  for (const w of waiters.get(p.id) ?? []) w(p);
  waiters.delete(p.id);
}

async function verifier(path: string, body: unknown) {
  const res = await fetch(`${VERIFIER_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`verifier ${path}: ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

/** Called when the human's ID app connects: create the proof request (anchored as a VRA). */
export async function createRequest(id: string, connectionId: string) {
  const p = getProof(id);
  if (!p) throw new Error('unknown proof');
  if (p.state === 'expired' || p.state === 'verified') throw new Error(`proof is ${p.state}`);
  const request = await verifier('/verifiable-presentations/create-verification-request', {
    connectionId,
    resourceId: `viale/shop/${p.shopTokenId}/age/${p.id}`,
    contextString: p.question,
    publicInfo: { app: 'viale', shop: p.shopTokenId, check: `age>=${REQUIRED_AGE}` },
    requestedClaims: [
      {
        type: 'identity',
        source: ['identityCredential'],
        issuers: await issuers(),
        statements: [{ type: 'AttributeInRange', attributeTag: 'dob', lower: '19000101', upper: dobUpperBound() }],
      },
    ],
  });
  p.request = request;
  p.requestTx = request.transactionRef;
  p.state = 'requested';
  return { request, session: publicView(p) };
}

/** Called with the ID app's presentation: verify it (anchored as a VAA). */
export async function verifyPresentation(id: string, presentation: any) {
  const p = getProof(id);
  if (!p?.request) throw new Error('no open request for this proof');
  try {
    const result = await verifier('/verifiable-presentations/verify', {
      auditRecordId: p.id,
      presentation: presentation?.verifiablePresentationJson ?? presentation,
      verificationRequest: p.request,
    });
    p.verifyTx = result.anchorTransactionHash ?? result.anchor_transaction_hash ?? result.verificationAuditRecord?.anchorTransactionHash;
    const verdict = result.result;
    if (verdict === 'Verified' || verdict === 'verified' || verdict?.type === 'verified') settle(p, 'verified');
    else settle(p, 'failed', typeof verdict === 'string' ? verdict : JSON.stringify(verdict));
  } catch (err: any) {
    settle(p, 'failed', err.message);
  }
  return publicView(p);
}

/** Resolves when the proof is verified, failed or expired. */
export function waitForProof(id: string): Promise<AgeProof> {
  const p = getProof(id);
  if (!p) return Promise.reject(new Error('unknown proof'));
  if (p.state === 'verified' || p.state === 'failed' || p.state === 'expired') return Promise.resolve(p);
  return new Promise((resolve) => {
    waiters.set(id, [...(waiters.get(id) ?? []), resolve]);
    const left = new Date(p.expiresAt).getTime() - Date.now();
    setTimeout(() => resolve(getProof(id)!), Math.max(0, left) + 50);
  });
}
