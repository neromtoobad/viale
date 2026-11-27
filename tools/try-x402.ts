// Pays one small bouquet over HTTP x402 against a local or live Viale server, to test the 402 round trip.
// Usage: node tools/try-x402.ts [base-url]   (spends 1.80 EUDemo test euros from the errand agent)
import { payShop } from '../src/pay/x402.ts';
const base = process.argv[2] ?? 'http://localhost:3000';
const quote = await (await fetch(`${base}/shops/1527/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sku: 'small-bouquet' }) })).json();
const terms = JSON.parse(quote.message);
const p = await payShop(`${base}/shops/1527/buy`, quote, terms.pay_to, terms.price_eur);
console.log(JSON.stringify(p, null, 2));
const again = await fetch(`${base}/shops/1527/buy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quote }) });
console.log('same quote again ->', again.status, (await again.text()).slice(0, 160));
