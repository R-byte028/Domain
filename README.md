# Domain Wallet

A mobile-first, non-custodial wallet frontend for the NEAR ecosystem. This project derives NEAR implicit addresses locally and encrypts wallet key material on the user's device.

## Current implementation

- Black and violet responsive wallet interface.
- Local NEAR recovery phrase generation using the NEAR-maintained `near-seed-phrase` package.
- Recovery phrase reveal/hide and copy controls.
- 12- or 24-word recovery phrase import with BIP-39 validation.
- NEAR implicit account ID derived from the Ed25519 public key.
- Device-local wallet encryption using Web Crypto AES-256-GCM with a PBKDF2-SHA-256 key derivation.
- Password unlock and lock flow.
- Read-only NEAR mainnet account existence check.
- Wallet dashboard, receive-address copy, and onboarding.

## Important NEAR account distinction

Generating a key pair and deriving a 64-character implicit account ID happens locally. It does not itself submit a transaction or fund/create an active on-chain account. NEAR implicit accounts become active on-chain when they receive their first transfer. The first implementation therefore clearly distinguishes a locally generated address from an account confirmed to exist on-chain.

## Security model and limitations

- The recovery phrase and key pair are generated/derived in the browser.
- The recovery phrase is not stored in localStorage, sent to Supabase, or sent to a Domain server.
- The private key is encrypted in browser localStorage using AES-256-GCM. A password-derived key uses PBKDF2-SHA-256 with a unique random salt and 310,000 iterations.
- The encryption password is not stored.
- Locking the wallet clears the in-memory active key object. Reloading the app requires the password again.
- Browser localStorage is accessible to same-origin JavaScript. Encryption reduces exposure of stored key material but does not protect against malicious extensions, compromised devices, XSS, or a compromised application origin. A production security review, CSP hardening, independent audit, and secure key storage review are still required.
- Losing both the password and recovery phrase means the wallet cannot be recovered.
- Do not paste a recovery phrase into support chats, issue trackers, analytics, logs, or third-party sites.
- No seed phrase or private key should ever be sent to Supabase or a server.

## Not yet implemented

- On-chain funding / named-account creation.
- Sending NEAR or NEP-141 tokens.
- Live token balances and transaction history.
- NEAR Intents quotes, deposits, signed intents, swaps, withdrawals, and status tracking.
- Social login, notifications, hardware-wallet support, multi-account support, and audited backup verification.

## Run locally

1. Install Node.js 20 or newer.
2. Clone this repository and enter the folder.
3. Run `npm install`.
4. Run `npm run dev -- --host 0.0.0.0`.
5. Open the local URL printed by Vite. Use HTTPS (or localhost) for Web Crypto APIs.

Build for production with `npm run build`. Vercel should use the Vite framework preset, `npm run build`, and `dist` as the output directory.

## Judge walkthrough

1. Open the app. Choose **Get Started** then **Create a new wallet**.
2. View the generated 12-word recovery phrase, toggle visibility, and copy it if desired. Acknowledge that it has been safely written down.
3. Choose a wallet display name and create a device password of at least eight characters.
4. The app encrypts the private key locally, derives the 64-character NEAR implicit address, and checks whether that address already exists on NEAR mainnet.
5. Open the dashboard. The Receive action copies the derived NEAR address.
6. Lock the wallet and unlock it with the device password.
7. To test recovery, use **Import an existing wallet** with a valid 12- or 24-word NEAR seed phrase. The app derives the same key and address for the matching phrase and encrypts it on this device.

## Technologies

- Vite, HTML, CSS, and JavaScript.
- `near-seed-phrase` for NEAR BIP-39 seed phrase/key derivation.
- `@scure/bip39` for mnemonic checksum validation.
- `bs58` for NEAR Ed25519 public key decoding.
- Web Crypto API (PBKDF2 and AES-GCM) for device-local encryption.
- NEAR mainnet JSON-RPC for a read-only account existence check.
- NEAR Intents integration is planned as the next stage; no swap or intent is submitted by this release.


## Live dashboard and NEAR Intents asset discovery

The wallet dashboard reads the active wallet address and then:
- Queries NEAR mainnet JSON-RPC for native NEAR account balance.
- Reads indexed NEP-141 token balances from FastNear's public account fungible-token endpoint.
- Fetches the supported token catalogue from the NEAR Intents 1Click API and matches NEAR token contract IDs to indicative USD prices.
- Shows actual holdings when the account contains assets. The empty-wallet discovery section is hidden whenever at least one asset is held.
- Shows a discovery list of NEAR-chain assets supported by NEAR Intents when the wallet has no indexed holdings.
- Keeps a floating mobile navigation bar fixed to the viewport.

Data caveats:
- Token prices from the 1Click supported-token catalogue are indicative and may be stale; a live quote must be requested before a trade.
- A token without a matching supported-token price is still displayed as a holding, but its USD value is shown as unavailable rather than invented.
- NEAR Intents supported-token discovery is not a claim that every listed token is already held by the user.
- Dashboard balance reads are read-only. No transaction signing, deposits, swaps, or transfers are triggered by this dashboard.
- FastNear's public indexed endpoint is used without an API key for the initial prototype. If usage limits or production reliability require an authenticated key, request one and store it server-side; never expose a provider secret in browser code.


## Wallet onboarding browser compatibility

The NEAR seed phrase dependency uses Node core modules internally. Vite is configured with `vite-plugin-node-polyfills` to provide browser-compatible crypto, Buffer, stream, and related modules. This is required for wallet creation and recovery phrase import to run in browser builds. The polyfills do not send recovery phrases or private keys to a server.


## Swap and bridge (NEAR Intents 1Click)

The Trade screen uses the live NEAR Intents 1Click API:

