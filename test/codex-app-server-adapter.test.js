import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { CodexAppServerAdapter } from "../src/execution/codex-app-server-adapter.js";

function fakeCodexProcess({ interaction = null, dynamicToolCall = null, itemStarted = null, itemCompleted = null, completeOn = null, terminalItems = null, threadReadItems = null, tokenUsage = null, resumeStatus = null, modelReroute = null, account = { type: "chatgpt", email: "user@example.com", planType: "pro" } } = {}) {
  const child = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const messages = [];
  let stdinBuffer = "";
  let closed = false;

  const emit = (message) => stdout.write(`${JSON.stringify(message)}\n`);
  const complete = (status = "completed") => emit({
    method: "turn/completed",
    params: {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        status,
        error: status === "failed" ? { message: "failed" } : null,
        items: status === "completed" ? (terminalItems ?? [{ type: "agentMessage", id: "msg-1", text: "done" }]) : [],
      },
    },
  });

  const handle = (message) => {
    messages.push(message);
    if (message.method === "initialize") emit({ id: message.id, result: { userAgent: "fake", codexHome: "/tmp", platformFamily: "unix", platformOs: "linux" } });
    if (message.method === "model/list") emit({ id: message.id, result: { data: [
      { id: "gpt-5.6-sol", model: "gpt-5.6-sol", defaultReasoningEffort: "low", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }, { reasoningEffort: "high" }, { reasoningEffort: "ultra" }], multiAgentVersion: "v2" },
      { id: "gpt-5.6-luna", model: "gpt-5.6-luna", defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }], multiAgentVersion: "v1" },
    ] } });
    if (message.method === "collaborationMode/list") emit({ id: message.id, result: { data: [
      { name: "Plan", mode: "plan", model: null, reasoning_effort: "medium" },
      { name: "Default", mode: "default", model: null, reasoning_effort: null },
    ] } });
    if (message.method === "account/rateLimits/read") emit({ id: message.id, result: {
      ordinaryUsageAllowed: true,
      rateLimitsByLimitId: {
        codex: {
          limitId: "codex",
          limitName: null,
          normalModelSlug: null,
          primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 12345 },
          secondary: null,
          rateLimitReachedType: null,
          spendControlReached: false,
        },
      },
      accountId: "must-not-leak",
    } });
    if (message.method === "account/read") emit({ id: message.id, result: { account, requiresOpenaiAuth: true } });
    if (message.method === "account/login/start") {
      if (message.params.type === "apiKey") emit({ id: message.id, result: { type: "apiKey" } });
      else if (message.params.type === "chatgptDeviceCode") emit({ id: message.id, result: { type: "chatgptDeviceCode", loginId: "login-device", verificationUrl: "https://example.com/device", userCode: "ABCD-EFGH" } });
      else emit({ id: message.id, result: { type: "chatgpt", loginId: "login-chatgpt", authUrl: "https://example.com/auth" } });
    }
    if (message.method === "account/login/cancel") emit({ id: message.id, result: {} });
    if (message.method === "account/logout") emit({ id: message.id, result: {} });
    if (message.method === "thread/start") emit({ id: message.id, result: {
      thread: { id: "thread-1" },
      model: message.params.model ?? "gpt-test",
      modelProvider: "openai",
      approvalPolicy: message.params.approvalPolicy ?? "on-request",
      approvalsReviewer: "user",
      sandbox: {
        type: message.params.sandbox === "read-only" ? "readOnly" : "workspaceWrite",
        networkAccess: message.params.sandbox === "read-only" ? false : true,
      },
      activePermissionProfile: { id: ":workspace", extends: null },
    } });
    if (message.method === "thread/resume") emit({ id: message.id, result: {
      thread: { id: message.params.threadId, ...(resumeStatus === null ? {} : { status: resumeStatus, canAcceptDirectInput: true }) },
      model: "gpt-test",
      modelProvider: "openai",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: { type: "workspaceWrite", networkAccess: true },
      activePermissionProfile: { id: ":workspace", extends: null },
    } });
    if (message.method === "thread/read") emit({ id: message.id, result: {
      thread: {
        id: message.params.threadId,
        turns: [{ id: "turn-1", status: "completed", error: null, items: threadReadItems ?? terminalItems ?? [{ type: "agentMessage", id: "msg-1", text: "done" }] }],
      },
    } });
    if (message.method === "turn/start") {
      emit({ id: message.id, result: { turn: { id: "turn-1", status: "inProgress", items: [] } } });
      emit({ method: "turn/started", params: { threadId: "thread-1", turn: { id: "turn-1" } } });
      if (tokenUsage) emit({ method: "thread/tokenUsage/updated", params: { threadId: "thread-1", turnId: "turn-1", tokenUsage } });
      if (modelReroute) emit({ method: "model/rerouted", params: { threadId: "thread-1", turnId: "turn-1", ...modelReroute } });
      if (itemStarted) emit({ method: "item/started", params: { threadId: "thread-1", turnId: "turn-1", startedAtMs: Date.now(), item: itemStarted } });
      if (itemCompleted) emit({ method: "item/completed", params: { threadId: "thread-1", turnId: "turn-1", item: itemCompleted } });
      if (interaction) emit({ id: "server-1", method: interaction.method, params: interaction.params });
      if (dynamicToolCall) emit({ id: "tool-server-1", method: "item/tool/call", params: dynamicToolCall });
      if (completeOn === "start") complete();
    }
    if (message.method === "turn/steer") {
      emit({ id: message.id, result: {} });
      if (completeOn === "steer") complete();
    }
    if (message.method === "turn/interrupt") {
      emit({ id: message.id, result: {} });
      complete("interrupted");
    }
    if (message.id === "server-1" && Object.hasOwn(message, "result")) {
      if (completeOn === "response") complete();
    }
    if (message.id === "tool-server-1" && Object.hasOwn(message, "result")) {
      if (completeOn === "dynamic_tool") complete();
    }
  };

  child.pid = 4321;
  child.stdout = stdout;
  child.stderr = stderr;
  child.exitCode = null;
  child.signalCode = null;
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      stdinBuffer += String(chunk);
      let newline;
      while ((newline = stdinBuffer.indexOf("\n")) >= 0) {
        const line = stdinBuffer.slice(0, newline);
        stdinBuffer = stdinBuffer.slice(newline + 1);
        if (line.trim()) queueMicrotask(() => handle(JSON.parse(line)));
      }
      callback();
    },
  });
  child.kill = (signal = "SIGTERM") => {
    if (closed) return false;
    closed = true;
    child.signalCode = signal;
    queueMicrotask(() => child.emit("close", null, signal));
    return true;
  };
  return {
    child,
    messages,
    completeLogin: ({ loginId = "login-chatgpt", success = true, error = null } = {}) => emit({
      method: "account/login/completed",
      params: { loginId, success, error },
    }),
  };
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for fake Codex protocol state.");
}

