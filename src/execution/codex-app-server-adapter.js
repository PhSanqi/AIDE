import { execFile as execFileCallback, spawn as spawnProcess } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { defaultCodexCommand, nativeCommandSpec, terminateProcessTree } from "../platform/runtime.js";

const execFile = promisify(execFileCallback);
const MAX_STDERR_BYTES = 64 * 1024;
const CATALOG_CACHE_MS = 5_000;
const catalogCache = new Map();

function createAppServerClient(command, spawn, { onNotification = () => {}, platform = process.platform } = {}) {
  const launch = nativeCommandSpec(command, ["app-server", "--stdio"], { platform });
  const child = spawn(launch.command, launch.args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: platform === "win32" });
  let buffer = "";
  let nextId = 1;
  let closed = false;
  const pending = new Map();
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const rawRequest = (method, params = {}) => new Promise((resolveRequest, rejectRequest) => {
    const id = nextId++;
    pending.set(String(id), { resolve: resolveRequest, reject: rejectRequest, method });
    send({ id, method, params });
  });
  const fail = (error) => {
    if (closed) return;
    closed = true;
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
  child.once("error", fail);
  child.once("close", () => fail(Object.assign(new Error("Codex app-server closed."), { code: "CODEX_APP_SERVER_CLOSED" })));
  child.stdin?.on("error", fail);
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); }
      catch { continue; }
      if (message.id !== undefined && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) {
        const waiter = pending.get(String(message.id));
        if (!waiter) continue;
        pending.delete(String(message.id));
        if (message.error) waiter.reject(Object.assign(new Error(message.error.message ?? `${waiter.method} failed.`), { code: "CODEX_APP_SERVER_REQUEST_FAILED" }));
        else waiter.resolve(message.result);
      } else if (typeof message.method === "string") {
        onNotification(message);
      }
    }
  });
  const ready = rawRequest("initialize", {
    clientInfo: { name: "aide", title: "AIDE", version: "0.0.0" },
    capabilities: { experimentalApi: true, requestAttestation: false },
  }).then((value) => { send({ method: "initialized" }); return value; });
  return {
    child,
    request: async (method, params = {}) => { await ready; return rawRequest(method, params); },
    close: () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (platform === "win32" && spawn === spawnProcess) terminateProcessTree(child.pid, { platform });
      else child.kill("SIGTERM");
    },
  };
}

function approvalContract({ profile, approvalPolicy, sandbox }) {
  const networkAccess = sandbox === "read-only" ? false : sandbox === "workspace-write" ? true : null;
  return {
    provider: "codex",
    transport: "app-server-v2",
    profile,
    interactive: approvalPolicy === "never" ? false : true,
    response_capability: true,
    session_grants: true,
    ...(sandbox ? { sandbox_mode: sandbox } : {}),
    ...(networkAccess === null ? {} : { network_access: networkAccess }),
    approval_policy: {
      source: approvalPolicy ? "configured-target" : "native-config",
      supported: approvalPolicy ? [approvalPolicy] : ["untrusted", "on-request", "never", "granular"],
    },
    reviewers: ["user", "auto_review", "guardian_subagent"],
    request_methods: [
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
      "item/permissions/requestApproval",
      "execCommandApproval",
      "applyPatchApproval",
    ],
  };
}

function normalizeSandboxMode(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.type === "readOnly") return "read-only";
  if (value.type === "workspaceWrite") return "workspace-write";
  if (value.type === "dangerFullAccess") return "danger-full-access";
  return null;
}

function rateLimitWindow(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Number.isInteger(value.usedPercent)) return null;
  return {
    used_percent: value.usedPercent,
    resets_at: Number.isInteger(value.resetsAt) ? value.resetsAt : null,
    window_duration_mins: Number.isInteger(value.windowDurationMins) ? value.windowDurationMins : null,
  };
}

function sanitizeRateLimits(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value.rateLimitsByLimitId && typeof value.rateLimitsByLimitId === "object" && !Array.isArray(value.rateLimitsByLimitId)
    ? Object.values(value.rateLimitsByLimitId)
    : value.rateLimits ? [value.rateLimits] : [];
  const limits = source.filter((item) => item && typeof item === "object" && !Array.isArray(item)).map((item) => ({
    limit_id: typeof item.limitId === "string" ? item.limitId : null,
    limit_name: typeof item.limitName === "string" ? item.limitName : null,
    normal_model_slug: typeof item.normalModelSlug === "string" ? item.normalModelSlug : null,
    primary: rateLimitWindow(item.primary),
    secondary: rateLimitWindow(item.secondary),
    rate_limit_reached_type: typeof item.rateLimitReachedType === "string" ? item.rateLimitReachedType : null,
    spend_control_reached: typeof item.spendControlReached === "boolean" ? item.spendControlReached : null,
  })).sort((a, b) => String(a.limit_id).localeCompare(String(b.limit_id)));
  if (limits.length === 0 && typeof value.ordinaryUsageAllowed !== "boolean") return null;
  return {
    ordinary_usage_allowed: typeof value.ordinaryUsageAllowed === "boolean" ? value.ordinaryUsageAllowed : null,
    limits,
  };
}

function killOwnedProcess(child, signal, ownsProcessGroup, ownsProcessTree, platform = process.platform) {
  if (ownsProcessTree && Number.isInteger(child.pid) && child.pid > 0) return terminateProcessTree(child.pid, { platform });
  if (ownsProcessGroup && Number.isInteger(child.pid) && child.pid > 0) {
    try { process.kill(-child.pid, signal); return true; }
    catch (error) { if (error?.code !== "ESRCH") throw error; }
  }
  return child.kill(signal);
}

