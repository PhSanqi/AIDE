import assert from "node:assert/strict";
import test from "node:test";
import { AideHttpTransport } from "../src/control/http-transport.js";

function runtimeFixture() {
  const calls = [];
  return {
    calls,
    runtime: {
      health: async () => ({ ok: true }),
      catalog: async () => ({
        providers: [{ provider: "codex", account: { connected: true, email: "user@example.com" }, auth: { methods: ["chatgpt", "device_code", "api_key"], secrets_write_only: true }, models: [{ id: "small", model: "small", reasoning_efforts: ["low", "medium"] }] }],
        targets: [{ id: "codex-economy", available: true, role: "execution", model: "small" }],
      }),
      providerLogin: async (provider, options) => { calls.push(["providerLogin", provider, options]); return options.method === "api_key" ? { provider, method: "api_key", status: "completed" } : { provider, login_id: "login-1", method: options.method, status: "waiting_user", auth_url: "https://example.com/auth" }; },
      providerLoginStatus: async (provider, loginId) => { calls.push(["providerLoginStatus", provider, loginId]); return { provider, login_id: loginId, status: "completed" }; },
      providerLoginCancel: async (provider, loginId) => { calls.push(["providerLoginCancel", provider, loginId]); return { provider, login_id: loginId, status: "cancelled" }; },
      providerLogout: async (provider) => { calls.push(["providerLogout", provider]); return { provider, status: "logged_out" }; },
      conversations: async () => [{ conversation_id: "conversation-1", title: "UI", task_count: 1 }],
      createConversation: async (options) => { calls.push(["createConversation", options]); return { conversation_id: "conversation-2", ...options }; },
      updateConversation: async (conversationId, patch) => { calls.push(["updateConversation", conversationId, patch]); return { conversation_id: conversationId, ...patch }; },
      conversation: async (conversationId) => ({ conversation: { conversation_id: conversationId, title: "UI" }, tasks: [] }),
      tasks: async (options) => { calls.push(["tasks", options]); return [{ task: { task_id: "task-list" }, attempts: [] }]; },
      recoveries: async () => [{ task: { task_id: "task-old" } }],
      routingHistory: async (options) => { calls.push(["routingHistory", options]); return [{ attempt_id: "attempt-history" }]; },
      enqueue: async (message, options, request) => { calls.push(["enqueue", message, options, request]); return { task_id: "task-1", attempt_id: "attempt-1", state: "running" }; },
      status: async (taskId) => ({ task: { task_id: taskId }, runtime: { attached: true } }),
      steerTask: async (taskId, message) => { calls.push(["steer", taskId, message]); return { accepted: true }; },
      cancelTask: async (taskId) => { calls.push(["cancel", taskId]); return { state: "cancelling" }; },
      recoverTask: async (taskId, recovery) => { calls.push(["recover", taskId, recovery]); return { recovery: { status: recovery.action } }; },
      respond: async (interactionId, response, options) => { calls.push(["respond", interactionId, response, options]); return { state: "running" }; },
    },
  };
}

