import { execFile as execFileCallback, spawn as spawnProcess } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { defaultDshCommand, nativeCommandSpec, terminateProcessTree } from "../platform/runtime.js";

const execFile = promisify(execFileCallback);
const MAX_STDERR_BYTES = 64 * 1024;

const PERMISSION_MODES = new Set(["read-only", "workspace-write", "danger-full-access"]);

function approvalContract(permissionMode) {
  const asks = permissionMode !== "danger-full-access";
  return {
    provider: "dsh",
    transport: "acp-v1",
    profile: "acp",
    interactive: asks,
    response_capability: true,
    behavior: asks ? "fail_closed" : "unattended",
    one_shot_grants: true,
    session_grants: false,
    remembered_grants: false,
    auto_review: false,
    sandbox_mode: permissionMode,
    request_methods: ["session/request_permission"],
  };
}

function appendBounded(current, chunk, limit = MAX_STDERR_BYTES) {
  const next = `${current}${chunk}`;
  return Buffer.byteLength(next, "utf8") <= limit ? next : next.slice(-limit);
}

function parseMessage(line) {
  const value = JSON.parse(line);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("DSH ACP emitted an invalid JSON-RPC message."), { code: "DSH_ACP_MESSAGE_INVALID" });
  }
  return value;
}

function permissionSummary(params = {}) {
  const title = params.toolCall?.title;
  const id = params.toolCall?.toolCallId;
  return typeof title === "string" && title.length > 0
    ? `DSH ACP requested permission: ${title}`
    : `DSH ACP requested permission for tool call ${typeof id === "string" ? id : "unknown"}.`;
}

function permissionResponse(response, options) {
  if (response === "cancel" || response?.outcome === "cancelled") return { outcome: { outcome: "cancelled" } };
  const optionId = typeof response === "string" ? response : response?.option_id ?? response?.optionId;
  if (typeof optionId !== "string" || !options.some((option) => option.optionId === optionId)) {
    throw Object.assign(new Error("DSH ACP permission response must select one advertised option id or cancel."), {
      code: "DSH_ACP_INTERACTION_RESPONSE_INVALID",
    });
  }
  return { outcome: { outcome: "selected", optionId } };
}

