const state = {
  conversations: [],
  currentConversationId: null,
  currentConversation: null,
  catalog: { targets: [] },
  tasks: [],
  routing: [],
  providerFlows: {},
  activeView: "conversations",
  poll: null,
};

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers ?? {}) },
  });
  const body = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
  if (!response.ok) throw Object.assign(new Error(body?.error?.message ?? `Request failed (${response.status})`), { code: body?.error?.code });
  return body;
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("visible"), 2500);
}

function statusClass(value) {
  return ["running", "completed", "failed", "cancelled", "waiting_input", "waiting_permission", "detached"].includes(value) ? value : "neutral";
}

function targetLabel(target) {
  return [target.id, target.model, target.reasoning_effort].filter(Boolean).join(" · ");
}

function selectedTarget() {
  return state.catalog.targets.find((target) => target.id === $("#targetSelect").value) ?? null;
}

function codexProvider() {
  return (state.catalog.providers ?? []).find((provider) => provider.provider === "codex") ?? null;
}

function currentTask() {
  const tasks = state.currentConversation?.tasks ?? [];
  return tasks.at(-1) ?? null;
}

function renderConversationList() {
  const list = $("#conversationList");
  if (state.conversations.length === 0) {
    list.innerHTML = '<div class="muted" style="padding:8px;font-size:12px">No conversations yet.</div>';
    return;
  }
  list.innerHTML = state.conversations.map((conversation) => `
    <button class="conversation-item ${conversation.conversation_id === state.currentConversationId ? "active" : ""}" data-conversation-id="${escapeHtml(conversation.conversation_id)}">
      ${escapeHtml(conversation.title)}
      <small>${conversation.task_count} task${conversation.task_count === 1 ? "" : "s"}</small>
    </button>`).join("");
  list.querySelectorAll("[data-conversation-id]").forEach((button) => button.addEventListener("click", () => openConversation(button.dataset.conversationId)));
}

function renderCatalogSelect() {
  const select = $("#targetSelect");
  const previous = select.value;
  const executionTargets = state.catalog.targets.filter((target) => target.available && target.role === "execution");
  select.innerHTML = '<option value="">Auto</option>' + executionTargets.map((target) => `<option value="${escapeHtml(target.id)}">${escapeHtml(targetLabel(target))}</option>`).join("");
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  renderModelSelect();
  updateSelectionHint();
}

function renderModelSelect(preferredModel = undefined, preferredEffort = undefined) {
  const modelSelect = $("#modelSelect");
  const effortSelect = $("#effortSelect");
  const target = selectedTarget();
  const direct = $("#modeSelect").value === "direct";
  const models = target?.model_selection === true && (target?.provider === "codex" || target?.id?.startsWith("codex-"))
    ? (codexProvider()?.models ?? [])
    : [];
  const previousModel = preferredModel ?? modelSelect.value;
  modelSelect.innerHTML = '<option value="">Profile default</option>' + models.map((model) => `<option value="${escapeHtml(model.model)}">${escapeHtml(model.display_name ?? model.model)}</option>`).join("");
  modelSelect.disabled = !direct || !target || models.length === 0;
  modelSelect.value = !modelSelect.disabled && [...modelSelect.options].some((option) => option.value === previousModel) ? previousModel : "";
  renderEffortSelect(preferredEffort);
}

function renderEffortSelect(preferredEffort = undefined) {
  const effortSelect = $("#effortSelect");
  const model = codexProvider()?.models?.find((item) => item.model === $("#modelSelect").value) ?? null;
  const previous = preferredEffort ?? effortSelect.value;
  effortSelect.innerHTML = '<option value="">Model default</option>' + (model?.reasoning_efforts ?? []).map((effort) => `<option value="${escapeHtml(effort)}">${escapeHtml(effort)}</option>`).join("");
  effortSelect.disabled = $("#modelSelect").disabled || !model;
  effortSelect.value = !effortSelect.disabled && [...effortSelect.options].some((option) => option.value === previous) ? previous : "";
  updateSelectionHint();
}

