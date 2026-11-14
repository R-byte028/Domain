# Domain Wallet

Domain Wallet is a mobile-first, non-custodial NEAR wallet prototype with live NEAR Intents 1Click quote and route discovery. It helps users inspect supported assets, preview swap/bridge routes, and review route pricing before preparing a deposit instruction.

**Live app:** https://domain-wallet.vercel.app  
**Repository:** https://github.com/R-byte028/Domain

## What works in this release

- Create or import a NEAR Ed25519 wallet locally using a recovery phrase.
- Derive the NEAR implicit account ID in the browser.
- Encrypt stored key material on-device with Web Crypto AES-256-GCM and PBKDF2-SHA-256.
- Lock and unlock the local wallet.
- Read native NEAR balance and indexed NEP-141 holdings.
- Discover supported assets from the NEAR Intents 1Click token catalogue.
- Search and filter supported assets in Markets.
- Request live NEAR Intents 1Click dry-run quote previews through the Supabase Edge Function.
- Display quote output, minimum receive, destination network/contract, quote expiry, indicative USD value gap, and fee information returned by the API.
- Flag material catalogue-price/quote-price differences and unusually large indicative value gaps so users can review a route before continuing.
- Prepare a committed quote and display its deposit instructions after explicit user confirmation.

## Important execution boundary

**This release does not complete a swap or bridge.** A quote preview and a deposit address are instructions only; neither means funds have moved.

The current wallet creates a NEAR Ed25519 key. It does not yet securely sign and broadcast deposits from every supported source chain (for example EVM, Solana, or Bitcoin). The app also does not yet complete the full deposit-submit, status-polling, and destination-transaction verification lifecycle from the user's wallet. Do not send funds to a quote deposit address from this prototype.

The bridge screen can preview supported cross-chain routes, but route availability is not proof that Domain can sign the source-chain transaction.

## Architecture

- **Frontend:** Vite, HTML, CSS, and JavaScript.
- **Wallet:** `near-seed-phrase`, `@scure/bip39`, `bs58`, and browser Web Crypto.
- **NEAR reads:** NEAR mainnet JSON-RPC and FastNear's public indexed fungible-token endpoint.
- **Intents:** Supabase Edge Function `intents-api` proxies requests to the NEAR Intents 1Click API.
- **Hosting:** Vercel.
- **Secrets:** Optional NEAR Intents partner JWT is stored only as the Supabase Edge Function secret `NEAR_INTENTS_API_KEY`; it must never be exposed in browser environment variables or committed to Git.

## Security notes

- Recovery phrases and private keys are generated/derived in the browser and are not sent to Supabase.
- The private key is encrypted in browser localStorage with AES-256-GCM. The password-derived key uses PBKDF2-SHA-256 with a unique random salt and 310,000 iterations.
- The encryption password is not stored.
- Browser localStorage remains accessible to same-origin JavaScript. Encryption does not protect against malicious extensions, compromised devices, XSS, or a compromised application origin.
- This prototype has not had an independent security audit. Do not use it to store significant funds.
- Never paste a recovery phrase, private key, or API secret into chats, issue trackers, analytics, or logs.

## Judge walkthrough

1. Open the live app and choose **Get Started**.
2. Create a new wallet and inspect the generated recovery phrase. Do not use a valuable or reused wallet for a public demo.
3. Set a device password and open the dashboard.
4. Check the derived NEAR address and read-only account/balance information.
5. Open **Markets** to see supported assets returned by the NEAR Intents 1Click token catalogue.
6. Open **Trade**, select supported assets, enter a small indicative amount, and request a quote preview.
7. Inspect the quoted output, minimum receive, destination network/contract, expiry, indicative value difference, fee disclosure, and any route/price warnings.
8. If the route has a material value gap, the app requires an additional review confirmation before preparing committed deposit instructions.
9. Stop at the deposit-instructions stage. Do not send funds: this release does not yet provide a complete secure source-chain signing and settlement flow.

## Run locally

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev -- --host 0.0.0.0
```

Build:

```bash
npm run build
```

Vercel settings: Vite framework preset, build command `npm run build`, output directory `dist`.

## Configuration

Vercel browser environment variables:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (public legacy anon JWT used for Edge Function gateway verification)
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Supabase Edge Function secret:
- `NEAR_INTENTS_API_KEY` (optional partner credential; keep server-side only)

The Supabase function validates request structure and numeric bounds, applies CORS for the production origin and localhost, and forwards supported-token, quote, deposit-submit, and status requests to 1Click. Supabase JWT verification is enabled. The publishable/anon keys are public client credentials, not wallet secrets.

## Known limitations / next steps

- Implement secure source-chain wallet connection/signing for each chain that Domain offers for execution.
- Complete and test deposit submission, status polling, refund/error handling, and destination transaction verification.
- Add user authentication, rate limits, abuse controls, and stronger per-user authorization before handling real deposits.
- Add independent security review, CSP hardening, and XSS protections.
- Add transaction history and more robust balance indexing.
- Add external market-data integration only if showing metrics such as 24-hour change, market capitalization, or volume; the 1Click token catalogue does not provide those metrics.

## Official references

- [NEAR Intents 1Click API overview](https://docs.agentsonintents.com/integration/distribution-channels/1click-api/about-1click-api)
- [1Click request lifecycle](https://docs.agentsonintents.com/integration/distribution-channels/1click-api/quickstart/making-a-request)
- [Supported tokens API](https://docs.agentsonintents.com/api-reference/oneclick/get-supported-tokens)
- [1Click authentication](https://docs.agentsonintents.com/integration/distribution-channels/1click-api/authentication)
- [1Click fees](https://docs.agentsonintents.com/resources/fees)
