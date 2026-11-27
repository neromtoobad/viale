# Viale: an AI errand agent that checks every shop on Concordium before it pays

Viale is a street of shops where every shop is an agent in Concordium's Agent Registry. You tell a Claude errand agent what to buy and sign its limits with your Concordium account. It checks that the shop is a registered agent owned by a verified business, gets a price signed by the shop's owner, pays exactly that price in test euros over x402, and seals the whole errand log on chain.

The same check is open to everyone: [Check any agent](https://viale.nerom.site/check) runs it on any of the 1,250-odd agents in Concordium's testnet registry, as a page, a JSON API and an MCP server that other agents can call before they pay.

**Live:** [viale.nerom.site](https://viale.nerom.site) · [Check any agent](https://viale.nerom.site/check) · **MCP:** `https://viale.nerom.site/mcp` · **Video (≤3 min):** not recorded yet · **Built at:** Encode Club × Concordium Trusted Agents Hackathon, Nov 2 – Dec 9 2026

**Proof:** an errand whose limits were signed in the Concordium Browser Wallet by an account whose key is not on Viale's server ([3BLLTU…](https://ccdexplorer.io/testnet/account/3BLLTUG1XCZQzPgctHeMv9PsXn4KDaLYGpQDVui9xy94gUYHVh), the builder's own second wallet account, not an outside user) paid €1.80 for a small bouquet ([payment](https://ccdexplorer.io/testnet/transaction/d5cb6cf4905812f525351fe6261185cad52f1880bcd66982b3409cd176f745bf)) and sealed its log ([seal](https://ccdexplorer.io/testnet/transaction/5ed0f07e4fab8afa0a08e8894d890f554a96c3f171bf0c4a1bd9865fa59b7a0d)). An earlier errand started from the live site paid €1.80 for a small bouquet ([payment](https://ccdexplorer.io/testnet/transaction/159c5899b5ff3fa24b090f01c47d388ea3fdb9d86fcacc939311c8a52ac913b5)), then sealed its log on chain ([seal](https://ccdexplorer.io/testnet/transaction/90c5ed1c644d4cf6f0a556cb30ab52beac21aa3cda622327b821c80e13c04aba)). On Nov 27 an errand from the live site bought the same bouquet over HTTP x402: the shop answered 402, the agent paid ([payment](https://ccdexplorer.io/testnet/transaction/03c19209c3d493abbb05a2c8680e6228c56c50efb5d057404b8ce8da593ddc74)) and sealed its log ([seal](https://ccdexplorer.io/testnet/transaction/c8ee03f5aafb7908cb22dfb0f87fe6e8fc065ff306c1449665da8706cb601b79)). Concordium testnet, nothing simulated.

![Viale's street page: three shops at dusk, two marked Business ID · Trade, a copy of The Bottle Shop marked Personal ID · Walk away](x/p1-street.png)

## For judges: verify in 2 minutes

No wallet or sign-in needed. [JUDGES.md](JUDGES.md) has the same steps with more detail.

| Do this | You see |
|---|---|
| Open [viale.nerom.site](https://viale.nerom.site) | Three shops, checked live against the registry and the chain. Two are owned by a business identity and say **Trade**. The second "The Bottle Shop" is owned by a personal identity and says **Walk away**. Click a shop to see each check. |
| Optional: click **Connect wallet** (top right) with a Concordium browser wallet on testnet (the Concordium Browser Wallet, or another that provides its `window.concordium` API) | Your account signs the errand's limits. Without a wallet, Viale's labelled demo account signs. |
| Click **Small bouquet** on the page | A real errand, step by step: registry lookup, five shop checks, a signed quote, an EUDemo payment and the log seal, each with its explorer link. The street allows 6 errands an hour and one at a time. |
| Open [viale.nerom.site/check/1010](https://viale.nerom.site/check/1010) | Another team's agent, checked the same way: registered, badge valid, but owned by a personal identity, so **Walk away**. Try [#600](https://viale.nerom.site/check/600), owned by a business: **Trade**. The page also counts who owns every active agent (recounted every 6 hours). |
| `curl https://viale.nerom.site/api/street` | The same checks as JSON, for every shop. |
| `claude mcp add --transport http viale https://viale.nerom.site/mcp` | Your own agent gets `check_agent` and `registry_owners` tools. |
| `curl -X POST https://viale.nerom.site/shops/1527/quote -H 'content-type: application/json' -d '{"sku":"small-bouquet"}'` | A price quote signed with the shop owner's Concordium account key. |
| `npm ci && npm run check:live` | PASS or FAIL for each claim below, checked against the live site and testnet. The last run passed all 14. |

## Claims

Every claim below is checked by [tools/check-live.ts](tools/check-live.ts) (C1–C13), against the live site and Concordium testnet.

| Claim | Where in code | Check |
|---|---|---|
| Every shop is an Active agent in Concordium's CIS-8004 Agent Registry `<12802,0>` | [src/errand/shop-check.ts:72](src/errand/shop-check.ts#L72), [src/registry/register.ts:47](src/registry/register.ts#L47) | C1 · [register #1527](https://ccdexplorer.io/testnet/transaction/d9c24c8a7a1f8de4437f8fa3f8b34c9d3e03d8ee737cbd130b13d06b46368250) |
| Each shop's Agent Card hashes to the SHA-256 pinned on chain, and its Verified-by-Concordium badge is valid | [src/errand/shop-check.ts:74-80](src/errand/shop-check.ts#L74), [src/registry/publish-cards.ts](src/registry/publish-cards.ts) | C2 · [pin card #1527](https://ccdexplorer.io/testnet/transaction/cd49f2dbbbe4b886c6cc2940c2bb1f776194c0a612e9b07e717c7d2a05c2f477) |
| The agent trades only with shops whose owner holds a business identity (Global FinReg) | [src/errand/shop-check.ts:83-88](src/errand/shop-check.ts#L83) | C3, C4 |
| The honest shops' owner got its business identity in code, from Global FinReg | [src/identity/business-id.ts:59](src/identity/business-id.ts#L59), [:142](src/identity/business-id.ts#L142) | [account opened](https://ccdexplorer.io/testnet/transaction/250f614dd79643be5a57591189274f7a4e83e87d50b9b65c3fbe44529246c961) |
| A copied shop with the same name and a valid badge, but a personal-identity owner, is refused before any money moves | [src/errand/shop-check.ts:88](src/errand/shop-check.ts#L88), [src/errand/guards.ts:35](src/errand/guards.ts#L35) | C4, C9 · [impostor errand seal](https://ccdexplorer.io/testnet/transaction/8b8838dcd3cbbc9a259964711550f122b4f6a7c6e52fe9d5cdcccc166b5d8197) |
| Shops sign each price with the owner's account key; the agent checks the signature against the owner's keys on chain | [src/street/shop-agent.ts:59](src/street/shop-agent.ts#L59), [src/errand/quote-check.ts:32-33](src/errand/quote-check.ts#L32) | C5 |
| The model never picks the amount: `pay_shop` takes only a quote id, and code pays exactly the quoted price | [src/agent/errand.ts:144](src/agent/errand.ts#L144), [src/errand/guards.ts:45](src/errand/guards.ts#L45) | C7, C10 |
| Code refuses any payment under an unsigned mandate, over budget, over the per-payment cap, after expiry, to an unchecked shop, to another wallet, or twice for one quote | [src/errand/guards.ts:24-50](src/errand/guards.ts#L24) | C10 (15 tests in [guards.test.ts](src/errand/guards.test.ts)) |
| An errand started with a wallet runs under a mandate (task, agent, budget, cap, expiry) signed with the visitor's own Concordium account key and checked against that account's keys on chain. Without a wallet, Viale's labelled demo account signs instead. A forged, over-limit, expired or reused mandate, or a wallet mandate signed by an account whose key Viale holds, starts nothing | [src/errand/mandate.ts:70-82](src/errand/mandate.ts#L70), [src/agent/errand.ts:57](src/agent/errand.ts#L57), [src/server/errands.ts:65-69](src/server/errands.ts#L65) | C13 · [wallet-signed errand](evidence/errand-bouquet-wallet-signed-2026-11-26.json) |
| Shops sell over HTTP x402: an unpaid `POST /shops/<id>/buy` gets **402** with payment requirements built from the signed quote; the agent checks they ask for exactly the quoted price to the registered wallet, retries with a `PAYMENT-SIGNATURE`, and the shop has Viale's facilitator verify and settle over HTTP (`/x402/facilitator/verify`, `/settle`, `/supported`). Payment is in EUDemo, a Protocol-Level Token, and the facilitator pays the fee as a sponsored transaction | [src/street/shop-agent.ts:92-136](src/street/shop-agent.ts#L92), [src/pay/x402.ts:23-48](src/pay/x402.ts#L23), [src/pay/facilitator.ts:38](src/pay/facilitator.ts#L38) | C14 · [x402 payment](https://ccdexplorer.io/testnet/transaction/e7843e015292fa247978e3d24ea48e2cf26e18af906d0dd8048d6b83c0101629) · [live errand paid over HTTP x402](evidence/errand-bouquet-x402-http-2026-11-27.json) ([payment](https://ccdexplorer.io/testnet/transaction/03c19209c3d493abbb05a2c8680e6228c56c50efb5d057404b8ce8da593ddc74)) |
| Each honest shop is paid at its CIS-8004 agent wallet (the till), linked with that wallet's own signature. The till holds a **personal** identity, because EUDemo's allow-list doesn't take business accounts; the shop check says so on every verdict | [src/registry/set-till.ts:25-26](src/registry/set-till.ts#L25), [src/errand/shop-check.ts:100-106](src/errand/shop-check.ts#L100) | C7 · [set till #1527](https://ccdexplorer.io/testnet/transaction/d2929679db75470464b026d15451df5e2391d13fb5ffdacfbc2cb4ac8a51f70f) |
| Each errand log is sealed on chain as sha256(log ‖ nonce); editing the log breaks the match | [src/chain/anchor.ts:15-31](src/chain/anchor.ts#L15), [src/agent/errand.ts:235](src/agent/errand.ts#L235) | C8 · [seal](https://ccdexplorer.io/testnet/transaction/90c5ed1c644d4cf6f0a556cb30ab52beac21aa3cda622327b821c80e13c04aba) |
| The errand agent is Claude (`claude-opus-5-5`) using tools: find_shops, check_shop, see_menu, get_quote, prove_age, pay_shop | [src/agent/errand.ts:26](src/agent/errand.ts#L26), [:201](src/agent/errand.ts#L203) | the live errand on the page |
| Every transaction in [evidence/](evidence/) is finalized and succeeded | [evidence/](evidence/) | C6 |
| Anyone can run the shop check on any agent in the registry, and its owner verdict matches the chain | [src/server/check.ts:19](src/server/check.ts#L19), [src/errand/shop-check.ts:63](src/errand/shop-check.ts#L63) | C11 · [/check/1010](https://viale.nerom.site/check/1010) |
| Viale serves the check as an MCP server (`check_agent`, `registry_owners`) | [src/server/check.ts:91-156](src/server/check.ts#L91) | C12 |
| 29 of the 1,254 active agents on testnet were owned by a business identity on Nov 27 (from 10 owner accounts; the number moves as agents register) | [src/registry/owners.ts:20](src/registry/owners.ts#L20) | [evidence/registry-owners-2026-11-27.json](evidence/registry-owners-2026-11-27.json) · recounted live every 6 hours on [/check](https://viale.nerom.site/check) |

## Not built yet

- **The 18+ check, live.** The Bottle Shop sells 18+ goods, so before paying it the agent asks its human for a zero-knowledge proof of age (Concordium Verify & Access). The code is written ([src/proof/age.ts](src/proof/age.ts), [web/prove.ts](web/prove.ts), [verifier/](verifier/)), and the guard refuses an 18+ shop until a proof passes ([src/errand/guards.ts:37](src/errand/guards.ts#L37)). We could not finish a proof on testnet: the ID app from the App Store is the mainnet app, and it shows "failed to connect to WalletConnect" after scanning our QR code. So the live demo buys flowers, and the street page offers no 18+ errand. On the hosted site an 18+ errand waits 2 minutes for a proof, then stops without paying. Details in [feedback.md](feedback.md).
- **Shops run by their owners.** All three shop agents run inside Viale's server, each signing with its own owner's key.
- **Spending limits on chain.** The mandate is checked by Viale's code before every payment; the agent's account itself is not yet limited by a contract.
- **Mainnet.** See the path to production below.

## Judging criteria

| Criterion (quoted from the event) | Where we meet it |
|---|---|
| **Depth of integration**: "how meaningfully the project uses Concordium identity, the Agent Registry and agent payments" | Identity: the trade decision reads the identity provider behind each shop owner's credentials ([shop-check.ts:83](src/errand/shop-check.ts#L83)), and the shop owner's business identity was made in code ([business-id.ts](src/identity/business-id.ts)). Registry: shops are registered, carded, badged and given wallets through the Registry MCP, signed by their own keys ([src/registry/](src/registry/)). Payments: x402 exact scheme in a PLT with sponsored fees ([x402.ts](src/pay/x402.ts)). Quotes use Concordium account message signing. Logs are sealed with register-data. |
| **A credible path to production**: "a believable route from testnet build to mainnet and real users" | [Path to production](#path-to-production) below: each step uses something Concordium already runs on mainnet (registry `<10082,0>`, Global FinReg, PLTs, sponsored transactions). |
| **It works**: "a clear end-to-end demo of the core flow" | One click on the live page runs the full flow on testnet. `npm run check:live` re-checks every claim. |
| **Usefulness**: "a real problem, solved for real people or agents" | An agent spending money for you needs to know who it is paying. Today a badge proves a card is unchanged, not that a business stands behind it. On Nov 27, 29 of 1,254 active agents on testnet were owned by a business identity, from just 10 owner accounts ([measured](evidence/registry-owners-2026-11-27.json)). The check is not tied to our street: any agent can call it over MCP before paying any agent in the registry ([/check](https://viale.nerom.site/check)). |

## What's real

| Part | Status | Proof |
|---|---|---|
| Shop agents #1526 The Bottle Shop, #1527 Viale Flowers | Registered in `<12802,0>`, cards pinned, wallets set | [registry contract](https://ccdexplorer.io/testnet/instance/12802/0) · [register #1526](https://ccdexplorer.io/testnet/transaction/ef0156cea7a3e241033362c23ec8fa924ae2f380e9ae0cee4816c35cf3fbdfd1) · [set till #1526](https://ccdexplorer.io/testnet/transaction/9b57c870377aaa5ba8166d891b6da8f03ca3fbd57f025c4ad7c27054d80fb4ad) · [pin card #1526](https://ccdexplorer.io/testnet/transaction/52f6808b112251b892f6995e23cf0f71c7d722540058b9abf469dee9ab7bd362) |
| Planted impostor #1406, a second "The Bottle Shop" | Registered, card pinned, owned by a personal identity | [register](https://ccdexplorer.io/testnet/transaction/17497c96091d73a9bf0540ea28b319753606692daf19073c696231b0edf78598) · [pin card](https://ccdexplorer.io/testnet/transaction/39ece79db3745b1cbd3a745d2fd2ab45b5a994591234dd4391a52550e7e99d54) |
| Shop owner [4UVsGd…](https://ccdexplorer.io/testnet/account/4UVsGdSyYk43E2m99Vy3M38u92yknjBUoY7xKQHGSDXZAUiWw5) | Account on a Global FinReg business identity (idp 4) | [account opened](https://ccdexplorer.io/testnet/transaction/250f614dd79643be5a57591189274f7a4e83e87d50b9b65c3fbe44529246c961) |
| Errands with signed quotes | Real EUDemo payments, exact quoted price | [€1.80 bouquet, wallet-signed](https://ccdexplorer.io/testnet/transaction/d5cb6cf4905812f525351fe6261185cad52f1880bcd66982b3409cd176f745bf) · [€1.80 bouquet, live site](https://ccdexplorer.io/testnet/transaction/159c5899b5ff3fa24b090f01c47d388ea3fdb9d86fcacc939311c8a52ac913b5) · [€2.60 tulips](https://ccdexplorer.io/testnet/transaction/8ce06ffd6fc23eccd8a13122bd255c366cc377298a18eb6b52274421ecdf76d6) · [€1.80 bouquet](https://ccdexplorer.io/testnet/transaction/bf43ee0b86a1b55d69f42fc02057f5136330b331c26ef6cd33bc8ed30edbc42a) |
| Errand log seals | register-data, re-checked by C8 | [wallet-signed bouquet](https://ccdexplorer.io/testnet/transaction/5ed0f07e4fab8afa0a08e8894d890f554a96c3f171bf0c4a1bd9865fa59b7a0d) · [bouquet](https://ccdexplorer.io/testnet/transaction/90c5ed1c644d4cf6f0a556cb30ab52beac21aa3cda622327b821c80e13c04aba) · [tulips](https://ccdexplorer.io/testnet/transaction/1b9d9ad1fcacd532c14adc24b34cdc827e41ad87b220a90ad0b6ac3fb4ebb251) · [impostor, no payment](https://ccdexplorer.io/testnet/transaction/8b8838dcd3cbbc9a259964711550f122b4f6a7c6e52fe9d5cdcccc166b5d8197) |
| Errand agent | Live Claude API calls (`claude-opus-5-5`) on every errand | [src/agent/errand.ts:203](src/agent/errand.ts#L203) |
| Simulated | Nothing | The shops, menus and prices are made up for the demo; every check, quote, payment and seal is real. |

The first errand, before signed quotes, paid its full €3 limit: [payment](https://ccdexplorer.io/testnet/transaction/b2ffbc675cfcfb5d4175a844876cdfe241fae757803a56b6308b8fb2fd0f1f61). That is why quotes exist.

## The problem

An AI agent that shops for you has to decide who to pay. A name proves nothing: anyone can register an agent called "The Bottle Shop". A Verified-by-Concordium badge proves the agent's card hasn't changed, not who owns it. Of the 1,254 active agents in Concordium's testnet registry, 29 (2.3%) were owned by an account with a business identity on Nov 27, from just 10 owner accounts; the rest are personal accounts ([src/registry/owners.ts](src/registry/owners.ts), [evidence](evidence/registry-owners-2026-11-27.json)). And an agent that sets its own payment amounts can overpay: our first errand did.

## How it works

0. **Sign the mandate** ([src/errand/mandate.ts](src/errand/mandate.ts)): the server drafts the terms (your task, this agent's account, €5 budget, €3 per payment, 15 minutes) and you sign them in a Concordium browser wallet. Without a wallet, Viale's demo account signs, and the page says so. The signature is checked against the signer's keys on chain; the errand runs once per mandate.
1. **Find shops** in the Agent Registry through Concordium's Registry MCP ([src/agent/errand.ts](src/agent/errand.ts), `find_shops`).
2. **Check the shop** ([src/errand/shop-check.ts](src/errand/shop-check.ts)): Active agent; badge valid; owner holds a Global FinReg business identity (read from the owner's credentials on chain); the card names the shop the agent was sent to. Any failed check means walk away, with the reason. Payment goes to the shop's registered agent wallet, or to the owner's account if it has none.
3. **Get a signed quote** ([src/street/shop-agent.ts](src/street/shop-agent.ts)) and check it ([src/errand/quote-check.ts](src/errand/quote-check.ts)): the signature matches the owner's keys on chain; shop, owner and wallet match the registry; not expired.
4. **Pay** ([src/errand/guards.ts](src/errand/guards.ts), [src/pay/x402.ts](src/pay/x402.ts), [src/pay/facilitator.ts](src/pay/facilitator.ts)): code checks the signed mandate, then buys over HTTP x402. The shop answers 402 with the quoted price as payment requirements; code checks they match the signed quote and the registry's wallet, signs a sponsored EUDemo transfer and retries with it; the shop has Viale's facilitator verify and settle it, and answers 200 with the transaction. The facilitator pays the fee and only sponsors payments to the street's shops.
5. **Seal the log** ([src/chain/anchor.ts](src/chain/anchor.ts)): sha256 of the full errand log plus a random nonce goes on chain with register-data. The log and nonce stay off chain, so no personal data is published.
6. **Show it** ([src/server/errands.ts](src/server/errands.ts), [public/index.html](public/index.html)): the street page streams each step as it happens.

**Check any agent.** Step 2 is also served on its own ([src/server/check.ts](src/server/check.ts)): `GET /api/check/<id>`, the [/check](https://viale.nerom.site/check) page, and an MCP server at `/mcp` (JSON-RPC over HTTP, read-only, no keys) with `check_agent` and `registry_owners`. Results are cached for five minutes and limited to 30 checks a minute per address. The registry count ([src/registry/owners.ts](src/registry/owners.ts)) lists every Active agent through the Registry MCP's `list_agents` and reads each owner's identity providers from a testnet node.

```
human ──signed mandate──▶ Claude errand agent ──tools──▶ Viale code (checks + limits)
                                                         │
                   Registry MCP ◀── find / check shop ───┤
            owner's identity (gRPC) ◀── business ID? ────┤
                   shop agent ──── signed quote ────────▶┤
   shop /buy ── 402 ─▶ pay exact quote ─▶ facilitator ┤──▶ EUDemo to shop's agent wallet
              register-data ◀── seal the errand log ─────┘
```

## Sponsor integrations (Concordium)

| Component | What Viale does with it | Where |
|---|---|---|
| Agent Registry (CIS-8004) + Registry MCP | Registers shops, builds and pins cards, sets agent wallets, reads agents and checks badges on every errand, and lists every agent for the registry count | [src/registry/](src/registry/), [src/registry/mcp.ts](src/registry/mcp.ts), [src/errand/shop-check.ts](src/errand/shop-check.ts) |
| Verified by Concordium badge | Required for trade; checked live through `check_badge` | [src/errand/shop-check.ts:74-80](src/errand/shop-check.ts#L74) |
| Concordium ID (business identity) | Made the shop owner's account from a Global FinReg business identity; reads every shop owner's identity provider before trading | [src/identity/business-id.ts](src/identity/business-id.ts), [src/errand/shop-check.ts:83](src/errand/shop-check.ts#L83) |
| x402 (`@x402/concordium`, `@x402/core/http`) | Each shop's `/buy` answers HTTP 402 with `PAYMENT-REQUIRED`; the agent pays with `PAYMENT-SIGNATURE`; Viale runs the facilitator as an HTTP service the shops call with `HTTPFacilitatorClient` | [src/street/shop-agent.ts:92](src/street/shop-agent.ts#L92), [src/pay/x402.ts](src/pay/x402.ts), [src/pay/facilitator.ts](src/pay/facilitator.ts) |
| Protocol-Level Tokens | Payments in EUDemo; each honest shop's till is on the EUDemo allow-list | [src/pay/x402.ts](src/pay/x402.ts), [src/registry/set-till.ts](src/registry/set-till.ts) |
| Sponsored transactions | The agent holds no CCD; Viale's facilitator pays every payment fee (the `feePayer` in each 402) | [src/pay/facilitator.ts:14-21](src/pay/facilitator.ts#L14) |
| Account message signing | Humans sign errand mandates and shops sign quotes; both are verified against keys on chain | [src/errand/mandate.ts:82](src/errand/mandate.ts#L82), [src/street/shop-agent.ts:59](src/street/shop-agent.ts#L59), [src/errand/quote-check.ts:33](src/errand/quote-check.ts#L33) |
| Concordium Browser Wallet API (`window.concordium`) | Connect wallet in the street page's nav, with any wallet that provides it; signs the errand mandate (`signMessage`), on testnet | [public/index.html:401](public/index.html#L401) |
| Verify & Access | 18+ proof request and verification, written but not finished on testnet (see Not built yet) | [src/proof/age.ts](src/proof/age.ts) |

Feedback for Concordium from building this: [feedback.md](feedback.md).

## Trust model & limitations

- **Viale's server holds keys** for the errand agent's account, Viale's own account (facilitator and log seals), and both shop owners' accounts (to sign quotes). In production each of these belongs to a different party; see below.
- **Viale's own account (3bV1C2…) also owns the planted impostor shop.** It has a personal identity, which is what the impostor needs to show. The facilitator can't move the agent's money: it can only settle a transfer the agent's key has signed.
- **The till.** EUDemo can only be paid to accounts on its EU allow-list, and a business identity can't join that list. So each honest shop takes payment at an allow-listed till account (3HNiUG…), set as its CIS-8004 agent wallet with the till's own signature. The till holds a **personal** identity and Viale holds its key: the business-identity check is on the shop's owner, and the money lands at a personal account. The shop check and the receipt show the till's identity rather than hide it. With a euro token that allow-lists business accounts, the owner's own account would be the wallet and the till goes away.
- **Limits.** The public street runs one errand at a time, 6 an hour. A mandate may ask for at most a €5 budget and €3 per payment ([src/server/errands.ts:17-19](src/server/errands.ts#L17)), and code enforces the signed numbers on every payment.
- **The demo signer.** Visitors without a Concordium wallet get a mandate signed by Viale's own account (3bV1C2…), and the page labels it "Viale's demo account". It goes through the same check as a wallet-signed one. The list of used mandates is kept in memory, so a restart forgets it, but every mandate also expires after 15 minutes.
- **Whose signature counts.** A wallet mandate signed by any account whose key is on Viale's server (the agent, the demo signer, the shop owner, the till) is refused ([src/server/errands.ts:33](src/server/errands.ts#L33)), so a wallet-signed errand shows that someone other than Viale agreed to the limits. Errands spend Claude API credit and test euros.
- **Concordium services.** Shop checks rely on Concordium's hosted Registry MCP and the public testnet node. If the badge checker's card fetch fails, the check retries once; if the node says to slow down (HTTP 429), reads retry with a backoff. A check that still fails shows as failing, and the agent never trades on a failed check.
- **What "trade" means.** The check proves the owner account holds a business identity from Global FinReg. It doesn't say the business is good, and an agent card can be fetched from any URL its owner registered, so Viale fetches cards only from public https hosts, with a timeout and size limit ([src/errand/shop-check.ts:44](src/errand/shop-check.ts#L44)).
- **Errand history.** The hosted server keeps errand logs on disk until it restarts; the page then shows the newest log committed in [evidence/](evidence/).

## Path to production

1. **Mainnet registry and identity.** Use the mainnet CIS-8004 registry `<10082,0>` and the mainnet Global FinReg identity provider; the checks don't change.
2. **The check is usable today.** Any agent can call `check_agent` over MCP before it pays another agent; on mainnet only the registry address changes.
3. **Shops run their own agents.** A shop owner runs the shop agent (menu + signed quotes) on their own server with their own key, registers it, and sets their own wallet. Viale becomes a directory plus the errand agent.
4. **A regulated euro.** Pay in a mainnet euro PLT. A shop with a business identity takes payment at its own allow-listed account, so no separate till.
5. **Limits on chain.** The human already signs the mandate (budget, cap, shop list, expiry). Next, the agent's account is held by a contract that enforces those signed numbers, so even Viale's server can't overspend.
6. **18+ on mainnet.** The ID app is a mainnet app, so the Verify & Access flow we wrote should work there as is.
7. **Who pays.** Shops pay a small fee per errand, and agent platforms pay for checks beyond a free tier; Viale keeps paying transaction fees through sponsored transactions, so buyers need no CCD.

## Run it

Node 24 or newer, and testnet accounts as listed in [keys.env.example](keys.env.example) (kept in `~/.viale-keys`, outside the repo).

```bash
npm ci
npm test                     # 15 payment guard and mandate tests
npm run check:live           # check every claim against the live site and testnet (no keys)
npm run server               # street page on http://localhost:3000 (needs the keys)
```

With the server running, one errand from the command line: `npm run errand -- "Buy me a small bouquet from Viale Flowers" --budget 5 --max 3`

## Built at the event

The event opened on Nov 2. The first commit is from Nov 17, and everything in this repo was written during the event, in small commits. No code was carried over from our earlier projects. Each working session's changes were split into one commit per feature and committed together at the end of the session, which is why some commits are seconds apart; the code was written over hours, not in seconds.

From others: Concordium's SDKs and services (`@concordium/web-sdk`, `@x402/concordium`, `@concordium/verification-web-ui`, the hosted Registry MCP, and the verifier container in [verifier/](verifier/)), Anthropic's SDK, zod and @noble/ed25519. The street picture was made with an image model during the event.

## AI usage

Built with Claude Code: it wrote the code, tests, scripts and docs, directed by the author, who chose the idea and design and ran the identity steps that need a person (the Global FinReg form and the Veriff check). Inside the product, the errand agent is Claude (`claude-opus-5-5`) via the Anthropic SDK's tool runner. Claude chooses shops and items and explains its steps; code makes every check and payment decision.

## Team

[Nerom Studio](https://x.com/NeromStudio) (GitHub [neromtoobad](https://github.com/neromtoobad)).
