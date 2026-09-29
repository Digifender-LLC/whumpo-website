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
    } }
  $("#service-stats").textContent = `${data.stats.projects} project${data.stats.projects === 1 ? "" : "s"} · ${data.stats.live || 0} live`;
  $("#agent-mode").textContent = data.mode === "ai" ? "Muse Spark 1.3 · AI connected" : "Guided mode · No AI charges";
  $("#usage-stats").textContent = data.usage ? `${data.usage.available} units available · ${data.usage.reserved} held` : "";
  $("#ai-note").textContent = data.mode === "ai" ? "Setup and commands are free. AI replies use build units. This Contributor model may use messages for training; avoid confidential information." : "Guided onboarding is available now. AI website creation is being built. Please keep passwords and API keys out of chat.";
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
function renderBilling(data) {
  $("#billing-summary").textContent = `${data.plan.name} · ${data.period}: ${data.quota.available} of ${data.quota.allowance} monthly units available, ${data.quota.spent} used, ${data.quota.reserved} held. ${data.credits.available} credits available; ${data.credits.reserved} held. Monthly units reset on the first day (UTC). Credits carry over.`;
  $("#overage-enabled").checked = data.credits.overageEnabled;
  const history = $("#billing-history"); history.replaceChildren();
  for (const entry of data.ledger.slice(0, 10)) history.append(text("p", `${entry.event.replaceAll("_", " ")} · ${entry.quota_delta > 0 ? "+" : ""}${entry.quota_delta} monthly units · ${entry.credits_delta > 0 ? "+" : ""}${entry.credits_delta} credits`, "ledger-entry"));
}
$("#billing-open").onclick = async () => { try { renderBilling(await api("/billing")); $("#billing-dialog").showModal(); } catch(error) { showMessage(error.message); } };
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
  try {
    authConfig = await api("/config");
    const { user } = await api("/me");
    await loadDashboard(user);
  } catch (error) {
    showAuth();
    if (authConfig) await setAuthMode(new URLSearchParams(location.search).get("signup") === "1");
    if (error.status !== 401) showMessage(error.message);
  }
}
start();
