const screens = ["welcome","choice","recovery","confirm","ready","dashboard","import"];
const toastEl = document.getElementById("toast");
let toastTimer;
function showScreen(name){screens.forEach(id=>document.getElementById("screen-"+id)?.classList.toggle("active",id===name));window.scrollTo({top:0,behavior:"smooth"});}
function toast(message){toastEl.textContent=message;toastEl.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>toastEl.classList.remove("show"),2600);}
document.addEventListener("click",e=>{const go=e.target.closest("[data-go]");if(go){e.preventDefault();showScreen(go.dataset.go);return;}const note=e.target.closest("[data-toast]");if(note)toast(note.dataset.toast);});
const toggle=document.getElementById("toggle-phrase");
const phraseGrid=document.getElementById("phrase-grid");
toggle.addEventListener("click",()=>{const hidden=phraseGrid.dataset.hidden==="true";phraseGrid.dataset.hidden=String(!hidden);phraseGrid.querySelectorAll("b").forEach(el=>el.textContent=hidden?"PREVIEW":"••••••");toggle.textContent=hidden?"Hide words":"Show words";});
document.getElementById("copy-phrase").addEventListener("click",async()=>{toast("Sample phrase is intentionally not provided. Real key generation is not connected yet.");});
const savedCheck=document.getElementById("saved-check");
const continueRecovery=document.getElementById("continue-recovery");
savedCheck.addEventListener("change",()=>continueRecovery.disabled=!savedCheck.checked);
continueRecovery.addEventListener("click",()=>showScreen("confirm"));
const walletName=document.getElementById("wallet-name");
walletName.addEventListener("input",()=>{document.getElementById("ready-name").textContent=walletName.value.trim()||"My Domain Wallet";});
document.getElementById("import-phrase").addEventListener("input",e=>{const words=e.target.value.trim().split(/\s+/).filter(Boolean);document.getElementById("word-count").textContent=words.length+" words";document.getElementById("import-error").textContent="";});
document.getElementById("import-submit").addEventListener("click",()=>{const value=document.getElementById("import-phrase").value.trim();const count=value?value.split(/\s+/).filter(Boolean).length:0;document.getElementById("import-error").textContent=(count===12||count===24)?"Word count looks right, but secure wallet import is not connected in this preview. Please do not enter a real recovery phrase.":"Please enter exactly 12 or 24 words for this preview.";});
if("serviceWorker" in navigator && location.protocol.startsWith("http")){window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));}