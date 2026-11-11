import nearSeedPhrase from "near-seed-phrase";
import bs58 from "bs58";
import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

const { generateSeedPhrase, parseSeedPhrase, normalizeSeedPhrase } = nearSeedPhrase;
const STORAGE_KEY = "domain.wallet.encrypted.v1";
const PBKDF2_ITERATIONS = 310000;
const screens = ["welcome","choice","recovery","import","confirm","password","unlock","ready","dashboard","markets"];
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
  $("dashboard-account").textContent = activeWallet.accountId;
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
    $("balance-status").textContent = "LIVE DATA";
    if (holdings.length) {
      $("holdings-list").innerHTML = holdings.map((item) =>
        '<article class="asset-row"><span class="asset-avatar">' + escapeHtml(item.symbol.slice(0, 2)) + '</span><span class="asset-info"><b>' + escapeHtml(item.symbol) + '</b><small>' + escapeHtml(item.name) + '</small></span><span class="asset-value"><b>' + escapeHtml(item.displayAmount) + '</b><small>' + (item.usd === null ? "Price unavailable" : formatUsd(item.usd)) + '</small></span></article>'
      ).join("");
      $("discovery-section").hidden = true;
    } else {
      $("holdings-list").innerHTML = '<div class="empty-wallet"><span class="empty-wallet-icon">◈</span><b>Your wallet is waiting for its first asset</b><small>Deposit or receive tokens to see your portfolio here.</small></div>';
      $("discovery-section").hidden = false;
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
  if (go) { event.preventDefault(); showScreen(go.dataset.go); return; }
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
if (!window.crypto?.subtle) {
  $("welcome-action").disabled = true;
  toast("This browser does not support secure wallet encryption. Please use an up-to-date browser over HTTPS.");
} else {
  setWelcomeAction();
  if (walletExists()) showScreen("unlock");
}
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