async function queryCatalog(command, spawn, { timeoutMs = 10_000, cache = true, platform = process.platform } = {}) {
  const cacheKey = cache && spawn === spawnProcess ? command : null;
  const cached = cacheKey ? catalogCache.get(cacheKey) : null;
  if (cached && Date.now() - cached.createdAt < CATALOG_CACHE_MS) return cached.promise;

  const promise = new Promise((resolve, reject) => {
    const client = createAppServerClient(command, spawn, { platform });
    const timer = setTimeout(() => finish(Object.assign(new Error("Codex catalog probe timed out."), { code: "CODEX_CATALOG_PROBE_TIMEOUT" })), timeoutMs);
    timer.unref?.();

    const cleanup = () => {
      clearTimeout(timer);
      client.close();
    };
    const finish = (error, value) => {
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    void (async () => {
      try {
        const rateLimitsPromise = Promise.race([
          client.request("account/rateLimits/read", {}).catch(() => null),
          new Promise((resolveTimeout) => {
            const optionalTimer = setTimeout(() => resolveTimeout(null), 1_500);
            optionalTimer.unref?.();
          }),
        ]);
        const [models, modes, account, rateLimits] = await Promise.all([
          client.request("model/list", { includeHidden: false }),
          client.request("collaborationMode/list", {}),
          client.request("account/read", { refreshToken: false }).catch(() => null),
          rateLimitsPromise,
        ]);
        finish(null, { models: models?.data ?? [], collaboration_modes: modes?.data ?? [], account: account ?? null, rate_limits: sanitizeRateLimits(rateLimits) });
      } catch (error) { finish(error); }
    })();
  });
  if (cacheKey) catalogCache.set(cacheKey, { createdAt: Date.now(), promise });
  return promise;
}

function publicAccount(value) {
  const account = value?.account;
  return {
    requires_openai_auth: value?.requiresOpenaiAuth === true,
    connected: account !== null && account !== undefined,
    ...(account?.type ? { type: account.type } : {}),
    ...(typeof account?.email === "string" ? { email: account.email } : {}),
    ...(typeof account?.planType === "string" ? { plan_type: account.planType } : {}),
  };
}

function publicModel(model) {
  return {
    id: model.id ?? model.model,
    model: model.model ?? model.id,
    display_name: model.displayName ?? model.model ?? model.id,
    description: model.description ?? null,
    default_reasoning_effort: model.defaultReasoningEffort ?? null,
    reasoning_efforts: Array.isArray(model.supportedReasoningEfforts)
      ? model.supportedReasoningEfforts.map((item) => item?.reasoningEffort).filter((value) => typeof value === "string")
      : [],
    is_default: model.isDefault === true,
    input_modalities: Array.isArray(model.inputModalities) ? [...model.inputModalities] : [],
    multi_agent_version: typeof model.multiAgentVersion === "string" ? model.multiAgentVersion : null,
  };
}

function publicLoginFlow(flow) {
  return {
    provider: "codex",
    login_id: flow.login_id,
    method: flow.method,
    status: flow.status,
    ...(flow.auth_url ? { auth_url: flow.auth_url } : {}),
    ...(flow.verification_url ? { verification_url: flow.verification_url } : {}),
    ...(flow.user_code ? { user_code: flow.user_code } : {}),
    ...(flow.error ? { error: flow.error } : {}),
    started_at: flow.started_at,
    completed_at: flow.completed_at ?? null,
  };
}

const CONTEXT_DYNAMIC_TOOLS = [{
  type: "namespace",
  name: "aide_context",
  description: "Read bounded, current facts from the AIDE Attempt workspace. Use these tools instead of re-reading broad project trees.",
  tools: [
    {
      type: "function",
      name: "search",
      description: "Search bounded workspace paths and text.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "symbol",
      description: "Find bounded symbol definitions in the current workspace.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "references",
      description: "Find bounded references to one symbol in the current workspace.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "read",
      description: "Read a bounded line range from one workspace-relative text file.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          startLine: { type: "integer", minimum: 1 },
          maxLines: { type: "integer", minimum: 1, maximum: 200 },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "current_truth",
      description: "Read bounded accepted AIDE Current Truth updates from durable project state.",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: 100 } },
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "evidence",
      description: "Read bounded prior terminal Attempt evidence and decision summaries for one AIDE Task.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
    },
  ],
}];

function appendBounded(current, chunk, limit = MAX_STDERR_BYTES) {
  const next = `${current}${chunk}`;
  return Buffer.byteLength(next, "utf8") <= limit ? next : next.slice(-limit);
}

function normalizeDecision(response, { legacy = false } = {}) {
  const value = typeof response === "string" ? response.trim() : response;
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (legacy) {
    if (["allow", "accept", "approved"].includes(value)) return "approved";
    if (["allow_session", "acceptForSession", "approved_for_session"].includes(value)) return "approved_for_session";
    if (["deny", "decline"].includes(value)) return { denied: { rejection: "Denied by AIDE user response." } };
    if (["cancel", "abort"].includes(value)) return "abort";
  } else {
    if (["allow", "accept"].includes(value)) return "accept";
    if (["allow_session", "acceptForSession"].includes(value)) return "acceptForSession";
    if (["deny", "decline"].includes(value)) return "decline";
    if (value === "cancel") return "cancel";
  }
  throw Object.assign(new Error("Unsupported Codex approval response."), { code: "CODEX_INTERACTION_RESPONSE_INVALID" });
}

function requestSummary(method, params = {}) {
  if (method === "item/tool/requestUserInput") {
    return (params.questions ?? []).map((question) => `${question.header}: ${question.question}`).join(" | ") || "Codex requested user input.";
  }
  if (method === "item/commandExecution/requestApproval") return params.reason ?? params.command ?? "Codex requested command approval.";
  if (method === "item/fileChange/requestApproval") return params.reason ?? "Codex requested file-change approval.";
  if (method === "item/permissions/requestApproval") return params.reason ?? "Codex requested additional permissions.";
  if (method === "execCommandApproval") return params.reason ?? (Array.isArray(params.command) ? params.command.join(" ") : null) ?? "Codex requested command approval.";
  if (method === "applyPatchApproval") return params.reason ?? "Codex requested patch approval.";
  return null;
}

