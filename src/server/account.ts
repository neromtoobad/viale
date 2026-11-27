// A visitor's account, read from the chain: which identity provider stands behind it (business or personal),
// its CCD and EUDemo balances, and the errands it signed. Read-only; anyone's public account data.
import { AccountAddress } from '@concordium/web-sdk';
import { client, withRetry } from '../chain/chain.ts';
import { BUSINESS_IDP_NAME, identityProviderNames } from '../errand/shop-check.ts';
import { TOKEN } from '../street/shop-agent.ts';
import { list } from './history.ts';

export async function account(address: string) {
  let addr: AccountAddress.Type;
  try { addr = AccountAddress.fromBase58(address); } catch { return { error: 'Not a Concordium account address.', status: 400 }; }
  let info: any;
  try { info = await withRetry(() => client().getAccountInfo(addr)); } catch { return { error: 'This account does not exist on Concordium testnet.', status: 404 }; }
  const names = await identityProviderNames().catch(() => new Map<number, string>());
  const ids = [...new Set(Object.values(info.accountCredentials).map((c: any) => Number(c.value.contents.ipIdentity)))]
    .map((id) => ({ id, name: names.get(id) ?? `provider ${id}`, business: (names.get(id) ?? '').includes(BUSINESS_IDP_NAME) }));
  const t = (info.accountTokens ?? []).find((x: any) => String(x.id) === TOKEN);
  return {
    address,
    identity: ids,
    business: ids.some((i) => i.business),
    ccd: Number(info.accountAmount.microCcdAmount) / 1e6,
    eudemo: t ? Number(t.state.balance.value) / 10 ** t.state.balance.decimals : 0,
    errands: list().filter((e) => e.signer?.human === address),
  };
}
