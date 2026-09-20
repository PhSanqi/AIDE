import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { classifyDshAcpToolCall, DshAcpAdapter, normalizeDshAcpPermissionResponse } from "../src/execution/dsh-acp-adapter.js";

function fakeAcpProcess({ permission = false, toolCall = false } = {}) {
  const child = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const messages = [];
  let stdinBuffer = "";
  let closed = false;
  let promptId = null;

  const emit = (message) => stdout.write(`${JSON.stringify(message)}\n`);
  const close = () => {
    if (closed) return;
    closed = true;
    child.exitCode = 0;
    queueMicrotask(() => child.emit("close", 0, null));
  };
  const completePrompt = (stopReason = "end_turn") => {
    emit({
      method: "session/update",
      params: {
        sessionId: "session-acp",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" } },
      },
    });
    emit({ jsonrpc: "2.0", id: promptId, result: { stopReason } });
  };

  const handle = (message) => {
    messages.push(message);
    if (message.method === "initialize") emit({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { resume: {}, close: {} } } } });
    if (message.method === "session/new") emit({ jsonrpc: "2.0", id: message.id, result: { sessionId: "session-acp" } });
    if (message.method === "session/resume") emit({ jsonrpc: "2.0", id: message.id, result: {} });
    if (message.method === "session/prompt") {
      promptId = message.id;
      if (toolCall) emit({
        method: "session/update",
        params: {
          sessionId: "session-acp",
          update: { sessionUpdate: "tool_call", toolCallId: "tool-1", title: "bash", kind: "other", status: "in_progress" },
        },
      });
      if (permission) emit({
        jsonrpc: "2.0",
        id: "permission-1",
        method: "session/request_permission",
        params: {
          sessionId: "session-acp",
          toolCall: { toolCallId: "tool-1", title: "bash" },
          options: [
            { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
            { optionId: "reject-once", name: "Reject", kind: "reject_once" },
          ],
        },
      });
      else completePrompt();
    }
    if (message.id === "permission-1" && message.result) completePrompt();
    if (message.method === "session/cancel") completePrompt("cancelled");
    if (message.method === "session/close") {
      emit({ jsonrpc: "2.0", id: message.id, result: {} });
    }
  };

  child.pid = 2468;
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
    final(callback) {
      queueMicrotask(close);
      callback();
    },
  });
  child.kill = (signal = "SIGTERM") => {
    if (closed) return false;
    child.signalCode = signal;
    close();
    return true;
  };
  return { child, messages };
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for fake DSH ACP state.");
}

test("DshAcpAdapter probe advertises only verified ACP control capabilities", async () => {
  const adapter = new DshAcpAdapter({
    platform: "linux",
    exec: async (_command, args) => args[0] === "--version"
      ? { stdout: "0.1.6-alpha.1\n" }
      : { stdout: "Serve automation clients over Agent Client Protocol stdio." },
  });
  const probe = await adapter.probe();
  assert.equal(probe.available, true);
  assert.ok(probe.capabilities.includes("interaction_response"));
  assert.ok(probe.capabilities.includes("permission_requests"));
  assert.ok(probe.capabilities.includes("structured_tool_events"));
  assert.equal(probe.approval_contract.profile, "acp");
  assert.equal(probe.approval_contract.session_grants, false);
});

test("DshAcpAdapter maps one ACP prompt to AIDE result and proves no-tool side effects", async () => {
  const fake = fakeAcpProcess();
  const events = [];
  const adapter = new DshAcpAdapter({ platform: "linux", spawn: () => fake.child, exec: async () => ({ stdout: "dsh test" }) });
  const handle = adapter.start({ task: "finish", cwd: "/tmp/work", onEvent: (event) => events.push(event) });
  const result = await handle.done;

  assert.equal(result.status, "completed");
  assert.equal(result.session_id, "session-acp");
  assert.equal(result.final_text, "done");
  assert.equal(result.turn_end_reason, "end_turn");
  assert.ok(events.some((event) => event.type === "approval_state" && event.state.transport === "acp-v1"));
  assert.ok(events.some((event) => event.type === "side_effect" && event.classification === "none"));
});

test("DshAcpAdapter uses the Windows cmd shim and persists a process-tree root", async () => {
  const fake = fakeAcpProcess();
  let launch;
  const adapter = new DshAcpAdapter({
    platform: "win32",
    command: "dsh.cmd",
    spawn: (command, args, options) => { launch = { command, args, options }; return fake.child; },
    exec: async () => ({ stdout: "dsh test" }),
  });
  const handle = adapter.start({ task: "windows", cwd: "C:\\work" });
  await handle.done;
  assert.equal(launch.command.toLowerCase().endsWith("cmd.exe"), true);
  assert.deepEqual(launch.args.slice(0, 6), ["/d", "/s", "/c", "dsh.cmd", "--profile", "acp"]);
  assert.equal(launch.options.windowsHide, true);
  assert.equal(handle.process_group_id, null);
  assert.equal(handle.process_tree_root_pid, 2468);
});