- Loads the current supported asset list from `GET https://1click.chaindefuser.com/v0/tokens`.
- Requests a non-committing quote preview with `POST /v0/quote` using `dry: true`.
- Can request a committed quote with `dry: false` and display the quote-specific deposit address and expiry.
- Uses the selected token's API-provided `assetId` and `decimals`; the app does not construct asset IDs.
- Supports cross-chain routing by letting the user specify a destination address and a refund address on the source chain.
- Displays a clear warning that the quote itself does not move funds and that deposits must use the exact source asset and network.

**Current integration boundary:** Domain currently provides quote preview and deposit instructions. It does not yet sign or broadcast source-chain deposits from the wallet, and it does not yet poll swap status or show completed transaction history. Do not treat a deposit address as proof that a swap has completed. These are subsequent implementation steps. The partner JWT is not required to request quotes; unauthenticated quotes currently incur an additional 0.25% 1Click fee according to the official API documentation.

Official documentation: https://docs.agentsonintents.com/integration/distribution-channels/1click-api/about-1click-api and https://docs.agentsonintents.com/integration/distribution-channels/1click-api/quickstart/making-a-request


## Markets screen

The dedicated Markets tab in the floating navigation displays the live supported-asset catalogue from the NEAR Intents 1Click API (`GET /v0/tokens`).

- Shows token symbol, chain/network, contract address when available, and indicative USD price.
- Search works across token symbol, network, contract address, and asset ID.
- Filters separate NEAR ecosystem assets from cross-chain assets.
- Price sorting and locally stored favorite-token markers are supported.
- Stocks and commodities are shown as future categories and are not represented as live tradable products.
- The API does not provide 24-hour percentage change, market capitalization, or volume in its supported-token response. Domain therefore does not fabricate those metrics. A separate market-data provider integration would be required to show them.

Official API reference: https://docs.agentsonintents.com/api-reference/oneclick/get-supported-tokens


## Account / portfolio screen

The Account tab has a dedicated mobile-first portfolio layout:
- Displays the active wallet name, NEAR mainnet label, shortened address, and copy action.
- Shows the portfolio total based on the current native NEAR and indexed NEP-141 holdings.
- Includes a privacy toggle to blur/unblur balance values.
- Shows a token count and a DeFi summary placeholder; DeFi positions are not yet integrated.
- Lists held assets with indicative unit price, held quantity, and estimated USD value where a supported price is available.
- Empty wallets show a clear receive prompt and an asset discovery list instead of fabricated holdings.
- History is labelled as unavailable until transaction indexing is integrated; no fake transaction activity or 24-hour portfolio performance is shown.


## Home / discovery hub

The Home tab is separate from the Account portfolio screen and is designed as an ecosystem discovery feed:
- Welcome panel explains Domain's cross-chain wallet purpose and links directly to Trade and Markets.
- Quick actions provide shortcuts to Swap, Markets, Account, and Receive guidance.
- Featured assets are loaded from the public NEAR Intents 1Click supported-token endpoint. They are labelled as assets to explore and show indicative prices, not fabricated performance metrics or recommendations.
- Ecosystem reading links point to official NEAR sources: the NEAR Blog, NEAR roadmap, and NEAR Intents.
- The Home screen does not duplicate the user's portfolio balance or holdings; those remain on Account.
- Navigation now separates Home, Markets, Trade, Account, and Spend. Spend remains a clearly marked future feature.


## NEAR Intents backend proxy

Domain now includes a Supabase Edge Function named `intents-api` deployed to the Domain Wallet Supabase project.

- The browser calls the Supabase Function rather than calling the 1Click API directly for supported assets and quote requests.
- The function validates request structure and numeric amount/slippage bounds, handles CORS for the production app and localhost, and forwards requests to the NEAR Intents 1Click API.
- The function supports supported-token discovery, dry quote previews, committed quote/deposit-address creation, deposit transaction notification, and swap status lookup.
- Supabase Edge Function JWT verification is enabled. The browser uses the project's public Supabase API keys only; these are not wallet secrets.
- The optional NEAR Intents partner JWT is read only from the server-side `NEAR_INTENTS_API_KEY` secret and sent upstream as `X-API-Key`. It must never be prefixed with `VITE_` or placed in browser code.
- Without a partner JWT, 1Click currently allows public quote requests but applies its unauthenticated fee schedule (additional 25 bps on non-`ANY_INPUT` quotes). Authenticated partner pricing is typically 20 bps and can be lower for eligible routes. Check the current official fee schedule before production.

### Backend configuration

Vercel project environment variables:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (legacy public anon JWT used for Edge Function gateway verification)
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Supabase Edge Function secret (not a Vercel browser variable):
- `NEAR_INTENTS_API_KEY` — optional partner JWT obtained from the NEAR Intents Partner Dashboard. Add it in Supabase Dashboard → Edge Functions → Secrets. Never commit it.

### Current execution boundary

The backend can prepare live quotes and quote-specific deposit instructions. A quote or deposit address alone does not execute a swap. End-to-end execution still requires a wallet signer and source-chain deposit transaction for the selected origin network, followed by status tracking and verification of the destination transaction. The current locally generated Domain wallet derives a NEAR Ed25519 key only; it cannot sign EVM, Solana, Bitcoin, or other external-chain transactions. We must add the relevant wallet connection/signing adapters or limit the first live execution demo to a source network the wallet can securely sign.

Official references:
- 1Click API authentication: https://docs.agentsonintents.com/integration/distribution-channels/1click-api/authentication
- 1Click API request lifecycle: https://docs.agentsonintents.com/integration/distribution-channels/1click-api/quickstart/making-a-request
- Intents SDK capability matrix: https://docs.agentsonintents.com/integration/devkit/intents-sdk
- 1Click fees: https://docs.agentsonintents.com/resources/fees
