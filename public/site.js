// Viale: shared page chrome. Draws the nav, the full-screen menu and the footer, and owns the
// Concordium Browser Wallet connection (window.concordium) for every page. Pages use window.V.
(() => {
  const EXPLORER = 'https://ccdexplorer.io/testnet';
  const TESTNET_GENESIS = '4221332d34e1694168c2a0c0b3fd0f27';
  const ACCOUNTS = {
    agent: '3bfc6N7NivEQmvyMWeei1eBYv4mD21FzKfLA5nAtjhuWXHNwhZ',
    viale: '3bV1C2T7j8oNGPfZsMSP51KCgdzuTuUMjDcHFak3rHM43i46zX',
    owner: '4UVsGdSyYk43E2m99Vy3M38u92yknjBUoY7xKQHGSDXZAUiWw5',
    till: '3HNiUGKvauG2NZXSabcsQ5eaYRbtqWYfYVUkGtzxJ37kfj64ji',
  };
  const $ = (id) => document.getElementById(id);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs ?? {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
    return el;
  };
  const short = (a) => (a ? `${String(a).slice(0, 6)}…` : '');
  const shortTx = (t) => (t ? `${t.slice(0, 6)}…${t.slice(-4)}` : '');
  const eur = (n) => `€${Number(n ?? 0).toFixed(2)}`;
  const ext = (href, text, cls = 'mono') => h('a', { href, target: '_blank', rel: 'noopener', class: cls }, text);
  const txLink = (t, text) => ext(`${EXPLORER}/transaction/${t}`, text ?? `${shortTx(t)} ↗`);
  const acct = (a, text) => (a ? ext(`${EXPLORER}/account/${a}`, text ?? `${short(a)} ↗`) : '—');
  const when = (iso) => (iso ? new Date(iso).toUTCString().slice(5, 22) + ' UTC' : '');
  const ago = (iso) => {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (!Number.isFinite(s)) return '';
    if (s < 90) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} days ago`;
  };
  const getJSON = async (url, init) => {
    const r = await fetch(url, init);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error ?? `HTTP ${r.status}`), { status: r.status, body: j });
    return j;
  };
  const postJSON = (url, data) => getJSON(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

  // ── Nav, menu, footer ────────────────────────────────────────────────────────────────────
  const page = document.body.dataset.page ?? '';
  const TOP = [['street', '/', 'Street'], ['errands', '/errands', 'Errands'], ['shops', '/shops', 'Shops'], ['check', '/check', 'Check an agent'], ['developers', '/developers', 'Developers']];
  const MENU = [
    ['Use Viale', [
      ['/', 'Run an errand', 'Send the Claude agent to buy something, under limits you sign'],
      ['/errands', 'Errand history', 'Every errand, its checks, payments and seal'],
      ['/shops', 'Shops on the street', 'Each shop agent, its owner and its menu'],
      ['/open', 'Open a shop', 'Register your own shop agent with your wallet'],
      ['/account', 'Your account', 'Your identity type, test euros and errands'],
    ]],
    ['Check & verify', [
      ['/check', 'Check any agent', 'Is a business behind this registry agent?'],
      ['/registry', 'Registry census', 'Who owns the agents in Concordium’s registry'],
      ['/verify', 'Audit desk', 'Check an errand log, a quote or a mandate yourself'],
      ['/proof', 'Proof', 'Every claim, checked against the live site and chain'],
    ]],
    ['Build', [
      ['/developers', 'Developers', 'MCP, A2A, REST and x402 for your own agent'],
      ['/mainnet', 'Path to mainnet', 'What it takes to go live with real users'],
      ['https://github.com/neromtoobad/viale', 'Source code', 'Public repository on GitHub'],
      ['https://github.com/neromtoobad/viale/blob/main/JUDGES.md', 'Verify in 5 minutes', 'The judges’ guide'],
    ]],
  ];

  function drawNav() {
    const slot = document.querySelector('header[data-nav]');
    if (!slot) return;
    slot.className = 'vnav';
    slot.replaceChildren(
      h('a', { href: '/', class: 'logo', 'aria-label': 'Viale home' }, h('img', { src: '/brand/viale-lockup.svg', alt: 'Viale', width: 144, height: 30 })),
      h('nav', { class: 'links', 'aria-label': 'Main' }, TOP.map(([k, href, text]) => h('a', { href, class: k === page ? 'on' : null }, text))),
      h('div', { class: 'r' },
        h('button', { type: 'button', class: 'mbtn', id: 'vmenuBtn', 'aria-expanded': 'false', 'aria-controls': 'vmenu' }, h('i'), h('span', {}, 'Menu')),
        h('div', { class: 'wwrap', id: 'wwrap' }, h('button', { type: 'button', class: 'wbtn', id: 'wbtn', 'aria-haspopup': 'true', 'aria-expanded': 'false' }, 'Connect wallet'), h('div', { class: 'wmenu', id: 'wmenu', role: 'menu' }))),
    );
    const menu = h('div', { class: 'vmenu', id: 'vmenu', role: 'dialog', 'aria-label': 'Menu' },
      h('div', { class: 'vnav' },
        h('a', { href: '/', class: 'logo' }, h('img', { src: '/brand/viale-lockup.svg', alt: 'Viale', width: 144, height: 30 })),
        h('button', { type: 'button', class: 'mbtn', id: 'vmenuClose' }, 'Close ✕')),
      h('div', { class: 'cols' }, MENU.map(([title, items]) => h('div', {}, h('h3', { class: 'lab' }, title),
        items.map(([href, b, s]) => h('a', { href, class: 'big', ...(href.startsWith('http') ? { target: '_blank', rel: 'noopener' } : {}) }, h('b', {}, b), h('small', {}, s)))))),
      h('div', { class: 'live', id: 'vmenuLive' }));
    document.body.append(menu);
    const open = (yes) => {
      menu.classList.toggle('open', yes);
      $('vmenuBtn').setAttribute('aria-expanded', String(yes));
      document.body.style.overflow = yes ? 'hidden' : '';
      if (yes) loadMenuStats();
    };
    $('vmenuBtn').onclick = () => open(true);
    $('vmenuClose').onclick = () => open(false);
    addEventListener('keydown', (e) => { if (e.key === 'Escape') { open(false); $('wwrap')?.classList.remove('open'); } });
  }
  let statsShown = false;
  async function loadMenuStats() {
    if (statsShown) return;
    statsShown = true;
    try {
      const s = await getJSON('/api/stats');
      $('vmenuLive').replaceChildren(
        h('span', { class: 'chip ink' }, `${s.errands.total} errands`),
        h('span', { class: 'chip line' }, `${eur(s.errands.paid_eur)} paid over x402`),
        h('span', { class: 'chip line' }, `${s.errands.walked_away} walk-aways`),
        h('span', { class: 'chip line' }, `${s.errands.sealed} logs sealed on chain`),
        s.registry ? h('span', { class: 'chip line' }, `${s.registry.business} of ${s.registry.active} registry agents business-owned`) : null);
    } catch { statsShown = false; }
  }

  function drawFooter() {
    const slot = document.querySelector('footer[data-foot]');
    if (!slot) return;
    slot.className = 'vfoot';
    const col = (title, links) => h('div', {}, h('h4', {}, title), links.map(([href, t]) => h('a', { href, ...(href.startsWith('http') ? { target: '_blank', rel: 'noopener' } : {}) }, t)));
    slot.replaceChildren(
      h('div', { class: 'in' },
        h('div', {}, h('img', { src: '/brand/viale-lockup-on-dark.svg', alt: 'Viale', width: 144, height: 30, style: 'height:28px;width:auto' }),
          h('p', { style: 'margin:14px 0 0;color:#aeb6c8;max-width:260px' }, 'An errand agent that checks every shop on Concordium before it pays. Testnet, test euros, nothing simulated.')),
        col('Use', [['/', 'Run an errand'], ['/errands', 'Errand history'], ['/shops', 'Shops'], ['/open', 'Open a shop'], ['/account', 'Your account']]),
        col('Verify', [['/check', 'Check any agent'], ['/registry', 'Registry census'], ['/verify', 'Audit desk'], ['/proof', 'Proof']]),
        col('Build', [['/developers', 'Developers'], ['/mainnet', 'Path to mainnet'], ['https://github.com/neromtoobad/viale', 'GitHub'], ['https://github.com/neromtoobad/viale/blob/main/feedback.md', 'Feedback for Concordium']]),
        h('div', { class: 'chain' }, h('h4', {}, 'On Concordium testnet'),
          ext(`${EXPLORER}/instance/12802/0`, 'Agent Registry <12802,0> ↗', ''), h('span', {}, 'CIS-8004, shops #1526 #1527 #1406'),
          ext(`${EXPLORER}/account/${ACCOUNTS.agent}`, `Errand agent ${short(ACCOUNTS.agent)} ↗`, ''),
          ext(`${EXPLORER}/account/${ACCOUNTS.viale}`, `Facilitator & seals ${short(ACCOUNTS.viale)} ↗`, ''),
          ext(`${EXPLORER}/account/${ACCOUNTS.owner}`, `Shop owner (business) ${short(ACCOUNTS.owner)} ↗`, ''),
          ext(`${EXPLORER}/tokens/EUDemo`, 'EUDemo test euro (PLT) ↗', ''))),
      h('div', { class: 'bottom' }, h('span', {}, 'Built for the Encode × Concordium Trusted Agents Hackathon. Test euros only; no real money moves.'), h('span', {}, 'Errand agent: Claude')));
  }

  // ── Wallet (Concordium Browser Wallet) ───────────────────────────────────────────────────
  const listeners = new Set();
  const wallet = {
    api: null, account: null, off: false, error: '',
    onChange(fn) { listeners.add(fn); fn(wallet.account); return () => listeners.delete(fn); },
    connect, disconnect() { wallet.account = null; wallet.off = true; changed(); },
  };
  function changed() { drawWalletButton(); for (const fn of listeners) fn(wallet.account); }
  function detect(timeout = 2000) {
    return new Promise((resolve) => {
      if (window.concordium) return resolve(window.concordium);
      const t = setTimeout(() => resolve(window.concordium ?? null), timeout);
      addEventListener('concordium#initialized', () => { clearTimeout(t); resolve(window.concordium ?? null); }, { once: true });
    });
  }
  async function connect() {
    wallet.error = '';
    wallet.api ??= await detect();
    if (!wallet.api) {
      wallet.error = 'none';
      showWalletMenu();
      throw new Error('No Concordium wallet found in this browser.');
    }
    try {
      const accounts = await wallet.api.requestAccounts();
      const chain = await wallet.api.getSelectedChain().catch(() => undefined);
      if (chain && !String(chain).startsWith(TESTNET_GENESIS)) throw new Error('Your wallet is on another network. Switch it to Concordium testnet.');
      if (!accounts?.length) throw new Error('No account was connected.');
      wallet.account = accounts[0];
      wallet.off = false;
      listen();
      changed();
      return wallet.account;
    } catch (err) {
      wallet.error = err?.message ?? 'The wallet did not connect.';
      showWalletMenu();
      throw err;
    }
  }
  function listen() {
    if (wallet.listening || !wallet.api?.on) return;
    wallet.listening = true;
    wallet.api.on('accountChanged', (a) => { if (wallet.account) { wallet.account = a; changed(); } });
    wallet.api.on('accountDisconnected', () => { wallet.account = null; changed(); });
  }
  function showWalletMenu() {
    const menu = $('wmenu');
    if (!menu) return;
    if (wallet.error === 'none') {
      menu.replaceChildren(h('div', { class: 'lab' }, 'No wallet found'),
        h('p', { style: 'margin-top:8px' }, 'Install the Concordium Browser Wallet, switch it to testnet, then click Connect again. Everything else on Viale works without a wallet.'),
        h('div', { class: 'row' }, ext('https://chromewebstore.google.com/detail/concordium-wallet/mnnkpffndmickbiakofclnpoiajlegmg', 'Get the wallet', '')));
    } else if (wallet.error) {
      menu.replaceChildren(h('div', { class: 'lab' }, 'Not connected'), h('p', { class: 'msg' }, wallet.error));
    }
    $('wwrap').classList.add('open');
  }
  function drawWalletButton() {
    const b = $('wbtn'), menu = $('wmenu');
    if (!b) return;
    $('wwrap').classList.remove('open');
    b.setAttribute('aria-expanded', 'false');
    if (!wallet.account) {
      b.className = 'wbtn'; b.replaceChildren('Connect wallet'); b.title = 'Connect a Concordium wallet (testnet)';
      menu.replaceChildren();
      return;
    }
    b.className = 'wbtn on'; b.title = wallet.account;
    b.replaceChildren(h('span', { class: 'd' }), h('span', { class: 'net2' }, 'Testnet'), h('span', { class: 'addr' }, short(wallet.account)));
    const copy = h('button', { type: 'button' }, 'Copy address');
    copy.onclick = async () => { try { await navigator.clipboard.writeText(wallet.account); copy.textContent = 'Copied'; } catch { copy.textContent = 'Copy failed'; } };
    menu.replaceChildren(
      h('div', { class: 'lab' }, 'Connected · Concordium testnet'),
      h('div', { class: 'full' }, wallet.account),
      h('p', {}, 'Errands you run are signed by this account. Your wallet asks before each one.'),
      h('div', { class: 'row' }, h('a', { href: '/account' }, 'Your account'), copy, ext(`${EXPLORER}/account/${wallet.account}`, 'Explorer', ''), h('button', { type: 'button', class: 'off', onclick: () => wallet.disconnect() }, 'Disconnect')));
  }
  function wireWallet() {
    const b = $('wbtn');
    if (!b) return;
    b.onclick = (ev) => {
      ev.stopPropagation();
      if (!wallet.account) return connect().catch(() => {});
      const open = $('wwrap').classList.toggle('open');
      b.setAttribute('aria-expanded', String(open));
    };
    document.addEventListener('click', (ev) => { if (!$('wwrap').contains(ev.target)) $('wwrap').classList.remove('open'); });
    // Like other web3 sites: if this site is already connected in the wallet, pick the account up without a prompt.
    (async () => {
      const api = await detect(1500);
      if (!api || wallet.account) return;
      wallet.api ??= api;
      try {
        const chain = await api.getSelectedChain();
        if (!String(chain).startsWith(TESTNET_GENESIS)) return;
        const a = await api.getMostRecentlySelectedAccount();
        if (a && !wallet.account && !wallet.off) { wallet.account = a; listen(); changed(); }
      } catch { /* not connected yet: the button asks */ }
    })();
  }

  window.V = { EXPLORER, TESTNET_GENESIS, ACCOUNTS, $, h, short, shortTx, eur, ext, txLink, acct, when, ago, getJSON, postJSON, wallet };
  drawNav();
  drawFooter();
  wireWallet();
})();