function updateSelectionHint() {
  const target = selectedTarget();
  const mode = $("#modeSelect").value;
  const strategy = $("#strategySelect").value || "service default";
  const model = $("#modelSelect").value;
  const effort = $("#effortSelect").value;
  $("#selectionHint").textContent = target
    ? `Next Task: ${target.id} · ${model || target.model || "native model"} · ${effort || (model ? "model default effort" : target.reasoning_effort ?? "native effort")} · ${mode}`
    : `Next Task: ${strategy} · ${mode} · Broker qualified target`;
}

function timelineCard(view) {
  const task = view.task;
  const attempt = view.latest_attempt;
  const result = attempt?.outcome?.final_text ?? null;
  const stateValue = view.runtime?.state ?? attempt?.status ?? task.status;
  const verification = attempt?.acceptance?.step_verification;
  return `
    <article class="message user">
      <div class="meta"><span>User</span><span>${escapeHtml(new Date(task.created_at).toLocaleString())}</span></div>
      <div class="body">${escapeHtml(task.objective)}</div>
    </article>
    <article class="message aide">
      <div class="meta"><span>AIDE</span><span>${escapeHtml(stateValue)}</span>${attempt?.assignment?.id ? `<span>${escapeHtml(attempt.assignment.id)}</span>` : ""}</div>
      <div class="body">${result ? escapeHtml(result) : `Task ${escapeHtml(task.status)}${view.runtime?.attached === true ? " · native run attached" : ""}`}</div>
      ${verification ? `<div class="result">Step verification: ${verification.accepted ? "PASS" : "FAIL"} · ${verification.steps?.length ?? 0} steps</div>` : ""}
    </article>`;
}

function renderTimeline() {
  const timeline = $("#timeline");
  const tasks = state.currentConversation?.tasks ?? [];
  if (tasks.length === 0) {
    timeline.classList.add("empty-state");
    timeline.innerHTML = '<div class="empty-card"><span class="eyebrow">AIDE</span><h2>Start with the goal.</h2><p>AIDE will create a durable Task, choose a qualified Harness, execute, verify, and keep the result in this conversation.</p></div>';
  } else {
    timeline.classList.remove("empty-state");
    timeline.innerHTML = tasks.map(timelineCard).join("");
    timeline.scrollTop = timeline.scrollHeight;
  }
}

function fact(label, value) {
  return `<div class="fact"><span>${escapeHtml(label)}</span><span>${escapeHtml(value ?? "—")}</span></div>`;
}

function renderInspector() {
  const view = currentTask();
  const body = $("#inspectorBody");
  const badge = $("#taskStateBadge");
  if (!view) {
    badge.textContent = "Idle";
    badge.className = "badge neutral";
    body.className = "inspector-body muted";
    body.textContent = "No Task selected.";
    return;
  }
  const attempt = view.latest_attempt;
  const runtimeState = view.runtime?.state ?? attempt?.status ?? view.task.status;
  badge.textContent = runtimeState;
  badge.className = `badge ${statusClass(runtimeState)}`;
  body.className = "inspector-body";
  const pending = view.pending_interactions ?? [];
  body.innerHTML = `
    <div class="fact-group"><h3>Task</h3><div class="fact-list">
      ${fact("Task", view.task.task_id)}${fact("Status", view.task.status)}${fact("WorkPackages", view.work_packages.length)}${fact("Attempts", view.attempts.length)}
    </div></div>
    <div class="fact-group"><h3>Assignment</h3><div class="fact-list">
      ${fact("Target", attempt?.assignment?.id)}${fact("Harness", attempt?.assignment?.harness)}${fact("Model", attempt?.assignment?.model)}${fact("Effort", attempt?.assignment?.reasoning_effort)}${fact("Side effects", attempt?.side_effects)}
    </div></div>
    <div class="fact-group"><h3>Verification</h3><div class="fact-list">
      ${fact("Accepted", attempt?.acceptance?.accepted === undefined ? null : String(attempt.acceptance.accepted))}${fact("Semantic review", attempt?.acceptance?.semantic_review?.status)}${fact("Step verification", attempt?.acceptance?.step_verification?.accepted === undefined ? null : String(attempt.acceptance.step_verification.accepted))}
    </div></div>
    ${pending.map((interaction) => interactionHtml(interaction)).join("")}
    ${view.runtime?.recovery_required ? recoveryHtml(view.task.task_id) : ""}
    ${attempt && !["completed", "failed", "cancelled"].includes(attempt.status) ? controlsHtml(view.task.task_id) : ""}`;
  body.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", handleInspectorAction));
}

