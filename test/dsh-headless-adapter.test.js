import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { DshHeadlessAdapter, parseDshEvent } from "../src/execution/dsh-headless-adapter.js";

function fakeChildProcess(onStart) {
  return (command, args, options) => {
    const child = new EventEmitter();
    child.pid = 4321;
    child.exitCode = null;
    child.signalCode = null;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = (signal) => { child.signalCode = signal; return true; };
    onStart?.({ child, command, args, options });
    return child;
  };
}

test("parseDshEvent accepts a normal DSH event", () => {
  assert.deepEqual(parseDshEvent('{"type":"session","sessionId":"session-1"}'), { type: "session", sessionId: "session-1" });
});

test("DSH headless probe advertises only verified run-control capabilities", async () => {
  const adapter = new DshHeadlessAdapter({ platform: "linux", exec: async () => ({ stdout: "dsh test\n" }) });
  const probe = await adapter.probe();
  assert.equal(probe.available, true);
  assert.deepEqual(probe.capabilities, ["headless", "json_events", "stream_events", "session_resume", "cancel"]);
  assert.equal(probe.capabilities.includes("same_turn_steer"), false);
  assert.equal(probe.capabilities.includes("interaction_response"), false);
  assert.equal(probe.approval_contract.provider, "dsh");
  assert.equal(probe.approval_contract.profile, "headless");
  assert.equal(probe.approval_contract.interactive, false);
  assert.equal(probe.approval_contract.response_capability, false);
  assert.equal(probe.approval_contract.behavior, "fail_closed");
  assert.deepEqual(probe.approval_contract.native_policy_model, ["ask", "never"]);
  assert.equal(probe.approval_contract.session_grants, false);
  assert.equal(probe.approval_contract.remembered_grants, false);
  assert.equal(probe.approval_contract.one_shot_grants, false);
  assert.equal(probe.approval_contract.sandbox_mode, "workspace-write");
});

test("parseDshEvent preserves large final events", () => {
  const text = "x".repeat(100_000);
  assert.equal(parseDshEvent(JSON.stringify({ type: "final", text })).text.length, text.length);
});

test("DSH adapter uses headless JSON over stdin and normalizes the result", async () => {
  let invocation;
  let task = "";
  const adapter = new DshHeadlessAdapter({
    platform: "linux",
    command: "/test/dsh",
    spawn: fakeChildProcess(({ child, ...rest }) => {
      invocation = rest;
      child.stdin.on("data", (chunk) => { task += chunk.toString(); });
      queueMicrotask(() => {
        child.stdout.write('{"type":"session","sessionId":"session-abc","cwd":"/tmp/work"}\n');
        child.stdout.write('{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"completed"}}\n');
        child.stdout.write('{"type":"final","text":"done"}\n');
        child.exitCode = 0;
        child.emit("close", 0, null);
      });
    }),
  });

  const events = [];
  const handle = adapter.start({ task: "run tests", cwd: "/tmp/work", onEvent: (event) => events.push(event) });
  const result = await handle.done;

  assert.equal(invocation.command, "/test/dsh");
  assert.deepEqual(invocation.args, ["--profile", "headless", "--json"]);
  assert.equal(invocation.options.cwd, "/tmp/work");
  assert.equal(task, "run tests");
  assert.equal(events[0].type, "approval_state");
  assert.equal(events[0].state.session_grants, false);
  assert.equal(events[0].state.one_shot_grants, false);
  assert.equal(events[0].state.remembered_grants, false);
  assert.equal(events[0].state.auto_review, false);
  assert.equal(events[0].state.sandbox_mode, "workspace-write");
  assert.equal(events[0].state.profile, "headless");
  assert.equal(events[0].state.interactive, false);
  assert.equal(events[1].type, "session");
  assert.equal(result.status, "completed");
  assert.equal(result.session_id, "session-abc");
  assert.equal(result.final_text, "done");
  assert.equal(result.turn_end_reason, "completed");
});

test("DSH adapter resumes an explicit session and treats non-zero exit as failure", async () => {
  let args;
  const adapter = new DshHeadlessAdapter({
    platform: "linux",
    spawn: fakeChildProcess(({ child, args: actual }) => {
      args = actual;
      queueMicrotask(() => {
        child.stdout.write('{"type":"session","sessionId":"session-old"}\n');
        child.stdout.write('{"type":"final","text":""}\n');
        child.exitCode = 1;
        child.emit("close", 1, null);
      });
    }),
  });
  const result = await adapter.start({ task: "continue", cwd: "/tmp/work", sessionId: "session-old" }).done;
  assert.deepEqual(args, ["--profile", "headless", "--json", "--session-id", "session-old"]);
  assert.equal(result.status, "failed");
  assert.equal(result.error_code, "DSH_EXIT_NONZERO");
});

test("DSH Headless uses the Windows cmd shim and persists a process-tree root", async () => {
  let invocation;
  const adapter = new DshHeadlessAdapter({
    platform: "win32",
    command: "dsh.cmd",
    spawn: fakeChildProcess(({ child, ...rest }) => {
      invocation = rest;
      queueMicrotask(() => {
        child.stdout.write('{"type":"session","sessionId":"session-win"}\n');
        child.stdout.write('{"type":"final","text":"done"}\n');
        child.exitCode = 0;
        child.emit("close", 0, null);
      });
    }),
  });
  const handle = adapter.start({ task: "windows", cwd: "C:\\work" });
  await handle.done;
  assert.equal(invocation.command.toLowerCase().endsWith("cmd.exe"), true);
  assert.deepEqual(invocation.args.slice(0, 7), ["/d", "/s", "/c", "dsh.cmd", "--profile", "headless", "--json"]);
  assert.equal(invocation.options.windowsHide, true);
  assert.equal(handle.process_group_id, null);
  assert.equal(handle.process_tree_root_pid, 4321);
});
