# Domain Wallet

A mobile-first web wallet experience for the NEAR ecosystem, with a product direction built around native NEAR accounts and NEAR Intents for cross-chain asset flows.

> **Current status: frontend prototype.** This repository currently contains the first responsive UI and clickable onboarding flow. Secure NEAR key generation, account creation, wallet import, authentication, balances, transfers, and NEAR Intents execution are not connected yet. The recovery phrase and import screens are intentionally marked as preview-only; do not enter or rely on real recovery phrases in this version.

## Product

Domain Wallet aims to make self-custody and access to the NEAR ecosystem feel approachable. The first release is scoped around:
- A branded welcome experience.
- Create-wallet and import-wallet entry points.
- Recovery phrase education and a future secure backup/confirmation flow.
- Wallet naming and a setup-complete screen.
- A balanced dashboard with portfolio value, Send, Receive, Deposit and Swap actions, assets, activity, and persistent bottom navigation.
- A future integration path for native NEAR functionality and NEAR Intents.

## Current frontend

The current implementation is a responsive static web app / installable PWA shell:
- **index.html** — screens and semantic markup.
- **styles.css** — premium dark visual system and responsive layouts.
- **app.js** — onboarding navigation, preview interactions, and UI feedback.
- **manifest.webmanifest** — installable app metadata.
- **sw.js** — basic offline shell cache.
- **domainlogo.png** and **domain.png** — supplied brand assets.

Visual direction: near-black surfaces, teal ambient glow, lime action accents, restrained purple highlights, rounded cards, and a mobile-first layout inspired by contemporary crypto wallets.

## Run locally

No build step is required.

1. Clone the repository:
   git clone https://github.com/R-byte028/Domain.git
2. Open the project folder.
3. Start a local static server, for example:
   python -m http.server 8000
4. Visit http://localhost:8000.

You can also deploy the repository as a static site on Vercel by importing the GitHub repository and using the project root as the deployment root. No build command is required; the output is the repository root.

## Judge walkthrough

1. Open the deployed site or run it locally.
2. On the welcome screen, select **Get started**. You should see the create/import choice.
3. Select **Create a new wallet**. You should see the recovery phrase education screen and an explicit preview-only warning.
4. Reveal/hide the sample placeholders and tick the acknowledgement. Continue to the wallet naming screen.
5. Edit the wallet name and continue. The ready screen should display the chosen name.
6. Select **Explore dashboard**. You should see the sample portfolio panel, quick actions, sample asset rows, recent activity empty state, and fixed bottom navigation.
7. Return to the start and choose **Import an existing wallet**. Entering a phrase updates the word counter; the preview checks for 12 or 24 words and clearly reports that secure import is not yet connected.

Expected result: the complete frontend navigation is clickable and adapts to phone and desktop widths. Actions that require a connected wallet show a coming-soon message rather than pretending to execute transactions.

## Security and implementation notes

- This version does not generate, store, transmit, or import real private keys or recovery phrases.
- Never paste a real seed phrase into the preview import screen.
- Do not add recovery phrases, private keys, or signing secrets to Supabase, GitHub, logs, analytics, or server requests.
- Production wallet creation/import must use a reviewed NEAR-compatible key/seed implementation and secure browser-side handling, with a clear recovery backup and verification flow.
- The sample dashboard values are placeholders; no live balance or transaction data is fetched.
- Google/email sign-in and notifications are not connected.

## Planned integration sequence

1. Implement and test NEAR-compatible key generation and wallet restore locally in the browser using maintained, audited NEAR tooling.
2. Add a secure account connection / account creation path and explicit signing confirmation.
3. Integrate NEAR Intents for supported quote, swap, deposit/withdrawal, and execution flows, following current protocol documentation.
4. Add live balances, token metadata, transaction history, and network/error states.
5. Add optional authentication only where it does not compromise self-custody.
6. Expand tests, security review, and judge walkthrough documentation as each integration becomes real.

## Technology

- HTML, CSS, and vanilla JavaScript for the initial frontend.
- Progressive Web App manifest and service worker.
- NEAR Protocol / NEAR Intents integration planned; not yet implemented in this frontend-only stage.
