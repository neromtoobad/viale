// Business-name proof against Concordium testnet: the real proof published for #1526 verifies, and every
// edit or reuse of it is refused. Needs network access to the testnet node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { businessChallenge, verifyBusinessProof } from './business-proof.ts';

const OWNER = '4UVsGdSyYk43E2m99Vy3M38u92yknjBUoY7xKQHGSDXZAUiWw5';
const IMPOSTOR_OWNER = '3bV1C2T7j8oNGPfZsMSP51KCgdzuTuUMjDcHFak3rHM43i46zX';
const real = fs.readFileSync(path.resolve(import.meta.dirname, '../../public/agents/1526.business.json'), 'utf8');
const edit = (f: (p: any) => void) => { const p = JSON.parse(real); f(p); return JSON.stringify(p); };
const subject = (p: any) => p.verifiableCredential[0].credentialSubject;

test('the published proof for #1526 verifies on chain and names the business', async () => {
  const r = await verifyBusinessProof(real, '1526', OWNER);
  assert.equal(r.ok, true, r.ok ? '' : r.reason);
  if (r.ok) assert.equal(r.business.legal_name, 'Viale Street Test ApS');
});

test('a proof copied to another agent is refused', async () => {
  const r = await verifyBusinessProof(real, '1406', IMPOSTOR_OWNER);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /another agent or owner/);
});

test('an edited legal name breaks the proof', async () => {
  const r = await verifyBusinessProof(edit((p) => { subject(p).proof.proofValue[0].attribute = 'Someone Else ApS'; }), '1526', OWNER);
  assert.equal(r.ok, false);
});

test('swapping in another challenge breaks the proof', async () => {
  const r = await verifyBusinessProof(edit((p) => { p.presentationContext = businessChallenge('1527', OWNER); }), '1527', OWNER);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /does not verify/);
});

test("a proof for a credential that isn't the owner's is refused", async () => {
  const r = await verifyBusinessProof(edit((p) => { p.presentationContext = businessChallenge('1526', IMPOSTOR_OWNER); }), '1526', IMPOSTOR_OWNER);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /isn't the owner account's/);
});

test('junk is refused, not thrown', async () => {
  const r = await verifyBusinessProof('{"not":"a proof"}', '1526', OWNER);
  assert.equal(r.ok, false);
});
