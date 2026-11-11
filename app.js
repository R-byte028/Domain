import nearSeedPhrase from "near-seed-phrase";
import bs58 from "bs58";
import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

const { generateSeedPhrase, parseSeedPhrase, normalizeSeedPhrase } = nearSeedPhrase;
const STORAGE_KEY = "domain.wallet.encrypted.v1";
const PBKDF2_ITERATIONS = 310000;
const screens = ["welcome","choice","recovery","import","confirm","password","unlock","ready","dashboard","market","trade"];
let pendingWallet = null;
let activeWallet = null;
let currentPhrase = "";
let toastTimer;
let dashboardLoadId = 0;
let supportedNearTokens = [];

const $ = (id) => document.getElementById(id);
const toastEl = $("toast");
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2800);
}
function showScreen(name) {
  screens.forEach((id) => $("screen-" + id)?.classList.toggle("active", id === name));
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function accountIdFromPublicKey(publicKey) {
  const [curve, encoded] = publicKey.split(":");
  if (curve !== "ed25519" || !encoded) throw new Error("Unsupported NEAR key type.");
  const bytes = bs58.decode(encoded);
  if (bytes.length !== 32) throw new Error("The generated public key is invalid.");
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function makeWallet(seed) {
  return {
    publicKey: seed.publicKey,
    secretKey: seed.secretKey,
    accountId: accountIdFromPublicKey(seed.publicKey),
    network: "mainnet"
  };
}
function renderPhrase(phrase) {
  $("phrase-grid").innerHTML = "";
  phrase.split(" ").forEach((word, index) => {
    const cell = document.createElement("span");
    const number = document.createElement("i");
    const value = document.createElement("b");
    number.textContent = String(index + 1).padStart(2, "0");
    value.textContent = word;
    cell.append(number, value);
    $("phrase-grid").append(cell);
  });
}
function clearSensitiveInputs() {
  $("import-phrase").value = "";
  $("wallet-password").value = "";
  $("wallet-password-confirm").value = "";
  $("unlock-password").value = "";
  $("phrase-grid").innerHTML = "";
  currentPhrase = "";
}
function walletExists() {
  return Boolean(localStorage.getItem(STORAGE_KEY));
}
function setWelcomeAction() {
  $("welcome-action").innerHTML = walletExists() ? 'Unlock Wallet <span>↗</span>' : 'Get Started <span>↗</span>';
}
async function deriveEncryptionKey(password, salt) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
function toBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary);
}
function fromBase64(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
async function saveEncryptedWallet(wallet, password, name) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEncryptionKey(password, salt);
  const payload = JSON.stringify({ ...wallet, name: name.trim() || "My Domain Wallet" });
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(payload));
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    version: 1,
    kdf: "PBKDF2-SHA-256",
    iterations: PBKDF2_ITERATIONS,
    cipher: "AES-256-GCM",
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext))
  }));
}
async function unlockWithPassword(password) {
  const record = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  if (!record || record.version !== 1 || record.kdf !== "PBKDF2-SHA-256" || record.cipher !== "AES-256-GCM") {
    throw new Error("No compatible encrypted wallet was found on this device.");
  }
  const key = await deriveEncryptionKey(password, fromBase64(record.salt));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(record.iv) },
    key,
    fromBase64(record.ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}
function renderWallet() {
  if (!activeWallet) return;
  $("ready-name").textContent = activeWallet.name;
  $("ready-address").textContent = activeWallet.accountId;
  $("dashboard-account").textContent = activeWallet.accountId;\n  $("account-wallet-name").textContent = activeWallet.name || "Domain Wallet";
}
async function checkOnChainAccount() {
  if (!activeWallet) return;
  $("account-status").textContent = "Checking NEAR mainnet…";
  try {
    const response = await fetch("https://rpc.mainnet.near.org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "domain-wallet", method: "query", params: { request_type: "view_account", finality: "final", account_id: activeWallet.accountId } })
    });
    const result = await response.json();
    $("account-status").textContent = result.result
      ? "This implicit account already exists on NEAR mainnet."
      : "Address derived successfully. The account is not active on-chain until it receives its first transfer.";
  } catch {
    $("account-status").textContent = "Address derived locally. Network status could not be checked right now.";
  }
}
 