function interactionHtml(interaction) {
  return `<div class="interaction-card"><strong>${escapeHtml(interaction.kind)}</strong><p>${escapeHtml(interaction.prompt ?? interaction.reason ?? "Response required")}</p><pre>${escapeHtml(JSON.stringify(interaction.native_contract ?? {}, null, 2))}</pre><div class="inline-form"><textarea data-interaction-response="${escapeHtml(interaction.interaction_id)}" placeholder='Response JSON or text'></textarea><button class="primary" data-action="respond" data-id="${escapeHtml(interaction.interaction_id)}">Respond</button></div></div>`;
}

function controlsHtml(taskId) {
  return `<div class="fact-group"><h3>Controls</h3><div class="inline-form"><input data-steer-input placeholder="Steer current Attempt"><div class="action-row"><button class="ghost" data-action="steer" data-id="${escapeHtml(taskId)}">Steer</button><button class="danger-button" data-action="cancel" data-id="${escapeHtml(taskId)}">Cancel</button></div></div></div>`;
}

function recoveryHtml(taskId) {
  return `<div class="fact-group"><h3>Recovery required</h3><div class="action-row"><button class="ghost" data-action="recover-finalize" data-id="${escapeHtml(taskId)}">Finalize</button><button class="ghost" data-action="recover-reroute" data-id="${escapeHtml(taskId)}">Reroute</button><button class="danger-button" data-action="recover-abandon" data-id="${escapeHtml(taskId)}">Abandon</button></div></div>`;
}

async function handleInspectorAction(event) {
  const { action, id } = event.currentTarget.dataset;
  try {
    if (action === "cancel") await api(`/v1/tasks/${encodeURIComponent(id)}/cancel`, { method: "POST" });
    if (action === "steer") {
      const input = $("[data-steer-input]");
      if (!input.value.trim()) return;
      await api(`/v1/tasks/${encodeURIComponent(id)}/steer`, { method: "POST", body: JSON.stringify({ message: input.value.trim() }) });
      input.value = "";
    }
    if (action.startsWith("recover-")) await api(`/v1/tasks/${encodeURIComponent(id)}/recover`, { method: "POST", body: JSON.stringify({ action: action.slice(8), quiescent: true }) });
    if (action === "respond") {
      const input = document.querySelector(`[data-interaction-response="${CSS.escape(id)}"]`);
      let response = input.value;
      try { response = JSON.parse(response); } catch { /* plain text is valid for providers that declare it */ }
      await api(`/v1/interactions/${encodeURIComponent(id)}/respond`, { method: "POST", body: JSON.stringify({ response }) });
    }
    toast("Control action accepted");
    await refreshCurrentConversation();
  } catch (error) { toast(`${error.code ?? "Error"}: ${error.message}`); }
}

function renderConversationHeader() {
  const conversation = state.currentConversation?.conversation;
  $("#conversationTitle").textContent = conversation?.title ?? "New conversation";
  $("#conversationMeta").textContent = conversation ? `${conversation.task_count ?? state.currentConversation.tasks.length} task(s) · ${conversation.conversation_id}` : "AIDE orchestration workspace";
}