function interactionKind(method) {
  if (method === "item/tool/requestUserInput") return "user_input";
  if ([
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/permissions/requestApproval",
    "execCommandApproval",
    "applyPatchApproval",
  ].includes(method)) return "permission";
  return null;
}

function nativeInteractionContract(method, params = {}) {
  const base = { provider: "codex", transport: "app-server-v2", method };
  if (method === "item/tool/requestUserInput") {
    return {
      ...base,
      category: "user_input",
      response: {
        shape: "answers",
        question_ids: (params.questions ?? []).map((question) => question.id).filter((id) => typeof id === "string"),
      },
    };
  }
  if (method === "item/commandExecution/requestApproval") {
    return {
      ...base,
      category: "command_execution_approval",
      response: {
        shape: "decision",
        scalar_values: ["accept", "acceptForSession", "decline", "cancel"],
        structured_variants: ["acceptWithExecpolicyAmendment", "applyNetworkPolicyAmendment"],
      },
    };
  }
  if (method === "item/fileChange/requestApproval") {
    return {
      ...base,
      category: "file_change_approval",
      item_id: typeof params.itemId === "string" ? params.itemId : null,
      grant_root: typeof params.grantRoot === "string" ? params.grantRoot : null,
      response: { shape: "decision", scalar_values: ["accept", "acceptForSession", "decline", "cancel"] },
    };
  }
  if (method === "item/permissions/requestApproval") {
    return {
      ...base,
      category: "permission_profile_approval",
      response: {
        shape: "permissions_scope",
        required: ["permissions", "scope"],
        scope_values: ["turn", "session"],
        optional: ["strictAutoReview"],
      },
    };
  }
  if (method === "execCommandApproval") {
    return {
      ...base,
      category: "legacy_command_approval",
      response: { shape: "decision", scalar_values: ["approved", "approved_for_session", "denied", "abort"] },
    };
  }
  if (method === "applyPatchApproval") {
    return {
      ...base,
      category: "legacy_patch_approval",
      response: { shape: "decision", scalar_values: ["approved", "approved_for_session", "denied", "abort"] },
    };
  }
  return { ...base, category: "unknown", response: { shape: "native" } };
}

