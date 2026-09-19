import assert from "node:assert/strict";
import test from "node:test";
import { AideControl } from "../src/control/control-service.js";

test("AideControl is a thin Tutti facade for submit/observe/respond/steer/cancel", async () => {
  const calls = [];
  const intake = {
    runTask: async (message, options) => { calls.push(["submit", message, options]); return { state: "waiting", attempt: { attempt_id: "attempt-1" } }; },
    startRun: async (message, options) => { calls.push(["startTask", message, options]); return { task: { task_id: "task-start" }, attempt: { attempt_id: "attempt-start" } }; },
    driveTask: async (attemptId, options) => { calls.push(["driveTask", attemptId, options]); return { state: "terminal" }; },
    observeAttempt: async (attemptId, options) => { calls.push(["observe", attemptId, options]); return { state: "running" }; },
    respondToInteraction: async (interactionId, response, options) => { calls.push(["respond", interactionId, response, options]); return { interaction_id: interactionId, attempt_id: "attempt-1" }; },
    runAttemptToBoundary: async (attemptId, options) => { calls.push(["supervise", attemptId, options]); return { state: "terminal" }; },
    advanceTask: async (boundary, options) => { calls.push(["advance", boundary.state, options]); return { state: "terminal", automation: { status: "completed" } }; },
    taskStatus: (taskId) => { calls.push(["status", taskId]); return { task: { task_id: taskId }, active_attempt: { attempt_id: "attempt-1" }, runtime: { attached: true } }; },
    recoveryStatus: () => { calls.push(["recoveries"]); return [{ task: { task_id: "task-recovery" }, runtime: { recovery_required: true } }]; },
    routingHistory: (options) => { calls.push(["routingHistory", options]); return [{ attempt_id: "attempt-history" }]; },
    recoverTask: async (taskId, recovery) => { calls.push(["recoverTask", taskId, recovery]); return { recovery: { status: "abandoned" } }; },
    steerAttempt: async (attemptId, message) => { calls.push(["steer", attemptId, message]); return { accepted: true }; },
    steerTask: async (taskId, message) => { calls.push(["steerTask", taskId, message]); return { accepted: true }; },
    requestCancel: async (attemptId) => { calls.push(["cancel", attemptId]); return { state: "cancelling" }; },
    cancelTask: async (taskId) => { calls.push(["cancelTask", taskId]); return { state: "cancelling" }; },
  };
  const control = new AideControl({ intake });

  assert.equal((await control.submit("do work", { timeoutMs: 10 })).state, "waiting");
  assert.equal((await control.startTask("start work")).task.task_id, "task-start");
  assert.equal((await control.driveTask("attempt-start")).state, "terminal");
  assert.equal((await control.observe("attempt-1")).state, "running");
  assert.equal(control.status("task-1").task.task_id, "task-1");
  assert.equal(control.recoveries()[0].task.task_id, "task-recovery");
  assert.equal(control.routingHistory({ limit: 5 })[0].attempt_id, "attempt-history");
  assert.equal((await control.recoverTask("task-recovery", { action: "abandon" })).recovery.status, "abandoned");
  assert.equal((await control.respond("interaction-1", "yes", { resolvedBy: "plugin", timeoutMs: 20 })).state, "terminal");
  assert.equal((await control.steer("attempt-1", "focus")).accepted, true);
  assert.equal((await control.steerTask("task-1", "focus task")).accepted, true);
  assert.equal((await control.cancel("attempt-1")).state, "cancelling");
  assert.equal((await control.cancelTask("task-1")).state, "cancelling");
  assert.deepEqual(calls.map(([name]) => name), ["submit", "startTask", "driveTask", "observe", "status", "recoveries", "routingHistory", "recoverTask", "respond", "supervise", "advance", "steer", "steerTask", "cancel", "cancelTask"]);
});
