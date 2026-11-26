// Opens the honest shops on Viale: makes sure the business-identity owner has CCD for fees,
// then mints a CIS-8004 agent for every shop in src/street/shops.ts that has no token id yet.
// Usage: node src/street/open-shops.ts
import { AccountAddress, AccountTransactionType, CcdAmount, Transaction, TransactionHash } from '@concordium/web-sdk';
import { client, txUrl } from '../chain/chain.ts';
import { shopOwnerWallet, sponsorWallet } from '../chain/keys.ts';
import { registerAgent } from '../registry/register.ts';
import { SHOPS } from './shops.ts';

const owner = shopOwnerWallet();
const grpc = client();
const info = await grpc.getAccountInfo(owner.address);
if (info.accountAmount.microCcdAmount < 400_000_000n) {
  // Viale's own test account sends the shop owner CCD for registry fees (testnet only).
  const sponsor = sponsorWallet();
  const { nonce } = await grpc.getNextAccountNonce(sponsor.address);
  const tx = Transaction.transfer({ amount: CcdAmount.fromCcd(500), toAddress: owner.address }).addMetadata({ sender: sponsor.address, nonce }).build();
  const hash = await grpc.sendTransaction(await Transaction.signAndFinalize(tx, sponsor.signer));
  await grpc.waitForTransactionFinalization(hash);
  console.log(`funded shop owner with 500 CCD: ${txUrl(TransactionHash.toHexString(hash))}`);
}

for (const shop of SHOPS.filter((s) => !s.tokenId && s.owner === owner.address.address)) {
  const { tokenId, tx } = await registerAgent(owner);
  console.log(`${shop.slug} registered as agent #${tokenId}: ${txUrl(tx)}`);
}
