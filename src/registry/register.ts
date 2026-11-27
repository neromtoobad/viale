// Registers a Viale shop as an agent in Concordium's CIS-8004 Agent Registry and pins its card.
// The registry MCP builds the parameter (it holds no keys); the shop's own account signs and pays.
// Note: sponsored contract updates fail on testnet, so the owner pays its own CCD fee here.
import { AccountAddress, ContractAddress, CcdAmount, Energy, Parameter, ReceiveName, Transaction, TransactionHash } from '@concordium/web-sdk';
import { client, txUrl } from '../chain/chain.ts';
import type { Wallet } from '../chain/keys.ts';
import { callTool } from './mcp.ts';

type Built = { contract_address: { index: number; subindex: number }; receive_name: string; parameter_hex: string; suggested_energy: number };

export async function submit(owner: Wallet, built: Built) {
  const grpc = client();
  const { nonce } = await grpc.getNextAccountNonce(owner.address);
  const tx = Transaction.updateContract(
    {
      amount: CcdAmount.zero(),
      address: ContractAddress.create(built.contract_address.index, built.contract_address.subindex),
      receiveName: ReceiveName.fromString(built.receive_name),
      message: Parameter.fromHexString(built.parameter_hex),
    },
    Energy.create(built.suggested_energy),
  )
    .addMetadata({ sender: owner.address, nonce })
    .build();
  const hash = await grpc.sendTransaction(await Transaction.signAndFinalize(tx, owner.signer));
  const outcome = await grpc.waitForTransactionFinalization(hash);
  const s: any = outcome.summary;
  if (s.transactionType === 'failed' || s.rejectReason) throw new Error(`contract update rejected: ${JSON.stringify(s.rejectReason)} ${txUrl(TransactionHash.toHexString(hash))}`);
  return { hash: TransactionHash.toHexString(hash), summary: s };
}

/** CIS-2 Mint event: tag 0xFE, token id (u8 length + bytes), amount (LEB128), owner address. */
export function mintedTokenId(summary: any): string | undefined {
  for (const ev of summary.events ?? []) {
    for (const log of ev.events ?? []) {
      const hex = typeof log === 'string' ? log : log?.toString?.();
      if (!hex?.startsWith('fe')) continue;
      const bytes = Buffer.from(hex, 'hex');
      const id = bytes.subarray(2, 2 + bytes[1]);
      return BigInt('0x' + Buffer.from(id).reverse().toString('hex')).toString(); // u64 little-endian
    }
  }
}

/** Mints a new agent NFT to the owner. The card is pinned afterwards with setCard(). */
export async function registerAgent(owner: Wallet) {
  const built = await callTool<Built>('build_register', { sender: owner.address.address });
  const { hash, summary } = await submit(owner, built);
  const tokenId = mintedTokenId(summary);
  if (!tokenId) throw new Error(`registered but could not read the token id from ${txUrl(hash)}`);
  return { tokenId, tx: hash };
}

/** Builds the shop's A2A Agent Card (with the Concordium badge block) via the registry MCP.
 *  Returns the exact bytes to host and their SHA-256, which setCard() pins on chain. */
export async function buildCard(owner: string, tokenId: string, cardUrl: string, name: string, description: string, skills: { id: string; name: string; description: string; tags?: string[] }[], agentWallet?: string) {
  const r = await callTool<{ agent_card_json: string; metadata_hash_hex: string; token_address: string }>('build_agent_card', {
    name, description, agent_uri: cardUrl, owner_account: owner, token_id: tokenId, skills, version: '0.1.0',
    ...(agentWallet ? { agent_wallet: agentWallet } : {}),
  });
  return { json: r.agent_card_json, sha256: r.metadata_hash_hex, tokenAddress: r.token_address };
}

/** Pins the hosted card's URL and SHA-256 on chain so anyone can check the card is the one the owner published. */
export async function setCard(owner: Wallet, tokenId: string, cardUrl: string, sha256Hex: string) {
  const built = await callTool<Built>('build_set_agent_uri', { token_id: tokenId, agent_uri: cardUrl, metadata_hash_hex: sha256Hex, sender: owner.address.address });
  return (await submit(owner, built)).hash;
}

export { AccountAddress };