async function loadConversations() {
  const data = await api("/v1/conversations");
  state.conversations = data.conversations;
  renderConversationList();
  if (!state.currentConversationId && state.conversations.length) await openConversation(state.conversations[0].conversation_id);
}

async function openConversation(id) {
  state.currentConversationId = id;
  await refreshCurrentConversation();
  const defaults = state.currentConversation?.conversation?.defaults ?? {};
  $("#strategySelect").value = defaults.strategy ?? "";
  $("#modeSelect").value = defaults.mode ?? "direct";
  $("#targetSelect").value = state.catalog.targets.some((target) => target.id === defaults.target_id) ? defaults.target_id : "";
  renderModelSelect(defaults.model, defaults.reasoning_effort);
  renderConversationList();
  switchView("conversations");
}

async function refreshCurrentConversation() {
  if (!state.currentConversationId) return;
  state.currentConversation = await api(`/v1/conversations/${encodeURIComponent(state.currentConversationId)}`);
  renderConversationHeader();
  renderTimeline();
  renderInspector();
}

async function createConversation() {
  const conversation = await api("/v1/conversations", { method: "POST", body: JSON.stringify({ title: "New conversation", defaults: {} }) });
  await loadConversations();
  await openConversation(conversation.conversation_id);
  $("#messageInput").focus();
}

function taskRequest() {
  const strategy = $("#strategySelect").value;
  const mode = $("#modeSelect").value;
  const target = $("#targetSelect").value;
  const model = $("#modelSelect").value;
  const effort = $("#effortSelect").value;
  if (model && !target) throw new Error("Choose a target profile before selecting an explicit model.");
  if (model && mode !== "direct") throw new Error("Explicit model selection is only available in Direct mode.");
  const requirements = {
    ...(target ? { preferred_targets: [target] } : {}),
    ...(model ? { requested_model: model } : {}),
    ...(effort ? { requested_reasoning_effort: effort } : {}),
  };
  return {
    message: $("#messageInput").value.trim(),
    ...(strategy ? { strategy } : {}),
    ...(mode === "decompose" ? { decompose: true } : {}),
    ...(mode === "crossfire" ? { crossfire: true } : {}),
    ...(Object.keys(requirements).length ? { options: { requirements } } : {}),
  };
}

async function sendTask(event) {
  event.preventDefault();
  if (!$("#messageInput").value.trim()) return;
  if (!state.currentConversationId) await createConversation();
  const button = $("#sendButton");
  button.disabled = true;
  try {
    const request = taskRequest();
    await api(`/v1/conversations/${encodeURIComponent(state.currentConversationId)}/tasks`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(request) });
    await api(`/v1/conversations/${encodeURIComponent(state.currentConversationId)}`, {
      method: "PATCH",
      body: JSON.stringify({ defaults: {
        ...($("#strategySelect").value ? { strategy: $("#strategySelect").value } : {}),
        mode: $("#modeSelect").value,
        ...($("#targetSelect").value ? { target_id: $("#targetSelect").value } : {}),
        ...($("#modelSelect").value ? { model: $("#modelSelect").value } : {}),
        ...($("#effortSelect").value ? { reasoning_effort: $("#effortSelect").value } : {}),
      } }),
    });
    $("#messageInput").value = "";
    await loadConversations();
    await refreshCurrentConversation();
  } catch (error) { toast(`${error.code ?? "Error"}: ${error.message}`); }
  finally { button.disabled = false; }
}

async function loadTasks() {
  const data = await api("/v1/tasks?limit=100");
  state.tasks = data.tasks;
  $("#taskTable").innerHTML = table(["Task", "Conversation", "State", "Target", "Model", "Created"], data.tasks.map((view) => [
    view.task.task_id,
    view.task.conversation_id ?? "—",
    view.runtime?.state ?? view.latest_attempt?.status ?? view.task.status,
    view.latest_attempt?.assignment?.id ?? "—",
    view.latest_attempt?.assignment?.model ?? "—",
    new Date(view.task.created_at).toLocaleString(),
  ]));
}

