// Loads test-account keys from outside the repo (default ~/.viale-keys). Never logs a key.
// On a host (Railway) the same keys come from one secret env var, VIALE_KEYS_BUNDLE: base64 of
// {"env": {..keys.env..}, "accounts": [..], "shop": {..}}, made by src/chain/keys-bundle.ts. Never committed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AccountAddress, buildBasicAccountSigner, type AccountSigner } from '@concordium/web-sdk';

const dir = process.env.VIALE_KEYS_DIR ?? path.join(os.homedir(), '.viale-keys');

type Bundle = { env: Record<string, string>; accounts: { address: string; signKey: string }[]; shop?: { address: string; signKey: string } };
let bundleCache: Bundle | undefined;
function bundle(): Bundle | undefined {
  const raw = process.env.VIALE_KEYS_BUNDLE;
  if (!raw) return undefined;
  return (bundleCache ??= JSON.parse(Buffer.from(raw, 'base64').toString('utf8')));
}

function readEnv(): Record<string, string> {
  const b = bundle();
  if (b) return b.env;
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(path.join(dir, 'keys.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/** A setting from the environment, else from keys.env (outside the repo). */
export function setting(name: string): string | undefined {
  return process.env[name] || readEnv()[name] || undefined;
}

/** Claude API key for the errand agent: env var first, then keys.env. */
export function loadAnthropicKey(): string {
  const key = process.env.ANTHROPIC_API_KEY || readEnv().ANTHROPIC_API_KEY;
  if (!key) throw new Error(`No ANTHROPIC_API_KEY: add it to ${path.join(dir, 'keys.env')}`);
  return key;
}

function keyFor(address: string): string {
  const env = readEnv();
  if (env.AGENT_ADDRESS === address && /^[0-9a-f]{64}$/.test(env.AGENT_PRIVATE_KEY ?? '')) return env.AGENT_PRIVATE_KEY;
  const accounts: { address: string; signKey: string }[] = bundle()?.accounts ?? JSON.parse(fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8'));
  const hit = accounts.find((a) => a.address === address);
  if (!hit) throw new Error(`No key for ${address} in ${dir}`);
  return hit.signKey;
}

export type Wallet = { address: AccountAddress.Type; signer: AccountSigner; signKeyHex: string };

function wallet(address: string): Wallet {
  const signKeyHex = keyFor(address);
  return { address: AccountAddress.fromBase58(address), signer: buildBasicAccountSigner(signKeyHex), signKeyHex };
}

/** The errand agent: pays shops in EUDemo, holds no CCD. */
export function agentWallet(): Wallet {
  return wallet(readEnv().AGENT_ADDRESS);
}

/** Viale's own account: sponsors fees and anchors receipts. */
export function sponsorWallet(): Wallet {
  return wallet(readEnv().SPONSOR_ADDRESS);
}

/** The honest shops' owner: an account on a Global FinReg business identity (made by src/identity/business-id.ts). */
export function shopOwnerWallet(): Wallet {
  const b = bundle();
  if (b) {
    if (!b.shop) throw new Error('VIALE_KEYS_BUNDLE has no shop owner');
    return { address: AccountAddress.fromBase58(b.shop.address), signer: buildBasicAccountSigner(b.shop.signKey), signKeyHex: b.shop.signKey };
  }
  const f = path.join(dir, 'shop.json');
  if (!fs.existsSync(f)) throw new Error(`No shop owner yet: run src/identity/business-id.ts (expects ${f})`);
  const { address, signKey } = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { address: AccountAddress.fromBase58(address), signer: buildBasicAccountSigner(signKey), signKeyHex: signKey };
}