test("CodexAppServerAdapter projects requestUserInput and resumes the same native turn", async () => {
  const fake = fakeCodexProcess({
    interaction: {
      method: "item/tool/requestUserInput",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "tool-1",
        isBlocking: true,
        questions: [{ id: "mode", header: "Mode", question: "Choose mode", isOther: false, isSecret: false, options: null }],
      },
    },
    completeOn: "response",
  });
  const events = [];
  const adapter = new CodexAppServerAdapter({ spawn: () => fake.child, exec: async () => ({ stdout: "codex 1" }) });
  const handle = adapter.start({ task: "finish", cwd: "/tmp/work", onEvent: (event) => events.push(event) });

  const interaction = await waitFor(() => events.find((event) => event.type === "interaction_request"));
  const approvalState = events.find((event) => event.type === "approval_state");
  assert.equal(approvalState.state.approval_policy, "on-request");
  assert.equal(approvalState.state.profile, "native-config");
  assert.equal(approvalState.state.approvals_reviewer, "user");
  assert.equal(approvalState.state.interactive, true);
  assert.equal(approvalState.state.response_capability, true);
  assert.equal(approvalState.state.session_grants, true);
  assert.equal(approvalState.state.auto_review, false);
  assert.equal(approvalState.state.active_permission_profile.id, ":workspace");
  assert.equal(interaction.kind, "user_input");
  assert.equal(Object.hasOwn(interaction, "sideEffectClass"), false);
  assert.equal(interaction.nativeRequestRef, "codex:server-1");
  assert.equal(interaction.nativeContract.provider, "codex");
  assert.equal(interaction.nativeContract.method, "item/tool/requestUserInput");
  assert.equal(interaction.nativeContract.response.shape, "answers");
  assert.deepEqual(interaction.nativeContract.response.question_ids, ["mode"]);
  assert.equal(await handle.respond({ nativeRequestRef: interaction.nativeRequestRef, response: "compatible" }), true);

  const result = await handle.done;
  assert.equal(result.status, "completed");
  assert.equal(result.session_id, "thread-1");
  assert.equal(result.final_text, "done");
  assert.deepEqual(fake.messages.find((message) => message.id === "server-1")?.result, {
    answers: { mode: { answers: ["compatible"] } },
  });
});