test("AideHttpTransport exposes one thin asynchronous Task control API", async () => {
  const fixture = runtimeFixture();
  const transport = await AideHttpTransport.start({ runtime: fixture.runtime });
  const { port } = transport.address();
  const base = `http://127.0.0.1:${port}`;

  const submittedResponse = await fetch(`${base}/v1/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "http-request-1" },
    body: JSON.stringify({ message: "do the work", strategy: "economy", options: { timeoutMs: 10 } }),
  });
  assert.equal(submittedResponse.status, 202);
  assert.equal((await submittedResponse.json()).task_id, "task-1");
  assert.equal(fixture.calls[0][3].clientRequestId, "http-request-1");
  assert.equal(fixture.calls[0][2].requirements.execution_strategy, "economy");
  assert.equal((await (await fetch(`${base}/v1/tasks/task-1`)).json()).task.task_id, "task-1");
  assert.equal((await (await fetch(`${base}/v1/catalog`)).json()).targets[0].id, "codex-economy");
  assert.equal((await (await fetch(`${base}/v1/conversations`)).json()).conversations[0].conversation_id, "conversation-1");
  assert.equal((await (await fetch(`${base}/v1/tasks?limit=7`)).json()).tasks[0].task.task_id, "task-list");
  assert.equal((await (await fetch(`${base}/v1/recoveries`)).json()).recoveries[0].task.task_id, "task-old");
  assert.equal((await (await fetch(`${base}/v1/routing-history?limit=5`)).json()).history[0].attempt_id, "attempt-history");

  await fetch(`${base}/v1/tasks/task-1/steer`, { method: "POST", body: JSON.stringify({ message: "focus" }) });
  await fetch(`${base}/v1/tasks/task-1/cancel`, { method: "POST" });
  await fetch(`${base}/v1/tasks/task-1/recover`, { method: "POST", body: JSON.stringify({ action: "abandon", quiescent: true }) });
  await fetch(`${base}/v1/interactions/interaction-1/respond`, { method: "POST", body: JSON.stringify({ response: "allow" }) });
  assert.deepEqual(fixture.calls.map(([name]) => name), ["enqueue", "tasks", "routingHistory", "steer", "cancel", "recover", "respond"]);
  await transport.stop();
});

test("AideHttpTransport serves the local management UI and Conversation Task entry", async () => {
  const fixture = runtimeFixture();
  const transport = await AideHttpTransport.start({ runtime: fixture.runtime });
  const { port } = transport.address();
  const base = `http://127.0.0.1:${port}`;

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  assert.match(await page.text(), /AIDE Management UI|New conversation|Models & Accounts/);
  assert.match(await (await fetch(`${base}/app.js`)).text(), /createConversation/);
  assert.match(await (await fetch(`${base}/styles.css`)).text(), /workspace-grid/);

  const created = await (await fetch(`${base}/v1/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "New conversation", defaults: { strategy: "capability", mode: "direct" } }),
  })).json();
  assert.equal(created.conversation_id, "conversation-2");
  assert.equal((await (await fetch(`${base}/v1/conversations/conversation-2`)).json()).conversation.conversation_id, "conversation-2");
  assert.equal((await (await fetch(`${base}/v1/conversations/conversation-2`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Renamed" }),
  })).json()).title, "Renamed");

  const submitted = await fetch(`${base}/v1/conversations/conversation-2/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "conversation-task-1" },
    body: JSON.stringify({
      message: "build the UI",
      strategy: "capability",
      decompose: true,
      options: { requirements: { preferred_targets: ["codex-capability"] } },
    }),
  });
  assert.equal(submitted.status, 202);
  const enqueue = fixture.calls.find(([name, message]) => name === "enqueue" && message === "build the UI");
  assert.equal(enqueue[2].conversationId, "conversation-2");
  assert.deepEqual(enqueue[2].requirements, {
    preferred_targets: ["codex-capability"],
    execution_strategy: "capability",
    semantic_decomposition: "plan",
  });
  assert.equal(enqueue[3].clientRequestId, "conversation-task-1");
  await transport.stop();
});

test("AideHttpTransport exposes provider-owned auth without returning API-key secrets", async () => {
  const fixture = runtimeFixture();
  const transport = await AideHttpTransport.start({ runtime: fixture.runtime });
  const { port } = transport.address();
  const base = `http://127.0.0.1:${port}`;

  const catalog = await (await fetch(`${base}/v1/catalog`)).json();
  assert.equal(catalog.providers[0].account.email, "user@example.com");
  assert.deepEqual(catalog.providers[0].models[0].reasoning_efforts, ["low", "medium"]);

  const apiKeyResponse = await (await fetch(`${base}/v1/providers/codex/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method: "api_key", api_key: "sk-secret" }),
  })).json();
  assert.equal(apiKeyResponse.status, "completed");
  assert.equal(JSON.stringify(apiKeyResponse).includes("sk-secret"), false);
  assert.deepEqual(fixture.calls.find(([name]) => name === "providerLogin").slice(1), ["codex", { method: "api_key", apiKey: "sk-secret" }]);

  const login = await (await fetch(`${base}/v1/providers/codex/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method: "chatgpt" }),
  })).json();
  assert.equal(login.auth_url, "https://example.com/auth");
  assert.equal((await (await fetch(`${base}/v1/providers/codex/login/login-1`)).json()).status, "completed");
  assert.equal((await (await fetch(`${base}/v1/providers/codex/login/login-1/cancel`, { method: "POST" })).json()).status, "cancelled");
  assert.equal((await (await fetch(`${base}/v1/providers/codex/logout`, { method: "POST" })).json()).status, "logged_out");
  await transport.stop();
});

