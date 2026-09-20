import { execFile as execFileCallback, spawn as spawnProcess } from "node:child_process";
import { promisify } from "node:util";
import { defaultDshCommand, nativeCommandSpec, terminateProcessTree } from "../platform/runtime.js";

const execFile = promisify(execFileCallback);
const MAX_STDERR_BYTES = 64 * 1024;
const PERMISSION_MODE = "workspace-write";

function appendBounded(current, chunk, limit = MAX_STDERR_BYTES) {
  const next = `${current}${chunk}`;
  return Buffer.byteLength(next, "utf8") <= limit ? next : next.slice(-limit);
}

function parseEvent(line) {
  const value = JSON.parse(line);
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.type !== "string") {
    throw Object.assign(new Error("DSH emitted an invalid JSON event."), { code: "DSH_EVENT_INVALID" });
  }
  return value;
}

function normalizeDshTurnEndReason(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value) && typeof value.kind === "string") return value.kind;
  return null;
}

function killOwnedProcess(child, signal, ownsProcessGroup, ownsProcessTree, platform = process.platform) {
  if (ownsProcessTree && Number.isInteger(child.pid) && child.pid > 0) return terminateProcessTree(child.pid, { platform });
  if (ownsProcessGroup && Number.isInteger(child.pid) && child.pid > 0) {
    try { process.kill(-child.pid, signal); return true; }
    catch (error) { if (error?.code !== "ESRCH") throw error; }
  }
  return child.kill(signal);
}

export class DshHeadlessAdapter {
  constructor({ command = process.env.AIDE_DSH_COMMAND ?? defaultDshCommand(), spawn = spawnProcess, exec = execFile, platform = process.platform } = {}) {
    this.command = command;
    this.spawn = spawn;
    this.exec = exec;
    this.platform = platform;
  }

  async probe() {
    try {
      const launch = nativeCommandSpec(this.command, ["--version"], { platform: this.platform });
      const { stdout = "" } = await this.exec(launch.command, launch.args, { timeout: 3_000, windowsHide: this.platform === "win32" });
      return {
        available: true,
        command: this.command,
        version: String(stdout).trim() || null,
        capabilities: ["headless", "json_events", "stream_events", "session_resume", "cancel"],
        approval_contract: {
          provider: "dsh",
          transport: "headless",
          profile: "headless",
          interactive: false,
          response_capability: false,
          behavior: "fail_closed",
          native_policy_model: ["ask", "never"],
          one_shot_grants: false,
          session_grants: false,
          remembered_grants: false,
          auto_review: false,
          sandbox_mode: PERMISSION_MODE,
        },
      };
    } catch (error) {
      return { available: false, command: this.command, error_code: error?.code ?? "DSH_PROBE_FAILED" };
    }
  }

  start({ task, cwd, sessionId = undefined, onEvent = () => {} } = {}) {
    if (typeof task !== "string" || task.trim().length === 0) throw new TypeError("DSH task must be a non-empty string.");
    if (typeof cwd !== "string" || cwd.length === 0) throw new TypeError("DSH cwd is required.");
    if (sessionId !== undefined && (typeof sessionId !== "string" || sessionId.length === 0)) throw new TypeError("DSH sessionId must be a non-empty string when provided.");

    const args = ["--profile", "headless", "--json", ...(sessionId === undefined ? [] : ["--session-id", sessionId])];
    const platform = this.platform;
    const ownsProcessGroup = platform !== "win32" && this.spawn === spawnProcess;
    const ownsProcessTree = platform === "win32" && this.spawn === spawnProcess;
    const launch = nativeCommandSpec(this.command, args, { platform: this.platform });
    const child = this.spawn(launch.command, launch.args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, DSH_PERMISSION_MODE: PERMISSION_MODE },
      detached: ownsProcessGroup,
      windowsHide: this.platform === "win32",
    });
    let stdoutBuffer = "";
    let stderr = "";
    let observedSessionId = sessionId ?? null;
    let finalText = null;
    let turnEndReason = null;
    let protocolError = null;
    let runtimeError = null;
    let cancelRequested = false;
    let killTimer;

    onEvent({
      type: "approval_state",
      state: {
        provider: "dsh",
        transport: "headless",
        profile: "headless",
        interactive: false,
        response_capability: false,
        behavior: "fail_closed",
        one_shot_grants: false,
        session_grants: false,
        remembered_grants: false,
        auto_review: false,
        sandbox_mode: PERMISSION_MODE,
      },
    });

    const emitLine = (line) => {
      if (!line.trim()) return;
      try {
        const event = parseEvent(line);
        if (event.type === "session" && typeof event.sessionId === "string") observedSessionId = event.sessionId;
        if (event.type === "final" && typeof event.text === "string") finalText = event.text;
        if (event.type === "status" && event.phase === "turn_end") turnEndReason = normalizeDshTurnEndReason(event.reason);
        if (event.type === "error") runtimeError = typeof event.message === "string" ? event.message : "DSH reported an error.";
        onEvent(event);
      } catch (error) {
        protocolError ??= { code: error?.code ?? "DSH_EVENT_INVALID", message: error?.message ?? "Invalid DSH JSON event." };
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

    const done = new Promise((resolve) => {
      let spawnError = null;
      child.once("error", (error) => { spawnError = error; });
      child.once("close", (exitCode, signal) => {
        if (killTimer) clearTimeout(killTimer);
        if (stdoutBuffer.trim()) emitLine(stdoutBuffer);
        const failed = exitCode !== 0 || spawnError || protocolError || runtimeError;
        resolve({
          status: cancelRequested ? "cancelled" : failed ? "failed" : "completed",
          exit_code: exitCode,
          signal: signal ?? null,
          session_id: observedSessionId,
          final_text: finalText,
          turn_end_reason: turnEndReason,
          error_code: spawnError?.code ?? protocolError?.code ?? (runtimeError ? "DSH_RUNTIME_ERROR" : failed ? "DSH_EXIT_NONZERO" : null),
          error_message: spawnError?.message ?? protocolError?.message ?? runtimeError ?? null,
          stderr: stderr.trim() || null,
        });
      });
    });

    child.stdin.end(task);

    return {
      pid: child.pid ?? null,
      process_group_id: ownsProcessGroup ? child.pid ?? null : null,
      process_tree_root_pid: platform === "win32" ? child.pid ?? null : null,
      done,
      cancel() {
        if (child.exitCode !== null || child.signalCode !== null) return false;
        cancelRequested = true;
        killOwnedProcess(child, "SIGTERM", ownsProcessGroup, ownsProcessTree, platform);
        killTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) killOwnedProcess(child, "SIGKILL", ownsProcessGroup, ownsProcessTree, platform);
        }, 2_000);
        killTimer.unref?.();
        return true;
      },
    };
  }
}

export { parseEvent as parseDshEvent, normalizeDshTurnEndReason };
