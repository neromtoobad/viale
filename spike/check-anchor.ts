// Reads a register-data transaction back from the chain and checks it holds the expected Viale digest.
import { TransactionHash } from '@concordium/web-sdk';
import { client } from '../src/chain/chain.ts';

const [hash, digest] = process.argv.slice(2);
const status = await client().getBlockItemStatus(TransactionHash.fromHexString(hash));
if (status.status !== 'finalized') throw new Error(`not finalized: ${status.status}`);
const s: any = status.outcome.summary;
const data: string = s.dataRegistered?.data ?? '';
const expected = Buffer.from('VIALE/R1').toString('hex') + digest;
console.log('sender', s.sender?.address ?? s.sender, '| type', s.transactionType, '| cost microCCD', String(s.cost?.microCcdAmount ?? s.cost));
console.log(data === expected ? 'MATCH: on-chain data = VIALE/R1 + digest' : `MISMATCH: ${data}`);
