// Generates the three Viale logo directions as standalone SVGs plus a comparison sheet.
import fs from 'node:fs';
const C = { navy: '#1E2B4A', sky: '#7FAEE3', cream: '#F6F1E7', brass: '#C9A14A', glow: '#FFD98A' };

// A: "Awning V" — the letter V cut from striped awning cloth, hung from a brass rod.
function awning(bg = null, dark = false) {
  const stripes = [];
  for (let x = 6, i = 0; x < 94; x += 8, i++) stripes.push(`<rect x="${x}" y="20" width="8" height="74" fill="${i % 2 ? C.sky : (dark ? C.cream : C.navy)}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${bg ? `<rect width="100" height="100" rx="22" fill="${bg}"/>` : ''}
  <defs><clipPath id="v"><path d="M12 24 H36 L50 60 L64 24 H88 L58 90 Q50 96 42 90 Z"/></clipPath></defs>
  <g clip-path="url(#v)">${stripes.join('')}</g>
  <rect x="8" y="16" width="84" height="7" rx="3.5" fill="${C.brass}"/>
  <circle cx="8" cy="19.5" r="4.5" fill="${C.brass}"/><circle cx="92" cy="19.5" r="4.5" fill="${C.brass}"/>
</svg>`;
}

// B: "Seal" — the verified rosette shopfronts wear, with a V cut out of it.
function seal(bg = null, dark = false) {
  const n = 14, R = 44, r = 38.5, pts = [];
  for (let i = 0; i < n * 2; i++) { const a = (Math.PI * i) / n - Math.PI / 2, rr = i % 2 ? r : R; pts.push([50 + rr * Math.cos(a), 50 + rr * Math.sin(a)]); }
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 1; i <= pts.length; i++) { const p = pts[i % pts.length], q = pts[(i - 1) % pts.length]; d += ` Q${q[0].toFixed(2)} ${q[1].toFixed(2)} ${((p[0] + q[0]) / 2).toFixed(2)} ${((p[1] + q[1]) / 2).toFixed(2)}`; }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${bg ? `<rect width="100" height="100" rx="22" fill="${bg}"/>` : ''}
  <path d="${d} Z" fill="${dark ? C.cream : C.navy}"/>
  <circle cx="50" cy="50" r="31" fill="none" stroke="${C.brass}" stroke-width="2.2"/>
  <path d="M33 36 H42 L50 57 L58 36 H67 L54 68 Q50 72 46 68 Z" fill="${dark ? C.navy : C.cream}"/>
</svg>`;
}

// C: "Lamp" — a brass street lantern whose glass holds the verified tick (also the dot of the i).
function lamp(bg = null, dark = false) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${bg ? `<rect width="100" height="100" rx="22" fill="${bg}"/>` : ''}
  <circle cx="50" cy="44" r="30" fill="${C.glow}" opacity="${dark ? 0.22 : 0.35}"/>
  <path d="M50 10 L64 22 H36 Z" fill="${C.brass}"/>
  <rect x="47" y="6" width="6" height="6" rx="3" fill="${C.brass}"/>
  <path d="M37 24 H63 L60 58 H40 Z" fill="${dark ? C.navy : C.cream}" stroke="${C.brass}" stroke-width="3.5" stroke-linejoin="round"/>
  <path d="M42.5 41 L48.5 47 L58.5 35" fill="none" stroke="${dark ? C.glow : C.navy}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="38" y="58" width="24" height="5" rx="2" fill="${C.brass}"/>
  <rect x="46.5" y="63" width="7" height="27" fill="${dark ? C.cream : C.navy}"/>
  <rect x="40" y="88" width="20" height="5" rx="2" fill="${dark ? C.cream : C.navy}"/>
</svg>`;
}