function renderModels() {
  const providers = state.catalog.providers ?? [];
  $("#modelCards").innerHTML = providers.map((provider) => providerCard(provider)).join("");
  $("#modelCards").querySelectorAll("[data-provider-action]").forEach((button) => button.addEventListener("click", handleProviderAction));
}

function providerCard(provider) {
  const account = provider.account ?? {};
  const flow = state.providerFlows[provider.provider];
  const accountText = account.connected === true
    ? [account.email ?? account.type ?? "Connected", account.plan_type].filter(Boolean).join(" · ")
    : account.status === "native_managed" ? "Managed by Native Harness" : "Not connected";
  const canAuth = (provider.auth?.methods ?? []).length > 0;
  return `<article class="model-card">
    <span class="badge ${account.connected === true ? "completed" : "neutral"}">${account.connected === true ? "Connected" : account.status === "native_managed" ? "Native-managed" : "Not connected"}</span>
    <h3>${escapeHtml(provider.provider)}</h3>
    <p>${escapeHtml(accountText)}</p>
    ${canAuth ? `<div class="account-actions">
      <button class="ghost" data-provider-action="chatgpt" data-provider="${escapeHtml(provider.provider)}">Sign in with ChatGPT</button>
      <button class="ghost" data-provider-action="device_code" data-provider="${escapeHtml(provider.provider)}">Device code</button>
      ${account.connected === true ? `<button class="danger-button" data-provider-action="logout" data-provider="${escapeHtml(provider.provider)}">Logout</button>` : ""}
    </div>
    <div class="account-actions">
      <input type="password" autocomplete="off" placeholder="API key (write-only)" data-api-key="${escapeHtml(provider.provider)}">
      <button class="ghost" data-provider-action="api_key" data-provider="${escapeHtml(provider.provider)}">Save API key</button>
    </div>` : ""}
    ${flow ? authFlowHtml(provider.provider, flow) : ""}
    <div class="model-directory">
      ${(provider.models ?? []).length ? provider.models.map((model) => `<div class="model-entry">
        <strong>${escapeHtml(model.display_name ?? model.model)}</strong>${model.is_default ? ' <span class="chip">default</span>' : ""}
        <p>${escapeHtml(model.model)} · default effort ${escapeHtml(model.default_reasoning_effort ?? "native")}</p>
        <div class="capabilities">${(model.reasoning_efforts ?? []).map((effort) => `<span class="chip">${escapeHtml(effort)}</span>`).join("")}</div>
      </div>`).join("") : '<p class="muted">Model directory remains Native Harness-managed.</p>'}
    </div>
  </article>`;
}

function authFlowHtml(provider, flow) {
  if (flow.status === "waiting_user") {
    if (flow.user_code) return `<div class="auth-flow">Open the verification page and enter <code>${escapeHtml(flow.user_code)}</code>. <button class="ghost" data-provider-action="cancel_login" data-provider="${escapeHtml(provider)}" data-login-id="${escapeHtml(flow.login_id)}">Cancel</button></div>`;
    return `<div class="auth-flow">Waiting for browser authorization… <button class="ghost" data-provider-action="cancel_login" data-provider="${escapeHtml(provider)}" data-login-id="${escapeHtml(flow.login_id)}">Cancel</button></div>`;
  }
  return `<div class="auth-flow">Login ${escapeHtml(flow.status)}${flow.error ? ` · ${escapeHtml(flow.error)}` : ""}</div>`;
}

async function reloadCatalog() {
  state.catalog = await api("/v1/catalog");
  renderCatalogSelect();
  renderModels();
  renderHarnesses();
  renderSettings();
}

