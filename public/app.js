const $ = (selector) => document.querySelector(selector);
let registering = false;
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
function renderProjects(projects) {
  $("#project-count").textContent = String(projects.length);
  const container = $("#projects");
  container.replaceChildren();
  if (!projects.length) return container.append(text("p", "Your projects will appear here.", "empty"));
  for (const project of projects) {
    const item = text("div", "", "project");
    item.append(text("strong", project.name), text("p", project.purpose || "No description yet"), text("small", `Draft · Created ${new Date(project.created_at).toLocaleDateString()}`));
    container.append(item);
  }
}
function renderActivity(events) {
  const container = $("#activity");
  container.replaceChildren();
  if (!events.length) return container.append(text("p", "No activity yet.", "empty"));
  for (const event of events) {
    const item = text("div", "", "event");
    item.append(text("span", event.summary), text("small", new Date(event.created_at).toLocaleString()));
    container.append(item);
  }
}
async function loadDashboard(user) {
  $("#auth").hidden = true;
  $("#dashboard").hidden = false;
  const account = $("#account");
  account.replaceChildren(text("span", user.email));
  const logout = text("button", "Sign out");
  logout.onclick = async () => { try { await api("/auth/logout", { method: "POST" }); location.reload(); } catch (error) { showMessage(error.message); } };
  account.append(logout);
  const [projects, activity] = await Promise.all([api("/projects"), api("/activity")]);
  renderProjects(projects.projects);
  renderActivity(activity.activity);
}
function showAuth() {
  $("#auth").hidden = false;
  $("#dashboard").hidden = true;
}
$("#auth-toggle").onclick = async () => {
  registering = !registering;
  $("#auth-title").textContent = registering ? "Create an account" : "Sign in";
  $("#auth-toggle").textContent = registering ? "Already have an account? Sign in" : "Create an account";
  $("#invite-field").hidden = !registering || !authConfig?.inviteRequired;
  const invite = $("[name=inviteCode]");
  invite.disabled = !registering || !authConfig?.inviteRequired;
  invite.required = !invite.disabled;
  $("[name=password]").autocomplete = registering ? "new-password" : "current-password";
  $("#turnstile-slot").hidden = !registering;
  try { if (registering) await prepareWidget(); } catch (error) { showMessage(error.message); }
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
    const result = await api(registering ? "/auth/register" : "/auth/login", { method: "POST", body: JSON.stringify(data) });
    await loadDashboard(result.user);
  } catch (error) { showMessage(error.message); if (widgetId !== undefined) window.turnstile.reset(widgetId); }
  finally { button.disabled = false; }
};
$("#project-form").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  try {
    await api("/projects", { method: "POST", body: JSON.stringify(data) });
    form.reset();
    const user = (await api("/me")).user;
    await loadDashboard(user);
    showMessage("Project created");
  } catch (error) { showMessage(error.message); }
};
async function start() {
  try {
    authConfig = await api("/config");
    const { user } = await api("/me");
    await loadDashboard(user);
  } catch (error) { showAuth(); if (error.status !== 401) showMessage(error.message); }
}
start();
