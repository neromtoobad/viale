// Spike 2: the errand agent pays a shop in EUDemo over x402 (exact scheme, V1 sponsored transfer).
// Viale's facilitator checks the payment, adds its sponsor signature and pays the CCD fee,
// so the agent never holds CCD. Then both sides' receipt is anchored (src/chain/anchor.ts).
// Usage: node spike/pay.ts <shopAddress> [amount EUDemo, default 1.24]
import { ExactConcordiumScheme as ClientScheme } from '@x402/concordium/exact/client';
import { ExactConcordiumScheme as FacilitatorScheme } from '@x402/concordium/exact/facilitator';
import { CONCORDIUM_TESTNET_CAIP2, toConcordiumFacilitatorSigner } from '@x402/concordium';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { AccountAddress } from '@concordium/web-sdk';
import { GRPC_HOST, GRPC_PORT, client, txUrl } from '../src/chain/chain.ts';
import { agentWallet, sponsorWallet } from '../src/chain/keys.ts';
import { anchorReceipt } from '../src/chain/anchor.ts';

const TOKEN = 'EUDemo';
const DECIMALS = 6;
const shop = process.argv[2];
const amount = process.argv[3] ?? '1.24';
if (!shop) throw new Error('usage: node spike/pay.ts <shopAddress> [amount]');
AccountAddress.fromBase58(shop); // throws on a bad address

const agent = agentWallet();
const viale = sponsorWallet();
const grpc = client();

async function balances(label: string) {
  for (const [name, addr] of [['agent', agent.address], ['shop', AccountAddress.fromBase58(shop)], ['viale', viale.address]] as const) {
    const i = await grpc.getAccountInfo(addr);
    const t = (i.accountTokens ?? []).find((x: any) => String(x.id) === TOKEN);
    const eud = t ? Number(t.state.balance.value) / 10 ** t.state.balance.decimals : 0;
    console.log(`${label} ${name.padEnd(5)} CCD=${Number(i.accountAmount.microCcdAmount) / 1e6} ${TOKEN}=${eud}`);
  }
}

// Facilitator: Viale's sponsor account.
const facilitator = new FacilitatorScheme({
  signer: toConcordiumFacilitatorSigner(viale.address.address, viale.signKeyHex, { host: GRPC_HOST, port: GRPC_PORT, useTls: true }),
});

// Shop side: what it asks for (the 402 response). feePayer comes from the facilitator.
const atomic = String(Math.round(Number(amount) * 10 ** DECIMALS));
const requirements: PaymentRequirements = {
  scheme: 'exact',
  network: CONCORDIUM_TESTNET_CAIP2,
  asset: TOKEN,
  amount: atomic,
  payTo: shop,
  maxTimeoutSeconds: 120,
  extra: facilitator.getExtra(CONCORDIUM_TESTNET_CAIP2) ?? {},
};

await balances('before');

// Agent side: build + sender-sign the sponsored transfer. It never broadcasts.
const payer = new ClientScheme({ accountAddress: agent.address, signer: agent.signer });
const partial = await payer.createPaymentPayload(2, requirements);
const payload = { x402Version: 2, accepted: requirements, payload: partial.payload } as unknown as PaymentPayload;

const verdict = await facilitator.verify(payload, requirements);
console.log('verify', verdict.isValid ? 'OK' : `REFUSED: ${verdict.invalidReason}`);
if (!verdict.isValid) process.exit(1);
if (process.env.DRY_RUN) { console.log('DRY_RUN: stopping before settlement, nothing sent'); process.exit(0); }

const settled = await facilitator.settle(payload, requirements);
if (!settled.success) { console.log('settle FAILED', settled.errorReason); process.exit(1); }
console.log('paid', amount, TOKEN, txUrl(settled.transaction));

const receipt = { kind: 'spike-payment', shop, payer: agent.address.address, amount, token: TOKEN, paymentTx: settled.transaction, at: new Date().toISOString() };
const anchored = await anchorReceipt(receipt);
console.log('receipt anchored', anchored.ok ? 'OK' : 'FAILED', txUrl(anchored.hash));

await balances('after ');