test("CodexAppServerAdapter preserves file-change grantRoot in the native interaction contract", async () => {
  const fake = fakeCodexProcess({
    interaction: {
      method: "item/fileChange/requestApproval",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "file-change-1",
        reason: "retry file change without sandbox",
        grantRoot: "/tmp/work",
      },
    },
    completeOn: "response",
  });
  const events = [];
  const adapter = new CodexAppServerAdapter({ spawn: () => fake.child, exec: async () => ({ stdout: "codex 1" }) });
  const handle = adapter.start({ task: "change one file", cwd: "/tmp/work", onEvent: (event) => events.push(event) });

  const interaction = await waitFor(() => events.find((event) => event.type === "interaction_request"));
  assert.equal(interaction.nativeContract.category, "file_change_approval");
  assert.equal(interaction.nativeContract.item_id, "file-change-1");
  assert.equal(interaction.nativeContract.grant_root, "/tmp/work");
  assert.equal(await handle.respond({ nativeRequestRef: interaction.nativeRequestRef, response: "accept" }), true);
  assert.equal((await handle.done).status, "completed");
});

test("CodexAppServerAdapter only classifies file changes inside cwd as workspace_only", async () => {
  const inside = fakeCodexProcess({
    itemStarted: { type: "fileChange", id: "file-inside", changes: [{ path: "/tmp/work/RESULT.txt", kind: { type: "add" }, diff: "ok\n" }] },
  });
  const insideEvents = [];
  const insideAdapter = new CodexAppServerAdapter({ spawn: () => inside.child, exec: async () => ({ stdout: "codex 1" }) });
  const insideHandle = insideAdapter.start({ task: "classify", cwd: "/tmp/work", onEvent: (event) => insideEvents.push(event) });
  const insideEffect = await waitFor(() => insideEvents.find((event) => event.type === "side_effect"));
  assert.equal(insideEffect.classification, "workspace_only");
  assert.deepEqual(insideEffect.detail, { item_id: "file-inside", paths: ["/tmp/work/RESULT.txt"] });
  insideHandle.cancel();
  await insideHandle.done;

  const outside = fakeCodexProcess({
    itemStarted: { type: "fileChange", id: "file-outside", changes: [{ path: "/tmp/OUTSIDE.txt", kind: { type: "add" }, diff: "bad\n" }] },
  });
  const outsideEvents = [];
  const outsideAdapter = new CodexAppServerAdapter({ spawn: () => outside.child, exec: async () => ({ stdout: "codex 1" }) });
  const outsideHandle = outsideAdapter.start({ task: "classify", cwd: "/tmp/work", onEvent: (event) => outsideEvents.push(event) });
  const outsideEffect = await waitFor(() => outsideEvents.find((event) => event.type === "side_effect"));
  assert.equal(outsideEffect.classification, "external_possible");
  outsideHandle.cancel();
  await outsideHandle.done;
});

test("CodexAppServerAdapter classifies completed native commands conservatively", async () => {
  const fake = fakeCodexProcess({
    itemStarted: { type: "commandExecution", id: "command-1", command: "curl https://example.com" },
    itemCompleted: { type: "commandExecution", id: "command-1", command: "curl https://example.com", status: "completed", commandActions: [{ type: "unknown", command: "curl https://example.com" }], exitCode: 0, durationMs: 10, aggregatedOutput: "" },
  });
  const events = [];
  const adapter = new CodexAppServerAdapter({ spawn: () => fake.child, exec: async () => ({ stdout: "codex 1" }) });
  const handle = adapter.start({ task: "classify", cwd: "/tmp/work", onEvent: (event) => events.push(event) });
  const effect = await waitFor(() => events.find((event) => event.type === "side_effect"));
  assert.equal(effect.classification, "external_possible");
  assert.equal(effect.source, "codex:item/commandExecution");
  assert.deepEqual(effect.detail, { item_id: "command-1", command_actions: ["unknown"] });
  handle.cancel();
  await handle.done;
});

