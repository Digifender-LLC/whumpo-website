import { createDashboard } from './dashboard.js';
import { presentWithAcknowledgment } from './ack-timing.js';
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
const $ = (selector) => document.querySelector(selector);
let registering = false;
let passwordMode = false;
let authConfig;
let widgetId;
let widgetReady;

async function prepareWidget() {
  if (!authConfig?.turnstileSiteKey) return;
  if (!widgetReady) widgetReady = new Promise((resolve, reject) => {
    window.tellumoTurnstileReady = resolve;
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=tellumoTurnstileReady";
    script.onerror = () => reject(new Error("Could not load verification. Please reload the page."));
    document.head.append(script);
  });
  await widgetReady;
  if (widgetId === undefined) widgetId = window.turnstile.render("#turnstile-slot", { sitekey: authConfig.turnstileSiteKey, action: "register", theme: "light" });
}

function showMessage(message) {
  const element = $("#message");
  element.textContent = message;
  document.querySelectorAll("dialog[open] .dialog-status").forEach(status => { status.textContent = message; });
  element.classList.add("visible");
  setTimeout(() => element.classList.remove("visible"), 4500);
}
async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...options.headers },
    ...options
  });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || "Something went wrong"); error.status = response.status; throw error; }
  return data;
}
function text(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}
const workspace = createDashboard({api,text,sendMessage,showMessage,controls:{files:openFiles,inbox:openInbox,domains:openDomains,connections:openConnections,billing:openBilling,security:openSecurity}});
let chatRevision = 0;
let pendingMessage;
let sending = false;
let chatPoll;
function renderChat(data) {
  chatRevision = data.state.revision;
  const container = $("#chat-messages");
  container.replaceChildren();
  function bubble(role, content, mode = "guided") {
    const item = text("article", "", `chat-bubble ${role}`);
    item.append(text("small", role === "user" ? "You" : "TownHello"), text("p", content));
    container.append(item);
    return item;
  }
  bubble("assistant", data.greeting);
  for (const turn of data.turns) { bubble("user", turn.user_text); const answer = bubble("assistant", turn.assistant_text, turn.mode);
    if (typeof turn.version_id === 'string' && /^[0-9a-f-]{36}$/.test(turn.version_id)) {
      const link = text('a', 'Open private preview ↗'); link.href = `/api/site-versions/${turn.version_id}/preview`; link.target = '_blank'; link.rel = 'noopener noreferrer'; answer.append(link);
      const compare=text('a','Compare with live site');compare.href=`/api/site-versions/${turn.version_id}/diff`;compare.target='_blank';compare.rel='noopener noreferrer';answer.append(compare);
    }
    if(typeof turn.comparison_version_id==='string'&&/^[0-9a-f-]{36}$/.test(turn.comparison_version_id)){const compare=text('a','Open private comparison ↗');const base=typeof turn.comparison_baseline_id==='string'&&/^[0-9a-f-]{36}$/.test(turn.comparison_baseline_id)?turn.comparison_baseline_id:'none';compare.href=`/api/site-versions/${turn.comparison_version_id}/diff?base=${base}`;compare.target='_blank';compare.rel='noopener noreferrer';answer.append(compare);}
    const exportVersion = turn.export_version_id || turn.version_id;
    if (typeof exportVersion === 'string' && /^[0-9a-f-]{36}$/.test(exportVersion)) {
      const download=text('a','Download website source');download.href=`/api/site-versions/${exportVersion}/export`;download.download=`tellumo-site-${exportVersion}.zip`;answer.append(download);
    }
    if(typeof turn.backup_confirmation_id==='string'&&/^[0-9a-f-]{36}$/.test(turn.backup_confirmation_id)){const button=text('button','Confirm reviewed GitHub backup');button.onclick=()=>sendMessage(`/confirm-backup ${turn.backup_confirmation_id}`);answer.append(button);}
    if(typeof turn.backup_url==='string'&&/^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}\/tree\/[0-9a-f]{40}\/tellumo\/[0-9a-f-]{36}\/versions\/[0-9a-f-]{36}$/.test(turn.backup_url)){const link=text('a','Open verified GitHub backup ↗');link.href=turn.backup_url;link.target='_blank';link.rel='noopener noreferrer';answer.append(link);}
    if(typeof turn.cms_preview_project_id==='string'&&/^[0-9a-f-]{36}$/.test(turn.cms_preview_project_id)&&typeof turn.cms_preview_request_id==='string'&&/^[0-9a-f-]{36}$/.test(turn.cms_preview_request_id)){const link=text('a','Open private CMS preview ↗');link.href=`/api/cms/${turn.cms_preview_project_id}/content/${turn.cms_preview_request_id}/preview`;link.target='_blank';link.rel='noopener noreferrer';answer.append(link);}
    if(typeof turn.cms_publication_url==='string'&&/^https:\/\/sites\.digifender\.com\/s\/[0-9a-f-]{36}\/cms\/(posts|pages)\/[0-9A-HJKMNP-TV-Z]{26}$/.test(turn.cms_publication_url)){const link=text('a','Open published CMS article ↗');link.href=turn.cms_publication_url;link.target='_blank';link.rel='noopener noreferrer';answer.append(link);const index=text('a','Browse published articles ↗');index.href=turn.cms_publication_url.replace(/\/cms\/(posts|pages)\/[0-9A-HJKMNP-TV-Z]{26}$/,'/cms');index.target='_blank';index.rel='noopener noreferrer';answer.append(index);}
    if(typeof turn.cms_discard_confirmation_id==='string'&&/^[0-9a-f-]{36}$/.test(turn.cms_discard_confirmation_id)){const button=text('button',turn.cms_discard_recovery?'Check CMS discard result':'Discard reviewed CMS changes');button.onclick=()=>sendMessage(`/confirm-cms-discard ${turn.cms_discard_confirmation_id}`);answer.append(button);}
    if(typeof turn.cms_unpublish_confirmation_id==='string'&&/^[0-9a-f-]{36}$/.test(turn.cms_unpublish_confirmation_id)){const button=text('button',turn.cms_unpublish_recovery?'Recover CMS unpublish':'Take reviewed CMS article offline');button.onclick=()=>sendMessage(`/confirm-cms-unpublish ${turn.cms_unpublish_confirmation_id}`);answer.append(button);}
    if(typeof turn.cms_publication_review_id==='string'&&/^[0-9a-f-]{36}$/.test(turn.cms_publication_review_id)){const link=text('a','Review exact CMS article ↗');link.href=`/api/cms-publication-reviews/${turn.cms_publication_review_id}/preview`;link.target='_blank';link.rel='noopener noreferrer';answer.append(link);}
    if(typeof turn.cms_publication_confirmation_id==='string'&&/^[0-9a-f-]{36}$/.test(turn.cms_publication_confirmation_id)){const button=text('button','Publish reviewed CMS article');button.onclick=()=>sendMessage(`/confirm-cms-publish ${turn.cms_publication_confirmation_id}`);answer.append(button);}
    if(typeof turn.cms_confirmation_id==='string'&&/^[0-9a-f-]{36}$/.test(turn.cms_confirmation_id)){const button=text('button','Approve CMS setup request');button.onclick=()=>sendMessage(`/confirm-cms ${turn.cms_confirmation_id}`);answer.append(button);}
    if(typeof turn.backend_state_export_id==='string'&&/^[0-9a-f-]{36}$/.test(turn.backend_state_export_id)){const link=text('a','Download backend data');link.href=`/api/backend-state-snapshots/${turn.backend_state_export_id}/export`;link.download=`townhello-backend-state-${turn.backend_state_export_id}.json`;answer.append(link);}
    if(typeof turn.backend_state_confirmation_id==='string'&&/^[0-9a-f-]{36}$/.test(turn.backend_state_confirmation_id)){const button=text('button','Confirm reviewed data change');button.onclick=()=>sendMessage(`/confirm-backend-state ${turn.backend_state_confirmation_id}`);answer.append(button);}
    if(typeof turn.directory_export_id==='string'&&/^[0-9a-f-]{36}$/.test(turn.directory_export_id)&&typeof turn.directory_export_project_id==='string'&&/^[0-9a-f-]{36}$/.test(turn.directory_export_project_id)){const link=text('a','Download directory data');link.href=`/api/projects/${turn.directory_export_project_id}/directory/snapshots/${turn.directory_export_id}/export`;link.download=`tellumo-directory-${turn.directory_export_id}.json`;answer.append(link);}
    if(typeof turn.directory_confirmation_id==='string'&&/^[0-9a-f-]{36}$/.test(turn.directory_confirmation_id)){const button=text('button','Confirm reviewed directory change');button.onclick=()=>sendMessage(`/confirm-directory ${turn.directory_confirmation_id}`);answer.append(button);}
    if(typeof turn.directory_project_id==='string'&&/^[0-9a-f-]{36}$/.test(turn.directory_project_id)){const link=text('a','Open published directory ↗');link.href=`https://sites.digifender.com/s/${turn.directory_project_id}/directory`;link.target='_blank';link.rel='noopener noreferrer';answer.append(link);}
    if(typeof turn.contact_confirmation_id==='string'&&/^[0-9a-f-]{36}$/.test(turn.contact_confirmation_id)){const button=text('button','Confirm contact form settings');button.onclick=()=>sendMessage(`/confirm-contact ${turn.contact_confirmation_id}`);answer.append(button);}
    if(typeof turn.version_confirmation_id==='string'&&/^[0-9a-f-]{36}$/.test(turn.version_confirmation_id)){const button=text('button','Confirm version deletion');button.onclick=()=>sendMessage(`/confirm-version-delete ${turn.version_confirmation_id}`);answer.append(button);}
    if (typeof turn.photo_confirmation_id === 'string' && /^[0-9a-f-]{36}$/.test(turn.photo_confirmation_id)) {
      const button=text('button','Confirm photo deletion');button.onclick=()=>sendMessage(`/confirm-photo-delete ${turn.photo_confirmation_id}`);answer.append(button);
    }
    if (typeof turn.confirmation_id === 'string' && /^[0-9a-f-]{36}$/.test(turn.confirmation_id)) {
      const compare=text('a','Review website changes ↗');compare.href=`/api/publication-reviews/${turn.confirmation_id}/diff`;compare.target='_blank';compare.rel='noopener noreferrer';answer.append(compare);
      const confirm = text('button', 'Confirm reviewed change'); confirm.onclick = () => sendMessage(`/confirm ${turn.confirmation_id}`); answer.append(confirm);
    }
    if (turn.publication_kind !== 'unpublish' && typeof turn.published_project_id === 'string' && /^[0-9a-f-]{36}$/.test(turn.published_project_id)) {
      const link = text('a','Open published site ↗'); link.href = `https://sites.digifender.com/s/${turn.published_project_id}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; answer.append(link);
    } }
  $("#service-stats").textContent = `${data.stats.projects} project${data.stats.projects === 1 ? "" : "s"} · ${data.stats.live || 0} live${data.stats.cms_articles ? ` · ${data.stats.cms_articles} CMS article${data.stats.cms_articles===1?'':'s'}` : ''}`;
  $("#chat-input").placeholder = data.state.brief_stage === "audience" ? "Who is it for, and what should visitors do?" : data.state.brief_stage === "style" ? "Ocean, clay, forest, or describe your style…" : "Tell me what you’d like to build or change…";
  $("#agent-mode").textContent = data.mode === "ai" ? "AI assistance connected" : "Guided mode · No AI charges";
  $("#usage-stats").textContent = data.usage ? (data.usage.reserved ? "AI request in progress" : data.usage.available ? "AI assistance available" : "AI test allowance reached") : "";
  $("#ai-note").textContent = data.mode === "ai" ? "Setup and commands are free. AI replies use build units. This Contributor model may use messages for training; avoid confidential information." : "Guided mode uses no AI units. You can create, preview, and publish a simple site. Please keep passwords and API keys out of chat.";
  clearTimeout(chatPoll);
  if (data.turns.some(turn => turn.status === "pending")) chatPoll = setTimeout(async () => {
    try { const update=await api("/chat");if(!sending)renderChat(update); } catch (error) { showMessage(error.message); }
  }, 2000);
  container.scrollTop = container.scrollHeight;
}
async function loadDashboard(user) {
  history.replaceState(null, "", "/workspace/");
  $("#auth").hidden = true;
  $("#dashboard").hidden = false;
  renderChat(await api("/chat"));
  await workspace.start();
}
async function sendMessage(content) {
  if (sending || !content.trim()) return;
  if (["/inbox", "show inbox", "my inbox"].includes(content.trim().toLowerCase())) { await openInbox(); return; }
  if (["/connections", "show connections", "connect github", "disconnect github", "connect cloudflare", "disconnect cloudflare", "/backup", "backup my website", "back up my website"].includes(content.trim().toLowerCase())) { await openConnections(); return; }
  if (["/domains", "show domains", "connect my domain", "disconnect my domain", "check domain hosting"].includes(content.trim().toLowerCase())) { await openDomains(); return; }
  if (["/files", "show files", "show photos", "upload a photo", "delete a photo", "remove a photo"].includes(content.trim().toLowerCase())) { await openFiles(); return; }
  if (["/security", "/passkeys"].includes(content.trim().toLowerCase())) { await openSecurity(); return; }
  workspace.showChat();
  sending = true;
  clearTimeout(chatPoll);
  $("#chat-form button").disabled = true;
  $("#chat-form button").textContent = "Sending…";
  document.querySelectorAll("[data-command]").forEach(button => button.disabled = true);
  // Keep the request ID after a network failure so retrying cannot create a second project.
  if (!pendingMessage || pendingMessage.content !== content) pendingMessage = { content, revision: chatRevision, id: crypto.randomUUID() };
  const activeRequest = pendingMessage.id;
  const transient = text('div', '', 'chat-transient');
  const userBubble = text('article', '', 'chat-bubble user');
  userBubble.append(text('small','You'),text('p',content));transient.append(userBubble);
  $('#chat-messages').append(transient);
  $('#chat-messages').scrollTop=$('#chat-messages').scrollHeight;
  try {
    const response=await presentWithAcknowledgment(api("/chat", { method: "POST", body: JSON.stringify(pendingMessage) }), {
      readAck: async()=> (await api(`/chat/${activeRequest}/ack`)).ack,
      showAck: content=>{const bubble=text('article','','chat-bubble assistant');bubble.setAttribute('role','status');bubble.append(text('small','TownHello'),text('p',content));transient.append(bubble);$('#chat-messages').scrollTop=$('#chat-messages').scrollHeight;},
      hideAck: ()=>transient.remove()
    });
    renderChat(response);
    workspace.refresh().catch(error=>showMessage(error.message));
    pendingMessage = undefined;
    $("#chat-input").value = "";
  } catch (error) {
    showMessage(error.message);
    if (error.status === 409) {
      pendingMessage = undefined;
      try { renderChat(await api("/chat")); } catch { showMessage("Could not refresh the conversation. Reload before trying again."); }
    }
  } finally {
    sending = false;
    $("#chat-form button").disabled = false;
    $("#chat-form button").textContent = "Send ↑";
    document.querySelectorAll("[data-command]").forEach(button => button.disabled = false);
  }
}
document.querySelectorAll("[data-command]").forEach(button => button.onclick = () => sendMessage(button.dataset.command));
$("#chat-form").onsubmit = event => { event.preventDefault(); sendMessage($("#chat-input").value.trim()); };
function showAuth() {
  $("#auth").hidden = false;
  $("#dashboard").hidden = true;
  $("#primary-navigation").hidden = true;
  $("#sidebar-account").hidden = true;
}
async function setAuthMode(createAccount) {
  registering = createAccount;
  $("#auth-title").textContent = registering ? "Let’s get you started" : "Welcome back";
  $("#auth-form").hidden = !registering && !passwordMode;
  $("#passkey-login").hidden = registering || passwordMode;
  $("#password-field").hidden = !passwordMode;
  $("#auth-form [name=password]").disabled = !passwordMode;
  $("#auth-form [name=password]").required = passwordMode;
  $("#auth-form button[type=submit]").textContent = passwordMode ? "Continue" : "Create my passkey";
  $("#password-toggle").textContent = passwordMode ? "Use a passkey instead" : "Use a password instead";
  $("#recovery-form").hidden = true;
  $("#auth-toggle").textContent = registering ? "Already have an account? Sign in" : "Create an account";
  $("#invite-field").hidden = !registering || !authConfig?.inviteRequired;
  const invite = $("[name=inviteCode]");
  invite.disabled = !registering || !authConfig?.inviteRequired;
  invite.required = !invite.disabled;
  $("[name=password]").autocomplete = registering ? "new-password" : "current-password";
  $("#turnstile-slot").hidden = !registering;
  try { if (registering) await prepareWidget(); } catch (error) { showMessage(error.message); }
}
$("#auth-toggle").onclick = () => { passwordMode = false; setAuthMode(!registering); };
$("#password-toggle").onclick = () => { passwordMode = !passwordMode; setAuthMode(registering); };
function showRecovery(code) { $("#recovery-value").textContent = code; $("#recovery-dialog").showModal(); }
$("#recovery-saved").onclick = () => { $("#recovery-dialog").close(); $("#recovery-value").textContent = ""; };
$("#recovery-dialog").addEventListener("close", () => { $("#recovery-value").textContent = ""; });
async function passkeyFlow(kind, data = {}) {
  if (!browserSupportsWebAuthn()) throw new Error("This browser does not support passkeys. Try a current browser or use your existing password/recovery code.");
  const { options } = await api(`/auth/passkeys/${kind}/options`, { method: "POST", body: JSON.stringify(data) });
  let credential;
  try { credential = kind === "login" ? await startAuthentication({optionsJSON: options}) : await startRegistration({optionsJSON: options}); }
  catch { throw new Error("Passkey setup or sign-in was canceled or unavailable. You can try again or choose another sign-in method."); }
  return api(`/auth/passkeys/${kind}/verify`, {method: "POST", body: JSON.stringify({credential, name: data.name})});
}
$("#passkey-login").onclick = async () => {
  const button = $("#passkey-login"); button.disabled = true;
  try { const result = await passkeyFlow("login"); await loadDashboard(result.user); }
  catch (error) { showMessage(error.message); } finally { button.disabled = false; }
};
$("#recover-toggle").onclick = () => { $("#recovery-form").hidden = !$("#recovery-form").hidden; };
$("#recovery-form").onsubmit = async event => {
  event.preventDefault(); const form = event.currentTarget; const button = form.querySelector("button"); button.disabled = true;
  try { const result = await api("/auth/recover", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) }); form.reset(); await loadDashboard(result.user); showRecovery(result.recoveryCode); }
  catch (error) { showMessage(error.message); } finally { button.disabled = false; }
};
async function loadPasskeys() {
  const { passkeys } = await api("/passkeys");
  const list = $("#passkey-list"); list.replaceChildren();
  if (!passkeys.length) list.append(text("p", "No passkeys yet. Add one below."));
  for (const key of passkeys) {
    const row = text("div", "", "project"); row.append(text("strong", key.name), text("small", `Added ${new Date(key.created_at).toLocaleDateString()}`));
    const remove = text("button", "Remove"); remove.onclick = async () => {
      if (!confirm(`Remove “${key.name}”? This signs out all your sessions.`)) return;
      remove.disabled = true;
      try { await api("/auth/passkeys/remove", {method:"POST",body:JSON.stringify({id:key.id})}); location.reload(); }
      catch (error) { showMessage(error.message); remove.disabled = false; }
    }; row.append(remove); list.append(row);
  }
}
let pendingPhoto;
let photoUploading=false;
async function refreshPhotos() {
  const project=$("#files-project").value, list=$("#files-list"); list.replaceChildren();
  if(!project) { $("#files-status").textContent="Create a project in chat before uploading photos."; return; }
  const data=await api(`/projects/${project}/files`);
  for(const file of data.files) {
    const row=text('article','', 'photo-row');row.append(text('p',`${file.name} · ${file.width} × ${file.height} · ${Math.ceil(file.size/1024)} KiB${file.status==='pending'?' · Upload awaiting confirmation':''}`));
    if(file.saved_versions)row.append(text('p',`Kept for ${file.saved_versions} saved website version${file.saved_versions===1?'':'s'}.`));
    else {const remove=text('button','Review deletion');remove.type='button';remove.onclick=()=>{$('#files-dialog').close();sendMessage(`/delete-photo ${file.id}`);};row.append(remove);}
    if(file.status==='ready'){const img=document.createElement('img');img.src=`/api/files/${file.id}`;img.alt=file.name;img.loading='lazy';row.append(img);const link=text('a','Open private photo');link.href=img.src;link.target='_blank';link.rel='noopener noreferrer';row.append(link);const use=text('button','Use in website');use.type='button';use.onclick=()=>{$('#files-dialog').close();sendMessage(`/photo ${file.id}`);};row.append(use);}
    list.append(row);
  }
  if(!data.files.length)list.append(text('p','No photos uploaded to this project yet.'));
}
async function openFiles() {
  try {
    const {projects}=await api('/projects'), select=$("#files-project"), previous=select.value;select.replaceChildren();
    for(const project of projects){const option=document.createElement('option');option.value=project.id;option.textContent=project.name;select.append(option);}
    if(projects.some(p=>p.id===previous))select.value=previous;
    $("#photo-upload").disabled=photoUploading||!projects.length;$("#files-status").textContent='';await refreshPhotos();$("#files-dialog").showModal();
  }catch(error){showMessage(error.message);}
}
$("#files-close").onclick=()=>$("#files-dialog").close();
$("#files-project").onchange=async()=>{pendingPhoto=undefined;try{await refreshPhotos();}catch(error){$("#files-status").textContent=error.message;}};
$("#photo-input").onchange=()=>{pendingPhoto=undefined;$("#photo-name").value=($("#photo-input").files[0]?.name??'').replace(/\.[^.]+$/,'').slice(0,100);};
$("#photo-name").oninput=()=>{pendingPhoto=undefined;};
async function preparePhoto(file){
 if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw new Error('Choose a JPEG, PNG or WebP photo up to 10 MiB.');
 const bitmap=await createImageBitmap(file);
 try {
  const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)), canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const context=canvas.getContext('2d');if(!context)throw new Error('Your browser could not prepare this photo');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
  let blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.85));
  if(blob?.size>1048576)blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.65));
  if(!blob||blob.size>1048576)throw new Error('This photo is too detailed for the test upload limit. Choose a smaller image.');return blob;
 }finally{bitmap.close();}
}
$("#photo-form").onsubmit=async event=>{
 event.preventDefault();if(photoUploading)return;photoUploading=true;const button=$("#photo-upload");button.disabled=true;$("#files-project").disabled=true;$("#photo-input").disabled=true;$("#photo-name").disabled=true;
 try {
  $("#files-status").textContent='Preparing and uploading your private photo…';
  if(!pendingPhoto)pendingPhoto={id:crypto.randomUUID(),project:$("#files-project").value,name:$("#photo-name").value.trim(),blob:await preparePhoto($("#photo-input").files[0])};
  const response=await fetch(`/api/projects/${pendingPhoto.project}/files/${pendingPhoto.id}`,{method:'PUT',credentials:'same-origin',headers:{'content-type':'image/jpeg','x-photo-name':encodeURIComponent(pendingPhoto.name)},body:pendingPhoto.blob});const data=await response.json();if(!response.ok)throw new Error(data.error||'Photo upload could not be confirmed');
  pendingPhoto=undefined;$("#photo-form").reset();await refreshPhotos();$("#files-status").textContent='Photo saved privately. It has not been published or sent to the AI.';
 }catch(error){$("#files-status").textContent=error.message;}
 finally{photoUploading=false;button.disabled=false;$("#files-project").disabled=false;$("#photo-input").disabled=false;$("#photo-name").disabled=false;}
};
function renderBilling(data) {
  $("#billing-summary").textContent = `${data.plan.name} · ${data.period}: ${data.quota.available} of ${data.quota.allowance} monthly units available, ${data.quota.spent} used, ${data.quota.reserved} held. ${data.credits.available} credits available; ${data.credits.reserved} held. Monthly units reset on the first day (UTC). Credits carry over.`;
  $("#overage-enabled").checked = data.credits.overageEnabled;
  $("#checkout-controls").hidden = !data.checkoutEnabled;
  $("#checkout-status").textContent = data.checkoutEnabled ? "Credits appear only after Stripe confirms the test payment. Returning from checkout alone does not add credits." : "Test checkout is not connected yet.";
  if (data.creditPack) $("#checkout-start").textContent = `Test purchase: ${data.creditPack.credits} credits · $${(data.creditPack.cents / 100).toFixed(2)}`;
  const history = $("#billing-history"); history.replaceChildren();
  for (const entry of data.ledger.slice(0, 10)) history.append(text("p", `${entry.event.replaceAll("_", " ")} · ${entry.quota_delta > 0 ? "+" : ""}${entry.quota_delta} monthly units · ${entry.credits_delta > 0 ? "+" : ""}${entry.credits_delta} credits`, "ledger-entry"));
}
async function openBilling(){ try { renderBilling(await api("/billing")); $("#billing-dialog").showModal(); } catch(error) { showMessage(error.message); } }
let checkoutRequestId;
$("#checkout-start").onclick = async () => {
  const button = $("#checkout-start"); button.disabled = true;
  checkoutRequestId ||= crypto.randomUUID();
  try {
    const result = await api("/billing/checkout", {method:"POST",body:JSON.stringify({id:checkoutRequestId,product:"credits-100"})});
    if (result.fulfilled) { checkoutRequestId = undefined; renderBilling(await api("/billing")); return; }
    const destination = new URL(result.url);
    if (destination.protocol !== "https:" || destination.hostname !== "checkout.stripe.com") throw new Error("Unexpected checkout destination");
    location.assign(destination.href);
  } catch(error) { $("#checkout-status").textContent = error.message; if (error.status === 409) checkoutRequestId = undefined; }
  finally { button.disabled = false; }
};
$("#billing-refresh").onclick = async () => { try { renderBilling(await api("/billing")); } catch(error) { $("#checkout-status").textContent = error.message; } };
$("#billing-close").onclick = () => $("#billing-dialog").close();
$("#overage-enabled").onchange = async event => {
  const toggle = event.currentTarget; toggle.disabled = true;
  try { renderBilling(await api("/billing/preferences", {method:"POST",body:JSON.stringify({overageEnabled:toggle.checked})})); showMessage("Credit preference saved"); }
  catch(error) { toggle.checked = !toggle.checked; showMessage(error.message); }
  finally { toggle.disabled = false; }
};
async function openSecurity() { try { await loadPasskeys(); $("#security-dialog").showModal(); } catch (error) { showMessage(error.message); } }

$("#security-close").onclick = () => $("#security-dialog").close();
$("#passkey-add").onclick = async () => {
  const button = $("#passkey-add"); button.disabled = true;
  try { await passkeyFlow("add", { name: $("#passkey-name").value }); await loadPasskeys(); showMessage("Passkey added"); }
  catch (error) { showMessage(error.message); } finally { button.disabled = false; }
};
$("#recovery-create").onclick = async () => {
  if (!confirm("Replace your recovery code? The old code will stop working.")) return;
  const button = $("#recovery-create"); button.disabled = true;
  try { const result = await api("/auth/recovery-code", {method:"POST"}); showRecovery(result.recoveryCode); }
  catch (error) { showMessage(error.message); } finally { button.disabled = false; }
};
$("#auth-form").onsubmit = async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const button = event.currentTarget.querySelector("button[type=submit]");
  if (registering && authConfig?.turnstileSiteKey) {
    const response = widgetId !== undefined ? window.turnstile.getResponse(widgetId) : "";
    if (!response) return showMessage("Please complete the verification first.");
    data.turnstileToken = response;
  }
  button.disabled = true;
  try {
    const result = registering && !passwordMode ? await passkeyFlow("signup", data) : await api(registering ? "/auth/register" : "/auth/login", { method: "POST", body: JSON.stringify(data) });
    await loadDashboard(result.user);
    if (result.recoveryCode) showRecovery(result.recoveryCode);
  } catch (error) { showMessage(error.message); if (widgetId !== undefined) window.turnstile.reset(widgetId); }
  finally { button.disabled = false; }
};
async function start() {
  const callbackParams=new URLSearchParams(location.search);
  try {
    authConfig = await api("/config");
    const { user } = await api("/me");
    await loadDashboard(user);
    if(['github','cloudflare'].includes(callbackParams.get('connection'))){const failed=callbackParams.has('connection_error');history.replaceState(null,'',location.pathname);await openConnections();if(failed)$('#connections-status').textContent='Provider authorization was cancelled, expired or could not be completed. Refresh the connection status before starting again.';}
  } catch (error) {
    showAuth();
    if (authConfig) await setAuthMode(new URLSearchParams(location.search).get("signup") === "1");
    if (error.status !== 401) showMessage(error.message);
  }
}
start();

let dnsZonePage=1;
async function loadDNSZones(){const data=await api('/connections/cloudflare/zones?page='+dnsZonePage);for(const zone of data.zones){if(zone.status!=='active')continue;const option=text('option',zone.name);option.value=zone.id;$('#dns-zone').append(option);}$('#dns-zone-more').hidden=!data.hasMore||dnsZonePage>=100;}
$('#dns-zone-more').onclick=async()=>{const button=$('#dns-zone-more');button.disabled=true;dnsZonePage++;try{await loadDNSZones();}catch(error){dnsZonePage--;$('#domains-status').textContent=error.message;}finally{button.disabled=false;}};
async function openDomains() {
 try {
  const [{projects},{domains},hosting,dns,connections]=await Promise.all([api('/projects'),api('/domains'),api('/domain-hosting'),api('/cloudflare/dns'),api('/connections')]);
  const previousZone=$('#dns-zone').value;$('#dns-zone').replaceChildren();dnsZonePage=1;$('#dns-zone-more').hidden=true;$('#dns-zone-controls').hidden=!connections.cloudflare.connected;
  if(connections.cloudflare.connected){try{await loadDNSZones();if(Array.from($('#dns-zone').options).some(o=>o.value===previousZone))$('#dns-zone').value=previousZone;}catch(error){showMessage(error.message);}}
  const select=$('#domain-project');select.replaceChildren();
  for(const project of projects){const option=document.createElement('option');option.value=project.id;option.textContent=project.name;select.append(option);}
  $('#domain-add').disabled=!projects.length;$('#domains-status').textContent=projects.length?'':'Create a project in chat first.';
  const list=$('#domains-list');list.replaceChildren();
  for(const domain of domains){
   const row=text('article','', 'panel');row.append(text('h3',domain.hostname),text('p',domain.status.replaceAll('_',' ')+' · '+(hosting.connections.some(c=>c.claimId===domain.id&&c.connected)?'Connected':'Not connected')));
   row.append(text('p','TXT record name: '+domain.record.name),text('p','TXT record value: '+domain.record.value),text('p','Proof expires: '+domain.expiresAt));
   const check=text('button',domain.status==='expired'?'Renew ownership proof':'Check DNS proof');check.type='button';check.onclick=()=>{$('#domains-dialog').close();sendMessage(domain.status==='expired'?`/domain ${domain.hostname} ${domain.projectId}`:`/verify-domain ${domain.id}`);};row.append(check);
   const dnsReview=text('button','Review TXT in Cloudflare'),reviewId=crypto.randomUUID();dnsReview.disabled=!connections.cloudflare.connected||domain.status==='expired';dnsReview.onclick=async()=>{const zoneId=$('#dns-zone').value;if(!zoneId){$('#domains-status').textContent='Choose an authorized Cloudflare zone first.';return;}dnsReview.disabled=true;try{await api('/cloudflare/dns/review',{method:'POST',body:JSON.stringify({id:reviewId,claimId:domain.id,zoneId})});await openDomains();}catch(error){$('#domains-status').textContent=error.message;}finally{dnsReview.disabled=false;}};row.append(dnsReview);
   const connect=text('button','Review hosting connection');connect.disabled=!hosting.enabled||domain.status==='expired';connect.onclick=async()=>{connect.disabled=true;try{await api('/domain-hosting/review',{method:'POST',body:JSON.stringify({id:crypto.randomUUID(),claimId:domain.id})});await openDomains();}catch(error){$('#domains-status').textContent=error.message;}finally{connect.disabled=!hosting.enabled;}};row.append(connect);list.append(row);
  }
  for(const action of dns.actions){const row=text('article','', 'panel');row.append(text('h3','Cloudflare '+(action.record.type==='CNAME'?'website routing':'TXT proof')+' · '+action.state),text('p','Zone: '+action.zoneName),text('p','Name: '+action.record.name),text('p','Value: '+action.record.value),text('p',action.detail));if(action.state==='review'){row.append(text('p',action.record.type==='CNAME'?'This adds a DNS-only CNAME with automatic TTL unless it already exists. Conflicting records are never replaced. Website traffic, including traffic previously using wildcard DNS, can move to TownHello. Check hosting status afterward to verify DNS and TLS.':'This adds the exact TXT proof with automatic TTL, unless it already exists. It does not replace your existing website records or connect hosting.'),text('p','Review expires: '+action.expiresAt));}if(['review','sending','uncertain'].includes(action.state)){const button=text('button',action.state==='review'?(action.record.type==='CNAME'?'Confirm website routing':'Confirm TXT proof'):'Check result without resending');button.onclick=async()=>{button.disabled=true;try{await api('/cloudflare/dns/'+action.id+'/confirm',{method:'POST',body:'{}'});await openDomains();}catch(error){$('#domains-status').textContent=error.message;}finally{button.disabled=false;}};row.append(button);}list.append(row);}
  if(!domains.length)list.append(text('p','No domains added yet.'));
  if(!hosting.enabled)list.append(text('p','Domain hosting is awaiting platform configuration. Ownership proofs remain available.'));
  for(const connection of hosting.connections){
   const row=text('article','', 'panel');row.append(text('h3',connection.hostname+' · Hosting'),text('p',connection.connected?'Connected':connection.state.replaceAll('_',' ')),text('p','Project: '+connection.projectId),text('p','Connection: '+connection.id),text('p','Certificate: '+(connection.certificateStatus||'Not requested')),text('p',connection.detail));
   const action=(label,operation)=>{const button=text('button',label);button.onclick=async()=>{button.disabled=true;try{await api('/domain-hosting/'+connection.id+'/'+operation,{method:'POST',body:'{}'});await openDomains();}catch(error){$('#domains-status').textContent=error.message;}finally{button.disabled=false;}};row.append(button);};
   if(connection.state==='review'){row.append(text('p','Confirming requests a hostname and TLS certificate. Once checks pass, this hostname serves the project’s current published version. Future publish/restore changes also appear here.'),text('p','Review expires: '+connection.expiresAt));action('Confirm hosting connection','confirm');}
   if(['active','provisioning','needs_check'].includes(connection.state)){row.append(text('p','At your DNS provider, point '+connection.hostname+' directly to '+connection.target+' using a DNS-only CNAME. Keep the TXT ownership proof current. Existing website traffic will move to TownHello; only do this when ready.'));action('Check hosting status','refresh');
    const routing=text('button','Review CNAME in Cloudflare'),routingId=crypto.randomUUID();routing.disabled=!connections.cloudflare.connected||!hosting.enabled;routing.onclick=async()=>{const zoneId=$('#dns-zone').value;if(!zoneId){$('#domains-status').textContent='Choose an authorized Cloudflare zone first.';return;}routing.disabled=true;try{await api('/cloudflare/dns/routing-review',{method:'POST',body:JSON.stringify({id:routingId,connectionId:connection.id,zoneId})});await openDomains();}catch(error){$('#domains-status').textContent=error.message;}finally{routing.disabled=false;}};row.append(routing);}
   if(connection.state==='disconnecting')action('Retry provider cleanup','disconnect');
   else if(!['disconnected','expired'].includes(connection.state))action(connection.state==='review'?'Cancel review':'Disconnect hosting','disconnect');
   list.append(row);
  }
  $('#domains-dialog').showModal();
 }catch(error){showMessage(error.message);}
}
$('#domains-close').onclick=()=>$('#domains-dialog').close();
$('#domain-form').onsubmit=event=>{event.preventDefault();const name=$('#domain-hostname').value.trim(), project=$('#domain-project').value;if(!project)return;$('#domains-dialog').close();sendMessage(`/domain ${name} ${project}`);};

let cloudflarePage=1;
async function loadCloudflareZones(){const data=await api('/connections/cloudflare/zones?page='+cloudflarePage);const list=$('#cloudflare-zones');for(const zone of data.zones)list.append(text('p',`${zone.name} · ${zone.status==='active'?'Active zone':'Zone not active'}`));if(!data.zones.length&&cloudflarePage===1)list.append(text('p','No authorized zones found.'));$('#cloudflare-more').hidden=!data.hasMore||cloudflarePage>=100;}
async function openConnections(){
 try{
  const {github,cloudflare}=await api('/connections');
  $('#cloudflare-status').textContent=!cloudflare.enabled?'Cloudflare connection is awaiting platform configuration.':cloudflare.connected?`Authorized until ${cloudflare.expiresAt}.`:'Not connected. Sign in recently before connecting.';
  if(cloudflare.revocationPending)$('#cloudflare-status').textContent+=' Local access is disabled; provider revocation is pending. You can also revoke this application in Cloudflare settings.';
  $('#cloudflare-connect').disabled=!cloudflare.enabled||cloudflare.connected||cloudflare.revocationPending;$('#cloudflare-disconnect').hidden=!cloudflare.connected&&!cloudflare.revocationPending;
  $('#cloudflare-zones').replaceChildren();$('#cloudflare-more').hidden=true;cloudflarePage=1;
  $('#github-status').textContent=!github.enabled?'GitHub connection is awaiting platform configuration.':github.connected?`Authorized as ${github.login} until ${github.expiresAt}.`:'Not connected. Sign in recently before connecting.';
  if(github.revocationPending)$('#github-status').textContent+=' Local access is disabled for disconnected tokens; provider revocation is pending. You can also revoke access in GitHub settings.';
  $('#github-connect').disabled=!github.enabled;$('#github-connect').textContent=github.connected?'Reconnect GitHub':'Connect GitHub';$('#github-disconnect').hidden=!github.connected&&!github.revocationPending;
  const install=$('#github-install');install.hidden=!github.connected;install.removeAttribute('href');if(github.connected&&github.installURL){const url=new URL(github.installURL);if(url.origin==='https://github.com'&&url.pathname.startsWith('/apps/'))install.href=url.href;}
  $('#github-backup-controls').hidden=!github.backupEnabled;
  const list=$('#github-installations');list.replaceChildren();$('#connections-status').textContent='';$('#connections-dialog').showModal();
  if(cloudflare.connected){try{await loadCloudflareZones();}catch(error){$('#cloudflare-zones').append(text('p',error.message));}}
  await renderBackups();
  if(github.connected){const data=await api('/connections/github/installations');await setupBackups(data.installations);for(const item of data.installations)list.append(text('p',`Installed for ${item.account} · ${item.repositorySelection==='selected'?'Selected repositories':'All repositories'}`));if(!data.installations.length)list.append(text('p','No active installation found. Use Choose repositories on GitHub, then refresh.'));if(data.truncated)list.append(text('p','Only the first 100 installations were checked.'));}
 }catch(error){$('#connections-status').textContent=error.message;if(!$('#connections-dialog').open)showMessage(error.message);}
}
$('#connections-refresh').onclick=openConnections;$('#connections-close').onclick=()=>$('#connections-dialog').close();
$('#github-connect').onclick=async()=>{const button=$('#github-connect');button.disabled=true;try{const result=await api('/connections/github/start',{method:'POST',body:'{}'}),url=new URL(result.url);if(url.origin!=='https://github.com'||url.pathname!=='/login/oauth/authorize')throw new Error('Unexpected authorization destination');location.assign(url.href);}catch(error){$('#connections-status').textContent=error.message;button.disabled=false;}};
$('#github-disconnect').onclick=async()=>{const button=$('#github-disconnect');button.disabled=true;try{await api('/connections/github/disconnect',{method:'POST',body:'{}'});await openConnections();}catch(error){$('#connections-status').textContent=error.message;}finally{button.disabled=false;}};

let backupRepositories=[],backupPage=1,backupReviewRequest=null;
function options(select,items,label,value){select.replaceChildren();for(const item of items){const option=text('option',label(item));option.value=value(item);select.append(option);}}
async function setupBackups(installations){
 options($('#backup-installation'),installations,i=>i.account,i=>i.id);
 const {projects}=await api('/projects');options($('#backup-project'),projects,p=>p.name,p=>p.id);
 await loadBackupVersions();await loadBackupRepositories();
}
async function loadBackupVersions(){
 const project=$('#backup-project').value;
 const {versions}=project?await api('/projects/'+project+'/versions'):{versions:[]};
 options($('#backup-version'),versions,v=>`${v.created_at} · ${v.component_id} · ${v.id}`,v=>v.id);backupReviewRequest=null;updateBackupButton();
}
function updateBackupButton(){$('#backup-review').disabled=!$('#backup-version').value||!$('#backup-repo').value;}
async function loadBackupRepositories(more=false){
 if(!more){backupRepositories=[];backupPage=1;}else backupPage++;
 const installation=$('#backup-installation').value;
 const result=installation?await api(`/connections/github/repositories?installation=${installation}&page=${backupPage}`):{repositories:[],hasMore:false};
 backupRepositories.push(...result.repositories);options($('#backup-repo'),backupRepositories,r=>`${r.owner}/${r.name} · ${r.private?'Private':'PUBLIC'}`,r=>r.id);
 $('#backup-more').hidden=!result.hasMore;backupReviewRequest=null;updateBackupButton();
}
async function renderBackups(){
 const {backups}=await api('/github/backups'),list=$('#github-backups');list.replaceChildren();if(backups.length)list.append(text('h3','Backup reviews and receipts'));
 for(const backup of backups){
  const row=text('article','', 'panel');row.append(text('h4',backup.repository+' · '+(backup.private?'Private repository':'PUBLIC repository')),text('p',`State: ${backup.state}. Branch: ${backup.branch}`),text('p','Version: '+backup.versionId),text('p','Folder: '+backup.path),text('p','Files: '+backup.files.join(', ')),text('p','Source bundle SHA-256: '+backup.sha256),text('p','Review expires: '+backup.expiresAt));
  if(backup.state==='pending')row.append(text('p',backup.private?'The selected repository’s collaborators can read the site text, photos and configuration.':'Anyone can read the site text, photos and configuration in this public repository.'));
  if(backup.detail)row.append(text('p',backup.detail));
  if(['pending','dispatching','uncertain'].includes(backup.state)){
   const confirm=text('button',backup.state==='pending'?'Confirm GitHub backup':'Check outcome');confirm.onclick=async()=>{confirm.disabled=true;try{const result=await api('/github/backups/'+backup.id+'/confirm',{method:'POST',body:'{}'});await renderBackups();$('#connections-status').textContent=result.state==='complete'?'Backup verified.':result.detail||('Backup state: '+result.state);}catch(error){$('#connections-status').textContent=error.message;}finally{confirm.disabled=false;}};row.append(confirm);
  }
  if(backup.url){const link=text('a','View verified source on GitHub'),url=new URL(backup.url);if(url.origin==='https://github.com'){link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';row.append(link);}}
  list.append(row);
 }
}
const backupError=error=>{$('#connections-status').textContent=error.message;};
$('#backup-installation').onchange=()=>loadBackupRepositories().catch(backupError);
$('#backup-project').onchange=()=>loadBackupVersions().catch(backupError);
$('#backup-version').onchange=$('#backup-repo').onchange=()=>{backupReviewRequest=null;updateBackupButton();};
$('#backup-more').onclick=()=>loadBackupRepositories(true).catch(backupError);
$('#backup-review').onclick=async()=>{
 const button=$('#backup-review');button.disabled=true;
 try{const repo=backupRepositories.find(r=>String(r.id)===$('#backup-repo').value);if(!repo)throw Error('Select a repository first.');backupReviewRequest??={id:crypto.randomUUID(),versionId:$('#backup-version').value,owner:repo.owner,repo:repo.name,repoId:repo.id};await api('/github/backups/review',{method:'POST',body:JSON.stringify(backupReviewRequest)});backupReviewRequest=null;await renderBackups();$('#connections-status').textContent='Review the destination and files, then confirm when ready.';}catch(error){backupError(error);}finally{updateBackupButton();}
};

$('#cloudflare-connect').onclick=async()=>{const button=$('#cloudflare-connect');button.disabled=true;try{const result=await api('/connections/cloudflare/start',{method:'POST',body:'{}'}),url=new URL(result.url);if(url.origin!=='https://dash.cloudflare.com'||url.pathname!=='/oauth2/auth')throw Error('Unexpected authorization destination');location.assign(url.href);}catch(error){$('#connections-status').textContent=error.message;button.disabled=false;}};
$('#cloudflare-disconnect').onclick=async()=>{const button=$('#cloudflare-disconnect');button.disabled=true;try{await api('/connections/cloudflare/disconnect',{method:'POST',body:'{}'});await openConnections();}catch(error){$('#connections-status').textContent=error.message;}finally{button.disabled=false;}};
$('#cloudflare-more').onclick=async()=>{const button=$('#cloudflare-more');button.disabled=true;cloudflarePage++;try{await loadCloudflareZones();}catch(error){cloudflarePage--;$('#connections-status').textContent=error.message;}finally{button.disabled=false;}};

// Visitor content is rendered with textContent and never persisted in the agent transcript.
let inboxEnabled=false;
let inboxRead=0;
async function refreshInbox(){
 const read=++inboxRead,id=$('#inbox-project').value,list=$('#inbox-list');list.replaceChildren();
 $('#contact-review').disabled=!id;if(!id){$('#inbox-status').textContent='Create a project first.';return;}
 const result=await api(`/projects/${id}/inbox`);
 if($('#inbox-project').value!==id||read!==inboxRead)return;
 inboxEnabled=result.enabled;
 $('#inbox-status').textContent=(result.enabled?'Contact form is enabled for the current live version.':'Contact form is disabled. Publish a version, then review enabling it.')+` ${result.messages.length} message(s).`;
 $('#contact-review').textContent=result.enabled?'Review disabling form':'Review enabling form';
 for(const m of result.messages){
  const card=text('article','');card.className='chat-bubble assistant';
  card.append(text('h3',m.name),text('p',m.email),text('small',new Date(m.created_at).toLocaleString()),text('p',m.message));
  const remove=text('button','Delete message');remove.type='button';remove.onclick=async()=>{if(!window.confirm('Permanently delete this message from your inbox?'))return;remove.disabled=true;try{await api(`/contact-messages/${m.id}`,{method:'DELETE'});await refreshInbox();}catch(error){showMessage(error.message);remove.disabled=false;}};card.append(remove);list.append(card);
 }
 if(!result.messages.length)list.append(text('p','No messages yet.'));
}
async function openInbox(){try{const {projects}=await api('/projects'),select=$('#inbox-project'),previous=select.value;select.replaceChildren();for(const p of projects){const option=text('option',p.name);option.value=p.id;select.append(option);}if(projects.some(p=>p.id===previous))select.value=previous;await refreshInbox();$('#inbox-dialog').showModal();}catch(error){showMessage(error.message);}}
$('#inbox-close').onclick=()=>{$('#inbox-list').replaceChildren();$('#inbox-dialog').close();};
$('#inbox-project').onchange=()=>refreshInbox().catch(error=>showMessage(error.message));
$('#inbox-refresh').onclick=()=>refreshInbox().catch(error=>showMessage(error.message));
$('#contact-review').onclick=()=>{const id=$('#inbox-project').value;if(!id)return;$('#inbox-dialog').close();sendMessage(`${inboxEnabled?'/contact-off':'/contact-on'} ${id}`);};

$('#inbox-dialog').addEventListener('close',()=>{inboxRead++;$('#inbox-list').replaceChildren();});