async function handleProviderAction(event) {
  const { providerAction: action, provider, loginId } = event.currentTarget.dataset;
  try {
    if (action === "cancel_login") {
      const flow = await api(`/v1/providers/${encodeURIComponent(provider)}/login/${encodeURIComponent(loginId)}/cancel`, { method: "POST" });
      state.providerFlows[provider] = flow;
      renderModels();
      return;
    }
    if (action === "logout") {
      await api(`/v1/providers/${encodeURIComponent(provider)}/logout`, { method: "POST" });
      delete state.providerFlows[provider];
      await reloadCatalog();
      toast(`${provider} logged out`);
      return;
    }
    const popup = ["chatgpt", "device_code"].includes(action) ? window.open("about:blank", "_blank") : null;
    let body = { method: action };
    if (action === "api_key") {
      const input = document.querySelector(`[data-api-key="${CSS.escape(provider)}"]`);
      const apiKey = input.value;
      input.value = "";
      if (!apiKey.trim()) return;
      body = { method: "api_key", api_key: apiKey };
    }
    let flow;
    try {
      flow = await api(`/v1/providers/${encodeURIComponent(provider)}/login`, { method: "POST", body: JSON.stringify(body) });
    } catch (error) {
      popup?.close();
      throw error;
    }
    if (flow.login_id) state.providerFlows[provider] = flow;
    const authUrl = flow.auth_url ?? flow.verification_url ?? null;
    if (popup && authUrl) popup.location.href = authUrl;
    else popup?.close();
    renderModels();
    if (flow.login_id) void pollProviderLogin(provider, flow.login_id);
    else { await reloadCatalog(); toast(`${provider} account updated`); }
  } catch (error) { toast(`${error.code ?? "Error"}: ${error.message}`); }
}

async function pollProviderLogin(provider, loginId) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      const flow = await api(`/v1/providers/${encodeURIComponent(provider)}/login/${encodeURIComponent(loginId)}`);
      state.providerFlows[provider] = flow;
      renderModels();
      if (flow.status !== "waiting_user") {
        await reloadCatalog();
        toast(flow.status === "completed" ? `${provider} connected` : `${provider} login ${flow.status}`);
        return;
      }
    } catch (error) { toast(error.message); return; }
  }
}

function renderHarnesses() {
  $("#harnessCards").innerHTML = state.catalog.targets.map((target) => `
    <article class="model-card">
      <span class="badge ${target.available ? "completed" : "failed"}">${target.available ? "Available" : "Unavailable"}</span>
      <h3>${escapeHtml(target.id)}</h3>
      <p>Provider: ${escapeHtml(target.provider)} · Role: ${escapeHtml(target.role)}</p>
      <p>Model: ${escapeHtml(target.model ?? "native")}${target.reasoning_effort ? ` · ${escapeHtml(target.reasoning_effort)}` : ""}</p>
      <p>Native mode: ${escapeHtml(target.collaboration_mode ?? "default")}</p>
      <p>Sandbox: ${escapeHtml(target.approval_contract?.sandbox_mode ?? "native")}</p>
      <p>Approval profile: ${escapeHtml(target.approval_contract?.profile ?? "native")}</p>
      <div class="capabilities">${(target.capabilities ?? []).map((cap) => `<span class="chip">${escapeHtml(cap)}</span>`).join("")}</div>
    </article>`).join("");
}

function renderSettings() {
  $("#settingsCard").innerHTML = `
    <div class="fact-group"><h3>Service</h3><div class="fact-list">
      ${fact("Endpoint", window.location.origin)}
      ${fact("Default strategy", state.catalog.defaults?.execution_strategy ?? "native / unset")}
      ${fact("Control surface", "HTTP + MCP + Local UI")}
    </div></div>
    <div class="fact-group"><h3>Configuration ownership</h3><div class="fact-list">
      ${fact("AIDE orchestration", "Direct / Decompose / Crossfire")}
      ${fact("Target profiles", "Broker qualified")}
      ${fact("Native modes", "Harness-owned")}
      ${fact("Secrets", "Never returned to browser")}
    </div></div>`;
}

