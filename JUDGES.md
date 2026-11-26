# Verify Viale in 2 minutes

No wallet, sign-in or keys needed. Everything runs on Concordium testnet.

## 1. The street (30 s)

| Do this | You see |
|---|---|
| Open [viale.nerom.site](https://viale.nerom.site) | Three shops. **The Bottle Shop** (#1526) and **Viale Flowers** (#1527) say *Business ID · Trade*. A second **The Bottle Shop** (#1406) says *Personal ID · Walk away*. The checks run live against the registry and the chain, and are at most a minute old. |
| Click any shop | Each check with ✓ or ✗: registered and Active, badge valid, owner's identity, card name, payment wallet. #1406 passes every check except the owner's identity. |
| `curl -s https://viale.nerom.site/api/street` | The same checks as JSON. |

## 2. A real errand (60 s)

| Do this | You see |
|---|---|
| Click **Small bouquet** | The errand starts. Steps appear as they happen: registry lookup, the shop check, the menu, a quote signed by the shop's owner, the payment, and the log seal. Each payment and seal links to CCDExplorer. |
| Open the payment link | A `tokenUpdate`: EUDemo from the agent (3bfc6N…) to the shop's till (3HNiUG…), for exactly the quoted price. The agent paid 0 CCD; the fee shows under *sponsor*. |
| Open the seal link | A `registerData` transaction: `VIALE/R1` followed by the SHA-256 of the errand log. |

The street runs one errand at a time and 6 an hour. If it's busy, the page shows the running or most recent errand instead, and its links work the same way.

Recorded errands you can open now:

| Errand | Payment | Seal |
|---|---|---|
| Small bouquet, €1.80, run from the live site | [159c58…](https://ccdexplorer.io/testnet/transaction/159c5899b5ff3fa24b090f01c47d388ea3fdb9d86fcacc939311c8a52ac913b5) | [90c5ed…](https://ccdexplorer.io/testnet/transaction/90c5ed1c644d4cf6f0a556cb30ab52beac21aa3cda622327b821c80e13c04aba) |
| Ten tulips, €2.60 | [8ce06f…](https://ccdexplorer.io/testnet/transaction/8ce06ffd6fc23eccd8a13122bd255c366cc377298a18eb6b52274421ecdf76d6) | [1b9d9a…](https://ccdexplorer.io/testnet/transaction/1b9d9ad1fcacd532c14adc24b34cdc827e41ad87b220a90ad0b6ac3fb4ebb251) |
| Sent to the impostor: walked away, paid nothing | none | [8b8838…](https://ccdexplorer.io/testnet/transaction/8b8838dcd3cbbc9a259964711550f122b4f6a7c6e52fe9d5cdcccc166b5d8197) |

Full logs are in [evidence/](evidence/).

## 3. Check every claim yourself (30 s)

```bash
git clone https://github.com/neromtoobad/viale && cd viale
npm ci
npm run check:live
```

[tools/check-live.ts](tools/check-live.ts) prints PASS or FAIL for the 10 claims in the README. It reads the live site, Concordium's Registry MCP and a testnet node:

- C1: every shop is an Active agent in the registry
- C2: every card hashes to its on-chain metadata hash
- C3: the owners' identity providers (business for the honest shops, personal for the impostor)
- C4: the live trade and walk-away decisions
- C5: a fresh quote's signature against the owner's on-chain keys (a changed price fails)
- C6: all 22 transactions in evidence/ are finalized and succeeded
- C7: each payment equals its signed quote, in EUDemo, to the till, with the fee sponsored
- C8: each seal is recomputed from its log (an edited log fails)
- C9: the impostor errand paid nothing
- C10: the 13 payment guard tests

## The three things to look at in the code

1. **The shop check:** [src/errand/shop-check.ts:43-78](src/errand/shop-check.ts#L43). The business-identity test is at line 61: it reads the identity provider behind each of the owner's credentials on chain.
2. **The model never picks the amount:** `pay_shop` takes only a quote id ([src/agent/errand.ts:139](src/agent/errand.ts#L139)); the guard refuses any amount but the quoted price ([src/errand/guards.ts:42](src/errand/guards.ts#L42)); the quote's signature is checked against the owner's keys on chain ([src/errand/quote-check.ts:32-33](src/errand/quote-check.ts#L32)).
3. **The payment:** x402 exact scheme, with Viale's facilitator verifying and settling a transfer the agent signed ([src/pay/x402.ts:37-43](src/pay/x402.ts#L37)).

## What doesn't work yet

The 18+ proof (Concordium Verify & Access) is written but can't be finished on testnet: the App Store ID app is a mainnet app and fails at WalletConnect. See the README's *Not built yet* section and [feedback.md](feedback.md).