function formatUsd(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}
function formatTokenAmount(raw, decimals) {
  const value = Number(raw) / (10 ** decimals);
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: value >= 1000 ? 2 : 6 }).format(value);
}
async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Accept: "application/json", ...(options.headers || {}) } });
  if (!response.ok) throw new Error("Request failed (" + response.status + ")");
  return response.json();
}
async function fetchSupportedNearTokens() {
  const tokens = await fetchJson("https://1click.chaindefuser.com/v0/tokens");
  supportedNearTokens = tokens.filter((token) => token.blockchain === "near" && token.contractAddress);
  return supportedNearTokens;
}
async function loadDiscovery() {
  const targets = [$("discovery-list"), $("markets-list")].filter(Boolean);
  targets.forEach((el) => el.innerHTML = '<div class="loading-card">Loading NEAR Intents supported assets…</div>');
  try {
    const tokens = await fetchSupportedNearTokens();
    const unique = [];
    const seen = new Set();
    for (const token of tokens) {
      if (seen.has(token.contractAddress)) continue;
      seen.add(token.contractAddress);
      unique.push(token);
    }
    const featured = unique.filter((token) => Number(token.price) > 0)
      .sort((a, b) => Number(b.price) - Number(a.price)).slice(0, 5);
    const html = featured.length ? featured.map((token) => {
      const price = Number(token.price);
      return '<article class="discovery-row"><span class="asset-avatar">' + escapeHtml(token.symbol.slice(0, 2)) + '</span><span class="asset-info"><b>' + escapeHtml(token.symbol) + '</b><small>' + escapeHtml(token.contractAddress) + '</small></span><span class="asset-value"><b>' + formatUsd(price) + '</b><small>Indicative price</small></span></article>';
    }).join("") : '<div class="loading-card">No featured NEAR assets are available right now.</div>';
    targets.forEach((el) => el.innerHTML = html);
  } catch {
    targets.forEach((el) => el.innerHTML = '<div class="loading-card">Could not load supported assets. Pull to refresh or try again.</div>');
  }
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
async function loadDashboard() {
  if (!activeWallet) return;
  const requestId = ++dashboardLoadId;
  $("balance-status").textContent = "UPDATING";
  $("portfolio-total").innerHTML = "$— <small>USD</small>";
  $("portfolio-native").textContent = "Reading balances from NEAR mainnet…";
  $("holdings-list").innerHTML = '<div class="loading-card">Fetching your NEAR wallet balances…</div>';
  try {
    const [account, ftData, prices] = await Promise.all([
      fetchJson("https://rpc.mainnet.near.org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "domain-balance", method: "query", params: { request_type: "view_account", finality: "final", account_id: activeWallet.accountId } })
      }),
      fetchJson("https://api.fastnear.com/v1/account/" + encodeURIComponent(activeWallet.accountId) + "/ft").catch(() => ({ tokens: [] })),
      fetchJson("https://1click.chaindefuser.com/v0/tokens").catch(() => [])
    ]);
    if (requestId !== dashboardLoadId || !activeWallet) return;
    if (account.error) throw new Error(account.error.message || "NEAR account query failed.");
    const nativeRaw = account.result?.amount || "0";
    const nativeAmount = Number(nativeRaw) / 1e24;
    const nativeToken = prices.find((token) => token.blockchain === "near" && ["NEAR", "wNEAR"].includes(token.symbol) && Number(token.price) > 0);
    const nativePrice = nativeToken ? Number(nativeToken.price) : null;
    const holdings = [];
    if (nativeAmount > 0) holdings.push({
      symbol: "NEAR", name: "NEAR Protocol", amount: nativeAmount,
      displayAmount: formatTokenAmount(nativeRaw, 24), price: nativePrice,
      usd: nativePrice === null ? null : nativeAmount * nativePrice,
      contract: "NEAR native"
    });
    const rows = Array.isArray(ftData.tokens) ? ftData.tokens : [];
    const priceByContract = new Map(prices.filter((token) => token.blockchain === "near" && token.contractAddress)
      .map((token) => [token.contractAddress, token]));
    for (const row of rows) {
      if (!row.balance || BigInt(row.balance) === 0n) continue;
      const token = priceByContract.get(row.contract_id);
      if (!token) {
        holdings.push({ symbol: row.contract_id.split(".")[0].slice(0, 12), name: row.contract_id, displayAmount: "Balance held", price: null, usd: null, contract: row.contract_id });
        continue;
      }
      const amount = Number(row.balance) / (10 ** token.decimals);
      const price = Number(token.price);
      holdings.push({
        symbol: token.symbol, name: row.contract_id, displayAmount: formatTokenAmount(row.balance, token.decimals),
        price: Number.isFinite(price) && price > 0 ? price : null,
        usd: Number.isFinite(price) && price > 0 ? amount * price : null,
        contract: row.contract_id
      });
    }
    const total = holdings.reduce((sum, item) => sum + (item.usd || 0), 0);
    const hasUnpriced = holdings.some((item) => item.usd === null);
    $("portfolio-total").innerHTML = (holdings.length && !hasUnpriced ? formatUsd(total) : holdings.length ? "—" : "$0.00") + ' <small>USD</small>';
    $("portfolio-native").textContent = (nativeAmount > 0 ? formatTokenAmount(nativeRaw, 24) + " NEAR" : "No NEAR available") +
      (holdings.length && hasUnpriced ? " · Some token prices unavailable" : " · " + holdings.length + " asset" + (holdings.length === 1 ? "" : "s"));
    $("tokens-total-value").textContent = holdings.length && !hasUnpriced ? formatUsd(total) : holdings.length ? "Value unavailable" : "$0.00";
    $("token-count").textContent = "(" + holdings.length + ")";
    $("balance-status").textContent = "LIVE DATA";
    if (holdings.length) {
      $("holdings-list").innerHTML = holdings.map((item) =>
        '<article class="account-token-row"><span class="account-token-avatar">' + escapeHtml(item.symbol.slice(0, 2)) + '</span><span class="account-token-info"><b>' + escapeHtml(item.symbol) + '</b><small>' + (item.price === null ? "Price unavailable" : formatUsd(item.price)) + (item.price === null ? "" : " per token") + '</small></span><span class="account-token-value"><b>' + (item.usd === null ? "—" : formatUsd(item.usd)) + '</b><small>' + escapeHtml(item.displayAmount) + '</small></span></article>'
      ).join("");
      $("discovery-section").hidden = true;
    } else {
      $("holdings-list").innerHTML = '<div class="account-empty-wallet"><span>◈</span><b>Your wallet is empty for now</b><small>Receive or deposit tokens and your holdings will appear here automatically.</small><button class="account-empty-action" id="account-empty-receive">Receive assets ↗</button></div>';
      $("discovery-section").hidden = false;
      $("account-empty-receive")?.addEventListener("click", () => $("receive-action")?.click());
      await loadDiscovery();
    }
  } catch (error) {
    if (requestId !== dashboardLoadId) return;
    $("balance-status").textContent = "UNAVAILABLE";
    $("portfolio-native").textContent = "Could not fetch current NEAR balances. Please retry.";
    $("holdings-list").innerHTML = '<div class="loading-card">Balance data is temporarily unavailable. Your wallet keys are safe. Try refreshing.</div>';
    $("discovery-section").hidden = false;
  }
}