test("CodexAppServerAdapter uses completed command evidence to avoid false external side effects", async () => {
  for (const [item, expected] of [
    [{
      type: "commandExecution", id: "read-1", command: "cat README.md", status: "completed",
      commandActions: [{ type: "read", command: "cat README.md", name: "README.md", path: "/tmp/work/README.md" }],
      exitCode: 0, durationMs: 2, aggregatedOutput: "ok",
    }, "none"],
    [{
      type: "commandExecution", id: "inspect-1",
      command: "/bin/bash -lc \"git status --short && printf '%s' '---CONTENT---' && od -An -t x1 RESULT.txt && printf '%s' '---TEXT---' && sed -n l RESULT.txt\"",
      status: "completed",
      commandActions: [{ type: "unknown", command: "git status --short && printf '%s' '---CONTENT---' && od -An -t x1 RESULT.txt && printf '%s' '---TEXT---' && sed -n l RESULT.txt" }],
      exitCode: 0, durationMs: 5, aggregatedOutput: "",
    }, "workspace_only"],
    [{
      type: "commandExecution", id: "sandbox-1", command: "touch RESULT.txt", status: "failed",
      commandActions: [{ type: "unknown", command: "touch RESULT.txt" }],
      exitCode: 1, durationMs: 0, aggregatedOutput: "bwrap: No permissions to create new namespace, likely because the kernel does not allow non-privileged user namespaces.\n",
    }, "none"],
  ]) {
    const fake = fakeCodexProcess({ itemStarted: { ...item, status: "inProgress" }, itemCompleted: item });
    const events = [];
    const adapter = new CodexAppServerAdapter({ spawn: () => fake.child, exec: async () => ({ stdout: "codex 1" }) });
    const handle = adapter.start({ task: "classify", cwd: "/tmp/work", onEvent: (event) => events.push(event) });
    const effect = await waitFor(() => events.find((event) => event.type === "side_effect"));
    assert.equal(effect.classification, expected);
    handle.cancel();
    await handle.done;
  }
});

test("CodexAppServerAdapter sends turn/steer against the active thread and turn", async () => {
  const fake = fakeCodexProcess({ completeOn: "steer" });
  const adapter = new CodexAppServerAdapter({ spawn: () => fake.child, exec: async () => ({ stdout: "codex 1" }) });
  const handle = adapter.start({ task: "start", cwd: "/tmp/work" });

  await waitFor(() => fake.messages.some((message) => message.method === "turn/start"));
  assert.equal(await handle.steer("focus on parser"), true);
  const result = await handle.done;
  const steer = fake.messages.find((message) => message.method === "turn/steer");
  assert.equal(steer.params.threadId, "thread-1");
  assert.equal(steer.params.expectedTurnId, "turn-1");
  assert.equal(steer.params.input[0].text, "focus on parser");
  assert.equal(result.status, "completed");
});

test("CodexAppServerAdapter cancels with turn/interrupt instead of killing the turn blindly", async () => {
  const fake = fakeCodexProcess();
  const adapter = new CodexAppServerAdapter({ spawn: () => fake.child, exec: async () => ({ stdout: "codex 1" }) });
  const handle = adapter.start({ task: "start", cwd: "/tmp/work" });

  await waitFor(() => fake.messages.some((message) => message.method === "turn/start"));
  assert.equal(handle.cancel(), true);
  const result = await handle.done;
  const interrupt = fake.messages.find((message) => message.method === "turn/interrupt");
  assert.equal(interrupt.params.threadId, "thread-1");
  assert.equal(interrupt.params.turnId, "turn-1");
  assert.equal(result.status, "cancelled");
  assert.equal(result.turn_end_reason, "interrupted");
});

test("CodexAppServerAdapter never starts a new turn when resumed native state is still active", async () => {
  const fake = fakeCodexProcess({ resumeStatus: { type: "active", activeFlags: ["waitingOnUserInput"] } });
  const adapter = new CodexAppServerAdapter({ spawn: () => fake.child, exec: async () => ({ stdout: "codex test" }) });
  const result = await adapter.start({ task: "must not duplicate", cwd: "/tmp/work", sessionId: "thread-1" }).done;

  assert.equal(result.status, "failed");
  assert.equal(result.error_code, "CODEX_THREAD_REATTACH_REQUIRED");
  assert.equal(fake.messages.some((message) => message.method === "turn/start"), false);
});