function isWithinWorkspace(cwd, target) {
  if (typeof target !== "string" || target.length === 0) return false;
  const root = resolve(cwd);
  const path = resolve(root, target);
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function classifyToolCall(update, cwd, permissionMode) {
  if (!["write", "edit"].includes(update?.title)) return "external_possible";
  const input = update?.rawInput;
  if (!input || typeof input !== "object" || Array.isArray(input)) return "external_possible";
  if (permissionMode !== "workspace-write" || input.sandbox_permissions !== undefined) return "external_possible";
  return isWithinWorkspace(cwd, input.file_path) ? "workspace_only" : "external_possible";
}

function killOwnedProcess(child, signal, ownsProcessGroup, ownsProcessTree, platform = process.platform) {
  if (ownsProcessTree && Number.isInteger(child.pid) && child.pid > 0) return terminateProcessTree(child.pid, { platform });
  if (ownsProcessGroup && Number.isInteger(child.pid) && child.pid > 0) {
    try { process.kill(-child.pid, signal); return true; }
    catch (error) { if (error?.code !== "ESRCH") throw error; }
  }
  return child.kill(signal);
}

export class DshAcpAdapter {
  constructor({ command = process.env.AIDE_DSH_COMMAND ?? defaultDshCommand(), spawn = spawnProcess, exec = execFile, permissionMode = "workspace-write", platform = process.platform } = {}) {
    if (!PERMISSION_MODES.has(permissionMode)) throw new TypeError("DSH ACP permissionMode must be read-only, workspace-write, or danger-full-access.");
    this.command = command;
    this.spawn = spawn;
    this.exec = exec;
    this.permissionMode = permissionMode;
    this.platform = platform;
  }

  async probe() {
    try {
      const versionLaunch = nativeCommandSpec(this.command, ["--version"], { platform: this.platform });
      const helpLaunch = nativeCommandSpec(this.command, ["--profile", "acp", "--help"], { platform: this.platform });
      const [{ stdout = "" }, help] = await Promise.all([
        this.exec(versionLaunch.command, versionLaunch.args, { timeout: 3_000, windowsHide: this.platform === "win32" }),
        this.exec(helpLaunch.command, helpLaunch.args, { timeout: 3_000, windowsHide: this.platform === "win32" }),
      ]);
      const available = String(help.stdout ?? "").includes("Agent Client Protocol")
        || String(help.stdout ?? "").includes("Serve automation clients");
      return {
        available,
        command: this.command,
        version: String(stdout).trim() || null,
        capabilities: [
          "acp",
          "json_events",
          "stream_events",
          "session_resume",
          "cancel",
          "interaction_response",
          "permission_requests",
          "structured_tool_events",
        ],
        approval_contract: approvalContract(this.permissionMode),
      };
    } catch (error) {
      return { available: false, command: this.command, error_code: error?.code ?? "DSH_ACP_PROBE_FAILED" };
    }
  }

  start({ task, cwd, sessionId = undefined, onEvent = () => {} } = {}) {
    if (typeof task !== "string" || task.trim().length === 0) throw new TypeError("DSH ACP task must be a non-empty string.");
    if (typeof cwd !== "string" || cwd.length === 0) throw new TypeError("DSH ACP cwd is required.");
    if (sessionId !== undefined && (typeof sessionId !== "string" || sessionId.length === 0)) throw new TypeError("DSH ACP sessionId must be a non-empty string when provided.");

    const platform = this.platform;
    const ownsProcessGroup = platform !== "win32" && this.spawn === spawnProcess;
    const ownsProcessTree = platform === "win32" && this.spawn === spawnProcess;
    const launch = nativeCommandSpec(this.command, ["--profile", "acp"], { platform });
    const child = this.spawn(launch.command, launch.args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, DSH_PERMISSION_MODE: this.permissionMode },
      detached: ownsProcessGroup,
      windowsHide: platform === "win32",
    });
    const pending = new Map();
    const permissions = new Map();
    let nextId = 1;
    let stdoutBuffer = "";
    let stderr = "";
    let observedSessionId = sessionId ?? null;
    let finalText = "";
    let stopReason = null;
    let protocolError = null;
    let spawnError = null;
    let cancelRequested = false;
    let toolStarted = false;
    let killTimer;

    const send = (message) => {
      if (child.stdin.destroyed || child.stdin.writableEnded) throw Object.assign(new Error("DSH ACP stdin is closed."), { code: "DSH_ACP_STDIN_CLOSED" });
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const request = (method, params) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject, method });
      send({ jsonrpc: "2.0", id, method, params });
    });
    const notify = (method, params) => send({ jsonrpc: "2.0", method, params });
    const nativeRef = (id) => `dsh-acp:${String(id)}`;

    const handleUpdate = (params = {}) => {
      if (observedSessionId && params.sessionId !== observedSessionId) return;
      const update = params.update;
      if (!update || typeof update !== "object" || Array.isArray(update)) return;
      if (update.sessionUpdate === "agent_message_chunk" && update.content?.type === "text" && typeof update.content.text === "string") {
        finalText += update.content.text;
        onEvent({ type: "text", text: update.content.text });
      }
      if (update.sessionUpdate === "tool_call") {
        toolStarted = true;
        const classification = classifyToolCall(update, cwd, this.permissionMode);
        onEvent({
          type: "side_effect",
          classification,
          source: "dsh-acp:tool_call",
          detail: {
            tool_call_id: update.toolCallId ?? null,
            title: update.title ?? null,
            kind: update.kind ?? null,
            sandbox_mode: this.permissionMode,
            file_path: typeof update.rawInput?.file_path === "string" ? update.rawInput.file_path : null,
          },
        });
      }
    };

    const handleMessage = (message) => {
      if (Object.hasOwn(message, "id") && !Object.hasOwn(message, "method")) {
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.error) {
          waiter.reject(Object.assign(new Error(message.error.message ?? `${waiter.method} failed.`), {
            code: "DSH_ACP_REQUEST_FAILED",
            data: message.error.data ?? null,
          }));
        } else {
          waiter.resolve(message.result ?? {});
        }
        return;
      }

      if (message.method === "session/update") {
        handleUpdate(message.params);
        return;
      }

      if (message.method === "session/request_permission" && Object.hasOwn(message, "id")) {
        const params = message.params ?? {};
        const options = Array.isArray(params.options)
          ? params.options.filter((option) => option && typeof option.optionId === "string" && typeof option.kind === "string")
          : [];
        const ref = nativeRef(message.id);
        permissions.set(ref, { id: message.id, options });
        onEvent({
          type: "interaction_request",
          kind: "permission",
          summary: permissionSummary(params),
          blocking: true,
          nativeRequestRef: ref,
          nativeContract: {
            provider: "dsh",
            transport: "acp-v1",
            method: "session/request_permission",
            response: {
              shape: "permission_option",
              options: options.map((option) => ({
                option_id: option.optionId,
                name: option.name ?? option.optionId,
                kind: option.kind,
              })),
            },
          },
        });
        return;
      }

      if (Object.hasOwn(message, "id") && typeof message.method === "string") {
        send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Unsupported ACP client request: ${message.method}` } });
      }
    };

    const emitLine = (line) => {
      if (!line.trim()) return;
      try {
        handleMessage(parseMessage(line));
      } catch (error) {
        protocolError ??= { code: error?.code ?? "DSH_ACP_PROTOCOL_ERROR", message: error?.message ?? "Invalid DSH ACP protocol message." };
        onEvent({ type: "protocol_error", ...protocolError });
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

    const failProtocol = (error) => {
      protocolError ??= { code: error?.code ?? "DSH_ACP_PROTOCOL_ERROR", message: error?.message ?? "DSH ACP protocol failed." };
      try { child.stdin.end(); } catch { /* process close will settle the run */ }
      if (child.exitCode === null && child.signalCode === null) killOwnedProcess(child, "SIGTERM", ownsProcessGroup, ownsProcessTree, platform);
    };

    const setup = (async () => {
      const initialized = await request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      if (initialized?.protocolVersion !== 1) throw Object.assign(new Error("DSH ACP did not negotiate protocol v1."), { code: "DSH_ACP_PROTOCOL_VERSION_UNSUPPORTED" });

      if (sessionId === undefined) {
        const created = await request("session/new", { cwd, mcpServers: [] });
        observedSessionId = created?.sessionId ?? null;
      } else {
        await request("session/resume", { sessionId, cwd, mcpServers: [] });
        observedSessionId = sessionId;
      }
      if (!observedSessionId) throw Object.assign(new Error("DSH ACP did not return a session id."), { code: "DSH_ACP_SESSION_ID_MISSING" });

      onEvent({ type: "session", sessionId: observedSessionId });
      onEvent({
        type: "approval_state",
        state: {
          provider: "dsh",
          transport: "acp-v1",
          profile: "acp",
          interactive: this.permissionMode !== "danger-full-access",
          response_capability: true,
          behavior: this.permissionMode === "danger-full-access" ? "unattended" : "fail_closed",
          one_shot_grants: true,
          session_grants: false,
          remembered_grants: false,
          auto_review: false,
          sandbox_mode: this.permissionMode,
        },
      });

      if (cancelRequested) notify("session/cancel", { sessionId: observedSessionId });
      const prompt = await request("session/prompt", {
        sessionId: observedSessionId,
        prompt: [{ type: "text", text: task }],
      });
      stopReason = prompt?.stopReason ?? null;
      if (!toolStarted) onEvent({ type: "side_effect", classification: "none", source: "dsh-acp:no-tool-call" });
      await request("session/close", { sessionId: observedSessionId });
      child.stdin.end();
    })();
    void setup.catch(failProtocol);

    const done = new Promise((resolve) => {
      child.once("close", (exitCode, signal) => {
        if (killTimer) clearTimeout(killTimer);
        if (stdoutBuffer.trim()) emitLine(stdoutBuffer);
        for (const waiter of pending.values()) {
          waiter.reject(Object.assign(new Error("DSH ACP exited before responding."), { code: "DSH_ACP_EXITED" }));
        }
        pending.clear();
        const cancelled = cancelRequested || stopReason === "cancelled";
        const failed = exitCode !== 0 || spawnError || protocolError;
        resolve({
          status: cancelled ? "cancelled" : failed ? "failed" : "completed",
          exit_code: exitCode,
          signal: signal ?? null,
          session_id: observedSessionId,
          final_text: finalText || null,
          turn_end_reason: stopReason,
          error_code: spawnError?.code ?? protocolError?.code ?? (failed ? "DSH_ACP_EXIT_NONZERO" : null),
          error_message: spawnError?.message ?? protocolError?.message ?? null,
          stderr: stderr.trim() || null,
        });
      });
    });

    return {
      pid: child.pid ?? null,
      process_group_id: ownsProcessGroup ? child.pid ?? null : null,
      process_tree_root_pid: platform === "win32" ? child.pid ?? null : null,
      done,
      cancel() {
        if (child.exitCode !== null || child.signalCode !== null) return false;
        cancelRequested = true;
        if (observedSessionId) {
          try { notify("session/cancel", { sessionId: observedSessionId }); }
          catch { return false; }
          killTimer ??= setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) killOwnedProcess(child, "SIGTERM", ownsProcessGroup, ownsProcessTree, platform);
          }, 2_000);
          killTimer.unref?.();
          return true;
        }
        return killOwnedProcess(child, "SIGTERM", ownsProcessGroup, ownsProcessTree, platform);
      },
      async respond({ nativeRequestRef, response } = {}) {
        const pendingPermission = permissions.get(nativeRequestRef);
        if (!pendingPermission) throw Object.assign(new Error("Unknown DSH ACP permission request."), { code: "DSH_ACP_INTERACTION_NOT_FOUND" });
        const result = permissionResponse(response, pendingPermission.options);
        permissions.delete(nativeRequestRef);
        send({ jsonrpc: "2.0", id: pendingPermission.id, result });
        return true;
      },
    };
  }
}

export {
  classifyToolCall as classifyDshAcpToolCall,
  parseMessage as parseDshAcpMessage,
  permissionResponse as normalizeDshAcpPermissionResponse,
};
