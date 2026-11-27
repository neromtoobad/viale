// Browser side of /open: hands a Registry MCP-built contract call to the visitor's Concordium Browser Wallet.
// The site sends {contract, receive_name, energy, json, schema_b64}; the wallet shows the call, the owner
// approves it, and the wallet signs and sends it from the owner's own account. Viale never sees a key.
import { AccountAddress, AccountTransactionType, CcdAmount, ContractAddress, Energy, ReceiveName } from '@concordium/web-sdk';

type Call = { contract: { index: number; subindex: number }; receive_name: string; energy: number; json: unknown; schema_b64: string };

async function sendUpdate(api: any, account: string, call: Call): Promise<string> {
  const payload = {
    amount: CcdAmount.zero(),
    address: ContractAddress.create(call.contract.index, call.contract.subindex),
    receiveName: ReceiveName.fromString(call.receive_name),
    maxContractExecutionEnergy: Energy.create(call.energy),
  };
  const hash = await api.sendTransaction(AccountAddress.fromBase58(account), AccountTransactionType.Update, payload, call.json, { type: 'parameter', value: call.schema_b64 });
  return typeof hash === 'string' ? hash : String(hash);
}

(globalThis as any).ViaOpen = { sendUpdate };