// The lamp drawn as the letter i: lantern = dot, post = stem.
function lampI(dark = false) {
  const ink = dark ? C.cream : C.navy;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 100">
  <path d="M15 1 L27 11 H3 Z" fill="${C.brass}"/>
  <path d="M4 13 H26 L23.5 39 H6.5 Z" fill="${dark ? C.navy : C.cream}" stroke="${C.brass}" stroke-width="3.2" stroke-linejoin="round"/>
  <path d="M9.5 26.5 L13.5 30.5 L20.5 21.5" fill="none" stroke="${dark ? C.glow : C.navy}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="5" y="39" width="20" height="4.5" rx="1.5" fill="${C.brass}"/>
  <rect x="8.2" y="43.5" width="13.6" height="56.5" fill="${ink}"/>
</svg>`;
}

const dirs = [
  { key: 'a-awning', title: 'A · Awning V', note: 'The V is cut from the striped awning cloth every shop on the street has, hung from a brass rod. Says "shops".', mk: awning },
  { key: 'b-seal', title: 'B · Seal', note: 'The verified rosette from the shop signs, with a V cut out. Says "verified".', mk: seal },
  { key: 'c-lamp', title: 'C · Lamp', note: 'A brass street lamp with the verified tick in its glass. In the wordmark the lamp is the i. Says "a lit street you can trust".', mk: lamp },
];
for (const d of dirs) {
  fs.writeFileSync(`${d.key}.svg`, d.mk());
  fs.writeFileSync(`${d.key}-app.svg`, d.mk(d.key === 'c-lamp' ? C.navy : C.cream, d.key === 'c-lamp'));
}
const uri = (s) => 'data:image/svg+xml;utf8,' + encodeURIComponent(s);
const word = (d, dark = false) => d.key === 'c-lamp'
  ? `<span class="wm">v<img class="li" src="${uri(lampI(dark))}">ale</span>`
  : `<span class="wm">viale</span>`;
const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
body{margin:0;background:#EDE8DD;font-family:Inter,sans-serif;color:${C.navy}}
.sheet{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding:32px;width:1536px;box-sizing:border-box}
.card{background:${C.cream};border-radius:20px;padding:28px;display:flex;flex-direction:column;gap:20px}
h2{margin:0;font-size:22px} p{margin:0;font-size:14px;line-height:1.5;color:#5b6475;min-height:42px}
.big{height:220px;display:flex;align-items:center;justify-content:center}.big img{height:200px}
.lock{display:flex;align-items:center;gap:14px;height:72px}.lock img{height:64px}
.wm{font-family:Fraunces,serif;font-weight:600;font-size:56px;letter-spacing:-0.02em;line-height:1;position:relative}
.li{height:1.02em;vertical-align:-0.005em;margin:0 0.01em}
.row{display:flex;align-items:center;gap:18px}.row img{border-radius:8px}
.dark{background:${C.navy};border-radius:14px;padding:18px 22px;display:flex;align-items:center;gap:14px}.dark .wm{color:${C.cream};font-size:40px}.dark img{height:46px}

small{font-size:12px;color:#8a8f9a}
</style></head><body><div class="sheet">
${dirs.map((d) => `<div class="card"><h2>${d.title}</h2><p>${d.note}</p>
<div class="big"><img src="${uri(d.mk())}"></div>
<div class="lock">${d.key === 'c-lamp' ? '' : `<img src="${uri(d.mk())}">`}${word(d)}</div>
<div class="dark">${d.key === 'c-lamp' ? '' : `<img src="${uri(d.key === 'b-seal' ? seal(null, true) : awning(null, true))}">`}${word(d, true)}</div>
<div class="row"><img src="${uri(d.mk(d.key === 'c-lamp' ? C.navy : C.cream, d.key === 'c-lamp'))}" width="96"><img src="${uri(d.mk(d.key === 'c-lamp' ? C.navy : C.cream, d.key === 'c-lamp'))}" width="48"><img src="${uri(d.mk(d.key === 'c-lamp' ? C.navy : C.cream, d.key === 'c-lamp'))}" width="32"><img src="${uri(d.mk(d.key === 'c-lamp' ? C.navy : C.cream, d.key === 'c-lamp'))}" width="16"><small>app icon → favicon</small></div>
</div>`).join('')}
</div></body></html>`;
fs.writeFileSync('directions.html', html);
console.log('ok');
