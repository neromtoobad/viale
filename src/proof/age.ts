// 18+ proofs. A shop that sells age-restricted goods asks the errand agent to prove its human is 18 or older.
// Two ways, same zero-knowledge statement (date of birth at least 18 years ago); nobody sees the birthday:
//  - Concordium Browser Wallet (walletRequest / verifyWalletPresentation): the wallet proves the statement from
//    the human's identity credential, for a challenge tied to this one request. Viale checks the statement, the
//    issuer and the challenge, verifies the proof against the credential's commitments on chain, and, when a
//    human signed the errand's mandate with their wallet, that the credential is that same account's.
//  - Concordium ID app (createRequest / verifyPresentation): Verify & Access through Concordium's credential
//    verification service, which anchors the request and the result on chain.
import crypto from 'node:crypto';
import {
  CredentialRegistrationId,
  VerifiablePresentation,
  Web3StatementBuilder,
  getPublicData,
  verifyPresentation as verifyWeb3Presentation,
  type CredentialStatements,
} from '@concordium/web-sdk';
import { client, cryptoParams, withRetry } from '../chain/chain.ts';
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
  human?: string; // the account that signed the errand's mandate, when it was a wallet (not Viale's demo signer)
  wallet?: { challenge: string; statements: CredentialStatements }; // the browser-wallet request
  proved?: { by: 'wallet' | 'id_app'; account?: string; credId?: string; issuer?: string; presentation?: string };
};

const proofs = new Map<string, AgeProof>();
const waiters = new Map<string, ((p: AgeProof) => void)[]>();

/** Latest birthday that is 18+ today, YYYYMMDD. */
export function dobUpperBound(now = new Date(), age = REQUIRED_AGE): string {
  const d = new Date(Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate()));
  return d.toISOString().slice(0, 10).replaceAll('-', '');
}

let personalIssuers: Promise<number[]> | undefined;
/** Every testnet identity provider that issues personal IDs (all except the business one), by index. */
export function personalIssuerIds(): Promise<number[]> {
  personalIssuers ??= (async () => {
    const out: number[] = [];
    for await (const ip of client().getIdentityProviders()) {
      if (!ip.ipDescription.name.includes(BUSINESS_IDP_NAME)) out.push(Number(ip.ipIdentity));
    }
    return out;
  })();
  personalIssuers.catch(() => { personalIssuers = undefined; });
  return personalIssuers;
}
const issuers = async () => (await personalIssuerIds()).map((i) => `did:ccd:testnet:idp:${i}`);

export function startAgeProof(shopTokenId: string, shopName: string, ttlMinutes = 10, opts: { human?: string } = {}): AgeProof {
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
    human: opts.human,
  };
  proofs.set(id, p);
  return p;
}

export function getProof(id: string): AgeProof | undefined {
  const p = proofs.get(id);
  if (p && p.state !== 'verified' && p.state !== 'failed' && new Date() > new Date(p.expiresAt)) settle(p, 'expired');
  return p;
}

/** Public view for the page: no raw ID-app request or presentation. */
export const publicView = ({ request, wallet, proved, ...p }: AgeProof) => ({ ...p, proved: proved ? { by: proved.by, account: proved.account } : undefined });

/** The challenge a wallet proof is made for: this one request, for this shop, until it expires. */
export const walletChallenge = (p: Pick<AgeProof, 'id' | 'shopTokenId' | 'expiresAt'>) =>
  crypto.createHash('sha256').update(`viale-age-proof/v1|${p.id}|${p.shopTokenId}|${p.expiresAt}|age>=${REQUIRED_AGE}`).digest('hex');

/** What the browser wallet is asked to prove: the human's date of birth is at least 18 years ago. */
export async function walletRequest(id: string) {
  const p = getProof(id);
  if (!p) throw new Error('unknown proof');
  if (p.state === 'expired' || p.state === 'verified') throw new Error(`proof is ${p.state}`);
  p.wallet ??= {
    challenge: walletChallenge(p),
    statements: new Web3StatementBuilder().addForIdentityCredentials(await personalIssuerIds(), (b) => b.addMinimumAge(REQUIRED_AGE)).getStatements(),
  };
  return { challenge: p.wallet.challenge, statements: p.wallet.statements, human: p.human ?? null, session: publicView(p) };
}

