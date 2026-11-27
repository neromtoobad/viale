// The /proof page's data: tools/check-live.ts, run by this server against its own public URL every
// 6 hours, writing every claim's PASS/FAIL to data/proof/latest.json. Until the first run finishes, the
// newest run committed in evidence/ is shown, marked as such.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'data/proof/latest.json');
let running = false;

export function runProof(site: string) {
  if (running) return;
  running = true;
  const p = spawn(process.execPath, ['tools/check-live.ts'], { cwd: ROOT, env: { ...process.env, VIALE_SITE: site, VIALE_PROOF_OUT: OUT }, stdio: 'ignore' });
  p.on('exit', () => (running = false));
  p.on('error', () => (running = false));
}

export function latestProof() {
  const read = (f: string) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const live = read(OUT);
  if (live) return { ...live, source: 'run by this server', running };
  const ev = path.join(ROOT, 'evidence');
  const f = fs.readdirSync(ev).filter((n) => /^check-live-.*\.json$/.test(n)).sort().at(-1);
  const committed = f ? read(path.join(ev, f)) : null;
  return committed ? { ...committed, source: `committed run (evidence/${f}); a fresh run starts shortly after each deploy`, running } : { none: true, running };
}

/** Runs the checker 10 minutes after start (after the street's first checks) and then every 6 hours. */
export function scheduleProof(site: string) {
  setTimeout(() => runProof(site), 10 * 60_000);
  setInterval(() => runProof(site), 6 * 3600_000);
}