test("CodexAppServerAdapter probe verifies the app-server command surface", async () => {
  const calls = [];
  const adapter = new CodexAppServerAdapter({
    command: "/fake/codex",
    exec: async (_command, args) => {
      calls.push(args);
      return args[0] === "--version" ? { stdout: "codex 0.1\n" } : { stdout: "Run the app server" };
    },
  });

  const probe = await adapter.probe();
  assert.equal(probe.available, true);
  assert.equal(probe.version, "codex 0.1");
  assert.deepEqual(calls, [["--version"], ["app-server", "--help"]]);
  assert.ok(probe.capabilities.includes("same_turn_steer"));
  assert.ok(probe.capabilities.includes("interaction_response"));
  assert.ok(probe.capabilities.includes("context_retrieval"));
  assert.ok(probe.capabilities.includes("structured_output"));
  assert.equal(probe.approval_contract.provider, "codex");
  assert.equal(probe.approval_contract.interactive, true);
  assert.equal(probe.approval_contract.session_grants, true);
  assert.deepEqual(probe.approval_contract.approval_policy.supported, ["untrusted", "on-request", "never", "granular"]);
  assert.ok(probe.approval_contract.request_methods.includes("item/permissions/requestApproval"));
});

test("CodexAppServerAdapter exposes AIDE Context through native dynamic tools", async () => {
  const fake = fakeCodexProcess({
    dynamicToolCall: {
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-1",
      namespace: "aide_context",
      tool: "symbol",
      arguments: { name: "alpha", limit: 2 },
    },
    completeOn: "dynamic_tool",
  });
  const queries = [];
  const context = {
    query: async (operation, args) => {
      queries.push([operation, args]);
      return [{ path: "sample.js", line: 1, name: "alpha" }];
    },
  };
  const events = [];
  const adapter = new CodexAppServerAdapter({ spawn: () => fake.child, exec: async () => ({ stdout: "codex 1" }) });
  const handle = adapter.start({ task: "inspect alpha", cwd: "/tmp/work", context, onEvent: (event) => events.push(event) });

  const result = await handle.done;
  assert.equal(result.status, "completed");
  assert.deepEqual(queries, [["symbol", { name: "alpha", limit: 2 }]]);

  const threadStart = fake.messages.find((message) => message.method === "thread/start");
  const namespace = threadStart.params.dynamicTools.find((tool) => tool.type === "namespace" && tool.name === "aide_context");
  assert.deepEqual(namespace.tools.map((tool) => tool.name), ["search", "symbol", "references", "read", "current_truth", "evidence"]);

  const response = fake.messages.find((message) => message.id === "tool-server-1" && Object.hasOwn(message, "result"));
  assert.equal(response.result.success, true);
  assert.deepEqual(JSON.parse(response.result.contentItems[0].text), [{ path: "sample.js", line: 1, name: "alpha" }]);
  assert.ok(events.some((event) => event.type === "context_tool_call" && event.tool === "symbol"));
  assert.ok(events.some((event) => event.type === "context_tool_result" && event.tool === "symbol" && event.success === true));
});

test("CodexAppServerAdapter verifies and freezes a configured economy model target", async () => {
  const fake = fakeCodexProcess();
  const adapter = new CodexAppServerAdapter({
    spawn: () => fake.child,
    exec: async (_command, args) => args[0] === "--version" ? { stdout: "codex test\n" } : { stdout: "Run the app server" },
    profile: "economy",
    model: "gpt-5.6-luna",
    effort: "low",
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
    strategyPriority: { economy: 0 },
  });
  const probe = await adapter.probe();
  assert.equal(probe.available, true);
  assert.equal(probe.model, "gpt-5.6-luna");
  assert.equal(probe.reasoning_effort, "low");
  assert.deepEqual(probe.strategy_priority, { economy: 0 });
  assert.equal(probe.approval_contract.profile, "economy");
  assert.equal(probe.approval_contract.sandbox_mode, "workspace-write");
  assert.equal(probe.approval_contract.network_access, true);
  assert.deepEqual(probe.approval_contract.approval_policy.supported, ["on-request"]);
  assert.deepEqual(probe.resource_facts.rate_limits, {
    ordinary_usage_allowed: true,
    limits: [{
      limit_id: "codex",
      limit_name: null,
      normal_model_slug: null,
      primary: { used_percent: 12, resets_at: 12345, window_duration_mins: 300 },
      secondary: null,
      rate_limit_reached_type: null,
      spend_control_reached: false,
    }],
  });
  assert.equal(JSON.stringify(probe).includes("must-not-leak"), false);
});

