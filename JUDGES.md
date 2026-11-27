# Verify Viale in 2 minutes

No wallet, sign-in or keys needed. Everything runs on Concordium testnet.

## 1. The street (30 s)

| Do this | You see |
|---|---|
| Open [viale.nerom.site](https://viale.nerom.site) | Three shops. **The Bottle Shop** (#1526) and **Viale Flowers** (#1527) say *Business ID · Trade*, each operated by Viale Street Test ApS: the owner proves that legal name with a zero-knowledge proof from its business identity (open a shop's checks to see it; the proof files are [1526.business.json](https://viale.nerom.site/agents/1526.business.json) and [1527.business.json](https://viale.nerom.site/agents/1527.business.json)). A second **The Bottle Shop** (#1406) says *Personal ID · Walk away*. The checks run live against the registry and the chain, and are at most a minute old. The list under the street also shows any shop opened through [/open](https://viale.nerom.site/open). |
| Click any shop | Each check with ✓ or ✗: registered and Active, badge valid, owner's identity, card name, payment wallet. #1406 passes every check except the owner's identity. |
| `curl -s https://viale.nerom.site/api/street` | The same checks as JSON, including shops opened through [/open](https://viale.nerom.site/open) (`"outside": true`). |
| Open [viale.nerom.site/shops](https://viale.nerom.site/shops) | Every shop with its checks and menu. **Corner Kiosk** (#1543) was opened through the public open-a-shop flow by our own test account, which holds a personal identity: its badge is valid and its card hash matches the chain, but it says **Walk away**. |

## 2. A real errand (60 s)

| Do this | You see |
|---|---|
| Click **Small bouquet** | The errand starts. The first step names who signed its mandate (task, budget, cap, 15-minute expiry): *Viale's demo account* if you have no Concordium wallet. Then steps appear as they happen: registry lookup, the shop check, the menu, a quote signed by the shop's owner, the payment, and the log seal. Each payment and seal links to CCDExplorer. |
| Open the payment link | A `tokenUpdate`: EUDemo from the agent (3bfc6N…) to the shop's till (3HNiUG…), for exactly the quoted price. The agent paid 0 CCD; the fee shows under *sponsor*. |
| Optional: with the [Concordium Browser Wallet](https://chromewebstore.google.com/detail/concordium-wallet/mnnkpffndmickbiakofclnpoiajlegmg) on testnet, click **Connect wallet** (top right) first | Your wallet asks you to sign the mandate. The errand then runs under your account's signature, checked against your keys on chain. |
| Open the seal link | A `registerData` transaction: `VIALE/R1` followed by the SHA-256 of the errand log. |

The street runs one errand at a time and 6 an hour. If it's busy, the page shows the running or most recent errand instead, and its links work the same way.

Recorded errands you can open now:

| Errand | Payment | Seal |
|---|---|---|
| Small bouquet, €1.80, limits signed in a Concordium wallet by [3BLLTU…](https://ccdexplorer.io/testnet/account/3BLLTUG1XCZQzPgctHeMv9PsXn4KDaLYGpQDVui9xy94gUYHVh) | [d5cb6c…](https://ccdexplorer.io/testnet/transaction/d5cb6cf4905812f525351fe6261185cad52f1880bcd66982b3409cd176f745bf) | [5ed0f0…](https://ccdexplorer.io/testnet/transaction/5ed0f07e4fab8afa0a08e8894d890f554a96c3f171bf0c4a1bd9865fa59b7a0d) |
| Small bouquet, €1.80, run from the live site | [159c58…](https://ccdexplorer.io/testnet/transaction/159c5899b5ff3fa24b090f01c47d388ea3fdb9d86fcacc939311c8a52ac913b5) | [90c5ed…](https://ccdexplorer.io/testnet/transaction/90c5ed1c644d4cf6f0a556cb30ab52beac21aa3cda622327b821c80e13c04aba) |
| Ten tulips, €2.60 | [8ce06f…](https://ccdexplorer.io/testnet/transaction/8ce06ffd6fc23eccd8a13122bd255c366cc377298a18eb6b52274421ecdf76d6) | [1b9d9a…](https://ccdexplorer.io/testnet/transaction/1b9d9ad1fcacd532c14adc24b34cdc827e41ad87b220a90ad0b6ac3fb4ebb251) |
| Sent to the impostor: walked away, paid nothing | none | [8b8838…](https://ccdexplorer.io/testnet/transaction/8b8838dcd3cbbc9a259964711550f122b4f6a7c6e52fe9d5cdcccc166b5d8197) |

Full logs are in [evidence/](evidence/). On the site, [/errands](https://viale.nerom.site/errands) lists every errand; each receipt has **Verify this log on chain** (recomputes the seal) and **Check the signature** on its mandate and quote. The [audit desk](https://viale.nerom.site/verify) does the same for a log you paste or upload.

## 3. Check any agent, not just ours (30 s)

| Do this | You see |
|---|---|
| Open [viale.nerom.site/check/1010](https://viale.nerom.site/check/1010) | Another team's agent. Registered, badge valid, owned by a personal identity: **Walk away**. |
| Open [viale.nerom.site/check/600](https://viale.nerom.site/check/600) | An agent we didn't build, owned by a Global FinReg business identity: **Trade**. Its owner hasn't published a business-name proof, so the page notes that Viale's errands would require one. |
| Scroll down on that page | Who owns the registry: 29 of about 1,250 active agents are owned by a business identity (the live number; two of them are our shops), recounted every 6 hours. Click any id to check it. |
| `claude mcp add --transport http viale https://viale.nerom.site/mcp` | Your agent gets `check_agent` (returns `trade` or `walk_away` with reasons) and `registry_owners`. |

## 4. Open a shop (optional, needs a wallet)

| Do this | You see |
|---|---|
| Open [viale.nerom.site/open](https://viale.nerom.site/open) and connect a Concordium Browser Wallet on testnet with a little CCD | The identity behind your account, and what the agent will decide about your shop (business: Trade; personal: Walk away). |
| Click **Register with my wallet** | Your wallet shows the CIS-8004 `register` call the Registry MCP built for your account; approve it and an agent token is minted to you. Viale checks on chain that the call came from you and that the registry lists you as the owner. |
| Write a menu and click **Sign price list and pin card** | Your wallet signs the exact price list shown on the page, then sends `setAgentURI` pinning your hosted card's SHA-256. Your shop appears on the street, checked like every other. |
| No wallet? `curl -s -X POST https://viale.nerom.site/shops/1543/quote -H 'content-type: application/json' -d '{"sku":"newspaper-1"}'` | A quote with no signature of its own: it carries the price list the owner signed. Change the price and POST it to `/shops/1543/buy`: refused, "not on the price list the owner signed". |

## 5. Check every claim yourself (30 s)

```bash
git clone https://github.com/neromtoobad/viale && cd viale
npm ci
npm run check:live
```

[tools/check-live.ts](tools/check-live.ts) prints PASS or FAIL for the 15 checked claims in the README. It reads the live site, Concordium's Registry MCP and a testnet node:

- C1: every shop is an Active agent in the registry (Viale's three, plus any opened through /open)
- C2: every card, including opened shops' hosted cards, hashes to its on-chain metadata hash
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
- C13: the wallet-signed errand's mandate (from an account Viale holds no key for) verifies against the signer's keys on chain (a changed budget fails), its payments stay within the signed cap, and the live site refuses a mandate with the wrong signature, a €50 budget, or the agent's own account
- C14: a fresh quote's unpaid `/buy` answers 402 with `PAYMENT-REQUIRED` asking exactly the quoted price to the shop's wallet, a quote with a changed price is refused, and the recorded HTTP x402 payment matches its requirements on chain
- C15: each opened shop's quote carries a price list signed by the shop's registry owner (checked against the owner's keys on chain), its unpaid `/buy` answers 402, and a quote off the list is refused
- C16: each honest shop's business-name proof, fetched from next to its card, verifies against the chain, names the operator the street shows, and fails when checked for the impostor

## The five things to look at in the code

1. **The shop check:** [src/errand/shop-check.ts:64-110](src/errand/shop-check.ts#L64). The business-identity test is at line 88: it reads the identity provider behind each of the owner's credentials on chain.
2. **The model never picks the amount:** `pay_shop` takes only a quote id ([src/agent/errand.ts:142](src/agent/errand.ts#L142)); the guard refuses any amount but the quoted price ([src/errand/guards.ts:45](src/errand/guards.ts#L45)); the quote's signature is checked against the owner's keys on chain ([src/errand/quote-check.ts:32](src/errand/quote-check.ts#L32) and [src/street/shop-agent.ts:105-117](src/street/shop-agent.ts#L105)).
3. **The signed mandate:** [src/errand/mandate.ts:70-82](src/errand/mandate.ts#L70) checks the terms and the signature against the signer's account keys on chain; the errand refuses to start without it ([src/agent/errand.ts:57](src/agent/errand.ts#L57)), and the guard refuses to pay without it ([src/errand/guards.ts:27](src/errand/guards.ts#L27)).
4. **The payment, over HTTP x402:** the shop's `/buy` answers 402 with requirements from its signed quote ([src/street/shop-agent.ts:119-164](src/street/shop-agent.ts#L119)); the agent checks them against the quote and pays with a `PAYMENT-SIGNATURE` ([src/pay/x402.ts:23-48](src/pay/x402.ts#L23)); Viale's facilitator verifies and settles over HTTP ([src/pay/facilitator.ts:38](src/pay/facilitator.ts#L38)). To see the 402 yourself, get a quote with `curl -s -X POST https://viale.nerom.site/shops/1527/quote -H 'content-type: application/json' -d '{"sku":"small-bouquet"}'`, then POST `{"quote": <that JSON>}` to `/shops/1527/buy` with `curl -i`.

5. **Open a shop:** [src/street/open-shops.ts](src/street/open-shops.ts). `ownerCall` (line 86) reads each finalized registry call and checks it came from the owner and, for the card, carries exactly the bytes Viale built; `priceListProblems` (line 132) checks the price list against the owner's keys and the registry record. The wallet side is [web/open.ts:15](web/open.ts#L15).

## What doesn't work yet

The 18+ proof (Concordium Verify & Access) is written but can't be finished on testnet: the App Store ID app is a mainnet app and fails at WalletConnect. See the README's *Not built yet* section and [feedback.md](feedback.md).