function withinWorkspace(cwd, target) {
  if (typeof target !== "string" || target.length === 0) return false;
  const rel = relative(resolve(cwd), resolve(cwd, target));
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function fileChangePaths(item) {
  return Array.isArray(item?.changes)
    ? item.changes.map((change) => change?.path).filter((path) => typeof path === "string" && path.length > 0)
    : [];
}

function commandActionTypes(item) {
  return Array.isArray(item?.commandActions)
    ? item.commandActions.map((action) => action?.type).filter((type) => typeof type === "string")
    : [];
}

function simpleInspectionCommandClass(item) {
  const actions = Array.isArray(item?.commandActions) ? item.commandActions : [];
  if (actions.length > 0 && actions.every((action) => ["read", "listFiles", "search"].includes(action?.type))) return "none";
  if (item?.status === "failed"
    && item?.durationMs === 0
    && typeof item?.aggregatedOutput === "string"
    && item.aggregatedOutput.startsWith("bwrap: No permissions to create new namespace")) return "none";

  const command = actions.length === 1 && actions[0]?.type === "unknown" ? actions[0].command : item?.command;
  if (typeof command !== "string" || command.length === 0 || /[;|<>\`$()\r\n]/.test(command)) return "external_possible";
  let classification = "none";
  for (const segment of command.split(/\s*&&\s*/)) {
    const value = segment.trim();
    if (/^git\s+status(?:\s|$)/.test(value)) classification = "workspace_only";
    else if (/^printf(?:\s|$)/.test(value) || /^od(?:\s|$)/.test(value) || /^sed\s+-n\s+l(?:\s|$)/.test(value)) continue;
    else return "external_possible";
  }
  return classification;
}

function sideEffectClass(item, cwd) {
  if (item?.type === "fileChange") {
    const paths = fileChangePaths(item);
    return paths.length > 0 && paths.every((path) => withinWorkspace(cwd, path)) ? "workspace_only" : "external_possible";
  }
  if (item?.type === "commandExecution") return simpleInspectionCommandClass(item);
  if (["mcpToolCall", "imageGeneration"].includes(item?.type)) return "external_possible";
  if (["userMessage", "agentMessage", "functionCallOutput", "plan", "reasoning", "dynamicToolCall", "webSearch", "imageView", "sleep", "enteredReviewMode", "exitedReviewMode", "contextCompaction"].includes(item?.type)) return null;
  if (typeof item?.type === "string") return "external_possible";
  return null;
}

function normalizeInteractionResponse(request, response) {
  const { method, params = {} } = request;
  if (method === "item/tool/requestUserInput") {
    if (response && typeof response === "object" && !Array.isArray(response) && response.answers) return response;
    if ((params.questions ?? []).length !== 1) {
      throw Object.assign(new Error("Multiple Codex questions require a structured answers object."), { code: "CODEX_INTERACTION_RESPONSE_INVALID" });
    }
    const questionId = params.questions[0].id;
    const answers = Array.isArray(response) ? response.map(String) : [String(response ?? "")];
    return { answers: { [questionId]: { answers } } };
  }
  if (["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(method)) {
    return { decision: normalizeDecision(response) };
  }
  if (["execCommandApproval", "applyPatchApproval"].includes(method)) {
    return { decision: normalizeDecision(response, { legacy: true }) };
  }
  if (method === "item/permissions/requestApproval") {
    if (response && typeof response === "object" && !Array.isArray(response) && response.permissions && ["turn", "session"].includes(response.scope)) return response;
    throw Object.assign(new Error("Codex permissions approval requires native { permissions, scope } response data."), { code: "CODEX_INTERACTION_RESPONSE_INVALID" });
  }
  throw Object.assign(new Error(`Unsupported Codex server request: ${method}`), { code: "CODEX_SERVER_REQUEST_UNSUPPORTED" });
}

function lastFinalText(turn, fallback = null, { allowPlan = false } = {}) {
  const items = (turn?.items ?? []).filter((item) => typeof item?.text === "string"
    && (item.type === "agentMessage" || (allowPlan && item.type === "plan")));
  return items.at(-1)?.text ?? fallback;
}

export class CodexAppServerAdapter {
  constructor({
    command = process.env.AIDE_CODEX_COMMAND ?? defaultCodexCommand(),
    spawn = spawnProcess,
    exec = execFile,
    profile = "native-config",
    model = null,
    effort = null,
    collaborationMode = null,
    sandbox = null,
    approvalPolicy = null,
    targetRole = "execution",
    strategyPriority = null,
    platform = process.platform,
  } = {}) {
    if (typeof profile !== "string" || profile.length === 0) throw new TypeError("Codex profile must be a non-empty string.");
    if (model !== null && (typeof model !== "string" || model.length === 0)) throw new TypeError("Codex model must be a non-empty string when provided.");
    if (effort !== null && (typeof effort !== "string" || effort.length === 0)) throw new TypeError("Codex effort must be a non-empty string when provided.");
    if (collaborationMode !== null && !["default", "plan"].includes(collaborationMode)) throw new TypeError("Codex collaborationMode must be default or plan.");
    if (sandbox !== null && !["read-only", "workspace-write", "danger-full-access"].includes(sandbox)) throw new TypeError("Codex sandbox must be read-only, workspace-write, or danger-full-access.");
    if (approvalPolicy !== null && !["untrusted", "on-request", "never"].includes(approvalPolicy)) throw new TypeError("Codex approvalPolicy must be untrusted, on-request, or never.");
    if (!['execution', 'planning', 'verification'].includes(targetRole)) throw new TypeError("Codex targetRole must be execution, planning, or verification.");
    if (strategyPriority !== null && (!strategyPriority || typeof strategyPriority !== "object" || Array.isArray(strategyPriority)
      || Object.entries(strategyPriority).some(([key, value]) => !["economy", "capability"].includes(key) || !Number.isInteger(value) || value < 0))) {
      throw new TypeError("Codex strategyPriority must contain non-negative integer economy/capability priorities.");
    }
    this.command = command;
    this.spawn = spawn;
    this.exec = exec;
    this.profile = profile;
    this.model = model;
    this.effort = effort;
    this.collaborationMode = collaborationMode;
    this.sandbox = sandbox;
    this.approvalPolicy = approvalPolicy;
    this.targetRole = targetRole;
    this.strategyPriority = strategyPriority === null ? null : structuredClone(strategyPriority);
    this.platform = platform;
    this.loginFlows = new Map();
  }

  async providerCatalog() {
    const catalog = await queryCatalog(this.command, this.spawn, { platform: this.platform });
    return {
      provider: "codex",
      account: publicAccount(catalog.account),
      auth: { methods: ["chatgpt", "device_code", "api_key"], secrets_write_only: true },
      models: catalog.models.map(publicModel),
      collaboration_modes: catalog.collaboration_modes.map((mode) => ({
        mode: mode.mode,
        name: mode.name ?? mode.mode,
        model: mode.model ?? null,
        reasoning_effort: mode.reasoning_effort ?? null,
      })),
      rate_limits: structuredClone(catalog.rate_limits),
    };
  }

  async startLogin({ method = "chatgpt", apiKey = null } = {}) {
    if (!["chatgpt", "device_code", "api_key"].includes(method)) throw new TypeError("Codex login method must be chatgpt, device_code, or api_key.");
    if ([...this.loginFlows.values()].some((flow) => flow.status === "waiting_user")) {
      throw Object.assign(new Error("A Codex login flow is already waiting for user authorization."), { code: "CODEX_LOGIN_IN_PROGRESS" });
    }
    if (method === "api_key") {
      if (typeof apiKey !== "string" || apiKey.trim().length === 0) throw new TypeError("apiKey is required for Codex API-key login.");
      const client = createAppServerClient(this.command, this.spawn, { platform: this.platform });
      try {
        await client.request("account/login/start", { type: "apiKey", apiKey });
        catalogCache.delete(this.command);
        return { provider: "codex", method: "api_key", status: "completed" };
      } finally { client.close(); }
    }

    let flow = null;
    let earlyCompletion = null;
    const complete = (notification) => {
      if (!flow) { earlyCompletion = notification; return; }
      if (notification?.params?.loginId !== null && notification?.params?.loginId !== undefined && notification.params.loginId !== flow.login_id) return;
      flow.status = notification?.params?.success === true ? "completed" : "failed";
      flow.error = typeof notification?.params?.error === "string" ? notification.params.error : null;
      flow.completed_at = new Date().toISOString();
      catalogCache.delete(this.command);
      flow.client.close();
    };
    const client = createAppServerClient(this.command, this.spawn, {
      platform: this.platform,
      onNotification: (message) => { if (message.method === "account/login/completed") complete(message); },
    });
    try {
      const response = await client.request("account/login/start", method === "chatgpt"
        ? { type: "chatgpt", useHostedLoginSuccessPage: true, codexStreamlinedLogin: true }
        : { type: "chatgptDeviceCode" });
      flow = {
        login_id: response.loginId,
        method,
        status: "waiting_user",
        auth_url: response.authUrl ?? null,
        verification_url: response.verificationUrl ?? null,
        user_code: response.userCode ?? null,
        error: null,
        started_at: new Date().toISOString(),
        completed_at: null,
        client,
      };
      this.loginFlows.set(flow.login_id, flow);
      if (earlyCompletion) complete(earlyCompletion);
      return publicLoginFlow(flow);
    } catch (error) {
      client.close();
      throw error;
    }
  }

  loginStatus(loginId) {
    const flow = this.loginFlows.get(loginId);
    if (!flow) throw Object.assign(new Error(`Unknown Codex login flow: ${loginId}`), { code: "CODEX_LOGIN_NOT_FOUND" });
    return publicLoginFlow(flow);
  }

  async cancelLogin(loginId) {
    const flow = this.loginFlows.get(loginId);
    if (!flow) throw Object.assign(new Error(`Unknown Codex login flow: ${loginId}`), { code: "CODEX_LOGIN_NOT_FOUND" });
    if (!["completed", "failed", "cancelled"].includes(flow.status)) {
      await flow.client.request("account/login/cancel", { loginId });
      flow.status = "cancelled";
      flow.completed_at = new Date().toISOString();
      flow.client.close();
    }
    return publicLoginFlow(flow);
  }

  async logout() {
    this.closeProviderFlows();
    const client = createAppServerClient(this.command, this.spawn, { platform: this.platform });
    try {
      await client.request("account/logout", {});
      catalogCache.delete(this.command);
      return { provider: "codex", status: "logged_out" };
    } finally { client.close(); }
  }

  closeProviderFlows() {
    for (const flow of this.loginFlows.values()) {
      if (flow.status === "waiting_user") {
        flow.status = "cancelled";
        flow.completed_at = new Date().toISOString();
        flow.client.close();
      }
    }
  }

  async probe() {
    try {
      const versionLaunch = nativeCommandSpec(this.command, ["--version"], { platform: this.platform });
      const helpLaunch = nativeCommandSpec(this.command, ["app-server", "--help"], { platform: this.platform });
      const [{ stdout = "" }, help] = await Promise.all([
        this.exec(versionLaunch.command, versionLaunch.args, { timeout: 3_000, windowsHide: this.platform === "win32" }),
        this.exec(helpLaunch.command, helpLaunch.args, { timeout: 3_000, windowsHide: this.platform === "win32" }),
      ]);
      const surfaceAvailable = String(help.stdout ?? "").includes("app-server") || String(help.stdout ?? "").includes("Run the app server");
      if (!surfaceAvailable) return { available: false, command: this.command, error_code: "CODEX_APP_SERVER_UNAVAILABLE" };

      let modelInfo = null;
      let collaborationInfo = null;
      let catalog = null;
      if (this.model !== null || this.effort !== null || this.collaborationMode !== null) {
        catalog = await queryCatalog(this.command, this.spawn, { platform: this.platform });
        modelInfo = this.model === null ? null : catalog.models.find((item) => item?.model === this.model || item?.id === this.model) ?? null;
        if (this.model !== null && !modelInfo) {
          return { available: false, command: this.command, version: String(stdout).trim() || null, error_code: "CODEX_MODEL_UNAVAILABLE", model: this.model };
        }
        if (this.effort !== null && modelInfo && !modelInfo.supportedReasoningEfforts?.some((item) => item?.reasoningEffort === this.effort)) {
          return { available: false, command: this.command, version: String(stdout).trim() || null, error_code: "CODEX_REASONING_EFFORT_UNAVAILABLE", model: this.model, reasoning_effort: this.effort };
        }
        collaborationInfo = this.collaborationMode === null
          ? null
          : catalog.collaboration_modes.find((item) => item?.mode === this.collaborationMode) ?? null;
        if (this.collaborationMode !== null && !collaborationInfo) {
          return { available: false, command: this.command, version: String(stdout).trim() || null, error_code: "CODEX_COLLABORATION_MODE_UNAVAILABLE", collaboration_mode: this.collaborationMode };
        }
      }

      const capabilities = ["app_server", "json_events", "stream_events", "session_resume", "cancel", "same_turn_steer", "interaction_response", "permission_requests", "context_retrieval", "structured_output"];
      if (this.collaborationMode === "plan") capabilities.push("planning_mode", "user_input_requests");
      if (this.effort === "ultra" && modelInfo?.multiAgentVersion && modelInfo.multiAgentVersion !== "disabled") capabilities.push("proactive_multi_agent");
      return {
        available: true,
        provider: "codex",
        command: this.command,
        version: String(stdout).trim() || null,
        capabilities,
        role: this.targetRole,
        ...(this.model ? { model: this.model } : {}),
        ...(this.effort ? { reasoning_effort: this.effort } : {}),
        ...(this.collaborationMode ? { collaboration_mode: this.collaborationMode } : {}),
        ...(this.strategyPriority ? { strategy_priority: structuredClone(this.strategyPriority) } : {}),
        ...(catalog ? { model_directory: catalog.models.map(publicModel) } : {}),
        ...(catalog?.rate_limits ? { resource_facts: { rate_limits: structuredClone(catalog.rate_limits) } } : {}),
        approval_contract: approvalContract({ profile: this.profile, approvalPolicy: this.approvalPolicy, sandbox: this.sandbox }),
      };
    } catch (error) {
      return { available: false, command: this.command, error_code: error?.code ?? "CODEX_APP_SERVER_PROBE_FAILED" };
    }
  }

  start({ task, cwd, sessionId = undefined, context = undefined, outputSchema = undefined, model = undefined, reasoningEffort = undefined, onEvent = () => {} } = {}) {
    if (typeof task !== "string" || task.trim().length === 0) throw new TypeError("Codex task must be a non-empty string.");
    if (typeof cwd !== "string" || cwd.length === 0) throw new TypeError("Codex cwd is required.");
    if (sessionId !== undefined && (typeof sessionId !== "string" || sessionId.length === 0)) throw new TypeError("Codex sessionId must be a non-empty string when provided.");
    if (context !== undefined && typeof context?.query !== "function") throw new TypeError("Codex context must expose query(operation, args).");
    if (outputSchema !== undefined && (!outputSchema || typeof outputSchema !== "object" || Array.isArray(outputSchema))) throw new TypeError("Codex outputSchema must be an object when provided.");
    const effectiveModel = model === undefined ? this.model : model;
    const effectiveEffort = reasoningEffort === undefined ? this.effort : reasoningEffort;
    if (effectiveModel !== null && (typeof effectiveModel !== "string" || effectiveModel.length === 0)) throw new TypeError("Codex run model must be a non-empty string or null.");
    if (effectiveEffort !== null && (typeof effectiveEffort !== "string" || effectiveEffort.length === 0)) throw new TypeError("Codex run reasoningEffort must be a non-empty string or null.");

    const ownsProcessGroup = this.platform !== "win32" && this.spawn === spawnProcess;
    const ownsProcessTree = this.platform === "win32" && this.spawn === spawnProcess;
    const launch = nativeCommandSpec(this.command, ["app-server", "--stdio"], { platform: this.platform });
    const child = this.spawn(launch.command, launch.args, { cwd, stdio: ["pipe", "pipe", "pipe"], detached: ownsProcessGroup, windowsHide: this.platform === "win32" });
    let stdoutBuffer = "";
    let stderr = "";
    let nextRequestId = 1;
    let observedSessionId = sessionId ?? null;
    let turnId = null;
    let finalText = null;
    let streamedText = "";
    let terminalTurn = null;
    let runtimeError = null;
    let protocolError = null;
    let spawnError = null;
    let tokenUsage = null;
    const compactedTurns = new Set();
    let cancelRequested = false;
    let shutdownRequested = false;
    let sideEffectObserved = false;
    const pendingCommandItems = new Set();
    let killTimer;
    const pendingClientRequests = new Map();
    const nativeRequests = new Map();

    const stopChild = () => {
      if (shutdownRequested || child.exitCode !== null || child.signalCode !== null) return;
      shutdownRequested = true;
      killOwnedProcess(child, "SIGTERM", ownsProcessGroup, ownsProcessTree, this.platform);
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) killOwnedProcess(child, "SIGKILL", ownsProcessGroup, ownsProcessTree, this.platform);
      }, 2_000);
      killTimer.unref?.();
    };

    const failProtocol = (error) => {
      protocolError ??= { code: error?.code ?? "CODEX_APP_SERVER_PROTOCOL_ERROR", message: error?.message ?? "Codex app-server protocol error." };
      onEvent({ type: "protocol_error", ...protocolError });
      stopChild();
    };

    const send = (message) => {
      if (!child.stdin?.writable) throw Object.assign(new Error("Codex app-server stdin is not writable."), { code: "CODEX_APP_SERVER_STDIN_CLOSED" });
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const request = (method, params) => new Promise((resolve, reject) => {
      const id = nextRequestId++;
      pendingClientRequests.set(String(id), { resolve, reject, method });
      try { send({ method, id, params }); }
      catch (error) { pendingClientRequests.delete(String(id)); reject(error); }
    });

    const handleNotification = (message) => {
      const { method, params = {} } = message;
      if (method === "item/agentMessage/delta" && typeof params.delta === "string") {
        streamedText += params.delta;
        onEvent({ type: "text_delta", text: params.delta, itemId: params.itemId ?? null });
        return;
      }
      if (method === "turn/started") {
        turnId = params.turn?.id ?? turnId;
        onEvent({ type: "status", phase: "turn_start", turnId });
        return;
      }
      if (method === "thread/tokenUsage/updated") {
        if (params.tokenUsage && typeof params.tokenUsage === "object" && !Array.isArray(params.tokenUsage)) {
          tokenUsage = structuredClone(params.tokenUsage);
          onEvent({ type: "usage", provider: "codex", scope: "thread_snapshot", turnId: params.turnId ?? turnId, tokenUsage });
        }
        return;
      }
      if (method === "thread/compacted") {
        const compactedTurnId = params.turnId ?? turnId ?? null;
        const key = compactedTurnId ?? "unknown";
        if (!compactedTurns.has(key)) {
          compactedTurns.add(key);
          onEvent({ type: "context_health", event: "compaction", source: "codex:thread/compacted", turnId: compactedTurnId });
        }
        return;
      }
      if (method === "model/rerouted") {
        if (typeof params.fromModel === "string" && typeof params.toModel === "string" && typeof params.reason === "string" && typeof params.turnId === "string") {
          onEvent({ type: "model_reroute", fromModel: params.fromModel, toModel: params.toModel, reason: params.reason, turnId: params.turnId });
        }
        return;
      }
      if (method === "item/started") {
        if (params.item?.type === "contextCompaction") {
          const compactedTurnId = params.turnId ?? turnId ?? null;
          const key = compactedTurnId ?? `item:${params.item?.id ?? "unknown"}`;
          if (!compactedTurns.has(key)) {
            compactedTurns.add(key);
            onEvent({ type: "context_health", event: "compaction", source: "codex:item/contextCompaction", turnId: compactedTurnId });
          }
        }
        if (params.item?.type === "commandExecution") {
          if (typeof params.item?.id === "string" && params.item.id.length > 0) pendingCommandItems.add(params.item.id);
          return;
        }
        const classification = sideEffectClass(params.item, cwd);
        if (classification) {
          sideEffectObserved = true;
          const paths = params.item?.type === "fileChange" ? fileChangePaths(params.item) : [];
          onEvent({
            type: "side_effect",
            classification,
            source: `codex:item/${params.item?.type ?? "unknown"}`,
            detail: { item_id: params.item?.id ?? null, ...(paths.length > 0 ? { paths } : {}) },
          });
        }
        return;
      }
      if (method === "item/completed" && params.item?.type === "commandExecution") {
        if (typeof params.item?.id === "string") pendingCommandItems.delete(params.item.id);
        const classification = sideEffectClass(params.item, cwd);
        sideEffectObserved = true;
        const actionTypes = commandActionTypes(params.item);
        onEvent({
          type: "side_effect",
          classification,
          source: "codex:item/commandExecution",
          detail: { item_id: params.item?.id ?? null, ...(actionTypes.length > 0 ? { command_actions: actionTypes } : {}) },
        });
        return;
      }
      if (method === "turn/completed") {
        if (pendingCommandItems.size > 0) {
          sideEffectObserved = true;
          onEvent({
            type: "side_effect",
            classification: "external_possible",
            source: "codex:item/commandExecution:missing_completion",
            detail: { item_ids: [...pendingCommandItems] },
          });
        }
        if (!sideEffectObserved) onEvent({ type: "side_effect", classification: "none", source: "codex:no-side-effect-items" });
        const notifiedTurn = params.turn ?? null;
        terminalTurn = notifiedTurn;
        turnId = notifiedTurn?.id ?? turnId;
        const finishTurn = (turn) => {
          terminalTurn = turn ?? notifiedTurn;
          finalText = lastFinalText(terminalTurn, streamedText || null, { allowPlan: this.collaborationMode === "plan" });
          if (finalText !== null) onEvent({ type: "final", text: finalText });
          onEvent({ type: "status", phase: "turn_end", reason: terminalTurn?.status ?? "failed", turnId });
          stopChild();
        };
        const notifiedText = lastFinalText(notifiedTurn, streamedText || null, { allowPlan: this.collaborationMode === "plan" });
        if (this.collaborationMode === "plan" && notifiedTurn?.status === "completed" && notifiedText === null && observedSessionId) {
          void request("thread/read", { threadId: observedSessionId, includeTurns: true })
            .then((response) => finishTurn(response?.thread?.turns?.find((turn) => turn?.id === turnId) ?? notifiedTurn))
            .catch(failProtocol);
          return;
        }
        finishTurn(notifiedTurn);
        return;
      }
      if (method === "error") {
        runtimeError = params.error?.message ?? "Codex app-server reported a runtime error.";
        onEvent({ type: "error", message: runtimeError, willRetry: params.willRetry === true });
      }
    };

    const handleDynamicToolRequest = async (message) => {
      const params = message.params ?? {};
      const reply = (result) => {
        try { send({ id: message.id, result }); }
        catch (error) { failProtocol(error); }
      };
      if (!context || params.namespace !== "aide_context") {
        reply({ contentItems: [{ type: "inputText", text: JSON.stringify({ error_code: "AIDE_CONTEXT_TOOL_UNAVAILABLE", error_message: "AIDE Context tool is unavailable for this run." }) }], success: false });
        return;
      }
      onEvent({
        type: "context_tool_call",
        namespace: params.namespace,
        tool: params.tool ?? null,
        arguments: params.arguments ?? {},
        nativeRequestRef: `codex:${String(message.id)}`,
      });
      try {
        const value = await context.query(params.tool, params.arguments ?? {});
        onEvent({ type: "context_tool_result", tool: params.tool ?? null, success: true });
        reply({ contentItems: [{ type: "inputText", text: JSON.stringify(value) }], success: true });
      } catch (error) {
        onEvent({ type: "context_tool_result", tool: params.tool ?? null, success: false, error_code: error?.code ?? "AIDE_CONTEXT_QUERY_FAILED" });
        reply({ contentItems: [{ type: "inputText", text: JSON.stringify({ error_code: error?.code ?? "AIDE_CONTEXT_QUERY_FAILED", error_message: error?.message ?? "AIDE Context query failed." }) }], success: false });
      }
    };

    const handleServerRequest = (message) => {
      if (message.method === "item/tool/call") {
        void handleDynamicToolRequest(message);
        return;
      }
      const kind = interactionKind(message.method);
      if (!kind) {
        failProtocol(Object.assign(new Error(`Unsupported Codex server request: ${message.method}`), { code: "CODEX_SERVER_REQUEST_UNSUPPORTED" }));
        return;
      }
      const nativeRequestRef = `codex:${String(message.id)}`;
      nativeRequests.set(nativeRequestRef, { id: message.id, method: message.method, params: message.params ?? {} });
      onEvent({
        type: "interaction_request",
        kind,
        summary: requestSummary(message.method, message.params) ?? `Codex requested ${kind}.`,
        blocking: message.method === "item/tool/requestUserInput" ? message.params?.isBlocking !== false : true,
        nativeRequestRef,
        nativeContract: nativeInteractionContract(message.method, message.params),
      });
    };

    const emitLine = (line) => {
      if (!line.trim()) return;
      try {
        const message = JSON.parse(line);
        if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("Codex app-server emitted invalid JSON.");
        if (message.id !== undefined && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) {
          const pending = pendingClientRequests.get(String(message.id));
          if (!pending) throw Object.assign(new Error(`Codex app-server returned unknown request id: ${String(message.id)}`), { code: "CODEX_APP_SERVER_RESPONSE_UNKNOWN" });
          pendingClientRequests.delete(String(message.id));
          if (message.error) {
            const error = Object.assign(new Error(message.error.message ?? `${pending.method} failed.`), { code: message.error.code ?? "CODEX_APP_SERVER_REQUEST_FAILED", data: message.error.data });
            pending.reject(error);
          } else pending.resolve(message.result);
          return;
        }
        if (message.id !== undefined && typeof message.method === "string") {
          handleServerRequest(message);
          return;
        }
        if (typeof message.method === "string") {
          handleNotification(message);
          return;
        }
        throw new Error("Codex app-server emitted an unknown message envelope.");
      } catch (error) {
        failProtocol(error);
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      let newline;
      while ((newline = stdoutBuffer.indexOf("\n")) >= 0) {
        emitLine(stdoutBuffer.slice(0, newline));
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr = appendBounded(stderr, chunk); });
    child.once("error", (error) => { spawnError = error; });

    const setup = (async () => {
      await request("initialize", {
        clientInfo: { name: "aide", title: "AIDE", version: "0.0.0" },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      send({ method: "initialized" });
      const threadResponse = sessionId === undefined
        ? await request("thread/start", {
            cwd,
            ...(context ? { dynamicTools: CONTEXT_DYNAMIC_TOOLS } : {}),
            ...(effectiveModel ? { model: effectiveModel } : {}),
            ...(this.sandbox ? { sandbox: this.sandbox } : {}),
            ...(this.approvalPolicy ? { approvalPolicy: this.approvalPolicy } : {}),
          })
        : await request("thread/resume", { threadId: sessionId, cwd, excludeTurns: true });
      observedSessionId = threadResponse?.thread?.id ?? observedSessionId;
      if (!observedSessionId) throw Object.assign(new Error("Codex app-server did not return a thread id."), { code: "CODEX_THREAD_ID_MISSING" });
      if (sessionId !== undefined && threadResponse?.thread?.status?.type === "active") {
        throw Object.assign(new Error("Codex thread is still active; continuation requires native reattachment instead of starting a new turn."), {
          code: "CODEX_THREAD_REATTACH_REQUIRED",
        });
      }
      if (effectiveModel && threadResponse?.model !== effectiveModel) {
        throw Object.assign(new Error(`Codex returned model ${threadResponse?.model ?? "unknown"} instead of frozen model ${effectiveModel}.`), { code: "CODEX_MODEL_DRIFT" });
      }
      const approvalPolicy = threadResponse?.approvalPolicy ?? null;
      const approvalsReviewer = threadResponse?.approvalsReviewer ?? null;
      onEvent({ type: "session", sessionId: observedSessionId });
      onEvent({
        type: "approval_state",
        state: {
          provider: "codex",
          transport: "app-server-v2",
          profile: this.profile,
          approval_policy: approvalPolicy,
          approvals_reviewer: approvalsReviewer,
          interactive: typeof approvalPolicy === "string" && typeof approvalsReviewer === "string" ? approvalsReviewer === "user" && approvalPolicy !== "never" : null,
          response_capability: true,
          session_grants: true,
          auto_review: typeof approvalsReviewer === "string" ? approvalsReviewer === "auto_review" : null,
          sandbox_mode: normalizeSandboxMode(threadResponse?.sandbox),
          network_access: typeof threadResponse?.sandbox?.networkAccess === "boolean" ? threadResponse.sandbox.networkAccess : null,
          sandbox: threadResponse?.sandbox ?? null,
          active_permission_profile: threadResponse?.activePermissionProfile ?? null,
          model: threadResponse?.model ?? null,
          model_provider: threadResponse?.modelProvider ?? null,
        },
      });
      const turnResponse = await request("turn/start", {
        threadId: observedSessionId,
        input: [{ type: "text", text: task, text_elements: [] }],
        ...(outputSchema === undefined ? {} : { outputSchema: structuredClone(outputSchema) }),
        ...(effectiveModel ? { model: effectiveModel } : {}),
        ...(effectiveEffort ? { effort: effectiveEffort } : {}),
        ...(this.collaborationMode ? {
          collaborationMode: {
            mode: this.collaborationMode,
            settings: {
              model: effectiveModel ?? threadResponse?.model,
              reasoning_effort: effectiveEffort ?? (this.collaborationMode === "plan" ? "medium" : null),
              developer_instructions: null,
            },
          },
        } : {}),
      });
      turnId = turnResponse?.turn?.id ?? turnId;
      if (!turnId) throw Object.assign(new Error("Codex app-server did not return a turn id."), { code: "CODEX_TURN_ID_MISSING" });
    })().catch(failProtocol);

    const done = new Promise((resolve) => {
      child.once("close", (exitCode, signal) => {
        if (killTimer) clearTimeout(killTimer);
        if (stdoutBuffer.trim()) emitLine(stdoutBuffer);
        for (const pending of pendingClientRequests.values()) {
          pending.reject(Object.assign(new Error("Codex app-server exited before responding."), { code: "CODEX_APP_SERVER_EXITED" }));
        }
        pendingClientRequests.clear();
        const turnStatus = terminalTurn?.status ?? null;
        const status = cancelRequested || turnStatus === "interrupted" ? "cancelled" : turnStatus === "completed" ? "completed" : "failed";
        resolve({
          status,
          exit_code: exitCode,
          signal: signal ?? null,
          session_id: observedSessionId,
          final_text: finalText,
          turn_end_reason: turnStatus,
          error_code: spawnError?.code ?? protocolError?.code ?? (terminalTurn?.error ? "CODEX_TURN_FAILED" : status === "failed" ? "CODEX_APP_SERVER_EXIT" : null),
          error_message: spawnError?.message ?? protocolError?.message ?? terminalTurn?.error?.message ?? runtimeError ?? null,
          usage: tokenUsage === null ? null : {
            provider: "codex",
            scope: "thread_snapshot",
            thread_id: observedSessionId,
            turn_id: turnId,
            token_usage: tokenUsage,
          },
          stderr: stderr.trim() || null,
        });
      });
    });

    return {
      pid: child.pid ?? null,
      process_group_id: ownsProcessGroup ? child.pid ?? null : null,
      process_tree_root_pid: this.platform === "win32" ? child.pid ?? null : null,
      done,
      cancel() {
        if (cancelRequested || child.exitCode !== null || child.signalCode !== null || terminalTurn) return false;
        cancelRequested = true;
        void setup.then(async () => {
          if (observedSessionId && turnId && !terminalTurn) {
            try { await request("turn/interrupt", { threadId: observedSessionId, turnId }); }
            catch (error) { failProtocol(error); }
          }
        });
        return true;
      },
      async steer(input) {
        if (typeof input !== "string" || input.trim().length === 0) throw new TypeError("Codex steer input must be a non-empty string.");
        await setup;
        if (!observedSessionId || !turnId || terminalTurn) throw Object.assign(new Error("Codex turn is not steerable."), { code: "CODEX_TURN_NOT_ACTIVE" });
        await request("turn/steer", {
          threadId: observedSessionId,
          expectedTurnId: turnId,
          input: [{ type: "text", text: input.trim(), text_elements: [] }],
        });
        return true;
      },
      async respond({ nativeRequestRef, response } = {}) {
        const nativeRequest = nativeRequests.get(nativeRequestRef);
        if (!nativeRequest) throw Object.assign(new Error(`Unknown Codex interaction request: ${nativeRequestRef ?? "missing"}`), { code: "CODEX_INTERACTION_NOT_FOUND" });
        const result = normalizeInteractionResponse(nativeRequest, response);
        send({ id: nativeRequest.id, result });
        nativeRequests.delete(nativeRequestRef);
        return true;
      },
    };
  }
}

export { normalizeInteractionResponse as normalizeCodexInteractionResponse };
