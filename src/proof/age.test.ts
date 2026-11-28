// The 18+ wallet proof's request checks, before any chain call: the proof must answer this request's challenge,
// prove exactly "18 or older", come from one identity credential, and from a personal identity provider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VerifiablePresentation, Web3StatementBuilder } from '@concordium/web-sdk';
import fs from 'node:fs';
import path from 'node:path';
import { checkWalletProof, dobUpperBound, walletChallenge, walletPresentationProblems } from './age.ts';

const PERSONAL = [0, 1, 2];
const statementsFor = (age: number, issuers = PERSONAL) => new Web3StatementBuilder().addForIdentityCredentials(issuers, (b) => b.addMinimumAge(age)).getStatements();
const want = { challenge: walletChallenge({ id: 'p1', shopTokenId: '1526', expiresAt: '2099-01-01T00:00:00Z' }), statements: statementsFor(18) };
const cred = (o: { issuer?: string; statement?: unknown } = {}) => ({
  type: ['VerifiableCredential', 'ConcordiumVerifiableCredential'],
  issuer: o.issuer ?? 'did:ccd:testnet:idp:0',
  credentialSubject: { id: 'did:ccd:testnet:cred:' + 'ab'.repeat(48), statement: o.statement ?? want.statements[0].statement, proof: { type: 'ConcordiumZKProofV3', created: '2026-11-27T00:00:00Z', proofValue: [] } },
});
const vp = (o: { challenge?: string; creds?: unknown[] } = {}) =>
  VerifiablePresentation.fromString(JSON.stringify({
    presentationContext: o.challenge ?? want.challenge,
    proof: { type: 'ConcordiumWeakLinkingProofV1', created: '2026-11-27T00:00:00Z', proofValue: [] },
    type: 'VerifiablePresentation',
    verifiableCredential: o.creds ?? [cred()],
  }));

test('a presentation for this request, proving 18+, from a personal identity, has no problems', () => {
  assert.deepEqual(walletPresentationProblems(vp(), want, PERSONAL), []);
});

test('the same statement with its keys in another order (as the wallet sends it) is accepted', () => {
  const sorted = want.statements[0].statement.map((x: any) => Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))));
  assert.deepEqual(walletPresentationProblems(vp({ creds: [cred({ statement: sorted })] }), want, PERSONAL), []);
});

test("a proof made for another request is refused", () => {
  const other = walletChallenge({ id: 'p2', shopTokenId: '1526', expiresAt: '2099-01-01T00:00:00Z' });
  assert.match(walletPresentationProblems(vp({ challenge: other }), want, PERSONAL).join(), /another request/);
});

test('a proof of a weaker statement (16 or older) is refused', () => {
  assert.match(walletPresentationProblems(vp({ creds: [cred({ statement: statementsFor(16)[0].statement })] }), want, PERSONAL).join(), /requested statement/);
});

test('a proof from the business identity provider is refused', () => {
  assert.match(walletPresentationProblems(vp({ creds: [cred({ issuer: 'did:ccd:testnet:idp:4' })] }), want, PERSONAL).join(), /not a personal identity provider/);
});

test('a proof over two credentials is refused', () => {
  assert.match(walletPresentationProblems(vp({ creds: [cred(), cred()] }), want, PERSONAL).join(), /exactly one credential/);
});

test('the age bound: born on this day 18 years ago counts as 18', () => {
  assert.equal(dobUpperBound(new Date('2026-11-27T12:00:00Z')), '20081127');
});

// A real proof from the Concordium Browser Wallet, saved by src/proof/try.ts. Needs the testnet node.
const saved = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../evidence/age-proof-wallet-2026-11-27.json'), 'utf8'));
const savedWant = { challenge: saved.challenge, statements: saved.statement };

test('the saved wallet proof verifies on chain and names the account that made it', async () => {
  const r = await checkWalletProof(saved.proved.presentation, savedWant);
  assert.equal(r.ok, true, r.ok ? '' : r.reason);
  if (r.ok) assert.equal(r.account, saved.proved.account);
});

test('the saved proof is refused when the errand was signed by someone else', async () => {
  const r = await checkWalletProof(saved.proved.presentation, savedWant, { human: '3BLLTUG1XCZQzPgctHeMv9PsXn4KDaLYGpQDVui9xy94gUYHVh' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /who signed this errand's mandate/);
});

test('an edited saved proof (claims a later birthday bound) does not verify', async () => {
  const edited = JSON.parse(saved.proved.presentation);
  edited.verifiableCredential[0].credentialSubject.statement[0].upper = '20101128';
  const statements = JSON.parse(JSON.stringify(saved.statement));
  statements[0].statement[0].upper = '20101128';
  const r = await checkWalletProof(JSON.stringify(edited), { challenge: saved.challenge, statements });
  assert.equal(r.ok, false);
});
