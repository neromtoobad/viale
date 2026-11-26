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
| Click **Small bouquet** | The errand starts. The first step names who signed its mandate (task, budget, cap, 15-minute expiry): *Viale's demo account* if you have no Concordium wallet. Then steps appear as they happen: registry lookup, the shop check, the menu, a quote signed by the shop's owner, the payment, and the log seal. Each payment and seal links to CCDExplorer. |
| Open the payment link | A `tokenUpdate`: EUDemo from the agent (3bfc6N…) to the shop's till (3HNiUG…), for exactly the quoted price. The agent paid 0 CCD; the fee shows under *sponsor*. |
| Optional: with the [Concordium Browser Wallet](https://chromewebstore.google.com/detail/concordium-wallet/mnnkpffndmickbiakofclnpoiajlegmg) on testnet, click **Sign with my Concordium wallet** first | Your wallet asks you to sign the mandate. The errand then runs under your account's signature, checked against your keys on chain. |
| Open the seal link | A `registerData` transaction: `VIALE/R1` followed by the SHA-256 of the errand log. |

The street runs one errand at a time and 6 an hour. If it's busy, the page shows the running or most recent errand instead, and its links work the same way.

Recorded errands you can open now:

| Errand | Payment | Seal |
|---|---|---|
| Small bouquet, €1.80, run from the live site | [159c58…](https://ccdexplorer.io/testnet/transaction/159c5899b5ff3fa24b090f01c47d388ea3fdb9d86fcacc939311c8a52ac913b5) | [90c5ed…](https://ccdexplorer.io/testnet/transaction/90c5ed1c644d4cf6f0a556cb30ab52beac21aa3cda622327b821c80e13c04aba) |
| Ten tulips, €2.60 | [8ce06f…](https://ccdexplorer.io/testnet/transaction/8ce06ffd6fc23eccd8a13122bd255c366cc377298a18eb6b52274421ecdf76d6) | [1b9d9a…](https://ccdexplorer.io/testnet/transaction/1b9d9ad1fcacd532c14adc24b34cdc827e41ad87b220a90ad0b6ac3fb4ebb251) |
| Sent to the impostor: walked away, paid nothing | none | [8b8838…](https://ccdexplorer.io/testnet/transaction/8b8838dcd3cbbc9a259964711550f122b4f6a7c6e52fe9d5cdcccc166b5d8197) |

Full logs are in [evidence/](evidence/).

## 3. Check any agent, not just ours (30 s)

| Do this | You see |
|---|---|
| Open [viale.nerom.site/check/1010](https://viale.nerom.site/check/1010) | Another team's agent. Registered, badge valid, owned by a personal identity: **Walk away**. |
| Open [viale.nerom.site/check/600](https://viale.nerom.site/check/600) | An agent we didn't build, owned by a Global FinReg business identity: **Trade**. |
| Scroll down on that page | Who owns the registry: 29 of 1,245 active agents are owned by a business identity, recounted every 6 hours. Click any id to check it. |
| `claude mcp add --transport http viale https://viale.nerom.site/mcp` | Your agent gets `check_agent` (returns `trade` or `walk_away` with reasons) and `registry_owners`. |

## 4. Check every claim yourself (30 s)

```bash
git clone https://github.com/neromtoobad/viale && cd viale
npm ci
npm run check:live
```

[tools/check-live.ts](tools/check-live.ts) prints PASS or FAIL for the 13 claims in the README. It reads the live site, Concordium's Registry MCP and a testnet node:

- C1: every shop is an Active agent in the registry
- C2: every card hashes to its on-chain metadata hash
- C3: the owners' identity providers (business for the honest shops, personal for the impostor)
- C4: the live trade and walk-away decisions
- C5: a fresh quote's signature against the owner's on-chain keys (a changed price fails)
- C6: every transaction in evidence/ is finalized and succeeded
- C7: each payment equals its signed quote, in EUDemo, to the till, with the fee sponsored
- C8: each seal is recomputed from its log (an edited log fails)
- C9: the impostor errand paid nothing
- C10: the 15 payment guard and mandate tests
- C11: check any agent (another team's, a business-owned one, the impostor, an unknown id) matches each owner's identity on chain
- C12: the MCP endpoint lists its tools and `check_agent` gives the right verdicts
- C13: the evidence errand's mandate signature verifies against the signer's keys on chain (a changed budget fails), its payments stay within the signed cap, and the live site refuses a mandate with the wrong signature or a €50 budget

## The four things to look at in the code

1. **The shop check:** [src/errand/shop-check.ts:63-103](src/errand/shop-check.ts#L63). The business-identity test is at line 83: it reads the identity provider behind each of the owner's credentials on chain.
2. **The model never picks the amount:** `pay_shop` takes only a quote id ([src/agent/errand.ts:142](src/agent/errand.ts#L142)); the guard refuses any amount but the quoted price ([src/errand/guards.ts:45](src/errand/guards.ts#L45)); the quote's signature is checked against the owner's keys on chain ([src/errand/quote-check.ts:32-33](src/errand/quote-check.ts#L32)).
3. **The signed mandate:** [src/errand/mandate.ts:70-82](src/errand/mandate.ts#L70) checks the terms and the signature against the signer's account keys on chain; the errand refuses to start without it ([src/agent/errand.ts:57](src/agent/errand.ts#L57)), and the guard refuses to pay without it ([src/errand/guards.ts:27](src/errand/guards.ts#L27)).
4. **The payment:** x402 exact scheme, with Viale's facilitator verifying and settling a transfer the agent signed ([src/pay/x402.ts:37-43](src/pay/x402.ts#L37)).

## What doesn't work yet

The 18+ proof (Concordium Verify & Access) is written but can't be finished on testnet: the App Store ID app is a mainnet app and fails at WalletConnect. See the README's *Not built yet* section and [feedback.md](feedback.md).
