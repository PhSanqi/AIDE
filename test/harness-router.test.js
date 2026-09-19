import assert from "node:assert/strict";
import test from "node:test";
import { HarnessRouter } from "../src/execution/harness-router.js";

function fakeAdapter() {
  let finish;
  return {
    probe: async () => ({ available: true, version: "test" }),
    start({ sessionId, onEvent }) {
      onEvent({ type: "session", sessionId: sessionId ?? "session-new" });
      return {
        pid: 77,
        cancel: () => true,
        done: new Promise((resolve) => { finish = resolve; }),
      };
    },
    finish(result) { finish(result); },
  };
}

function interactiveFakeAdapter() {
  let finish;
  const controls = { steered: [], responses: [] };
  return {
    controls,
    probe: async () => ({ available: true, version: "test", capabilities: ["same_turn_steer", "interaction_response"] }),
    start({ onEvent }) {
      onEvent({ type: "session", sessionId: "session-interactive" });
      return {
        pid: 88,
        cancel: () => true,
        steer: async (input) => { controls.steered.push(input); return true; },
        respond: async (payload) => { controls.responses.push(payload); return true; },
        done: new Promise((resolve) => { finish = resolve; }),
      };
    },
    finish(result) { finish(result); },
  };
}

test("HarnessRouter tracks one DSH lifecycle and buffered events", async () => {
  const dsh = fakeAdapter();
  const router = new HarnessRouter({ dsh });
  const started = router.start({ task: "x", cwd: "/tmp/work" });
  assert.equal(started.state, "running");
  assert.equal(started.session_id, "session-new");
  assert.equal(router.events(started.run_id).events.length, 1);

  dsh.finish({ status: "completed", exit_code: 0, session_id: "session-new", final_text: "ok" });
  await Promise.resolve();

  assert.equal(router.status(started.run_id).state, "completed");
  assert.deepEqual(router.result(started.run_id), { ready: true, run_id: started.run_id, harness: "dsh", status: "completed", exit_code: 0, session_id: "session-new", final_text: "ok" });
});

test("HarnessRouter continue passes the existing session id", () => {
  let seenSessionId;
  const dsh = fakeAdapter();
  const originalStart = dsh.start;
  dsh.start = (input) => { seenSessionId = input.sessionId; return originalStart(input); };
  const router = new HarnessRouter({ dsh });
  router.continue({ sessionId: "session-existing", task: "continue", cwd: "/tmp/work" });
  assert.equal(seenSessionId, "session-existing");
});

test("HarnessRouter passes scoped context through without interpreting it", () => {
  let seenContext;
  const dsh = fakeAdapter();
  const originalStart = dsh.start;
  dsh.start = (input) => { seenContext = input.context; return originalStart(input); };
  const router = new HarnessRouter({ dsh });
  const context = { query: async () => [] };

  router.start({ task: "x", cwd: "/tmp/work", context });
  assert.equal(seenContext, context);
});

test("HarnessRouter passes structured output schema through without interpreting it", () => {
  let seenOutputSchema;
  const dsh = fakeAdapter();
  const originalStart = dsh.start;
  dsh.start = (input) => { seenOutputSchema = input.outputSchema; return originalStart(input); };
  const router = new HarnessRouter({ dsh });
  const outputSchema = { type: "object", properties: { work_packages: { type: "array" } } };

  router.start({ task: "x", cwd: "/tmp/work", outputSchema });
  assert.deepEqual(seenOutputSchema, outputSchema);
});

test("HarnessRouter keeps cancellation non-terminal until the Harness exits", async () => {
  const dsh = fakeAdapter();
  const router = new HarnessRouter({ dsh });
  const started = router.start({ task: "x", cwd: "/tmp/work" });

  const cancelling = router.cancel(started.run_id);
  assert.equal(cancelling.state, "cancelling");
  assert.equal(cancelling.terminal, false);

  dsh.finish({ status: "cancelled", exit_code: null, signal: "SIGTERM", session_id: "session-new" });
  await Promise.resolve();
  assert.equal(router.status(started.run_id).state, "cancelled");
  assert.equal(router.status(started.run_id).terminal, true);
});

test("HarnessRouter forwards steer and interaction responses only when the adapter supports them", async () => {
  const interactive = interactiveFakeAdapter();
  const router = new HarnessRouter({ dsh: interactive });
  const started = router.start({ task: "x", cwd: "/tmp/work" });

  assert.equal((await router.steer(started.run_id, "focus on parser")).accepted, true);
  assert.deepEqual(interactive.controls.steered, ["focus on parser"]);
  assert.equal((await router.respond(started.run_id, { nativeRequestRef: "req-1", response: "allow" })).accepted, true);
  assert.deepEqual(interactive.controls.responses, [{ nativeRequestRef: "req-1", response: "allow" }]);
});

test("HarnessRouter does not emulate steer for a non-interactive adapter", async () => {
  const dsh = fakeAdapter();
  const router = new HarnessRouter({ dsh });
  const started = router.start({ task: "x", cwd: "/tmp/work" });
  await assert.rejects(router.steer(started.run_id, "change direction"), (error) => error.code === "HARNESS_CAPABILITY_UNSUPPORTED");
});

test("HarnessRouter reports an event gap when a consumer cursor falls behind the bounded buffer", () => {
  const dsh = {
    probe: async () => ({ available: true }),
    start({ onEvent }) {
      for (let index = 0; index < 513; index += 1) onEvent({ type: "text", text: String(index) });
      return { pid: 99, cancel: () => true, done: new Promise(() => {}) };
    },
  };
  const router = new HarnessRouter({ dsh });
  const started = router.start({ task: "x", cwd: "/tmp/work" });
  const batch = router.events(started.run_id, { after: 0 });

  assert.equal(batch.dropped, 1);
  assert.equal(batch.oldest_seq, 2);
  assert.equal(batch.latest_seq, 513);
  assert.equal(batch.gap, true);
  assert.equal(batch.events.length, 512);
});

test("HarnessRouter exposes DSH ACP as a distinct configured target", async () => {
  const dsh = { probe: async () => ({ available: true, capabilities: ["headless"] }) };
  const dshAcp = { probe: async () => ({ available: true, capabilities: ["acp", "interaction_response"] }) };
  const codex = { probe: async () => ({ available: false }) };
  const unavailable = { probe: async () => ({ available: false }) };
  const router = new HarnessRouter({ dsh, dshAcp, codex, codexEconomy: unavailable, codexCapability: unavailable, codexPlan: unavailable, codexPlanAlt: unavailable, codexReview: unavailable });
  const probe = await router.probe();

  assert.deepEqual(Object.keys(probe).sort(), ["codex", "codex-capability", "codex-economy", "codex-plan", "codex-plan-alt", "codex-review", "dsh", "dsh-acp"]);
  assert.deepEqual(probe["dsh-acp"].capabilities, ["acp", "interaction_response"]);
  assert.equal(probe["codex-economy"].available, false);
});

test("HarnessRouter exposes native process-group ownership when the adapter provides it", () => {
  const dsh = {
    probe: async () => ({ available: true }),
    start() {
      return { pid: 77, process_group_id: 7077, cancel: () => true, done: new Promise(() => {}) };
    },
  };
  const router = new HarnessRouter({ dsh });
  const started = router.start({ task: "x", cwd: "/tmp/work" });
  assert.equal(started.pid, 77);
  assert.equal(started.process_group_id, 7077);
});
