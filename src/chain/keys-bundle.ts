// Packs only the keys the hosted server needs into one base64 value for the VIALE_KEYS_BUNDLE secret.
// Prints nothing secret: writes the value to a mode-600 file outside the repo and reports its path and contents' shape.
// Left out on purpose: the shop seed phrase, the till key and the identity files (only needed for setup scripts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = process.env.VIALE_KEYS_DIR ?? path.join(os.homedir(), '.viale-keys');
const env: Record<string, string> = {};
for (const line of fs.readFileSync(path.join(dir, 'keys.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && ['AGENT_ADDRESS', 'AGENT_PRIVATE_KEY', 'SPONSOR_ADDRESS', 'ANTHROPIC_API_KEY', 'WALLETCONNECT_PROJECT_ID'].includes(m[1])) env[m[1]] = m[2].trim();
}
const accounts = JSON.parse(fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8')).filter((a: any) => a.address === env.SPONSOR_ADDRESS);
const { address, signKey } = JSON.parse(fs.readFileSync(path.join(dir, 'shop.json'), 'utf8'));
const out = path.join(dir, 'bundle.b64');
fs.writeFileSync(out, Buffer.from(JSON.stringify({ env, accounts, shop: { address, signKey } })).toString('base64'), { mode: 0o600 });
console.log(`wrote ${out}: env ${Object.keys(env).join(', ')}; ${accounts.length} sponsor account; shop owner ${address.slice(0, 6)}…`);
