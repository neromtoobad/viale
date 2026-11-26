# Viale

A street of verified shops where your AI agent runs your errands, and every step is proven on Concordium.

Built from scratch for the Concordium Trusted Agents Hackathon (Encode Club), November 2026. Work in progress.

## Built but not shown live: the 18+ check

The bottle shop sells 18+ goods. Before paying such a shop, the errand agent asks its human to prove they are 18 or older with Concordium Verify & Access. This is a zero-knowledge range proof made in the Concordium ID app, so the shop learns only yes or no. The code is in [src/proof/age.ts](src/proof/age.ts), the page is [web/prove.ts](web/prove.ts), and the age checker is Concordium's verifier container in [verifier/](verifier/). The payment guard in [src/errand/guards.ts](src/errand/guards.ts) refuses to pay an 18+ shop until a proof has passed.

**We could not run it end to end on testnet.** The ID app from the App Store scans our QR code and then shows "failed to connect to WalletConnect". This happened every time, including with a fresh code (Nov 26). Our side works up to that point: the request is created, the WalletConnect QR code is shown, and the verifier is healthy. The store app is a mainnet app, and we found no testnet build or network switch in it. So the demo errands use shops that do not sell 18+ goods. See [feedback.md](feedback.md).