async function loadRouting() {
  const data = await api("/v1/routing-history?limit=100");
  state.routing = data.history;
  $("#routingTable").innerHTML = table(["Role", "Target", "Model", "Result", "Duration", "Shadow"], data.history.slice().reverse().map((row) => [
    row.routing.actual.role ?? "execution",
    row.routing.actual.target_id ?? "—",
    [row.routing.actual.model, row.routing.actual.reasoning_effort].filter(Boolean).join(" / ") || "—",
    row.routing.outcome?.accepted === true ? "accepted" : row.routing.outcome?.accepted === false ? "rejected" : row.routing.outcome?.status ?? "—",
    Number.isFinite(row.wall_duration_ms) ? `${(row.wall_duration_ms / 1000).toFixed(1)}s` : "—",
    row.routing.advisory?.advice?.decision ?? row.routing.advisory?.status ?? "—",
  ]));
}

function table(headers, rows) {
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

async function switchView(view) {
  state.activeView = view;
  document.querySelectorAll(".view").forEach((el) => el.classList.toggle("active", el.id === `${view}View`));
  document.querySelectorAll(".nav-tab").forEach((el) => el.classList.toggle("active", el.dataset.view === view));
  if (view === "tasks") await loadTasks();
  if (view === "routing") await loadRouting();
  if (view === "models") renderModels();
  if (view === "harnesses") renderHarnesses();
  if (view === "settings") renderSettings();
}

async function renameConversation() {
  if (!state.currentConversationId) return;
  const current = state.currentConversation?.conversation?.title ?? "";
  const title = window.prompt("Conversation title", current);
  if (!title?.trim() || title.trim() === current) return;
  await api(`/v1/conversations/${encodeURIComponent(state.currentConversationId)}`, { method: "PATCH", body: JSON.stringify({ title: title.trim() }) });
  await loadConversations();
  await refreshCurrentConversation();
}

async function archiveConversation() {
  if (!state.currentConversationId) return;
  await api(`/v1/conversations/${encodeURIComponent(state.currentConversationId)}`, { method: "PATCH", body: JSON.stringify({ archived: true }) });
  state.currentConversationId = null;
  state.currentConversation = null;
  await loadConversations();
  if (!state.currentConversationId) await createConversation();
}

async function init() {
  try {
    const [health, catalog] = await Promise.all([api("/health"), api("/v1/catalog")]);
    $("#healthText").textContent = health.ok ? "Service healthy" : "Service unavailable";
    state.catalog = catalog;
    renderCatalogSelect();
    renderModels();
    renderHarnesses();
    renderSettings();
    await loadConversations();
    if (!state.currentConversationId) await createConversation();
    state.poll = setInterval(() => { if (state.activeView === "conversations") void refreshCurrentConversation(); }, 1800);
  } catch (error) {
    $("#healthText").textContent = "Connection failed";
    toast(error.message);
  }
}

$("#newConversationButton").addEventListener("click", () => void createConversation());
$("#renameConversationButton").addEventListener("click", () => void renameConversation().catch((error) => toast(error.message)));
$("#archiveConversationButton").addEventListener("click", () => void archiveConversation().catch((error) => toast(error.message)));
$("#refreshButton").addEventListener("click", () => void refreshCurrentConversation());
$("#composer").addEventListener("submit", sendTask);
$("#strategySelect").addEventListener("change", updateSelectionHint);
$("#targetSelect").addEventListener("change", () => renderModelSelect());
$("#modelSelect").addEventListener("change", () => renderEffortSelect());
$("#effortSelect").addEventListener("change", updateSelectionHint);
$("#modeSelect").addEventListener("change", () => {
  const mode = $("#modeSelect").value;
  if (mode !== "direct" && $("#strategySelect").value === "economy") $("#strategySelect").value = "capability";
  renderModelSelect();
});
document.querySelectorAll(".nav-tab").forEach((button) => button.addEventListener("click", () => void switchView(button.dataset.view)));

void init();
