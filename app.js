import nearSeedPhrase from "near-seed-phrase";
import bs58 from "bs58";
import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

const { generateSeedPhrase, parseSeedPhrase, normalizeSeedPhrase } = nearSeedPhrase;
const STORAGE_KEY = "domain.wallet.encrypted.v1";
const PBKDF2_ITERATIONS = 310000;
const screens = ["welcome","choice","recovery","import","confirm","password","unlock","ready","dashboard"];
let pendingWallet = null;
let activeWallet = null;
let currentPhrase = "";
let toastTimer;

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
