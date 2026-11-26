# Viale on X

Account: @NeromStudio. Every claim below is live on viale.nerom.site or in this repo.
Check the handles in the composer's mention list before posting: @encodeclub, @ConcordiumNet.

## P1 · Launch (image: x/p1-street.png)

We built a street where an AI agent does your shopping, and checks every shop before it pays.

Viale, for the @encodeclub × @ConcordiumNet Trusted Agents hackathon:

→ every shop is an agent in Concordium's Agent Registry
→ the agent walks away from any shop whose owner isn't a verified business
→ it pays exactly the price the shop signed, nothing more
→ it seals the whole errand log on chain

Live on testnet, with test euros: viale.nerom.site

Alt text: Viale's street page. Three shops at dusk: The Bottle Shop marked "Business ID · Trade", a run-down copy also called The Bottle Shop marked "Personal ID · Walk away", and Viale Flowers marked "Business ID · Trade".

## P2 · The fake shop (image: x/p2-two-bottle-shops.png)

Two shops on our street are called The Bottle Shop. Same name, same menu. One is about 20% cheaper.

The cheap one is owned by a personal account, not a business. Viale's agent reads that from Concordium's identity layer and walks away before any money moves.

Anyone can copy a name. Nobody can copy a verified business identity.

Alt text: Two shopfronts both signed "The Bottle Shop". The tidy one is marked "Business ID · Trade"; the run-down one is marked "Personal ID · Walk away".

## P3 · The model never picks the amount (image: x/p3-steps.png)

The AI agent never decides how much to pay.

The shop signs a price quote with its owner's Concordium account key. Code checks that signature against the keys on chain, checks the quote names the shop's registered till, then pays exactly that price.

If the model asks to pay €3 for a €1.80 bouquet, code refuses.

Alt text: A live errand on Viale, step by step: found the shop, five checks passed, signed quote for a small bouquet at €1.80, paid €1.80 to the shop's registered till, errand log sealed on Concordium. Receipt on the right.

## P4 · Proof, not screenshots (no image; links)

Every Viale errand ends with one transaction: the hash of its full log, written to Concordium.

Change one line of the log later and the hash no longer matches. The payment and the seal from a live errand:

Payment: https://ccdexplorer.io/testnet/transaction/159c5899b5ff3fa24b090f01c47d388ea3fdb9d86fcacc939311c8a52ac913b5
Seal: https://ccdexplorer.io/testnet/transaction/90c5ed1c644d4cf6f0a556cb30ab52beac21aa3cda622327b821c80e13c04aba

## P5 · Open source

Viale is open source: github.com/neromtoobad/viale

Claude agent with hard limits in code (budget, per-payment cap, expiry, checked shops only), Concordium Agent Registry, business identity checks, x402 payments in EUDemo, and an anchored errand log. Built for the @encodeclub × @ConcordiumNet Trusted Agents hackathon.
