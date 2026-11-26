# Feedback for Concordium

Notes from building Viale for the Trusted Agents Hackathon. Each one is something we hit while building.

## Verify & Access: no way to test the ID app on testnet

- **What we did:** we ran `concordium/credential-verification-service:0.3.1` against the testnet node. We showed the request with `@concordium/verification-web-ui` 0.2.1 (`network: 'testnet'`) and scanned the QR code with the Concordium ID app from the App Store.
- **What happened:** the app shows "failed to connect to WalletConnect, try again". The same thing happens with a fresh QR code, and the dApp side never receives `session_approved`. On our side, the QR code renders, the WalletConnect project ID is accepted, and the verifier is healthy.
- **Why it matters:** the Verify & Access tutorial runs on testnet, with testnet trusted issuers `did:ccd:testnet:idp:0`–`3`. The only ID app we could find is the mainnet store build, and its identities are real KYC identities. Hackathon builders have no documented way to finish the flow on testnet.
- **What would help:** a testnet build of the ID app (TestFlight or APK) or a network switch inside it, plus a line in the tutorial saying which app and which test identity to use. A clearer error in the app when the network doesn't match would also help.
