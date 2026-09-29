const $ = (selector) => document.querySelector(selector);
let registering = false;
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
function renderChat(data) {
  chatRevision = data.state.revision;
  const container = $("#chat-messages");
  container.replaceChildren();
  function bubble(role, content) {
    const item = text("article", "", `chat-bubble ${role}`);
    item.append(text("small", role === "user" ? "You" : "TellUmo · Guide"), text("p", content));
    container.append(item);
  }
  bubble("assistant", data.greeting);
  for (const turn of data.turns) { bubble("user", turn.user_text); bubble("assistant", turn.assistant_text); }
  $("#service-stats").textContent = `${data.stats.projects} project${data.stats.projects === 1 ? "" : "s"} · ${data.stats.live || 0} live`;
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
  sending = true;
  $("#chat-form button").disabled = true;
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
  $("#auth-title").textContent = registering ? "Create an account" : "Sign in";
  $("#auth-toggle").textContent = registering ? "Already have an account? Sign in" : "Create an account";
  $("#invite-field").hidden = !registering || !authConfig?.inviteRequired;
  const invite = $("[name=inviteCode]");
  invite.disabled = !registering || !authConfig?.inviteRequired;
  invite.required = !invite.disabled;
  $("[name=password]").autocomplete = registering ? "new-password" : "current-password";
  $("#turnstile-slot").hidden = !registering;
  try { if (registering) await prepareWidget(); } catch (error) { showMessage(error.message); }
}
$("#auth-toggle").onclick = () => setAuthMode(!registering);
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
    const result = await api(registering ? "/auth/register" : "/auth/login", { method: "POST", body: JSON.stringify(data) });
    await loadDashboard(result.user);
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
    if (authConfig && new URLSearchParams(location.search).get("signup") === "1") await setAuthMode(true);
    if (error.status !== 401) showMessage(error.message);
  }
}
start();