test("CodexAppServerAdapter exposes a sanitized exact model/account catalog", async () => {
  const fake = fakeCodexProcess();
  const adapter = new CodexAppServerAdapter({ spawn: () => fake.child, exec: async () => ({ stdout: "codex test" }) });
  const catalog = await adapter.providerCatalog();

  assert.equal(catalog.provider, "codex");
  assert.deepEqual(catalog.account, { requires_openai_auth: true, connected: true, type: "chatgpt", email: "user@example.com", plan_type: "pro" });
  assert.deepEqual(catalog.auth, { methods: ["chatgpt", "device_code", "api_key"], secrets_write_only: true });
  assert.deepEqual(catalog.models.find((model) => model.id === "gpt-5.6-sol").reasoning_efforts, ["low", "medium", "high", "ultra"]);
  assert.equal(catalog.models.find((model) => model.id === "gpt-5.6-luna").default_reasoning_effort, "medium");
  assert.equal(catalog.collaboration_modes.some((mode) => mode.mode === "plan"), true);
  assert.equal(JSON.stringify(catalog).includes("must-not-leak"), false);
});

test("CodexAppServerAdapter keeps API keys write-only and drives native login flows", async () => {
  const apiFake = fakeCodexProcess();
  const apiAdapter = new CodexAppServerAdapter({ spawn: () => apiFake.child, exec: async () => ({ stdout: "codex test" }) });
  const apiResult = await apiAdapter.startLogin({ method: "api_key", apiKey: "sk-test-secret" });
  assert.deepEqual(apiResult, { provider: "codex", method: "api_key", status: "completed" });
  assert.equal(JSON.stringify(apiResult).includes("sk-test-secret"), false);
  assert.equal(apiFake.messages.find((message) => message.method === "account/login/start").params.apiKey, "sk-test-secret");

  const chatFake = fakeCodexProcess();
  const chatAdapter = new CodexAppServerAdapter({ spawn: () => chatFake.child, exec: async () => ({ stdout: "codex test" }) });
  const flow = await chatAdapter.startLogin({ method: "chatgpt" });
  assert.equal(flow.status, "waiting_user");
  assert.equal(flow.auth_url, "https://example.com/auth");
  chatFake.completeLogin();
  await waitFor(() => chatAdapter.loginStatus(flow.login_id).status === "completed");
  assert.equal(chatAdapter.loginStatus(flow.login_id).error, undefined);

  const deviceFake = fakeCodexProcess();
  const deviceAdapter = new CodexAppServerAdapter({ spawn: () => deviceFake.child, exec: async () => ({ stdout: "codex test" }) });
  const device = await deviceAdapter.startLogin({ method: "device_code" });
  assert.equal(device.verification_url, "https://example.com/device");
  assert.equal(device.user_code, "ABCD-EFGH");
  assert.equal((await deviceAdapter.cancelLogin(device.login_id)).status, "cancelled");
  assert.equal(deviceFake.messages.some((message) => message.method === "account/login/cancel" && message.params.loginId === "login-device"), true);
});

test("CodexAppServerAdapter applies one frozen per-run model/effort without changing the profile safety policy", async () => {
  const fake = fakeCodexProcess({ completeOn: "start" });
  const adapter = new CodexAppServerAdapter({
    spawn: () => fake.child,
    exec: async () => ({ stdout: "codex test" }),
    profile: "capability",
    model: "gpt-5.6-sol",
    effort: "ultra",
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
  });
  const result = await adapter.start({
    task: "run with explicit model",
    cwd: "/tmp/work",
    model: "gpt-5.6-luna",
    reasoningEffort: "medium",
  }).done;
  assert.equal(result.status, "completed");
  const threadStart = fake.messages.find((message) => message.method === "thread/start");
  const turnStart = fake.messages.find((message) => message.method === "turn/start");
  assert.equal(threadStart.params.model, "gpt-5.6-luna");
  assert.equal(threadStart.params.sandbox, "workspace-write");
  assert.equal(threadStart.params.approvalPolicy, "on-request");
  assert.equal(turnStart.params.model, "gpt-5.6-luna");
  assert.equal(turnStart.params.effort, "medium");
});