/** JSON with object keys sorted, so two encodings of one statement compare equal (the wallet sorts keys). */
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

/** Problems with a wallet presentation for a request, before any chain call: right challenge, one identity
 *  credential, exactly the requested statement, from a personal identity provider. */
export function walletPresentationProblems(vp: VerifiablePresentation, want: { challenge: string; statements: CredentialStatements }, issuerIds: number[]): string[] {
  const out: string[] = [];
  if (vp.presentationContext !== want.challenge) out.push('the proof was made for another request');
  if (vp.verifiableCredential.length !== 1) out.push('the proof must cover exactly one credential');
  const vc: any = vp.verifiableCredential[0];
  if (!vc) return out;
  if (!String(vc.credentialSubject?.id ?? '').startsWith('did:ccd:testnet:cred:')) out.push('the proof is not from a Concordium testnet identity credential');
  const issuer = Number(String(vc.issuer ?? '').match(/^did:ccd:testnet:idp:(\d+)$/)?.[1] ?? NaN);
  if (!issuerIds.includes(issuer)) out.push(`the credential's issuer (${vc.issuer}) is not a personal identity provider`);
  if (canonical(vc.credentialSubject?.statement) !== canonical(want.statements[0].statement)) out.push('the proof does not prove the requested statement (age 18 or older)');
  return out;
}

export type WalletProofCheck = { ok: true; account: string; credId: string; issuer: string } | { ok: false; reason: string };

/** Checks a wallet presentation against what was asked and against the chain. Anyone can re-run it on a saved
 *  proof (evidence/age-proof-wallet-*.json). Never throws. */
export async function checkWalletProof(json: string, want: { challenge: string; statements: CredentialStatements }, opts: { human?: string } = {}): Promise<WalletProofCheck> {
  try {
    const vp = VerifiablePresentation.fromString(json);
    const problems = walletPresentationProblems(vp, want, await personalIssuerIds());
    if (problems.length) return { ok: false, reason: problems.join('; ') };
    const grpc = client();
    const pub = await withRetry(() => getPublicData(grpc, 'Testnet', vp));
    if (pub.some((c) => Number(c.status) !== 0)) return { ok: false, reason: 'the identity credential behind the proof is not active' };
    const checked = verifyWeb3Presentation(vp, await cryptoParams(), pub.map((c) => c.inputs));
    if (checked.challenge !== want.challenge) return { ok: false, reason: 'the proof does not verify for this request' };
    const vc: any = vp.verifiableCredential[0];
    const credId = String(vc.credentialSubject.id).split(':').at(-1)!;
    const account = (await withRetry(() => grpc.getAccountInfo(CredentialRegistrationId.fromHexString(credId)))).accountAddress.address;
    if (opts.human && account !== opts.human) return { ok: false, reason: `the proof is from account ${account.slice(0, 6)}…, not ${opts.human.slice(0, 6)}…, who signed this errand's mandate` };
    return { ok: true, account, credId, issuer: vc.issuer };
  } catch (err: any) {
    return { ok: false, reason: `the proof does not verify: ${String(err?.message ?? err).slice(0, 200)}` };
  }
}

/** Called with the browser wallet's presentation: check it, and settle the request when it passes. */
export async function verifyWalletPresentation(id: string, json: string) {
  const p = getProof(id);
  if (!p?.wallet) throw new Error('no open wallet request for this proof');
  if (p.state === 'verified' || p.state === 'expired') return publicView(p);
  const r = await checkWalletProof(json, p.wallet, { human: p.human });
  if (!r.ok) {
    // A wrong proof can be retried until the request expires; only the reason is kept.
    p.error = r.reason;
    return { ...publicView(p), rejected: r.reason };
  }
  p.proved = { by: 'wallet', account: r.account, credId: r.credId, issuer: r.issuer, presentation: json };
  settle(p, 'verified');
  return publicView(p);
}

/** The full record of a verified proof, for the errand log (the presentation lets anyone re-check it). */
export const proofRecord = (p: AgeProof) => ({ state: p.state, proved: p.proved, challenge: p.wallet?.challenge, statement: p.wallet?.statements, requestTx: p.requestTx, verifyTx: p.verifyTx });

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
    if (verdict === 'Verified' || verdict === 'verified' || verdict?.type === 'verified') { p.proved = { by: 'id_app' }; settle(p, 'verified'); }
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
