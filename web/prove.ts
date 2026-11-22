// Browser side of the 18+ proof page (/prove/<id>). Concordium's Verification Web UI shows the QR,
// the ID app makes the zero-knowledge proof on the phone, and our server checks it with
// Concordium's verifier service. The page never sees a date of birth.
import { ConcordiumVerificationWebUI, resetSDK } from '@concordium/verification-web-ui';
import '@concordium/verification-web-ui/styles';

const id = location.pathname.split('/').filter(Boolean).pop()!;
const $ = (s: string) => document.querySelector(s) as HTMLElement;

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
    waiting: 'Tap the button, then scan the code with the Concordium ID app.',
    requested: 'Request sent to your phone. Open the Concordium ID app to approve it.',
    verified: 'Done. The shop now knows you are 18 or older, and nothing else.',
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
  ($('#go') as HTMLButtonElement).hidden = s.state === 'verified' || s.state === 'expired';
}

let session = await api('');
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

// Keep the page in step if the proof finishes on another device.
setInterval(async () => {
  if (session.state === 'verified' || session.state === 'expired') return;
  const s = await api('');
  if (s.state !== session.state) { session = s; render(s); }
}, 3000);