test("CodexAppServerAdapter uses the Windows cmd shim and persists a process-tree root", async () => {
  const fake = fakeCodexProcess({ completeOn: "start" });
  let launch;
  const adapter = new CodexAppServerAdapter({
    platform: "win32",
    command: "codex.cmd",
    spawn: (command, args, options) => { launch = { command, args, options }; return fake.child; },
    exec: async () => ({ stdout: "codex test" }),
  });
  const handle = adapter.start({ task: "windows launch", cwd: "C:\\work" });
  const result = await handle.done;
  assert.equal(result.status, "completed");
  assert.equal(launch.command.toLowerCase().endsWith("cmd.exe"), true);
  assert.deepEqual(launch.args.slice(0, 6), ["/d", "/s", "/c", "codex.cmd", "app-server", "--stdio"]);
  assert.equal(launch.options.windowsHide, true);
  assert.equal(handle.process_group_id, null);
  assert.equal(handle.process_tree_root_pid, fake.child.pid);
});

test("CodexAppServerAdapter maps the verified Plan collaboration target onto turn/start", async () => {
  const fake = fakeCodexProcess({
    completeOn: "start",
    terminalItems: [{ type: "plan", id: "turn-1-plan", text: "Plan text\nAIDE_PLAN_SMOKE_OK\n" }],
  });
  const events = [];
  const adapter = new CodexAppServerAdapter({
    spawn: () => fake.child,
    exec: async () => ({ stdout: "codex test" }),
    profile: "plan",
    model: "gpt-5.6-sol",
    effort: "medium",
    collaborationMode: "plan",
    sandbox: "read-only",
    approvalPolicy: "never",
    targetRole: "planning",
  });
  const handle = adapter.start({ task: "plan only", cwd: "/tmp/work", onEvent: (event) => events.push(event) });
  const result = await handle.done;
  assert.equal(result.status, "completed");
  assert.equal(result.final_text, "Plan text\nAIDE_PLAN_SMOKE_OK\n");
  const threadStart = fake.messages.find((message) => message.method === "thread/start");
  const turnStart = fake.messages.find((message) => message.method === "turn/start");
  assert.equal(threadStart.params.model, "gpt-5.6-sol");
  assert.equal(threadStart.params.sandbox, "read-only");
  assert.equal(threadStart.params.approvalPolicy, "never");
  assert.equal(turnStart.params.effort, "medium");
  assert.deepEqual(turnStart.params.collaborationMode, {
    mode: "plan",
    settings: { model: "gpt-5.6-sol", reasoning_effort: "medium", developer_instructions: null },
  });
  assert.ok(events.some((event) => event.type === "approval_state" && event.state.profile === "plan" && event.state.sandbox_mode === "read-only"));
  assert.ok(events.some((event) => event.type === "approval_state" && event.state.network_access === false));
});

test("CodexAppServerAdapter hydrates Plan terminal text when turn/completed omits items", async () => {
  const fake = fakeCodexProcess({
    completeOn: "start",
    terminalItems: [],
    threadReadItems: [{ type: "plan", id: "turn-1-plan", text: "Hydrated semantic plan" }],
  });
  const adapter = new CodexAppServerAdapter({
    spawn: () => fake.child,
    exec: async () => ({ stdout: "codex test" }),
    profile: "plan",
    model: "gpt-5.6-sol",
    effort: "medium",
    collaborationMode: "plan",
    sandbox: "read-only",
    approvalPolicy: "never",
    targetRole: "planning",
  });

  const result = await adapter.start({ task: "plan", cwd: "/tmp/work" }).done;
  assert.equal(result.status, "completed");
  assert.equal(result.final_text, "Hydrated semantic plan");
  assert.ok(fake.messages.some((message) => message.method === "thread/read" && message.params.includeTurns === true));
});