test("AideHttpTransport requires authentication for non-loopback binding", async () => {
  const fixture = runtimeFixture();
  await assert.rejects(
    AideHttpTransport.start({ runtime: fixture.runtime, host: "0.0.0.0" }),
    (error) => error.code === "AIDE_HTTP_AUTH_REQUIRED",
  );
});

test("AideHttpTransport enforces bearer auth when configured", async () => {
  const fixture = runtimeFixture();
  const token = "0123456789abcdef";
  const transport = await AideHttpTransport.start({ runtime: fixture.runtime, token });
  const { port } = transport.address();
  const base = `http://127.0.0.1:${port}`;

  assert.equal((await fetch(`${base}/health`)).status, 401);
  assert.equal((await fetch(`${base}/health`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
  await transport.stop();
});

test("AideHttpTransport serves MCP 2026-07-28 tools on the same runtime", async () => {
  const fixture = runtimeFixture();
  const transport = await AideHttpTransport.start({ runtime: fixture.runtime });
  const { port } = transport.address();
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": { name: "aide-test", version: "1" },
  };
  const request = (body, extraHeaders = {}) => fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": body.method,
      ...(body.method === "tools/call" ? { "mcp-name": body.params.name } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify({ ...body, params: { ...(body.params ?? {}), _meta: meta } }),
  });

  const discover = await (await request({ jsonrpc: "2.0", id: 1, method: "server/discover", params: {} })).json();
  assert.equal(discover.result.resultType, "complete");
  assert.deepEqual(discover.result.supportedVersions, ["2026-07-28"]);
  assert.equal(discover.result._meta["io.modelcontextprotocol/serverInfo"].name, "aide");

  const list = await (await request({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })).json();
  assert.equal(list.result.resultType, "complete");
  const submitTool = list.result.tools.find((tool) => tool.name === "aide_submit");
  assert.ok(submitTool);
  assert.deepEqual(submitTool.inputSchema.properties.decompose, { type: "boolean" });
  assert.deepEqual(submitTool.inputSchema.properties.constraints, { type: "array", maxItems: 32, items: { type: "string" } });
  assert.deepEqual(submitTool.inputSchema.properties.semantic_acceptance, { type: "array", maxItems: 16, items: { type: "string" } });
  assert.ok(list.result.tools.some((tool) => tool.name === "aide_recover"));
  assert.ok(list.result.tools.some((tool) => tool.name === "aide_routing_history"));
  assert.equal(list.result.cacheScope, "private");

  const call = await (await request({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "aide_submit", arguments: { message: "from mcp", strategy: "capability", crossfire: true, client_request_id: "mcp-request-1" } } })).json();
  assert.equal(call.result.structuredContent.task_id, "task-1");
  assert.equal(call.result.resultType, "complete");
  assert.equal(call.result.isError, false);
  assert.equal(JSON.parse(call.result.content[0].text).task_id, "task-1");
  const mcpEnqueue = fixture.calls.find(([name, message]) => name === "enqueue" && message === "from mcp");
  assert.equal(mcpEnqueue[3].clientRequestId, "mcp-request-1");
  assert.deepEqual(mcpEnqueue[2].requirements, { execution_strategy: "capability", plan_consensus: "dual" });

  const history = await (await request({ jsonrpc: "2.0", id: 31, method: "tools/call", params: { name: "aide_routing_history", arguments: { limit: 7 } } })).json();
  assert.equal(history.result.structuredContent.history[0].attempt_id, "attempt-history");
  assert.deepEqual(fixture.calls.find(([name]) => name === "routingHistory")[1], { limit: 7 });

  const mismatch = await request(
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "aide_status", arguments: { task_id: "task-1" } } },
    { "mcp-name": "wrong" },
  );
  assert.equal(mismatch.status, 400);
  assert.equal((await mismatch.json()).error.code, -32020);
  await transport.stop();
});