test("DshAcpAdapter exposes native permission option ids and resumes the same prompt", async () => {
  const fake = fakeAcpProcess({ permission: true, toolCall: true });
  const events = [];
  const adapter = new DshAcpAdapter({ platform: "linux", spawn: () => fake.child, exec: async () => ({ stdout: "dsh test" }) });
  const handle = adapter.start({ task: "run tool", cwd: "/tmp/work", onEvent: (event) => events.push(event) });
  const interaction = await waitFor(() => events.find((event) => event.type === "interaction_request"));

  assert.equal(interaction.kind, "permission");
  assert.equal(interaction.nativeContract.response.shape, "permission_option");
  assert.deepEqual(interaction.nativeContract.response.options.map((item) => item.option_id), ["allow-once", "reject-once"]);
  assert.equal(await handle.respond({ nativeRequestRef: interaction.nativeRequestRef, response: "allow-once" }), true);

  const result = await handle.done;
  assert.equal(result.status, "completed");
  assert.ok(events.some((event) => event.type === "side_effect" && event.classification === "external_possible"));
  assert.deepEqual(fake.messages.find((message) => message.id === "permission-1")?.result, {
    outcome: { outcome: "selected", optionId: "allow-once" },
  });
});

test("DshAcpAdapter resumes an opaque native session and uses native cancellation", async () => {
  const fake = fakeAcpProcess({ permission: true });
  const adapter = new DshAcpAdapter({ platform: "linux", spawn: () => fake.child, exec: async () => ({ stdout: "dsh test" }) });
  const handle = adapter.start({ task: "continue", cwd: "/tmp/work", sessionId: "session-acp" });
  await waitFor(() => fake.messages.find((message) => message.method === "session/prompt"));
  assert.equal(handle.cancel(), true);
  const result = await handle.done;

  assert.equal(result.status, "cancelled");
  assert.ok(fake.messages.some((message) => message.method === "session/resume" && message.params.sessionId === "session-acp"));
  assert.ok(fake.messages.some((message) => message.method === "session/cancel"));
});

test("DshAcpAdapter requires one advertised native permission option", () => {
  const options = [{ optionId: "allow-once" }, { optionId: "reject-once" }];
  assert.deepEqual(normalizeDshAcpPermissionResponse("allow-once", options), { outcome: { outcome: "selected", optionId: "allow-once" } });
  assert.deepEqual(normalizeDshAcpPermissionResponse("cancel", options), { outcome: { outcome: "cancelled" } });
  assert.throws(() => normalizeDshAcpPermissionResponse("allow", options), /advertised option id/);
});

test("DshAcpAdapter rejects an unknown configured permission mode", () => {
  assert.throws(() => new DshAcpAdapter({ permissionMode: "ambient" }), /permissionMode/);
});

test("DshAcpAdapter only classifies workspace-confined fs writes as workspace_only", () => {
  assert.equal(classifyDshAcpToolCall({ title: "write", rawInput: { file_path: "/repo/DONE.txt" } }, "/repo", "workspace-write"), "workspace_only");
  assert.equal(classifyDshAcpToolCall({ title: "edit", rawInput: { file_path: "src/a.js" } }, "/repo", "workspace-write"), "workspace_only");
  assert.equal(classifyDshAcpToolCall({ title: "write", rawInput: { file_path: "/tmp/outside.txt" } }, "/repo", "workspace-write"), "external_possible");
  assert.equal(classifyDshAcpToolCall({ title: "write", rawInput: { file_path: "/repo/DONE.txt", sandbox_permissions: "danger-full-access" } }, "/repo", "workspace-write"), "external_possible");
  assert.equal(classifyDshAcpToolCall({ title: "write", rawInput: { file_path: "/repo/DONE.txt" } }, "/repo", "danger-full-access"), "external_possible");
  assert.equal(classifyDshAcpToolCall({ title: "bash", rawInput: { command: "touch DONE.txt" } }, "/repo", "workspace-write"), "external_possible");
});

test("DshAcpAdapter approval contract reflects the configured DSH permission mode", async () => {
  const exec = async (_command, args) => args[0] === "--version"
    ? { stdout: "0.1.6-alpha.1\n" }
    : { stdout: "Serve automation clients over Agent Client Protocol stdio." };
  const workspace = await new DshAcpAdapter({ platform: "linux", exec, permissionMode: "workspace-write" }).probe();
  const unrestricted = await new DshAcpAdapter({ platform: "linux", exec, permissionMode: "danger-full-access" }).probe();

  assert.equal(workspace.approval_contract.interactive, true);
  assert.equal(workspace.approval_contract.behavior, "fail_closed");
  assert.equal(workspace.approval_contract.sandbox_mode, "workspace-write");
  assert.equal(unrestricted.approval_contract.interactive, false);
  assert.equal(unrestricted.approval_contract.behavior, "unattended");
  assert.equal(unrestricted.approval_contract.sandbox_mode, "danger-full-access");
});

test("DshAcpAdapter pins the child process to its configured permission mode", async () => {
  const fake = fakeAcpProcess();
  let mode;
  const adapter = new DshAcpAdapter({
    platform: "linux",
    permissionMode: "workspace-write",
    spawn: (_command, _args, options) => { mode = options.env.DSH_PERMISSION_MODE; return fake.child; },
    exec: async () => ({ stdout: "dsh test" }),
  });
  const result = await adapter.start({ task: "finish", cwd: "/tmp/work" }).done;
  assert.equal(result.status, "completed");
  assert.equal(mode, "workspace-write");
});