test("CodexAppServerAdapter preserves native thread token usage without inventing per-Attempt cost", async () => {
  const nativeUsage = {
    last: { inputTokens: 100, cachedInputTokens: 70, cacheWriteInputTokens: 5, outputTokens: 20, reasoningOutputTokens: 8, totalTokens: 120 },
    total: { inputTokens: 400, cachedInputTokens: 280, cacheWriteInputTokens: 20, outputTokens: 80, reasoningOutputTokens: 32, totalTokens: 480 },
    modelContextWindow: 258400,
  };
  const fake = fakeCodexProcess({ completeOn: "start", tokenUsage: nativeUsage });
  const events = [];
  const adapter = new CodexAppServerAdapter({ spawn: () => fake.child, exec: async () => ({ stdout: "codex test" }) });
  const result = await adapter.start({ task: "measure", cwd: "/tmp/work", onEvent: (event) => events.push(event) }).done;

  assert.deepEqual(result.usage, {
    provider: "codex",
    scope: "thread_snapshot",
    thread_id: "thread-1",
    turn_id: "turn-1",
    token_usage: nativeUsage,
  });
  assert.ok(events.some((event) => event.type === "usage" && event.scope === "thread_snapshot"));
});

test("CodexAppServerAdapter projects native context compaction as context-health evidence", async () => {
  const fake = fakeCodexProcess({ itemStarted: { type: "contextCompaction", id: "compact-1" }, completeOn: "start" });
  const events = [];
  const adapter = new CodexAppServerAdapter({ spawn: () => fake.child, exec: async () => ({ stdout: "codex test" }) });
  const result = await adapter.start({ task: "compact", cwd: "/tmp/work", onEvent: (event) => events.push(event) }).done;

  assert.equal(result.status, "completed");
  assert.deepEqual(events.filter((event) => event.type === "context_health"), [{
    type: "context_health",
    event: "compaction",
    source: "codex:item/contextCompaction",
    turnId: "turn-1",
  }]);
});

test("CodexAppServerAdapter projects native safety model reroutes without countermanding them", async () => {
  const fake = fakeCodexProcess({ modelReroute: { fromModel: "gpt-a", toModel: "gpt-b", reason: "highRiskCyberActivity" }, completeOn: "start" });
  const events = [];
  const adapter = new CodexAppServerAdapter({ spawn: () => fake.child, exec: async () => ({ stdout: "codex test" }) });
  const result = await adapter.start({ task: "reroute", cwd: "/tmp/work", onEvent: (event) => events.push(event) }).done;

  assert.equal(result.status, "completed");
  assert.deepEqual(events.filter((event) => event.type === "model_reroute"), [{
    type: "model_reroute",
    fromModel: "gpt-a",
    toModel: "gpt-b",
    reason: "highRiskCyberActivity",
    turnId: "turn-1",
  }]);
});

test("CodexAppServerAdapter forwards native outputSchema to turn/start", async () => {
  const fake = fakeCodexProcess({ completeOn: "start" });
  const adapter = new CodexAppServerAdapter({ spawn: () => fake.child, exec: async () => ({ stdout: "codex test" }) });
  const outputSchema = {
    type: "object",
    additionalProperties: false,
    required: ["decision"],
    properties: { decision: { enum: ["single", "decompose"] } },
  };
  const result = await adapter.start({ task: "decide", cwd: "/tmp/work", outputSchema }).done;

  assert.equal(result.status, "completed");
  const turnStart = fake.messages.find((message) => message.method === "turn/start");
  assert.deepEqual(turnStart.params.outputSchema, outputSchema);
});

test("CodexAppServerAdapter advertises user input only on the verified Plan target", async () => {
  const fake = fakeCodexProcess();
  const plan = new CodexAppServerAdapter({
    spawn: () => fake.child,
    exec: async (_command, args) => args[0] === "--version" ? { stdout: "codex test\n" } : { stdout: "Run the app server" },
    model: "gpt-5.6-sol",
    effort: "medium",
    collaborationMode: "plan",
    sandbox: "read-only",
    approvalPolicy: "never",
    targetRole: "planning",
  });
  const planProbe = await plan.probe();
  assert.ok(planProbe.capabilities.includes("user_input_requests"));

  const generic = new CodexAppServerAdapter({ exec: async () => ({ stdout: "Run the app server" }) });
  const genericProbe = await generic.probe();
  assert.equal(genericProbe.capabilities.includes("user_input_requests"), false);
});
