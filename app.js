const screens=["welcome","choice","recovery","confirm","ready","dashboard","import"];
const toastEl=document.getElementById("toast");
let toastTimer;
function showScreen(name){
  screens.forEach(id=>document.getElementById("screen-"+id)?.classList.toggle("active",id===name));
  if(name==="ready"){
    const nameInput=document.getElementById("wallet-name");
    document.getElementById("ready-name").textContent=nameInput.value.trim()||"My Domain Wallet";
  }
  window.scrollTo({top:0,behavior:"smooth"});
}
function toast(message){
  toastEl.textContent=message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>toastEl.classList.remove("show"),2600);
}
document.addEventListener("click",event=>{
  const go=event.target.closest("[data-go]");
  if(go){event.preventDefault();showScreen(go.dataset.go);return;}
  const note=event.target.closest("[data-toast]");
  if(note)toast(note.dataset.toast);
});
const toggle=document.getElementById("toggle-phrase");
const phraseGrid=document.getElementById("phrase-grid");
toggle.addEventListener("click",()=>{
  const hidden=phraseGrid.dataset.hidden==="true";
  phraseGrid.dataset.hidden=String(!hidden);
  phraseGrid.querySelectorAll("b").forEach(el=>el.textContent=hidden?"PREVIEW":"••••••");
  toggle.textContent=hidden?"Hide words":"Show words";
});
document.getElementById("copy-phrase").addEventListener("click",()=>toast("No sample recovery phrase is provided. Real key generation is not connected yet."));
const savedCheck=document.getElementById("saved-check");
const continueRecovery=document.getElementById("continue-recovery");
savedCheck.addEventListener("change",()=>continueRecovery.disabled=!savedCheck.checked);
continueRecovery.addEventListener("click",()=>showScreen("confirm"));
document.getElementById("wallet-name").addEventListener("input",event=>{
  document.getElementById("ready-name").textContent=event.target.value.trim()||"My Domain Wallet";
});
document.getElementById("import-phrase").addEventListener("input",event=>{
  const words=event.target.value.trim().split(/\s+/).filter(Boolean);
  document.getElementById("word-count").textContent=words.length+" words";
  document.getElementById("import-error").textContent="";
});
document.getElementById("import-submit").addEventListener("click",()=>{
  const value=document.getElementById("import-phrase").value.trim();
  const count=value?value.split(/\s+/).filter(Boolean).length:0;
  document.getElementById("import-error").textContent=(count===12||count===24)
    ?"Word count looks right, but secure wallet import is not connected in this preview. Do not enter a real recovery phrase."
    :"Please enter exactly 12 or 24 words for this preview.";
});
if("serviceWorker" in navigator&&location.protocol.startsWith("http")){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
}