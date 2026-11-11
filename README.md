# Domain Wallet

A mobile-first wallet frontend for the NEAR ecosystem, with a product direction centred on native NEAR accounts and NEAR Intents.

> **Status: frontend prototype.** This repository currently contains a responsive visual design and clickable onboarding/dashboard flow. Secure NEAR key generation, account creation, wallet import, authentication, live balances, transfers, and NEAR Intents execution are not connected. Recovery and import screens are preview-only. Never enter a real recovery phrase in this prototype.

## Product experience

- Minimal black-and-violet welcome screen.
- Create-wallet and import-wallet entry points.
- Recovery phrase safety education and a preview-only acknowledgement.
- Wallet naming and setup-complete screen.
- Wallet dashboard with portfolio overview, Send, Receive, Deposit and Swap entry points, assets, activity, and fixed bottom navigation.
- Responsive layouts for mobile and desktop.

## Visual direction

The interface uses a deliberately restrained palette: near-black backgrounds, deep violet surfaces, purple accents, and white typography. The welcome screen does not use the supplied logo image; the supplied domain.png artwork is used as the central visual.

## Run locally

No build step is required.

1. Clone the repository: git clone https://github.com/R-byte028/Domain.git
2. Enter the project folder.
3. Start a local static server: python -m http.server 8000
4. Open http://localhost:8000.

For Vercel, import this GitHub repository as a static site. Use the repository root; no build command is required.

## Judge walkthrough

1. Open the deployed site. The first screen should show the Domain Wallet title, purple portal artwork, “Expand your portfolio”, and a prominent Get Started button on a black background.
2. Select Get Started. Choose Create a new wallet or Import an existing wallet.
3. On the create flow, inspect the preview-only recovery phrase notice, reveal/hide the placeholder words, acknowledge the notice, and continue.
4. Enter a wallet display name and continue to the setup preview.
5. Select Explore dashboard. Inspect the sample portfolio card, quick actions, asset list, activity panel, and fixed bottom navigation.
6. Return to the start and open Import an existing wallet. The prototype counts entered words and explains that secure import is not connected.

Expected result: all screens navigate and adapt to phone and desktop sizes. Wallet actions that require a connected account display a clear coming-soon message rather than pretending to execute a transaction.

## Security notes

- This prototype does not generate, store, transmit, or import private keys or recovery phrases.
- Never paste a real seed phrase into the preview import screen.
- Do not store recovery phrases, private keys, or signing secrets in Supabase, GitHub, logs, analytics, or server requests.
- Production wallet creation/import must use reviewed NEAR-compatible tooling and secure key handling, with recovery backup and verification.
- Dashboard balances and asset rows are sample placeholders; no live wallet data is fetched.
- Social login and notifications are not connected.

## Planned integration sequence

1. Implement and test NEAR-compatible key generation and wallet restoration using maintained tooling.
2. Add a secure account creation/connection path and explicit signing confirmation.
3. Integrate NEAR Intents for supported quote, swap, and execution flows, following current protocol documentation.
4. Add live balances, token metadata, transaction history, and network/error states.
5. Complete security review and expand tests and judge walkthrough evidence.

## Technology

- HTML, CSS, and vanilla JavaScript.
- Progressive Web App manifest and service worker.
- NEAR Protocol / NEAR Intents integration planned; not yet implemented in this frontend-only stage.