function resetForNewWallet() {
  pendingWallet = null;
  activeWallet = null;
  clearSensitiveInputs();
  $("saved-check").checked = false;
  $("continue-recovery").disabled = true;
}
$("welcome-action").addEventListener("click", () => showScreen(walletExists() ? "unlock" : "choice"));
document.addEventListener("click", (event) => {
  const go = event.target.closest("[data-go]");
  if (go) { event.preventDefault(); showScreen(go.dataset.go); if (go.dataset.go === "market") { void loadMarketAssets(); if (activeWallet) { $("market-wallet-name").textContent = activeWallet.name || "Domain Wallet"; $("market-account-label").textContent = activeWallet.accountId.slice(0, 12) + "…"; } }
    if (go.dataset.go === "trade") { void loadTradeAssets(); if (activeWallet) { $("trade-account-label").textContent = activeWallet.accountId.slice(0, 12) + "…"; $("trade-refund").value ||= activeWallet.accountId; } } return; }
  const note = event.target.closest("[data-toast]");
  if (note) toast(note.dataset.toast);
});
$("create-wallet").addEventListener("click", () => {
  try {
    resetForNewWallet();
    const generated = generateSeedPhrase();
    currentPhrase = normalizeSeedPhrase(generated.seedPhrase);
    if (!validateMnemonic(currentPhrase, wordlist)) throw new Error("The generated recovery phrase did not pass validation.");
    pendingWallet = makeWallet(generated);
    renderPhrase(currentPhrase);
    $("toggle-phrase").textContent = "Hide words";
    $("phrase-grid").classList.remove("phrase-hidden");
    showScreen("recovery");
  } catch (error) {
    toast(error.message || "Could not generate a wallet. Please try again.");
  }
});
$("toggle-phrase").addEventListener("click", () => {
  const hidden = $("phrase-grid").classList.toggle("phrase-hidden");
  $("toggle-phrase").textContent = hidden ? "Show words" : "Hide words";
});
$("copy-phrase").addEventListener("click", async () => {
  if (!currentPhrase) return;
  try { await navigator.clipboard.writeText(currentPhrase); toast("Recovery phrase copied. Keep it private."); }
  catch { toast("Clipboard access unavailable. Please write the words down in order."); }
});
$("saved-check").addEventListener("change", () => $("continue-recovery").disabled = !$("saved-check").checked);
$("continue-recovery").addEventListener("click", () => {
  if (!pendingWallet || !$("saved-check").checked) return;
  $("wallet-name").value = "My Domain Wallet";
  showScreen("confirm");
});
$("wallet-name").addEventListener("input", () => {
  if ($("wallet-name").value.length > 24) $("wallet-name").value = $("wallet-name").value.slice(0, 24);
});
$("import-phrase").addEventListener("input", () => {
  const count = $("import-phrase").value.trim().split(/\s+/).filter(Boolean).length;
  $("word-count").textContent = count + (count === 1 ? " word" : " words");
  $("import-error").textContent = "";
});
$("import-submit").addEventListener("click", () => {
  try {
    const phrase = normalizeSeedPhrase($("import-phrase").value);
    if (![12, 24].includes(phrase.split(" ").length)) throw new Error("Enter exactly 12 or 24 recovery words.");
    if (!validateMnemonic(phrase, wordlist)) throw new Error("That recovery phrase is not valid. Check the words and their order.");
    const recovered = parseSeedPhrase(phrase);
    pendingWallet = makeWallet(recovered);
    currentPhrase = "";
    $("wallet-name").value = "My Domain Wallet";
    $("import-error").textContent = "";
    $("import-phrase").value = "";
    showScreen("confirm");
  } catch (error) {
    $("import-error").textContent = error.message || "Could not restore this wallet.";
  }
});
$("secure-wallet").addEventListener("click", async () => {
  const password = $("wallet-password").value;
  const confirm = $("wallet-password-confirm").value;
  $("password-error").textContent = "";
  if (!pendingWallet) { $("password-error").textContent = "Your wallet session expired. Start again."; return; }
  if (password.length < 8) { $("password-error").textContent = "Use a password with at least 8 characters."; return; }
  if (password !== confirm) { $("password-error").textContent = "The passwords do not match."; return; }
  const button = $("secure-wallet");
  button.disabled = true;
  button.textContent = "Encrypting wallet…";
  try {
    await saveEncryptedWallet(pendingWallet, password, $("wallet-name").value || "My Domain Wallet");
    activeWallet = { ...pendingWallet, name: $("wallet-name").value.trim() || "My Domain Wallet" };
    pendingWallet = null;
    currentPhrase = "";
    $("phrase-grid").innerHTML = "";
    $("wallet-password").value = "";
    $("wallet-password-confirm").value = "";
    renderWallet();
    setWelcomeAction();
    showScreen("ready");
    void checkOnChainAccount();
  } catch (error) {
    $("password-error").textContent = error.message || "Could not encrypt the wallet on this device.";
  } finally {
    button.disabled = false;
    button.innerHTML = 'Encrypt & create wallet <span>→</span>';
  }
});
$("unlock-wallet").addEventListener("click", async () => {
  $("unlock-error").textContent = "";
  try {
    activeWallet = await unlockWithPassword($("unlock-password").value);
    $("unlock-password").value = "";
    renderWallet();
    showScreen("dashboard");
  } catch {
    $("unlock-error").textContent = "Unable to unlock. Check your password, or restore with your recovery phrase.";
  }
});
$("forget-wallet").addEventListener("click", () => {
  toast("Use Import an existing wallet to restore with your recovery phrase.");
  showScreen("choice");
});
$("copy-address").addEventListener("click", async () => {
  if (!activeWallet) return;
  try { await navigator.clipboard.writeText(activeWallet.accountId); toast("NEAR address copied."); }
  catch { toast("Clipboard access unavailable. You can select the address to copy it."); }
});
$("dashboard-copy-address").addEventListener("click", async () => {
  if (!activeWallet) return;
  try { await navigator.clipboard.writeText(activeWallet.accountId); toast("NEAR address copied."); } catch { toast("Clipboard access unavailable."); }
});
$("refresh-balances").addEventListener("click", () => void loadDashboard());
$("refresh-markets").addEventListener("click", () => void loadDiscovery());
$("receive-action").addEventListener("click", async () => {
  if (!activeWallet) return;
  try { await navigator.clipboard.writeText(activeWallet.accountId); toast("Your NEAR address was copied."); }
  catch { toast("Your NEAR address: " + activeWallet.accountId); }
});
$("lock-wallet").addEventListener("click", () => {
  activeWallet = null;
  $("unlock-password").value = "";
  showScreen("unlock");
});
let accountBalanceHidden = false;
$("toggle-balance").addEventListener("click", () => {
  accountBalanceHidden = !accountBalanceHidden;
  $("portfolio-total").classList.toggle("balance-hidden", accountBalanceHidden);
  $("tokens-total-value").classList.toggle("balance-hidden", accountBalanceHidden);
  $("toggle-balance").textContent = accountBalanceHidden ? "◌" : "◉";
  $("toggle-balance").setAttribute("aria-label", accountBalanceHidden ? "Show balance" : "Hide balance");
});
$("account-history").addEventListener("click", () => toast("Transaction history will appear here when activity indexing is connected."));
document.querySelectorAll("[data-account-tab]").forEach(button => button.addEventListener("click", () => {
  document.querySelectorAll("[data-account-tab]").forEach(item => item.classList.toggle("active", item === button));
  const defi = button.dataset.accountTab === "defi";
  $("holdings-section").hidden = defi;
  $("discovery-section").hidden = defi || $("holdings-list").querySelector(".account-empty-wallet") === null;
  $("account-defi-panel").hidden = !defi;
}));
if (!window.crypto?.subtle) {
  $("welcome-action").disabled = true;
  toast("This browser does not support secure wallet encryption. Please use an up-to-date browser over HTTPS.");
} else {
  setWelcomeAction();
  if (walletExists()) showScreen("unlock");
}
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.getRegistrations()
    .then((registrations) => registrations.forEach((registration) => registration.unregister()))
    .catch(() => {}));
}


