// Builds the final Viale logo set (direction B, "Seal") from code.
// The V and the wordmark are Fraunces 600 glyphs converted to outlines, so no font is needed to display them.
// Usage: FRAUNCES_TTF=/path/to/Fraunces-600.ttf NODE_PATH=<dir with opentype.js> node build.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
const opentype = createRequire(import.meta.url)('opentype.js');
const font = opentype.loadSync(process.env.FRAUNCES_TTF);

export const C = { navy: '#1E2B4A', sky: '#7FAEE3', cream: '#F6F1E7', brass: '#C9A14A' };
const f = (n) => +n.toFixed(2);

// Scalloped rosette: n bumps between radius R (outer) and r (inner), centred at (cx, cy).
function rosette(cx, cy, R, r, n = 14) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) { const a = (Math.PI * i) / n - Math.PI / 2, rr = i % 2 ? r : R; pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
  let d = `M${f((pts[0][0] + pts[pts.length - 1][0]) / 2)} ${f((pts[0][1] + pts[pts.length - 1][1]) / 2)}`;
  for (let i = 0; i < pts.length; i++) { const q = pts[i], p = pts[(i + 1) % pts.length]; d += ` Q${f(q[0])} ${f(q[1])} ${f((p[0] + q[0]) / 2)} ${f((p[1] + q[1]) / 2)}`; }
  return d + ' Z';
}

// A glyph run as an SVG path, scaled so its bounding box has height h, centred on (cx, cy).
function textPath(str, cx, cy, h, letterSpacing = 0) {
  const raw = font.getPath(str, 0, 0, 100, { kerning: true, letterSpacing });
  const bb = raw.getBoundingBox();
  const s = h / (bb.y2 - bb.y1);
  const p = font.getPath(str, 0, 0, 100 * s, { kerning: true, letterSpacing });
  const b = p.getBoundingBox();
  const dx = cx - (b.x1 + b.x2) / 2, dy = cy - (b.y1 + b.y2) / 2;
  const q = font.getPath(str, dx, dy, 100 * s, { kerning: true, letterSpacing });
  return { d: q.toPathData(2), w: b.x2 - b.x1, h: b.y2 - b.y1 };
}

// Wordmark laid out at a baseline so x-height letters align, returning width.
function wordPath(str, x, baseline, size) {
  const p = font.getPath(str, x, baseline, size, { kerning: true, letterSpacing: -0.02 });
  const b = p.getBoundingBox();
  return { d: p.toPathData(2), x1: b.x1, x2: b.x2, y1: b.y1, y2: b.y2 };
}

function mark({ seal = C.navy, ring = C.brass, v = C.cream, withRing = true, vScale = 1 } = {}) {
  const V = textPath('V', 50, 51.5, 37 * vScale);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <path d="${rosette(50, 50, 48, 42.5)}" fill="${seal}"/>
  ${withRing ? `<circle cx="50" cy="50" r="34.5" fill="none" stroke="${ring}" stroke-width="2.6"/>` : ''}
  <path d="${V.d}" fill="${v}"/>
</svg>`;
}

function wordmark(color) {
  const w = wordPath('viale', 0, 100, 128);
  const pad = 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(w.x1 - pad)} ${f(w.y1 - pad)} ${f(w.x2 - w.x1 + pad * 2)} ${f(w.y2 - w.y1 + pad * 2)}"><path d="${w.d}" fill="${color}"/></svg>`;
}

function lockup({ dark = false } = {}) {
  // mark 100x100, word set so its x-height sits on the seal's middle band
  const size = 96, baseline = 80;
  const w = wordPath('viale', 124, baseline, size);
  const W = Math.ceil(w.x2 + 4);
  const m = dark ? mark({ seal: C.cream, v: C.navy }) : mark();
  const inner = m.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 100" width="${W}" height="100">
  <g>${inner}</g>
  <path d="${w.d}" fill="${dark ? C.cream : C.navy}"/>
</svg>`;
}

function appIcon() {
  const inner = mark().replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">
  <rect width="100" height="100" fill="${C.cream}"/>
  <g transform="translate(14 14) scale(0.72)">${inner}</g>
</svg>`;
}

const out = {
  'viale-mark.svg': mark(),
  'viale-mark-on-dark.svg': mark({ seal: C.cream, v: C.navy }),
  'viale-favicon.svg': mark({ withRing: false, vScale: 1.2 }),
  'viale-wordmark.svg': wordmark(C.navy),
  'viale-wordmark-cream.svg': wordmark(C.cream),
  'viale-lockup.svg': lockup(),
  'viale-lockup-on-dark.svg': lockup({ dark: true }),
  'viale-app-icon.svg': appIcon(),
};
fs.mkdirSync('final', { recursive: true });
for (const [k, v] of Object.entries(out)) fs.writeFileSync(`final/${k}`, v);
console.log(Object.keys(out).join('\n'));
