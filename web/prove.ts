// Browser side of the 18+ proof page (/prove/<id>). Two ways to prove; the page never sees a date of birth:
//  - Concordium Browser Wallet: the wallet makes a zero-knowledge proof for the statement and challenge our
//    server sends, and the server checks it against the chain (src/proof/age.ts, verifyWalletPresentation).
//  - Concordium ID app: Concordium's Verification Web UI shows the QR, the app proves on the phone, and our
//    server checks it with Concordium's verifier service.
import { ConcordiumVerificationWebUI, resetSDK } from '@concordium/verification-web-ui';
import '@concordium/verification-web-ui/styles';

const id = location.pathname.split('/').filter(Boolean).pop()!;
const $ = (s: string) => document.querySelector(s) as HTMLElement;
const short = (a: string) => `${a.slice(0, 6)}…`;

async function api(path: string, body?: unknown) {
  const res = await fetch(`/api/proof/${id}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

function render(s: any) {
  $('#shop').textContent = s.shopName;
  $('#question').textContent = s.question;
  $('#status').textContent = {
    waiting: 'Prove with your Concordium wallet in this browser, or scan a code with the Concordium ID app.',
    requested: 'Request sent to your phone. Open the Concordium ID app to approve it.',
    verified: `Done. The shop now knows you are 18 or older, and nothing else.${s.proved?.account ? ` Proved from account ${short(s.proved.account)}.` : ''}`,
    failed: `The proof did not pass: ${s.error ?? 'unknown reason'}`,
    expired: 'This request has expired. Ask your agent to start again.',
  }[s.state as string] ?? s.state;
  document.body.dataset.state = s.state;
  const links = $('#links');
  links.innerHTML = '';
  for (const [label, tx] of [['Proof request recorded', s.requestTx], ['Check result recorded', s.verifyTx]] as const) {
    if (!tx) continue;
    const a = document.createElement('a');
    a.href = `https://testnet.ccdexplorer.io/tx/${tx}`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = `${label} on Concordium ↗`;
    links.append(a);
  }
  for (const b of ['#go', '#wallet']) ($(b) as HTMLButtonElement).hidden = s.state === 'verified' || s.state === 'expired';
  if (s.human && s.state !== 'verified') $('#status').textContent += ` Use the account that signed the errand: ${short(s.human)}.`;
}

let session = await api('');
// The account that signed the mandate (if a wallet did), so the page can say which account to prove from.
api('/wallet', {}).then((r) => { session = { ...r.session, human: r.human }; render(session); }).catch(() => {});
render(session);

let sdk: ConcordiumVerificationWebUI | undefined;
let vpr: unknown;

window.addEventListener('verification-web-ui-event', async (event: Event) => {
  const { type, data } = (event as CustomEvent).detail;
  try {
    if (type === 'session_approved') {
      const created = await api('/create', { connectionId: data.topic });
      vpr = created.request;
      session = created.session;
      render(session);
      await sdk!.sendPresentationRequest(vpr as any, data.topic);
    } else if (type === 'presentation_received') {
      session = await api('/verify', { presentation: data });
      render(session);
      if (session.state === 'verified') await sdk!.showSuccessState();
      else await sdk!.showErrorState();
    } else if (type === 'error') {
      throw new Error(data?.message ?? 'The ID app connection failed');
    }
  } catch (err: any) {
    $('#status').textContent = err.message;
    document.body.dataset.state = 'failed';
    await sdk?.showErrorState();
  }
});

$('#go').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    if (!res.ok) throw new Error(cfg.error ?? 'Viale is not set up for the ID app yet');
    resetSDK();
    sdk = new ConcordiumVerificationWebUI({
      network: cfg.network,
      projectId: cfg.walletConnectProjectId,
      metadata: { name: 'Viale', description: 'A street of verified shops', url: location.origin, icons: [`${location.origin}/brand/viale-icon-192.png`] },
    });
    await sdk.renderUIModals();
  } catch (err: any) {
    $('#status').textContent = err.message;
    document.body.dataset.state = 'failed';
  }
});

function detectWallet(timeout = 2000): Promise<any> {
  return new Promise((resolve) => {
    const w = (window as any).concordium;
    if (w) return resolve(w);
    const t = setTimeout(() => resolve((window as any).concordium ?? null), timeout);
    addEventListener('concordium#initialized', () => { clearTimeout(t); resolve((window as any).concordium ?? null); }, { once: true });
  });
}

$('#wallet').addEventListener('click', async () => {
  const btn = $('#wallet') as HTMLButtonElement;
  btn.disabled = true;
  try {
    const w = await detectWallet();
    if (!w) throw new Error('No Concordium Browser Wallet found. Install it and switch it to testnet, or use the ID app.');
    await w.requestAccounts();
    const { challenge, statements, human } = await api('/wallet', {});
    $('#status').textContent = 'Approve the proof in your Concordium wallet.';
    const vp = await w.requestVerifiablePresentation(challenge, statements);
    const presentation = typeof vp === 'string' ? vp : vp.toString();
    const r = await api('/wallet/verify', { presentation });
    session = { ...r, human };
    render(session);
    if (r.rejected) { $('#status').textContent = `The proof did not pass: ${r.rejected}`; document.body.dataset.state = 'failed'; }
  } catch (err: any) {
    $('#status').textContent = err?.message ?? String(err);
    document.body.dataset.state = 'failed';
  } finally {
    btn.disabled = false;
  }
});

// Keep the page in step if the proof finishes on another device.
setInterval(async () => {
  if (session.state === 'verified' || session.state === 'expired') return;
  const s = await api('');
  if (s.state !== session.state) { session = { ...s, human: session.human }; render(session); }
}, 3000);