// NEAR Intents 1Click swap / bridge interface
let tradeAssets = [];
let committedTradeQuote = null;
let tradeMode = "swap";
const ONE_CLICK = "https://1click.chaindefuser.com";
function tradeAssetLabel(asset) { return asset.symbol + " · " + String(asset.blockchain || "").toUpperCase(); }
function selectedTradeAsset(id) { return tradeAssets.find(asset => asset.assetId === id); }
function populateTradeSelectors() {
  const from = $("trade-from-token"), to = $("trade-to-token");
  const currentFrom = from.value, currentTo = to.value;
  const options = tradeAssets.map(asset => '<option value="' + escapeHtml(asset.assetId) + '">' + escapeHtml(tradeAssetLabel(asset)) + '</option>').join("");
  from.innerHTML = options; to.innerHTML = options;
  const preferredFrom = tradeAssets.find(asset => asset.blockchain === "near" && ["NEAR","wNEAR"].includes(asset.symbol));
  const preferredTo = tradeAssets.find(asset => asset.symbol === "USDC" && asset.blockchain !== "near") || tradeAssets.find(asset => asset.symbol === "USDC");
  from.value = tradeAssets.some(a => a.assetId === currentFrom) ? currentFrom : preferredFrom?.assetId || tradeAssets[0]?.assetId || "";
  to.value = tradeAssets.some(a => a.assetId === currentTo) ? currentTo : preferredTo?.assetId || tradeAssets[1]?.assetId || "";
  updateTradeChains();
}
function updateTradeChains() {
  const from = selectedTradeAsset($("trade-from-token").value), to = selectedTradeAsset($("trade-to-token").value);
  $("trade-from-chain").textContent = from ? (from.blockchain || "Network").toUpperCase() + " · " + (from.contractAddress || from.assetId) : "";
  $("trade-to-chain").textContent = to ? (to.blockchain || "Network").toUpperCase() + " · " + (to.contractAddress || to.assetId) : "";
  $("recipient-help").textContent = to ? "Enter an address on " + to.blockchain + " to receive " + to.symbol + "." : "Enter an address on the destination network.";
  if (activeWallet && to?.blockchain === "near" && !$("trade-recipient").value) $("trade-recipient").value = activeWallet.accountId;
  if (activeWallet && to?.blockchain !== "near" && $("trade-recipient").value === activeWallet.accountId) $("trade-recipient").value = "";
  if (activeWallet && from?.blockchain === "near" && !$("trade-refund").value) $("trade-refund").value = activeWallet.accountId;
  if (activeWallet && from?.blockchain !== "near" && $("trade-refund").value === activeWallet.accountId) $("trade-refund").value = "";
  $("trade-to-amount").value = "";
  $("trade-quote-panel").innerHTML = '<span>ROUTE</span><b>Powered by NEAR Intents</b><small>Get a live quote to see the estimated output and route.</small>';
  committedTradeQuote = null;
  $("trade-deposit-instructions").hidden = true;
}
async function loadTradeAssets() {
  const list = $("markets-list");
  if (list) list.innerHTML = '<div class="loading-card">Loading supported assets from NEAR Intents…</div>';
  try {
    const tokens = await fetchJson(ONE_CLICK + "/v0/tokens");
    tradeAssets = tokens.filter(token => token.assetId && Number.isInteger(Number(token.decimals)) && Number(token.decimals) >= 0);
    if (!tradeAssets.length) throw new Error("No supported assets were returned.");
    populateTradeSelectors();
    const popular = tradeAssets.filter(token => Number(token.price) > 0).sort((a,b) => Number(b.price)-Number(a.price)).slice(0,8);
    if (list) list.innerHTML = popular.map(token => '<article class="discovery-row"><span class="asset-avatar">' + escapeHtml(token.symbol.slice(0,2)) + '</span><span class="asset-info"><b>' + escapeHtml(token.symbol) + '</b><small>' + escapeHtml(String(token.blockchain).toUpperCase()) + ' · ' + escapeHtml(token.assetId) + '</small></span><span class="asset-value"><b>' + formatUsd(Number(token.price)) + '</b><small>Indicative price</small></span></article>').join("") || '<div class="loading-card">Asset prices are not available at the moment.</div>';
  } catch (error) {
    if (list) list.innerHTML = '<div class="loading-card">Could not load the NEAR Intents asset list. Please refresh.</div>';
    $("trade-error").textContent = error.message || "Could not load supported assets.";
  }
}
function amountToAtomic(value, decimals) {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error("Enter a valid amount greater than zero.");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error("This token supports up to " + decimals + " decimal places.");
  const atomic = BigInt(whole) * (10n ** BigInt(decimals)) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (atomic <= 0n) throw new Error("Enter an amount greater than zero.");
  return atomic.toString();
}
function tradeQuoteRequest(dry) {
  const from = selectedTradeAsset($("trade-from-token").value), to = selectedTradeAsset($("trade-to-token").value);
  if (!from || !to) throw new Error("Choose both assets first.");
  if (from.assetId === to.assetId) throw new Error("Choose two different assets.");
  const amount = amountToAtomic($("trade-from-amount").value.trim(), Number(from.decimals));
  const recipient = $("trade-recipient").value.trim();
  const refundTo = $("trade-refund").value.trim();
  if (!recipient) throw new Error("Enter the destination wallet address.");
  if (!refundTo) throw new Error("Enter a refund address on the sell-token network.");
  return {
    dry, swapType: "EXACT_INPUT", slippageTolerance: Number($("trade-slippage").value),
    originAsset: from.assetId, depositType: "ORIGIN_CHAIN", destinationAsset: to.assetId,
    amount, recipient, recipientType: "DESTINATION_CHAIN",
    refundTo, refundType: "ORIGIN_CHAIN",
    deadline: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    quoteWaitingTimeMs: 3000
  };
}
function renderTradeQuote(result) {
  const q = result.quote || result;
  $("trade-to-amount").value = q.amountOutFormatted || "—";
  $("trade-quote-panel").innerHTML = '<span>LIVE QUOTE · NEAR INTENTS</span><b>' + escapeHtml(q.amountInFormatted || $("trade-from-amount").value) + ' ' + escapeHtml(selectedTradeAsset($("trade-from-token").value)?.symbol || "") + ' → ' + escapeHtml(q.amountOutFormatted || "—") + ' ' + escapeHtml(selectedTradeAsset($("trade-to-token").value)?.symbol || "") + '</b><small>Estimated time: ' + (Number(q.timeEstimate) ? Math.max(1, Math.ceil(Number(q.timeEstimate)/60)) + ' min' : 'provided by solver') + ' · Slippage: ' + escapeHtml((Number($("trade-slippage").value)/100).toFixed(2)) + '%</small><small>Quote deadline: ' + escapeHtml(q.deadline || "as shown by provider") + '</small>';
}
$("trade-from-token").addEventListener("change", updateTradeChains);
$("trade-to-token").addEventListener("change", updateTradeChains);
$("swap-direction").addEventListener("click", () => {
  const from = $("trade-from-token").value; $("trade-from-token").value = $("trade-to-token").value; $("trade-to-token").value = from;
  const amount = $("trade-from-amount").value; $("trade-from-amount").value = $("trade-to-amount").value || ""; $("trade-to-amount").value = amount;
  updateTradeChains();
});
$("trade-from-amount").addEventListener("input", () => { committedTradeQuote = null; $("trade-to-amount").value = ""; $("trade-deposit-instructions").hidden = true; });
document.querySelectorAll("[data-trade-mode]").forEach(button => button.addEventListener("click", () => {
  tradeMode = button.dataset.tradeMode;
  document.querySelectorAll("[data-trade-mode]").forEach(item => item.classList.toggle("active", item === button));
  $("get-trade-quote").textContent = tradeMode === "bridge" ? "Get bridge quote →" : "Get quote →";
  $("trade-quote-panel").innerHTML = '<span>' + tradeMode.toUpperCase() + '</span><b>Powered by NEAR Intents</b><small>Choose your assets and request a fresh quote.</small>';
}));
$("trade-refresh-assets").addEventListener("click", () => void loadTradeAssets());
$("get-trade-quote").addEventListener("click", async () => {
  const button = $("get-trade-quote");
  $("trade-error").textContent = "";
  try {
    const body = tradeQuoteRequest(true);
    button.disabled = true; button.textContent = "Getting live quote…";
    const response = await fetchJson(ONE_CLICK + "/v0/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    renderTradeQuote(response);
    committedTradeQuote = body;
    const action = document.createElement("button");
    action.className = "button button-primary wide-button";
    action.id = "commit-trade-quote";
    action.textContent = "Create deposit instructions →";
    $("trade-deposit-instructions").hidden = true;
    $("trade-quote-panel").append(action);
    action.addEventListener("click", async () => {
      action.disabled = true; action.textContent = "Preparing deposit…";
      try {
        const wetBody = { ...committedTradeQuote, dry: false };
        const committed = await fetchJson(ONE_CLICK + "/v0/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(wetBody) });
        const q = committed.quote || committed;
        if (!q.depositAddress) throw new Error("The provider did not return a deposit address.");
        const panel = $("trade-deposit-instructions");
        panel.hidden = false;
        panel.innerHTML = '<span class="deposit-label">DEPOSIT INSTRUCTIONS · EXPIRES ' + escapeHtml(q.timeWhenInactive || q.deadline || "SOON") + '</span><b>Send only ' + escapeHtml(selectedTradeAsset($("trade-from-token").value)?.symbol || "the selected asset") + ' to this address</b><code id="trade-deposit-address">' + escapeHtml(q.depositAddress) + '</code><button class="inline-action" id="copy-trade-deposit">Copy deposit address</button><small>Send the exact asset and network shown. This quote does not send funds. Use your source-chain wallet to make the deposit. Never send a different token or network to this address.</small>';
        $("copy-trade-deposit").addEventListener("click", async () => { try { await navigator.clipboard.writeText(q.depositAddress); toast("Deposit address copied."); } catch { toast("Select and copy the deposit address."); } });
        action.textContent = "Deposit instructions ready";
      } catch (error) { $("trade-error").textContent = error.message || "Could not prepare deposit instructions."; action.disabled = false; action.textContent = "Try again"; }
    });
  } catch (error) {
    $("trade-error").textContent = error.message || "Could not get a quote. Check the amount and addresses.";
    $("trade-quote-panel").innerHTML = '<span>QUOTE UNAVAILABLE</span><b>Could not find a route</b><small>' + escapeHtml(error.message || "Try a different amount or asset pair.") + '</small>';
  } finally { button.disabled = false; button.textContent = tradeMode === "bridge" ? "Get bridge quote →" : "Get quote →"; }
});


// Markets page — live asset catalogue from NEAR Intents 1Click
let marketAssets = [];
let marketFilter = "all";
let marketSortDescending = true;
let marketFavorites = new Set(JSON.parse(localStorage.getItem("domain.market.favorites") || "[]"));
function marketPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return new Intl.NumberFormat("en-US", { style:"currency", currency:"USD", minimumFractionDigits: n < 1 ? 4 : 2, maximumFractionDigits: n < 1 ? 6 : 2 }).format(n);
}
function marketTokenInitial(symbol) { return String(symbol || "?").slice(0,2).toUpperCase(); }
function renderMarketList() {
  const query = $("market-search").value.trim().toLowerCase();
  let rows = marketAssets.filter(token => {
    const matchesFilter = marketFilter === "all" || (marketFilter === "near" ? token.blockchain === "near" : token.blockchain !== "near");
    const haystack = [token.symbol,token.blockchain,token.contractAddress,token.assetId].join(" ").toLowerCase();
    return matchesFilter && haystack.includes(query);
  });
  rows.sort((a,b) => {
    const pa = Number(a.price) || 0, pb = Number(b.price) || 0;
    return marketSortDescending ? pb-pa : pa-pb;
  });
  $("market-count").textContent = rows.length + " assets";
  if (!rows.length) {
    $("market-list").innerHTML = '<div class="market-empty"><span>⌕</span><b>No matching tokens</b><small>Try another symbol or network.</small></div>';
    return;
  }
  $("market-list").innerHTML = rows.slice(0,180).map((token,index) => {
    const key = token.assetId;
    const favorite = marketFavorites.has(key);
    const price = Number(token.price);
    const chain = String(token.blockchain || "unknown").toUpperCase();
    return '<article class="market-row"><button class="market-favorite '+(favorite?'is-favorite':'')+'" data-favorite="'+escapeHtml(key)+'" aria-label="'+(favorite?'Remove from':'Add to')+' favorites">'+(favorite?'★':'☆')+'</button><span class="market-token-avatar avatar-'+(index%6)+'">'+escapeHtml(marketTokenInitial(token.symbol))+'</span><span class="market-token-info"><b>'+escapeHtml(token.symbol || "Unknown")+'</b><small>'+escapeHtml(chain)+(token.contractAddress ? ' · '+escapeHtml(token.contractAddress) : '')+'</small></span><span class="market-price"><b>'+marketPrice(price)+'</b><small>'+(price>0?'USD price':'Price unavailable')+'</small></span><span class="market-token-network">'+escapeHtml(chain)+'</span></article>';
  }).join("");
}
async function loadMarketAssets() {
  $("market-list").innerHTML = '<div class="loading-card">Loading supported tokens from NEAR Intents…</div>';
  $("market-updated").textContent = "Refreshing prices";
  try {
    const tokens = await fetchJson(ONE_CLICK + "/v0/tokens");
    const seen = new Set();
    marketAssets = tokens.filter(token => {
      if (!token.assetId || seen.has(token.assetId)) return false;
      seen.add(token.assetId); return true;
    });
    marketAssets.sort((a,b) => Number(b.price||0)-Number(a.price||0));
    $("market-updated").textContent = "Updated " + new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
    renderMarketList();
  } catch (error) {
    $("market-updated").textContent = "Connection unavailable";
    $("market-list").innerHTML = '<div class="market-empty"><span>!</span><b>Could not load market assets</b><small>'+escapeHtml(error.message || "Check your connection and try again.")+'</small><button class="inline-action" id="market-retry">Try again</button></div>';
    $("market-retry")?.addEventListener("click", () => void loadMarketAssets());
  }
}
$("market-search").addEventListener("input", renderMarketList);
document.querySelectorAll("[data-market-filter]").forEach(button => button.addEventListener("click", () => {
  marketFilter = button.dataset.marketFilter;
  document.querySelectorAll("[data-market-filter]").forEach(item => item.classList.toggle("active",item===button));
  renderMarketList();
}));
$("market-sort").addEventListener("click", () => { marketSortDescending = !marketSortDescending; $("market-sort").textContent = marketSortDescending ? "↕" : "↧"; renderMarketList(); });
$("market-price-heading").addEventListener("click", () => { marketSortDescending = !marketSortDescending; renderMarketList(); });
$("market-refresh").addEventListener("click", () => void loadMarketAssets());
$("market-list").addEventListener("click", event => {
  const button = event.target.closest("[data-favorite]");
  if (!button) return;
  const id = button.dataset.favorite;
  if (marketFavorites.has(id)) marketFavorites.delete(id); else marketFavorites.add(id);
  localStorage.setItem("domain.market.favorites", JSON.stringify([...marketFavorites]));
  renderMarketList();
});