test("AideHttpTransport exposes explicit capability decomposition without leaking internal requirements", async () => {
  const fixture = runtimeFixture();
  const transport = await AideHttpTransport.start({ runtime: fixture.runtime });
  const { port } = transport.address();
  const response = await fetch(`http://127.0.0.1:${port}/v1/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "plan before execution", decompose: true, constraints: ["Preserve public APIs."] }),
  });
  assert.equal(response.status, 202);
  const enqueue = fixture.calls.find(([name, message]) => name === "enqueue" && message === "plan before execution");
  assert.deepEqual(enqueue[2].requirements, { execution_strategy: "capability", semantic_decomposition: "plan" });
  assert.deepEqual(enqueue[2].constraints, ["Preserve public APIs."]);
  await transport.stop();
});

test("AideHttpTransport exposes semantic acceptance as first-class Task intent", async () => {
  const fixture = runtimeFixture();
  const transport = await AideHttpTransport.start({ runtime: fixture.runtime });
  const { port } = transport.address();
  const response = await fetch(`http://127.0.0.1:${port}/v1/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: "verify intent",
      semantic_acceptance: ["The behavior matches the requested semantics."],
      options: { acceptance: { finalText: "done" } },
    }),
  });
  assert.equal(response.status, 202);
  const enqueue = fixture.calls.find(([name, message]) => name === "enqueue" && message === "verify intent");
  assert.deepEqual(enqueue[2].acceptance, {
    finalText: "done",
    semantic: ["The behavior matches the requested semantics."],
  });
  await transport.stop();
});

test("AideHttpTransport rejects ambiguous or malformed semantic acceptance before enqueue", async () => {
  const fixture = runtimeFixture();
  const transport = await AideHttpTransport.start({ runtime: fixture.runtime });
  const { port } = transport.address();
  for (const body of [
    { message: "ambiguous", semantic_acceptance: ["A"], options: { acceptance: { semantic: ["B"] } } },
    { message: "empty", semantic_acceptance: [""] },
  ]) {
    const response = await fetch(`http://127.0.0.1:${port}/v1/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
  }
  assert.equal(fixture.calls.length, 0);
  await transport.stop();
});

test("AideHttpTransport rejects ambiguous top-level and nested constraints", async () => {
  const fixture = runtimeFixture();
  const transport = await AideHttpTransport.start({ runtime: fixture.runtime });
  const { port } = transport.address();
  const response = await fetch(`http://127.0.0.1:${port}/v1/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "do work", constraints: ["A"], options: { constraints: ["B"] } }),
  });
  assert.equal(response.status, 400);
  assert.equal(fixture.calls.length, 0);
  await transport.stop();
});

test("AideHttpTransport refuses crossfire in economy mode", async () => {
  const fixture = runtimeFixture();
  const transport = await AideHttpTransport.start({ runtime: fixture.runtime });
  const { port } = transport.address();
  const response = await fetch(`http://127.0.0.1:${port}/v1/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "do work", strategy: "economy", crossfire: true }),
  });
  assert.equal(response.status, 400);
  assert.equal(fixture.calls.length, 0);
  await transport.stop();
});

test("AideHttpTransport refuses decomposition in economy mode or together with crossfire", async () => {
  const fixture = runtimeFixture();
  const transport = await AideHttpTransport.start({ runtime: fixture.runtime });
  const { port } = transport.address();
  for (const body of [
    { message: "do work", strategy: "economy", decompose: true },
    { message: "do work", strategy: "capability", decompose: true, crossfire: true },
  ]) {
    const response = await fetch(`http://127.0.0.1:${port}/v1/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
  }
  assert.equal(fixture.calls.length, 0);
  await transport.stop();
});
