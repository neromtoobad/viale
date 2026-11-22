// Spike 1: anchor a receipt hash on Concordium testnet with a register-data transaction.
// Personal data stays off chain: we anchor sha256(receipt || nonce) and keep receipt + nonce locally.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { DataBlob, Transaction, TransactionHash } from '@concordium/web-sdk';
import { client, txUrl } from './chain.ts';
import { sponsorWallet } from './keys.ts';

const MAGIC = Buffer.from('VIALE/R1'); // 8-byte tag so anyone can spot Viale anchors

export function receiptDigest(receipt: object, nonce: Buffer): Buffer {
  return crypto.createHash('sha256').update(JSON.stringify(receipt)).update(nonce).digest();
}

export async function anchorReceipt(receipt: object) {
  const grpc = client();
  const viale = sponsorWallet();
  const nonce = crypto.randomBytes(32);
  const digest = receiptDigest(receipt, nonce);
  const { nonce: accountNonce } = await grpc.getNextAccountNonce(viale.address);

  const tx = Transaction.registerData({ data: new DataBlob(Buffer.concat([MAGIC, digest])) })
    .addMetadata({ sender: viale.address, nonce: accountNonce })
    .build();
  const finalized = await Transaction.signAndFinalize(tx, viale.signer);
  const hash = await grpc.sendTransaction(finalized);
  const outcome = await grpc.waitForTransactionFinalization(hash);
  const ok = outcome.summary.type === 'accountTransaction' && outcome.summary.transactionType !== 'failed';
  return { hash: TransactionHash.toHexString(hash), digest: digest.toString('hex'), nonce: nonce.toString('hex'), ok, block: outcome.blockHash.toString() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const receipt = { kind: 'spike', shop: 'test', item: 'anchor check', at: new Date().toISOString() };
  const r = await anchorReceipt(receipt);
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(`data/receipt-${r.hash.slice(0, 12)}.json`, JSON.stringify({ receipt, ...r }, null, 2));
  console.log(r.ok ? 'Anchored' : 'FAILED', txUrl(r.hash));
  console.log('digest', r.digest);
}
