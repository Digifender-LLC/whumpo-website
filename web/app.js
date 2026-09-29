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
    window.whumpoTurnstileReady = resolve;
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=whumpoTurnstileReady";
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
    item.append(text("small", role === "user" ? "You" : mode === "ai" ? "Whumpo · AI" : "Whumpo · Guide"), text("p", content));
    container.append(item);
    return item;
  }
  bubble("assistant", data.greeting);
  for (const turn of data.turns) { bubble("user", turn.user_text); const answer = bubble("assistant", turn.assistant_text, turn.mode);
    if (typeof turn.version_id === 'string' && /^[0-9a-f-]{36}$/.test(turn.version_id)) {
      const link = text('a', 'Open private preview ↗'); link.href = `/api/site-versions/${turn.version_id}/preview`; link.target = '_blank'; link.rel = 'noopener noreferrer'; answer.append(link);
    }
    const exportVersion = turn.export_version_id || turn.version_id;
    if (typeof exportVersion === 'string' && /^[0-9a-f-]{36}$/.test(exportVersion)) {
      const download=text('a','Download website source');download.href=`/api/site-versions/${exportVersion}/export`;download.download=`whumpo-site-${exportVersion}.zip`;answer.append(download);
    }
    if (typeof turn.confirmation_id === 'string' && /^[0-9a-f-]{36}$/.test(turn.confirmation_id)) {
      const confirm = text('button', 'Confirm reviewed change'); confirm.onclick = () => sendMessage(`/confirm ${turn.confirmation_id}`); answer.append(confirm);
    }
    if (turn.publication_kind !== 'unpublish' && typeof turn.published_project_id === 'string' && /^[0-9a-f-]{36}$/.test(turn.published_project_id)) {
      const link = text('a','Open published site ↗'); link.href = `https://sites.digifender.com/s/${turn.published_project_id}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; answer.append(link);
    } }
  $("#service-stats").textContent = `${data.stats.projects} project${data.stats.projects === 1 ? "" : "s"} · ${data.stats.live || 0} live`;
  $("#chat-input").placeholder = data.state.brief_stage === "audience" ? "Who is it for, and what should visitors do?" : data.state.brief_stage === "style" ? "Ocean, clay, forest, or describe your style…" : "Tell me what you’d like to build or change…";
  $("#agent-mode").textContent = data.mode === "ai" ? "Muse Spark 1.3 · AI connected" : "Guided mode · No AI charges";
  $("#usage-stats").textContent = data.usage ? `${data.usage.available} units available · ${data.usage.reserved} held` : "";
  $("#ai-note").textContent = data.mode === "ai" ? "Setup and commands are free. AI replies use build units. This Contributor model may use messages for training; avoid confidential information." : "Guided mode uses no AI units. You can create, preview, and publish a simple site. Please keep passwords and API keys out of chat.";
  clearTimeout(chatPoll);
  if (data.turns.some(turn => turn.status === "pending")) chatPoll = setTimeout(async () => {
    try { renderChat(await api("/chat")); } catch (error) { showMessage(error.message); }
  }, 2000);
  container.scrollTop = container.scrollHeight;
}
async function loadDashboard(user) {
  history.replaceState(null, "", "/workspace/");
  $("#auth").hidden = true;
  $("#dashboard").hidden = false;
  const account = $("#account");
  account.replaceChildren(text("span", user.email));
  const logout = text("button", "Sign out");
  logout.onclick = async () => { try { await api("/auth/logout", { method: "POST" }); location.reload(); } catch (error) { showMessage(error.message); } };
  account.append(logout);
  renderChat(await api("/chat"));
}
async function sendMessage(content) {
  if (sending || !content.trim()) return;
  if (["/connections", "show connections", "connect github", "disconnect github", "/backup", "backup my website", "back up my website"].includes(content.trim().toLowerCase())) { await openConnections(); return; }
  if (["/domains", "show domains", "connect my domain", "disconnect my domain", "check domain hosting"].includes(content.trim().toLowerCase())) { await openDomains(); return; }
  if (["/files", "show files", "show photos", "upload a photo"].includes(content.trim().toLowerCase())) { await openFiles(); return; }
  if (["/security", "/passkeys"].includes(content.trim().toLowerCase())) { await openSecurity(); return; }
  sending = true;
  $("#chat-form button").disabled = true;
  $("#chat-form button").textContent = "Sending…";
  document.querySelectorAll("[data-command]").forEach(button => button.disabled = true);
  // Keep the request ID after a network failure so retrying cannot create a second project.
  if (!pendingMessage || pendingMessage.content !== content) pendingMessage = { content, revision: chatRevision, id: crypto.randomUUID() };
  try {
    renderChat(await api("/chat", { method: "POST", body: JSON.stringify(pendingMessage) }));
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
$("#menu-toggle").onclick = () => {
  $("#workspace-menu").hidden = !$("#workspace-menu").hidden;
  $("#menu-toggle").setAttribute("aria-expanded", String(!$("#workspace-menu").hidden));
};
document.querySelectorAll("[data-command]").forEach(button => button.onclick = () => {
  $("#workspace-menu").hidden = true;
  $("#menu-toggle").setAttribute("aria-expanded", "false");
  sendMessage(button.dataset.command);
});
$("#chat-form").onsubmit = event => { event.preventDefault(); sendMessage($("#chat-input").value.trim()); };
function showAuth() {
  $("#auth").hidden = false;
  $("#dashboard").hidden = true;
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
$("#files-open").onclick=openFiles;$("#files-close").onclick=()=>$("#files-dialog").close();
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
$("#billing-open").onclick = async () => { try { renderBilling(await api("/billing")); $("#billing-dialog").showModal(); } catch(error) { showMessage(error.message); } };
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
$("#security-open").onclick = openSecurity;
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
    if(callbackParams.get('connection')==='github'){const failed=callbackParams.has('connection_error');history.replaceState(null,'',location.pathname);await openConnections();if(failed)$('#connections-status').textContent='GitHub authorization was cancelled, expired or could not be completed. You can start again.';}
  } catch (error) {
    showAuth();
    if (authConfig) await setAuthMode(new URLSearchParams(location.search).get("signup") === "1");
    if (error.status !== 401) showMessage(error.message);
  }
}
start();

async function openDomains() {
 try {
  const [{projects},{domains},hosting]=await Promise.all([api('/projects'),api('/domains'),api('/domain-hosting')]);
  const select=$('#domain-project');select.replaceChildren();
  for(const project of projects){const option=document.createElement('option');option.value=project.id;option.textContent=project.name;select.append(option);}
  $('#domain-add').disabled=!projects.length;$('#domains-status').textContent=projects.length?'':'Create a project in chat first.';
  const list=$('#domains-list');list.replaceChildren();
  for(const domain of domains){
   const row=text('article','', 'panel');row.append(text('h3',domain.hostname),text('p',domain.status.replaceAll('_',' ')+' · '+(hosting.connections.some(c=>c.claimId===domain.id&&c.connected)?'Connected':'Not connected')));
   row.append(text('p','TXT record name: '+domain.record.name),text('p','TXT record value: '+domain.record.value),text('p','Proof expires: '+domain.expiresAt));
   const check=text('button',domain.status==='expired'?'Renew ownership proof':'Check DNS proof');check.type='button';check.onclick=()=>{$('#domains-dialog').close();sendMessage(domain.status==='expired'?`/domain ${domain.hostname} ${domain.projectId}`:`/verify-domain ${domain.id}`);};row.append(check);
   const connect=text('button','Review hosting connection');connect.disabled=!hosting.enabled||domain.status==='expired';connect.onclick=async()=>{connect.disabled=true;try{await api('/domain-hosting/review',{method:'POST',body:JSON.stringify({id:crypto.randomUUID(),claimId:domain.id})});await openDomains();}catch(error){$('#domains-status').textContent=error.message;}finally{connect.disabled=!hosting.enabled;}};row.append(connect);list.append(row);
  }
  if(!domains.length)list.append(text('p','No domains added yet.'));
  if(!hosting.enabled)list.append(text('p','Domain hosting is awaiting platform configuration. Ownership proofs remain available.'));
  for(const connection of hosting.connections){
   const row=text('article','', 'panel');row.append(text('h3',connection.hostname+' · Hosting'),text('p',connection.connected?'Connected':connection.state.replaceAll('_',' ')),text('p','Project: '+connection.projectId),text('p','Certificate: '+(connection.certificateStatus||'Not requested')),text('p',connection.detail));
   const action=(label,operation)=>{const button=text('button',label);button.onclick=async()=>{button.disabled=true;try{await api('/domain-hosting/'+connection.id+'/'+operation,{method:'POST',body:'{}'});await openDomains();}catch(error){$('#domains-status').textContent=error.message;}finally{button.disabled=false;}};row.append(button);};
   if(connection.state==='review'){row.append(text('p','Confirming requests a hostname and TLS certificate. Once checks pass, this hostname serves the project’s current published version. Future publish/restore changes also appear here.'),text('p','Review expires: '+connection.expiresAt));action('Confirm hosting connection','confirm');}
   if(['active','provisioning','needs_check'].includes(connection.state)){row.append(text('p','At your DNS provider, point '+connection.hostname+' directly to '+connection.target+' using a DNS-only CNAME. Keep the TXT ownership proof current. Existing website traffic will move to Whumpo; only do this when ready.'));action('Check hosting status','refresh');}
   if(connection.state==='disconnecting')action('Retry provider cleanup','disconnect');
   else if(!['disconnected','expired'].includes(connection.state))action(connection.state==='review'?'Cancel review':'Disconnect hosting','disconnect');
   list.append(row);
  }
  $('#domains-dialog').showModal();
 }catch(error){showMessage(error.message);}
}
$('#domains-open').onclick=openDomains;$('#domains-close').onclick=()=>$('#domains-dialog').close();
$('#domain-form').onsubmit=event=>{event.preventDefault();const name=$('#domain-hostname').value.trim(), project=$('#domain-project').value;if(!project)return;$('#domains-dialog').close();sendMessage(`/domain ${name} ${project}`);};

async function openConnections(){
 try{
  const {github}=await api('/connections');
  $('#github-status').textContent=!github.enabled?'GitHub connection is awaiting platform configuration.':github.connected?`Authorized as ${github.login} until ${github.expiresAt}.`:'Not connected. Sign in recently before connecting.';
  if(github.revocationPending)$('#github-status').textContent+=' Local access is disabled for disconnected tokens; provider revocation is pending. You can also revoke access in GitHub settings.';
  $('#github-connect').disabled=!github.enabled;$('#github-connect').textContent=github.connected?'Reconnect GitHub':'Connect GitHub';$('#github-disconnect').hidden=!github.connected&&!github.revocationPending;
  const install=$('#github-install');install.hidden=!github.connected;install.removeAttribute('href');if(github.connected&&github.installURL){const url=new URL(github.installURL);if(url.origin==='https://github.com'&&url.pathname.startsWith('/apps/'))install.href=url.href;}
  $('#github-backup-controls').hidden=!github.backupEnabled;
  const list=$('#github-installations');list.replaceChildren();$('#connections-status').textContent='';$('#connections-dialog').showModal();
  await renderBackups();
  if(github.connected){const data=await api('/connections/github/installations');await setupBackups(data.installations);for(const item of data.installations)list.append(text('p',`Installed for ${item.account} · ${item.repositorySelection==='selected'?'Selected repositories':'All repositories'}`));if(!data.installations.length)list.append(text('p','No active installation found. Use Choose repositories on GitHub, then refresh.'));if(data.truncated)list.append(text('p','Only the first 100 installations were checked.'));}
 }catch(error){$('#connections-status').textContent=error.message;if(!$('#connections-dialog').open)showMessage(error.message);}
}
$('#connections-open').onclick=openConnections;$('#connections-refresh').onclick=openConnections;$('#connections-close').onclick=()=>$('#connections-dialog').close();
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
