// Business-name proof: ties a registry agent to the legal business behind its owner.
//
// A Global FinReg business identity commits, on chain, to the company's legal name, country, registration
// authority and business number (attribute commitments in the owner account's credential). The owner proves those values with a
// Concordium verifiable presentation (a zero-knowledge proof that reveals exactly these attributes and nothing
// else), made for a challenge that names one registry agent and its owner. So a proof can't be copied to
// another agent or another owner, and the revealed name can't be edited without breaking the proof.
//
// Anyone can check it: the proof is verified against the credential's commitments read from a node, and the
// credential must be one of the owner account's own. The shop check then reports "operated by <legal name>".
import crypto from 'node:crypto';
import {
  AccountAddress,
  ConcordiumHdWallet,
  VerifiablePresentation,
  createAccountCommitmentInputWithHdWallet,
  getPublicData,
  getVerifiablePresentation,
  verifyPresentation,
  type AtomicStatementV2,
} from '@concordium/web-sdk';
import { client, withRetry } from '../chain/chain.ts';

export const REGISTRY = '<12802,0>';
/** The attributes a business proof reveals. The legal name and country must be set; Global FinReg's test flow
 *  can issue an identity with an empty business number (ours has one), which the proof then shows as empty. */
export const REVEALED = ['legalName', 'legalCountry', 'registrationAuth', 'businessNumber'] as const;
const REQUIRED = ['legalName', 'legalCountry'] as const;
/** CIS4.CredentialStatus.Active (the SDK's enum: Active 0, Revoked 1, Expired 2, NotActivated 3). */
const ACTIVE = 0;
const statement: AtomicStatementV2[] = REVEALED.map((attributeTag) => ({ type: 'RevealAttribute', attributeTag }) as AtomicStatementV2);

/** The challenge a business proof is made for: one agent in one registry, owned by one account. */
export function businessChallenge(tokenId: string, owner: string): string {
  return crypto.createHash('sha256').update(`viale-business-proof/v1|${REGISTRY}|${tokenId}|${owner}`).digest('hex');
}

export type Business = { legal_name: string; country: string; registration_authority: string; business_number: string };
export type BusinessProofResult = { ok: true; business: Business; cred_id: string } | { ok: false; reason: string };

/** Makes the proof from the owner's identity (prover side: needs the owner's seed and identity object). */
export async function proveBusiness(input: {
  tokenId: string; owner: string; seedHex: string; identityProvider: number; identityIndex: number; credIndex: number;
  attributes: any; // the identity object's attributeList
}): Promise<VerifiablePresentation> {
  const grpc = client();
  const info = await withRetry(() => grpc.getAccountInfo(AccountAddress.fromBase58(input.owner)));
  const cred: any = Object.values(info.accountCredentials)[0];
  const credId: string = cred.value.contents.credId ?? cred.value.contents.regId;
  const wallet = ConcordiumHdWallet.fromHex(input.seedHex, 'Testnet');
  const commitment = createAccountCommitmentInputWithHdWallet(statement, input.identityProvider, input.attributes, wallet, input.identityIndex, input.credIndex);
  return getVerifiablePresentation({
    request: { challenge: businessChallenge(input.tokenId, input.owner), credentialStatements: [{ id: `did:ccd:testnet:cred:${credId}`, statement }] },
    globalContext: await grpc.getCryptographicParameters(),
    commitmentInputs: [commitment],
  });
}

let ctx: ReturnType<ReturnType<typeof client>['getCryptographicParameters']> | undefined;
/** The chain's cryptographic parameters (fixed for a network), read once. */
function globalContext() {
  ctx ??= withRetry(() => client().getCryptographicParameters());
  ctx.catch(() => { ctx = undefined; });
  return ctx;
}

/** Checks a business proof for an agent and its owner, against the chain. Never throws. */
export async function verifyBusinessProof(json: string, tokenId: string, owner: string): Promise<BusinessProofResult> {
  try {
    const p = VerifiablePresentation.fromString(json);
    const want = businessChallenge(tokenId, owner);
    if (p.presentationContext !== want) return { ok: false, reason: 'business proof was made for another agent or owner' };
    if (p.verifiableCredential.length !== 1) return { ok: false, reason: 'business proof must cover exactly one credential' };
    const vc: any = p.verifiableCredential[0];
    const credId = String(vc.credentialSubject?.id ?? '').split(':').at(-1) ?? '';
    // The credential must be one of the owner account's own.
    const grpc = client();
    const info = await withRetry(() => grpc.getAccountInfo(AccountAddress.fromBase58(owner)));
    const ownCreds = Object.values(info.accountCredentials).map((c: any) => String(c.value.contents.credId ?? c.value.contents.regId));
    if (!ownCreds.includes(credId)) return { ok: false, reason: "business proof is for a credential that isn't the owner account's" };
    // Verify the zero-knowledge proof against the credential's commitments on chain.
    const pub = await withRetry(() => getPublicData(grpc, 'Testnet', p));
    if (pub.some((c) => Number(c.status) !== ACTIVE)) return { ok: false, reason: 'the credential behind the business proof is not active' };
    const request = verifyPresentation(p, await globalContext(), pub.map((c) => c.inputs));
    if (request.challenge !== want) return { ok: false, reason: 'business proof does not verify for this challenge' };
    const values = revealedValues(vc);
    for (const k of REVEALED) if (!(k in values)) return { ok: false, reason: `business proof does not reveal ${k}` };
    for (const k of REQUIRED) if (!values[k]) return { ok: false, reason: `business proof reveals an empty ${k}` };
    return {
      ok: true, cred_id: credId,
      business: { legal_name: values.legalName, country: values.legalCountry, registration_authority: values.registrationAuth, business_number: values.businessNumber },
    };
  } catch (e: any) {
    return { ok: false, reason: `business proof does not verify: ${String(e?.message ?? e).slice(0, 160)}` };
  }
}

/** Revealed attribute values, in statement order, from a verified account credential. */
function revealedValues(vc: any): Record<string, string> {
  const statements: any[] = vc.credentialSubject?.statement ?? [];
  const proofs: any[] = vc.credentialSubject?.proof?.proofValue ?? [];
  const out: Record<string, string> = {};
  statements.forEach((s, i) => { if (s.type === 'RevealAttribute' && proofs[i]?.type === 'RevealAttribute') out[s.attributeTag] = String(proofs[i].attribute); });
  return out;
}
