import nearSeedPhrase from "near-seed-phrase";
import bs58 from "bs58";
import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

const { generateSeedPhrase, parseSeedPhrase, normalizeSeedPhrase } = nearSeedPhrase;
const STORAGE_KEY = "domain.wallet.encrypted.v1";
const PBKDF2_ITERATIONS = 310000;
const screens = ["welcome","choice","recovery","import","confirm","password","unlock","ready","home","dashboard","market","trade"];
let pendingWallet = null;
let activeWallet = null;
let currentPhrase = "";
let toastTimer;
let dashboardLoadId = 0;
let supportedNearTokens = [];

const $ = (id) => document.getElementById(id);

// Trade state is initialized before document-level click handlers can run.
let allTradeAssets = [];
let tradeAssets = [];
let committedTradeQuote = null;
let tradeMode = "swap";
let tradePreviewTimer = null;
let tradePreviewRequest = 0;
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
  $("dashboard-account").textContent = activeWallet.accountId;
  $("account-wallet-name").textContent = activeWallet.name || "Domain Wallet";
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
const SUPABASE_FUNCTIONS_URL = (import.meta.env.VITE_SUPABASE_URL || "") + "/functions/v1/intents-api";
async function fetchIntents(path, options = {}) {
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const publishable = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_FUNCTIONS_URL.startsWith("https://") || !anon || !publishable) throw new Error("The secure NEAR Intents backend is not configured. Refresh after deployment.");
  const response = await fetch(SUPABASE_FUNCTIONS_URL + "/" + path, { ...options, headers: { Accept: "application/json", "Content-Type": "application/json", apikey: publishable, Authorization: "Bearer " + anon, ...(options.headers || {}) } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "NEAR Intents backend request failed (" + response.status + ").");
  return result;
}
async function fetchIntentsTokens() {
  const response = await fetchIntents("tokens");
  // Accept the documented array and common API gateway wrappers.
  let value = response;
  for (let depth = 0; depth < 4 && !Array.isArray(value); depth++) {
    if (!value || typeof value !== "object") break;
    value = value.tokens ?? value.assets ?? value.data ?? value.result ?? value.items ?? value;
    if (value === response) break;
  }
  if (!Array.isArray(value)) {
    const keys = response && typeof response === "object" ? Object.keys(response).join(", ") : typeof response;
    throw new Error("Asset API returned an unexpected format (" + keys + ").");
  }
  return value.map(token => {
    const item = token && typeof token === "object" ? token : {};
    return {
      ...item,
      assetId: item.assetId ?? item.asset_id ?? item.id ?? "",
      blockchain: item.blockchain ?? item.network ?? item.chain ?? "",
      symbol: item.symbol ?? item.ticker ?? item.name ?? "",
      decimals: item.decimals ?? item.decimal
    };
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Accept: "application/json", ...(options.headers || {}) } });
  if (!response.ok) throw new Error("Request failed (" + response.status + ")");
  return response.json();
}
async function fetchSupportedNearTokens() {
  const tokens = await fetchIntentsTokens();
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
let homeFeedRequest = 0;
async function loadHomeFeed() {
  const requestId = ++homeFeedRequest;
  const target = $("home-featured-assets");
  if (!target) return;
  target.innerHTML = '<div class="loading-card">Refreshing supported assets…</div>';
  try {
    const tokens = await fetchIntentsTokens();
    if (requestId !== homeFeedRequest) return;
    const seen = new Set();
    const valid = tokens.filter(token => {
      if (!token.assetId || seen.has(token.assetId) || !(Number(token.price) > 0)) return false;
      seen.add(token.assetId); return true;
    });
    const featured = valid.filter(token => token.blockchain === "near").slice(0,2).concat(valid.filter(token => token.blockchain !== "near").slice(0,2));
    if (!featured.length) {
      target.innerHTML = '<div class="market-empty"><span>◇</span><b>No featured assets right now</b><small>Open Markets to browse the supported-token list.</small></div>';
      return;
    }
    target.innerHTML = featured.map((token,index) => '<button class="home-asset-card" data-home-asset="'+escapeHtml(token.symbol || "")+'"><span class="home-asset-avatar">'+escapeHtml(String(token.symbol || "??").slice(0,2))+'</span><span class="home-asset-info"><b>'+escapeHtml(token.symbol || "Unknown")+'</b><small>'+escapeHtml(String(token.blockchain || "network").toUpperCase())+'</small></span><span class="home-asset-price"><b>'+formatUsd(Number(token.price))+'</b><small>Indicative USD</small></span><span class="home-asset-arrow">↗</span></button>').join("");
    target.querySelectorAll("[data-home-asset]").forEach(button => button.addEventListener("click", () => {
      showScreen("market");
      $("market-search").value = button.dataset.homeAsset;
      marketFilter = "all";
      document.querySelectorAll("[data-market-filter]").forEach(item => item.classList.toggle("active",item.dataset.marketFilter === "all"));
      void loadMarketAssets().then(() => renderMarketList());
    }));
  } catch (error) {
    if (requestId !== homeFeedRequest) return;
    target.innerHTML = '<div class="market-empty"><span>!</span><b>Discovery is temporarily unavailable</b><small>Check your connection or browse Markets again.</small><button class="inline-action" id="home-retry">Try again</button></div>';
    $("home-retry")?.addEventListener("click", () => void loadHomeFeed());
  }
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
      fetchIntentsTokens().catch(() => [])
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
  if (go) { event.preventDefault(); showScreen(go.dataset.go);
    if (go.dataset.go === "home") void loadHomeFeed();
    if (go.dataset.go === "dashboard") { if (activeWallet) { void loadDashboard(); $("account-wallet-name").textContent = activeWallet.name || "Domain Wallet"; $("account-wallet-network").textContent = "NEAR MAINNET"; } }
    if (go.dataset.go === "market") { void loadMarketAssets(); if (activeWallet) { $("market-wallet-name").textContent = activeWallet.name || "Domain Wallet"; $("market-account-label").textContent = activeWallet.accountId.slice(0, 12) + "…"; } }
    if (go.dataset.go === "trade") { void loadTradeAssets(); if (activeWallet) { $("trade-account-label").textContent = activeWallet.accountId.slice(0, 12) + "…"; $("trade-refund").value ||= activeWallet.accountId; } } return; }
  const tradeTab = event.target.closest("[data-trade-mode]");
  if (tradeTab) {
    event.preventDefault();
    const nextMode = tradeTab.dataset.tradeMode;
    if (nextMode === "swap" || nextMode === "bridge") {
      tradeMode = nextMode;
      document.querySelectorAll("[data-trade-mode]").forEach(item => {
        const active = item.dataset.tradeMode === tradeMode;
        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", active ? "true" : "false");
      });
      applyTradeModeAssets();
      if (allTradeAssets.length) populateTradeSelectors();
      $("get-trade-quote").textContent = tradeMode === "bridge" ? "Get bridge quote →" : "Get swap quote →";
      $("trade-quote-panel").innerHTML = '<span>' + tradeMode.toUpperCase() + '</span><b>Powered by NEAR Intents</b><small>' + (tradeMode === "bridge" ? "Choose different source and destination networks." : "Choose two NEAR-network tokens.") + '</small>';
      $("trade-error").textContent = "";
      $("trade-error").classList.remove("is-visible");
    }
    return;
  }
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
    showScreen("home");
    void loadHomeFeed();
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

function tradeChain(asset) { return String(asset?.blockchain || "").toLowerCase(); }
function tradeSymbol(asset) { return String(asset?.symbol || asset?.assetId || "Unknown"); }
function tradeAssetLabel(asset) { return tradeSymbol(asset) + " · " + (tradeChain(asset) || "NETWORK").toUpperCase(); }
function selectedTradeAsset(id) { return tradeAssets.find(asset => asset.assetId === id); }
function applyTradeModeAssets() {
  tradeAssets = tradeMode === "swap"
    ? allTradeAssets.filter(asset => tradeChain(asset) === "near")
    : allTradeAssets.filter(asset => tradeChain(asset));
  const description = $("trade-mode-description");
  if (description) description.textContent = tradeMode === "swap"
    ? "Swap NEAR and supported NEAR ecosystem tokens only."
    : "Bridge between networks supported by NEAR Intents. Choose different source and destination networks.";
  const title = document.querySelector(".trade-discovery .section-title p");
  if (title) title.textContent = tradeMode === "swap" ? "NEAR tokens available through 1Click" : "Cross-network assets available through 1Click";
}
function populateTradeSelectors() {
  const from = $("trade-from-token"), to = $("trade-to-token");
  const currentFrom = from.value, currentTo = to.value;
  const options = tradeAssets.map(asset => '<option value="' + escapeHtml(asset.assetId) + '">' + escapeHtml(tradeAssetLabel(asset)) + '</option>').join("");
  from.innerHTML = options || '<option value="">No supported assets for this mode</option>';
  to.innerHTML = options || '<option value="">No supported assets for this mode</option>';
  const preferredFrom = tradeAssets.find(asset => tradeSymbol(asset).toUpperCase() === "NEAR") || tradeAssets.find(asset => tradeSymbol(asset).toUpperCase() === "WNEAR");
  const preferredTo = tradeMode === "bridge"
    ? tradeAssets.find(asset => tradeSymbol(asset).toUpperCase() === "USDC" && tradeChain(asset) !== "near")
    : tradeAssets.find(asset => tradeSymbol(asset).toUpperCase() === "USDC");
  from.value = tradeAssets.some(a => a.assetId === currentFrom) ? currentFrom : preferredFrom?.assetId || tradeAssets[0]?.assetId || "";
  to.value = tradeAssets.some(a => a.assetId === currentTo) ? currentTo : preferredTo?.assetId || tradeAssets.find(a => a.assetId !== from.value)?.assetId || "";
  updateTradeChains();
}
function updateTradeChains() {
  const from = selectedTradeAsset($("trade-from-token").value), to = selectedTradeAsset($("trade-to-token").value);
  $("trade-from-chain").textContent = from ? (from.blockchain || "Network").toUpperCase() + " · " + (from.contractAddress || from.assetId) : "";
  $("trade-to-chain").textContent = to ? (to.blockchain || "Network").toUpperCase() + " · " + (to.contractAddress || to.assetId) : "";
  $("recipient-help").textContent = to ? "Enter an address on " + (tradeChain(to) || "the destination network") + " to receive " + tradeSymbol(to) + "." : "Enter an address on the destination network.";
  if (activeWallet && tradeChain(to) === "near" && !$("trade-recipient").value) $("trade-recipient").value = activeWallet.accountId;
  if (activeWallet && tradeChain(to) !== "near" && $("trade-recipient").value === activeWallet.accountId) $("trade-recipient").value = "";
  if (activeWallet && tradeChain(from) === "near" && !$("trade-refund").value) $("trade-refund").value = activeWallet.accountId;
  if (activeWallet && tradeChain(from) !== "near" && $("trade-refund").value === activeWallet.accountId) $("trade-refund").value = "";
  $("trade-to-amount").value = "";
  $("trade-quote-panel").innerHTML = '<span>ROUTE</span><b>Powered by NEAR Intents</b><small>Get a live quote to see the estimated output and route.</small>';
  committedTradeQuote = null;
  $("trade-deposit-instructions").hidden = true;
}
async function loadTradeAssets() {
  const list = $("markets-list");
  if (list) list.innerHTML = '<div class="loading-card">Loading supported assets from NEAR Intents…</div>';
  $("trade-error").textContent = "";
  try {
    const response = await fetchIntentsTokens();
    allTradeAssets = response.filter(token =>
      token && typeof token.assetId === "string" && token.assetId.length > 0 &&
      Number.isInteger(Number(token.decimals)) && Number(token.decimals) >= 0 &&
      typeof token.blockchain === "string" && token.blockchain.length > 0
    );
    if (!allTradeAssets.length) throw new Error("NEAR Intents returned no usable assets. Refresh to try again.");
    applyTradeModeAssets();
    populateTradeSelectors();
    if (!tradeAssets.length) {
      if (list) list.innerHTML = '<div class="loading-card">No assets are currently listed for this mode.</div>';
      $("trade-error").textContent = "No supported assets are currently listed for this mode.";
      return;
    }
    const popular = tradeAssets.filter(token => Number(token.price) > 0)
      .sort((a,b) => Number(b.price)-Number(a.price)).slice(0,8);
    if (list) list.innerHTML = popular.length ? popular.map(token => {
      const symbol = tradeSymbol(token);
      return '<article class="discovery-row"><span class="asset-avatar">' + escapeHtml(symbol.slice(0,2)) + '</span><span class="asset-info"><b>' + escapeHtml(symbol) + '</b><small>' + escapeHtml(tradeChain(token).toUpperCase()) + ' · ' + escapeHtml(token.assetId) + '</small></span><span class="asset-value"><b>' + formatUsd(Number(token.price)) + '</b><small>Indicative price</small></span></article>';
    }).join("") : '<div class="loading-card">Assets are available; live prices are not available at the moment.</div>';
  } catch (error) {
    const message = error.message || "Could not load supported assets.";
    const unavailable = '<option value="">Asset list unavailable — tap refresh</option>';
    $("trade-from-token").innerHTML = unavailable;
    $("trade-to-token").innerHTML = unavailable;
    if (list) list.innerHTML = '<div class="loading-card">' + escapeHtml(message) + '</div>';
    $("trade-error").textContent = "Asset loading failed: " + message;
    $("trade-error").classList.add("is-visible");
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
  if (tradeMode === "swap" && (tradeChain(from) !== "near" || tradeChain(to) !== "near")) {
    throw new Error("Swap is limited to NEAR-network tokens. Use Bridge for other networks.");
  }
  if (tradeMode === "bridge" && tradeChain(from) === tradeChain(to)) {
    throw new Error("Choose two different networks to bridge between.");
  }
  const amount = amountToAtomic($("trade-from-amount").value.trim(), Number(from.decimals));
  // For a NEAR-to-NEAR swap, the connected Domain account can safely be used
  // as the default receive/refund account. Cross-chain routes still require
  // the user to provide addresses for the relevant external networks.
  if (tradeMode === "swap" && activeWallet) {
    if (!$("trade-recipient").value.trim()) $("trade-recipient").value = activeWallet.accountId;
    if (!$("trade-refund").value.trim()) $("trade-refund").value = activeWallet.accountId;
  }
  const recipient = $("trade-recipient").value.trim();
  const refundTo = $("trade-refund").value.trim();
  if (!recipient) throw new Error("Add the wallet address that should receive the tokens.");
  if (!refundTo) throw new Error("Add a refund address for the network you are sending from.");
  return {
    dry, swapType: "EXACT_INPUT", slippageTolerance: Number($("trade-slippage").value),
    originAsset: from.assetId, depositType: "ORIGIN_CHAIN", destinationAsset: to.assetId,
    amount, recipient, recipientType: "DESTINATION_CHAIN",
    refundTo, refundType: "ORIGIN_CHAIN",
    deadline: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
}
function renderTradeQuote(result) {
  const q = result.quote || result;
  const from = selectedTradeAsset($("trade-from-token").value);
  const to = selectedTradeAsset($("trade-to-token").value);
  const output = q.amountOutFormatted || (q.amountOut ? formatTokenAmount(q.amountOut, Number(to?.decimals || 0)) : "");
  if (!output) throw new Error("NEAR Intents returned a quote without an estimated receive amount. Please request a fresh quote.");
  $("trade-to-amount").value = output;
  const input = q.amountInFormatted || $("trade-from-amount").value;
  const usdLine = q.amountInUsd && q.amountOutUsd
    ? '<small>Indicative value: ' + escapeHtml(formatUsd(Number(q.amountInUsd))) + ' in → ' + escapeHtml(formatUsd(Number(q.amountOutUsd))) + ' out</small>'
    : "";
  const minimumLine = q.minAmountOut
    ? '<small>Minimum receive at quoted slippage: ' + escapeHtml(formatTokenAmount(q.minAmountOut, Number(to?.decimals || 0))) + ' ' + escapeHtml(to?.symbol || "") + '</small>'
    : "";
  $("trade-quote-panel").innerHTML = '<span>LIVE QUOTE · NEAR INTENTS</span><b>Estimated receive: ' + escapeHtml(output) + ' ' + escapeHtml(to?.symbol || "") + '</b><small>Paying: ' + escapeHtml(input) + ' ' + escapeHtml(from?.symbol || "") + '</small>' + usdLine + minimumLine + '<small>Estimated time: ' + (Number(q.timeEstimate) ? Math.max(1, Math.ceil(Number(q.timeEstimate)/60)) + ' min' : 'provided by solver') + ' · Slippage setting: ' + escapeHtml((Number($("trade-slippage").value)/100).toFixed(2)) + '%</small><small>Provider fees are reflected in the quoted output; network gas may be separate. Quote deadline: ' + escapeHtml(q.deadline || "refresh before depositing") + '</small>';
}

function scheduleTradePreview() {
  clearTimeout(tradePreviewTimer);
  const requestId = ++tradePreviewRequest;
  committedTradeQuote = null;
  $("trade-to-amount").value = "";
  $("trade-deposit-instructions").hidden = true;
  const amount = $("trade-from-amount").value.trim();
  const from = selectedTradeAsset($("trade-from-token").value);
  const to = selectedTradeAsset($("trade-to-token").value);
  if (!amount || Number(amount) <= 0 || !from || !to) {
    $("trade-quote-panel").innerHTML = '<span>LIVE ESTIMATE</span><b>Enter an amount to calculate</b><small>NEAR Intents will return the estimated receive amount.</small>';
    return;
  }
  if (tradeMode === "swap" && activeWallet) {
    if (!$("trade-recipient").value.trim()) $("trade-recipient").value = activeWallet.accountId;
    if (!$("trade-refund").value.trim()) $("trade-refund").value = activeWallet.accountId;
  }
  if (!$("trade-recipient").value.trim() || !$("trade-refund").value.trim()) {
    $("trade-quote-panel").innerHTML = '<span>LIVE ESTIMATE</span><b>Wallet addresses needed</b><small>Unlock your Domain Wallet or enter both the recipient and refund addresses before requesting a quote.</small>';
    return;
  }
  $("trade-quote-panel").innerHTML = '<span>LIVE ESTIMATE</span><b>Getting a quote…</b><small>Requesting a live route from NEAR Intents. This does not move funds.</small>';
  tradePreviewTimer = setTimeout(async () => {
    try {
      const body = tradeQuoteRequest(true);
      const result = await fetchIntents("quote", { method: "POST", body: JSON.stringify({ action: "quote", payload: body }) });
      if (requestId !== tradePreviewRequest) return;
      renderTradeQuote(result);
      $("trade-quote-panel").insertAdjacentHTML("beforeend", '<small>Indicative quote only. Review and request a fresh quote before depositing.</small>');
    } catch (error) {
      if (requestId !== tradePreviewRequest) return;
      $("trade-to-amount").value = "";
      $("trade-quote-panel").innerHTML = '<span>QUOTE UNAVAILABLE</span><b>No estimate yet</b><small>' + escapeHtml(error.message || "Enter valid addresses and try again.") + '</small>';
    }
  }, 650);
}
$("trade-from-token").addEventListener("change", () => { updateTradeChains(); scheduleTradePreview(); });
$("trade-to-token").addEventListener("change", () => { updateTradeChains(); scheduleTradePreview(); });
$("swap-direction").addEventListener("click", () => {
  const from = $("trade-from-token").value; $("trade-from-token").value = $("trade-to-token").value; $("trade-to-token").value = from;
  const amount = $("trade-from-amount").value; $("trade-from-amount").value = $("trade-to-amount").value || ""; $("trade-to-amount").value = amount;
  updateTradeChains();
});
$("trade-from-amount").addEventListener("input", scheduleTradePreview);
$("trade-recipient").addEventListener("input", scheduleTradePreview);
$("trade-refund").addEventListener("input", scheduleTradePreview);
$("trade-slippage").addEventListener("change", scheduleTradePreview);
document.querySelectorAll("[data-trade-mode]").forEach(button => button.addEventListener("click", () => {
  const nextMode = button.dataset.tradeMode;
  if (nextMode !== tradeMode) {
    $("trade-from-token").value = "";
    $("trade-to-token").value = "";
    $("trade-recipient").value = "";
    $("trade-refund").value = "";
  }
  tradeMode = nextMode;
  document.querySelectorAll("[data-trade-mode]").forEach(item => item.classList.toggle("active", item === button));
  applyTradeModeAssets();
  if (allTradeAssets.length) populateTradeSelectors();
  $("get-trade-quote").textContent = tradeMode === "bridge" ? "Get bridge quote →" : "Get swap quote →";
  $("trade-quote-panel").innerHTML = '<span>' + tradeMode.toUpperCase() + '</span><b>Powered by NEAR Intents</b><small>' + (tradeMode === "bridge" ? "Choose different source and destination networks." : "Choose two NEAR-network tokens.") + '</small>';
  $("trade-error").textContent = "";
}));
$("trade-refresh-assets").addEventListener("click", () => void loadTradeAssets());
$("get-trade-quote").addEventListener("click", async (event) => {
  event.preventDefault();
  const button = $("get-trade-quote");
  const panel = $("trade-quote-panel");
  const errorBox = $("trade-error");
  errorBox.textContent = "";
  button.disabled = true;
  button.textContent = "Requesting live quote…";
  panel.innerHTML = '<span>NEAR INTENTS</span><b>Requesting your quote…</b><small>Checking the selected route and live market price. No funds will move.</small>';
  try {
    const body = tradeQuoteRequest(true);
    const response = await fetchIntents("quote", {
      method: "POST",
      body: JSON.stringify({ action: "quote", payload: body })
    });
    renderTradeQuote(response);
    committedTradeQuote = body;
    const action = document.createElement("button");
    action.type = "button";
    action.className = "button button-primary wide-button";
    action.id = "commit-trade-quote";
    action.textContent = "Continue — prepare deposit address (no funds sent) →";
    $("trade-deposit-instructions").hidden = true;
    panel.append(action);
    action.addEventListener("click", async () => {
      action.disabled = true;
      action.textContent = "Preparing deposit…";
      errorBox.textContent = "";
      try {
        const wetBody = { ...committedTradeQuote, dry: false };
        const committed = await fetchIntents("quote", {
          method: "POST",
          body: JSON.stringify({ action: "quote", payload: wetBody })
        });
        const q = committed.quote || committed;
        if (!q.depositAddress) throw new Error("NEAR Intents did not return a deposit address. No funds have been sent.");
        const panel = $("trade-deposit-instructions");
        panel.hidden = false;
        panel.innerHTML = '<span class="deposit-label">DEPOSIT INSTRUCTIONS · EXPIRES ' + escapeHtml(q.timeWhenInactive || q.deadline || "SOON") + '</span><b>Send only ' + escapeHtml(selectedTradeAsset($("trade-from-token").value)?.symbol || "the selected asset") + ' to this address</b><code id="trade-deposit-address">' + escapeHtml(q.depositAddress) + '</code><button type="button" class="inline-action" id="copy-trade-deposit">Copy deposit address</button><small>Sending is a separate step. This page has not moved funds. Verify the exact asset, network, amount and refund details before any deposit.</small>';
        $("copy-trade-deposit").addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(q.depositAddress); toast("Deposit address copied."); }
          catch { toast("Select and copy the deposit address."); }
        });
        action.textContent = "Deposit instructions ready — no funds sent";
      } catch (error) {
        errorBox.textContent = error.message || "Could not prepare deposit instructions.";
        action.disabled = false;
        action.textContent = "Try again";
      }
    });
  } catch (error) {
    const message = error.message || "Could not get a quote. Check the amount and addresses.";
    errorBox.textContent = message;
    panel.innerHTML = '<span>QUOTE UNAVAILABLE</span><b>Could not get a live quote</b><small>' + escapeHtml(message) + '</small><small>No funds have been sent. Correct the details and try again.</small>';
  } finally {
    button.disabled = false;
    button.textContent = tradeMode === "bridge" ? "Get bridge quote →" : "Get swap quote →";
  }
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
    const tokens = await fetchIntentsTokens();
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
