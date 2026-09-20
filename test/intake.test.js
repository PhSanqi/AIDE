import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkStateStore } from "../src/core/work-state-store.js";
import { HarnessRouter } from "../src/execution/harness-router.js";
import { LocalContextFabric } from "../src/tutti/context-fabric.js";
import { createHarnessSemanticVerifier, TuttiIntake } from "../src/tutti/intake.js";

test("TuttiIntake creates work, prepares shared context, and automatically selects a qualified target", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const router = { probe: async () => ({ dsh: { available: true, version: "1", capabilities: ["headless"] }, unavailable: { available: false, capabilities: ["headless"] } }) };
  const intake = new TuttiIntake({ store, router, context });

  const submitted = await intake.submit("implement the bounded change", { requirements: { capabilities: ["headless"] } });

  assert.equal(submitted.task.objective, "implement the bounded change");
  assert.equal(submitted.work_package.task_id, submitted.task.task_id);
  assert.equal(submitted.routing_context.goal, submitted.task.objective);
  assert.equal(Object.hasOwn(submitted, "execution_context"), false);
  assert.equal(submitted.assignment.harness, "dsh");
  assert.equal(submitted.assignment.decision_reason, "only_qualified_candidate");
  assert.deepEqual(submitted.recommendation.rejected, [{ id: "unavailable", reasons: ["unavailable"] }]);
});

test("TuttiIntake preflight proves routing and workspace intent without creating durable work", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-preflight-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const router = { probe: async () => ({ dsh: { available: true, capabilities: ["headless"] } }) };
  const intake = new TuttiIntake({ store, router, context });
  const before = store.listTaskViews().length;

  const preflight = await intake.preflight("prove before executing", {
    workspace: root,
    constraints: ["Keep the current public API."],
    requirements: { preferred_targets: ["dsh"], capabilities: ["headless"] },
  });

  assert.equal(preflight.dry_run, true);
  assert.equal(preflight.workflow, "direct");
  assert.equal(preflight.assignment.id, "dsh");
  assert.equal(preflight.workspace.path, root);
  assert.equal(preflight.durable_state_created, false);
  assert.equal(preflight.native_run_started, false);
  assert.equal(store.listTaskViews().length, before);
});

test("TuttiIntake preflight uses the same direct-model and isolation gates as submission", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-preflight-gates-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const router = {
    probe: async () => ({
      "codex-capability": {
        available: true,
        provider: "codex",
        model_directory: [{ id: "gpt-small", model: "gpt-small", default_reasoning_effort: "medium", reasoning_efforts: ["medium"], multi_agent_version: "v1" }],
      },
    }),
  };
  const intake = new TuttiIntake({ store, router, context });

  await assert.rejects(
    intake.preflight("invalid mixed mode", {
      requirements: { execution_strategy: "capability", preferred_targets: ["codex-capability"], requested_model: "gpt-small", semantic_decomposition: "plan" },
    }),
    /only supported for direct execution/,
  );
  await assert.rejects(
    intake.preflight("isolated run", { workspace: root, requirements: { preferred_targets: ["codex-capability"], workspace_isolation: "attempt" } }),
    (error) => error.code === "WORKSPACE_ISOLATION_PATH_FORBIDDEN",
  );
  assert.equal(store.listTaskViews().length, 0);
});

test("TuttiIntake never uses alphabetical candidate order as an implicit assignment policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-assignment-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const router = { probe: async () => ({ dsh: { available: true }, codex: { available: true } }) };
  const intake = new TuttiIntake({ store, router, context });

  await assert.rejects(intake.submit("do not pick by id"), (error) => {
    assert.equal(error.code, "HARNESS_ASSIGNMENT_AMBIGUOUS");
    assert.deepEqual(error.candidate_ids, ["codex", "dsh"]);
    return true;
  });

  const submitted = await intake.submit("use the explicit preference", { requirements: { preferred_targets: ["dsh", "codex"] } });
  assert.equal(submitted.assignment.id, "dsh");
  assert.equal(submitted.assignment.decision_reason, "preferred_target");
});

test("TuttiIntake applies one configured target preference when the task does not override it", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-default-preference-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const router = { probe: async () => ({ dsh: { available: true }, codex: { available: true } }) };
  const intake = new TuttiIntake({ store, router, context, targetPreference: ["dsh", "codex"] });

  const submitted = await intake.submit("use deployment preference");
  assert.equal(submitted.assignment.id, "dsh");
  assert.deepEqual(submitted.work_package.requirements.preferred_targets, ["dsh", "codex"]);

  const overridden = await intake.submit("override deployment preference", { requirements: { preferred_targets: ["codex"] } });
  assert.equal(overridden.assignment.id, "codex");
  assert.deepEqual(overridden.work_package.requirements.preferred_targets, ["codex"]);
});

test("TuttiIntake lets an explicit execution strategy select one ranked configured target", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-strategy-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const router = {
    probe: async () => ({
      "codex-economy": { available: true, strategy_priority: { economy: 0 }, model: "small" },
      "codex-capability": { available: true, strategy_priority: { capability: 0 }, model: "large" },
      "codex-plan": { available: true, role: "planning", capabilities: ["planning_mode"] },
    }),
  };
  const intake = new TuttiIntake({ store, router, context });

  const economy = await intake.submit("use fewer resources", { requirements: { execution_strategy: "economy" } });
  const capability = await intake.submit("use more capability", { requirements: { execution_strategy: "capability" } });

  assert.equal(economy.assignment.id, "codex-economy");
  assert.equal(economy.assignment.decision_reason, "strategy_economy");
  assert.equal(economy.assignment.model, "small");
  assert.equal(capability.assignment.id, "codex-capability");
  assert.equal(capability.assignment.decision_reason, "strategy_capability");
  assert.ok(economy.recommendation.rejected.some((item) => item.id === "codex-plan" && item.reasons[0] === "role:planning"));
});

test("TuttiIntake freezes one explicit Direct model/effort inside a preferred Codex profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-model-preference-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const router = {
    probe: async () => ({
      "codex-capability": {
        available: true,
        provider: "codex",
        model: "gpt-large",
        reasoning_effort: "ultra",
        model_directory: [
          { id: "gpt-small", model: "gpt-small", default_reasoning_effort: "medium", reasoning_efforts: ["low", "medium"], multi_agent_version: "v1" },
          { id: "gpt-large", model: "gpt-large", default_reasoning_effort: "high", reasoning_efforts: ["high", "ultra"], multi_agent_version: "v2" },
        ],
      },
    }),
  };
  const intake = new TuttiIntake({ store, router, context });
  const submitted = await intake.submit("use the selected model", {
    requirements: {
      preferred_targets: ["codex-capability"],
      requested_model: "gpt-small",
      requested_reasoning_effort: "low",
    },
  });
  assert.equal(submitted.assignment.id, "codex-capability");
  assert.equal(submitted.assignment.model, "gpt-small");
  assert.equal(submitted.assignment.reasoning_effort, "low");
  assert.deepEqual(submitted.work_package.requirements, {
    preferred_targets: ["codex-capability"],
    requested_model: "gpt-small",
    requested_reasoning_effort: "low",
  });

  const before = store.listTaskViews().length;
  await assert.rejects(
    intake.submit("do not mix model override with decomposition", {
      requirements: { preferred_targets: ["codex-capability"], execution_strategy: "capability", requested_model: "gpt-small", semantic_decomposition: "plan" },
    }),
    /only supported for direct execution/,
  );
  assert.equal(store.listTaskViews().length, before);
});

test("TuttiIntake records shadow routing advice without changing the actual assignment", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-shadow-routing-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const router = {
    probe: async () => ({
      economy: { available: true, strategy_priority: { economy: 0 }, model: "small", reasoning_effort: "low" },
      capability: { available: true, strategy_priority: { capability: 0 }, model: "large", reasoning_effort: "high" },
    }),
  };
  const intake = new TuttiIntake({
    store,
    router,
    context,
    shadowAdvisor: async ({ actual }) => ({ source: "fake-advisor", target_id: "capability", model: "large", reasoning_effort: "high", confidence: 0.82, reason: `shadow-only; actual=${actual.id}` }),
  });

  const submitted = await intake.submit("mechanical task", { requirements: { execution_strategy: "economy" } });
  assert.equal(submitted.assignment.id, "economy");
  assert.deepEqual(submitted.routing_advice, {
    status: "available",
    advice: {
      source: "fake-advisor",
      target_id: "capability",
      model: "large",
      reasoning_effort: "high",
      confidence: 0.82,
      reason: "shadow-only; actual=economy",
    },
  });
});

test("TuttiIntake persists an insufficient-history shadow decision without inventing an alternate target", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-shadow-insufficient-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const router = { probe: async () => ({ economy: { available: true, strategy_priority: { economy: 0 } }, capability: { available: true } }) };
  const intake = new TuttiIntake({
    store,
    router,
    context,
    shadowAdvisor: async () => ({ source: "history-v0", decision: "insufficient_history", reason: "not enough samples", metrics: { min_samples: 10, comparable_attempts: 1 } }),
  });
  const submitted = await intake.submit("keep the actual route", { requirements: { execution_strategy: "economy" } });
  assert.equal(submitted.assignment.id, "economy");
  assert.deepEqual(submitted.routing_advice, {
    status: "available",
    advice: {
      source: "history-v0",
      decision: "insufficient_history",
      reason: "not enough samples",
      metrics: { min_samples: 10, comparable_attempts: 1 },
    },
  });
});

test("TuttiIntake shadow routing failure is observational and never blocks assignment", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-shadow-routing-failure-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const router = { probe: async () => ({ dsh: { available: true } }) };
  const intake = new TuttiIntake({
    store,
    router,
    context,
    shadowAdvisor: async () => { throw Object.assign(new Error("advisor offline"), { code: "ADVISOR_OFFLINE" }); },
  });

  const submitted = await intake.submit("keep working if shadow advice is unavailable");
  assert.equal(submitted.assignment.id, "dsh");
  assert.deepEqual(submitted.routing_advice, {
    status: "unavailable",
    error_code: "ADVISOR_OFFLINE",
    error_message: "advisor offline",
  });
});

test("TuttiIntake can apply one globally configured execution strategy while allowing per-task override", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-default-strategy-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const router = {
    probe: async () => ({
      economy: { available: true, strategy_priority: { economy: 0 } },
      capability: { available: true, strategy_priority: { capability: 0 } },
    }),
  };
  const intake = new TuttiIntake({ store, router, context, defaultExecutionStrategy: "economy" });

  const defaulted = await intake.submit("default strategy");
  const overridden = await intake.submit("override strategy", { requirements: { execution_strategy: "capability" } });
  assert.equal(defaulted.work_package.requirements.execution_strategy, "economy");
  assert.equal(defaulted.assignment.id, "economy");
  assert.equal(overridden.assignment.id, "capability");
});

test("TuttiIntake does not silently downgrade one execution strategy into the opposite configured profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-strategy-no-downgrade-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const router = {
    probe: async () => ({
      "codex-economy": { available: false, strategy_priority: { economy: 0 } },
      "codex-capability": { available: true, strategy_priority: { capability: 0 } },
      codex: { available: true },
    }),
  };
  const intake = new TuttiIntake({ store, router, context });

  await assert.rejects(
    intake.submit("do not silently spend more", { requirements: { execution_strategy: "economy" } }),
    (error) => error.code === "HARNESS_ASSIGNMENT_AMBIGUOUS"
      && error.candidate_ids.includes("codex-capability")
      && error.candidate_ids.includes("codex"),
  );
});

test("TuttiIntake capability crossfire runs two independent planners before one executor", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-crossfire-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  let sequence = 0;
  const runs = new Map();
  const starts = [];
  const router = {
    probe: async () => ({
      "codex-plan": { available: true, role: "planning", model: "planner-a", capabilities: ["planning_mode"], approval_contract: { sandbox_mode: "read-only" } },
      "codex-plan-alt": { available: true, role: "planning", model: "planner-b", capabilities: ["planning_mode"], approval_contract: { sandbox_mode: "read-only" } },
      "codex-capability": { available: true, role: "execution", model: "executor", capabilities: ["json_events"], strategy_priority: { capability: 0 } },
    }),
    start: ({ harness, task }) => {
      const runId = `run-crossfire-${++sequence}`;
      starts.push({ harness, task });
      const finalText = harness === "codex-plan"
        ? "PLAN_A: preserve the current boundary."
        : harness === "codex-plan-alt"
          ? "PLAN_B: verify the boundary before changing it."
          : "EXECUTED";
      runs.set(runId, { harness, status: "completed", final_text: finalText, exit_code: 0 });
      return { run_id: runId, state: "running" };
    },
    result: (runId) => ({ ready: true, run_id: runId, ...runs.get(runId) }),
    events: (runId, { after = 0 } = {}) => {
      const run = runs.get(runId);
      const events = run?.harness?.startsWith("codex-plan") ? [
        { seq: 1, event: { type: "approval_state", state: { sandbox_mode: "read-only" } } },
        { seq: 2, event: { type: "side_effect", classification: "none", source: "test-plan" } },
      ] : [];
      return { run_id: runId, dropped: 0, oldest_seq: 1, latest_seq: events.length, gap: false, events: events.filter((item) => item.seq > after) };
    },
    cancel: () => undefined,
  };
  const intake = new TuttiIntake({ store, router, context });

  const completed = await intake.runTask("implement after independent planning", {
    acceptance: { finalText: "EXECUTED" },
    requirements: {
      execution_strategy: "capability",
      plan_consensus: "dual",
      plan_targets: ["codex-plan", "codex-plan-alt"],
    },
  });

  assert.deepEqual(starts.map((item) => item.harness), ["codex-plan", "codex-plan-alt", "codex-capability"]);
  assert.equal(completed.verification.accepted, true);
  assert.equal(completed.closure.task.status, "completed");
  assert.equal(completed.assignment.id, "codex-capability");
  assert.equal(completed.attempt_chain.length, 3);
  assert.ok(starts[2].task.includes("PLAN_A: preserve the current boundary."));
  assert.ok(starts[2].task.includes("PLAN_B: verify the boundary before changing it."));
  assert.ok(starts[0].task.includes("AIDE independent crossfire planning role:"));
  assert.ok(starts[1].task.includes("AIDE independent crossfire planning role:"));
  assert.equal(starts[0].task.includes("PLAN_B"), false);
  assert.equal(starts[1].task.includes("PLAN_A"), false);
  const view = store.getTaskView(completed.task.task_id);
  assert.equal(view.work_packages.length, 3);
  assert.ok(view.work_packages.every((workPackage) => workPackage.status === "completed"));
  assert.deepEqual(view.work_packages.map((workPackage) => workPackage.lineage?.kind ?? null), ["submission", "plan_consensus_planner", "plan_consensus_execution"]);
  assert.equal(view.work_packages[1].lineage.from_attempt_id, view.attempts[0].attempt_id);
  assert.equal(view.work_packages[2].lineage.from_attempt_id, view.attempts[1].attempt_id);
  assert.deepEqual(view.attempts.slice(0, 2).map((attempt) => attempt.assignment.role), ["planning", "planning"]);
});

test("TuttiIntake persists one structured semantic decomposition decision before execution", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-decomposition-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  let sequence = 0;
  const runs = new Map();
  const starts = [];
  const router = {
    probe: async () => ({
      "codex-plan": { available: true, role: "planning", model: "planner", capabilities: ["planning_mode", "structured_output"], approval_contract: { sandbox_mode: "read-only" } },
      "codex-capability": { available: true, role: "execution", model: "executor", capabilities: ["json_events"], strategy_priority: { capability: 0 } },
    }),
    start: ({ harness, task, outputSchema }) => {
      const runId = `run-decomposition-${++sequence}`;
      starts.push({ harness, task, outputSchema });
      const finalText = harness === "codex-plan"
        ? JSON.stringify({
            decision: "decompose",
            reason: "The objective has two ordered implementation concerns.",
            work_packages: [
              { objective: "STEP_ONE", verification: "STEP_ONE postcondition is satisfied." },
              { objective: "STEP_TWO", verification: "STEP_TWO postcondition is satisfied." },
            ],
          })
        : "EXECUTED";
      runs.set(runId, { harness, status: "completed", final_text: finalText, exit_code: 0 });
      return { run_id: runId, state: "running" };
    },
    result: (runId) => ({ ready: true, run_id: runId, ...runs.get(runId) }),
    events: (runId, { after = 0 } = {}) => {
      const run = runs.get(runId);
      const events = run?.harness === "codex-plan" ? [
        { seq: 1, event: { type: "approval_state", state: { sandbox_mode: "read-only" } } },
        { seq: 2, event: { type: "side_effect", classification: "none", source: "test-decomposition-plan" } },
      ] : [];
      return { run_id: runId, dropped: 0, oldest_seq: 1, latest_seq: events.length, gap: false, events: events.filter((item) => item.seq > after) };
    },
    cancel: () => undefined,
  };
  const semanticCalls = [];
  const intake = new TuttiIntake({
    store,
    router,
    context,
    semanticVerifier: async ({ criteria }) => {
      semanticCalls.push(criteria);
      return { source: "step-verifier", checks: criteria.map((criterion) => ({ criterion, passed: true, reason: "verified" })) };
    },
  });

  const completed = await intake.runTask("make the bounded architectural change", {
    acceptance: { finalText: "EXECUTED", semantic: ["The final Task behavior remains correct."] },
    constraints: ["Preserve the existing public API."],
    requirements: { execution_strategy: "capability", semantic_decomposition: "plan", capabilities: ["json_events"] },
  });

  assert.deepEqual(starts.map((item) => item.harness), ["codex-plan", "codex-capability"]);
  assert.ok(starts[0].outputSchema);
  assert.equal(starts[1].outputSchema, undefined);
  assert.ok(starts[0].task.includes("AIDE semantic decomposition role:"));
  assert.ok(starts[0].task.includes("verification"));
  assert.ok(starts[0].task.includes("Preserve the existing public API."));
  assert.ok(starts[1].task.includes("AIDE ordered semantic decomposition execution:"));
  assert.ok(starts[1].task.includes("STEP_ONE"));
  assert.ok(starts[1].task.includes("STEP_TWO"));
  assert.ok(starts[1].task.includes("Preserve the existing public API."));
  const view = store.getTaskView(completed.task.task_id);
  assert.equal(view.task.semantic_decision.kind, "task_decomposition");
  assert.equal(view.task.semantic_decision.decision, "decompose");
  assert.deepEqual(view.task.semantic_decision.steps, [
    { objective: "STEP_ONE", verification: "STEP_ONE postcondition is satisfied." },
    { objective: "STEP_TWO", verification: "STEP_TWO postcondition is satisfied." },
  ]);
  assert.deepEqual(semanticCalls, [[
    "The final Task behavior remains correct.",
    "STEP_ONE postcondition is satisfied.",
    "STEP_TWO postcondition is satisfied.",
  ]]);
  assert.deepEqual(view.task.constraints, ["Preserve the existing public API."]);
  assert.deepEqual(view.work_packages[1].requirements.capabilities, ["json_events"]);
  assert.deepEqual(view.work_packages.map((workPackage) => workPackage.lineage?.kind ?? null), ["submission", "semantic_decomposition_execution"]);
  assert.equal(view.work_packages[0].status, "completed");
  assert.equal(view.work_packages[1].status, "completed");
  assert.equal(completed.verification.accepted, true);
  assert.equal(completed.verification.step_verification.accepted, true);
  assert.deepEqual(completed.verification.step_verification.steps.map((step) => step.step_index), [1, 2]);
  assert.equal(completed.closure.task.status, "completed");
});

test("TuttiIntake blocks Task closure when one decomposed step postcondition fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-step-verification-fail-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  let sequence = 0;
  const runs = new Map();
  const router = {
    probe: async () => ({
      "codex-plan": { available: true, role: "planning", capabilities: ["planning_mode", "structured_output"], approval_contract: { sandbox_mode: "read-only" } },
      "codex-capability": { available: true, role: "execution", strategy_priority: { capability: 0 } },
    }),
    start: ({ harness }) => {
      const runId = `run-step-verification-${++sequence}`;
      runs.set(runId, {
        status: "completed",
        final_text: harness === "codex-plan"
          ? JSON.stringify({
              decision: "decompose",
              reason: "Two ordered postconditions need verification.",
              work_packages: [
                { objective: "STEP_ONE", verification: "First postcondition." },
                { objective: "STEP_TWO", verification: "Second postcondition." },
              ],
            })
          : "EXECUTED",
      });
      return { run_id: runId, state: "running" };
    },
    result: (runId) => ({ ready: true, run_id: runId, ...runs.get(runId) }),
    events: (runId, { after = 0 } = {}) => {
      const events = runId === "run-step-verification-1" ? [
        { seq: 1, event: { type: "approval_state", state: { sandbox_mode: "read-only" } } },
        { seq: 2, event: { type: "side_effect", classification: "none", source: "test-decomposition-plan" } },
      ] : [];
      return { run_id: runId, dropped: 0, oldest_seq: 1, latest_seq: events.length, gap: false, events: events.filter((item) => item.seq > after) };
    },
    cancel: () => undefined,
  };
  const intake = new TuttiIntake({
    store,
    router,
    context,
    semanticVerifier: async ({ criteria }) => ({
      source: "step-verifier",
      checks: criteria.map((criterion, index) => ({ criterion, passed: index === 0, reason: index === 0 ? "verified" : "missing evidence" })),
    }),
  });

  const completed = await intake.runTask("verify every planned step", {
    acceptance: { finalText: "EXECUTED" },
    requirements: { execution_strategy: "capability", semantic_decomposition: "plan" },
  });

  assert.equal(completed.verification.accepted, false);
  assert.equal(completed.verification.step_verification.accepted, false);
  assert.equal(completed.verification.step_verification.steps[0].passed, true);
  assert.equal(completed.verification.step_verification.steps[1].passed, false);
  assert.equal(store.getTask(completed.task.task_id).status, "open");
  assert.equal(completed.closure, null);
});

test("TuttiIntake keeps semantic decomposition explicit to capability mode and separate from crossfire", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-decomposition-policy-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const router = { probe: async () => ({}) };
  const intake = new TuttiIntake({ store, router, context });

  await assert.rejects(
    intake.submit("do not add a hidden planner", { requirements: { execution_strategy: "economy", semantic_decomposition: "plan" } }),
    /requires execution_strategy=capability/,
  );
  await assert.rejects(
    intake.submit("do not merge two planning semantics", { requirements: { execution_strategy: "capability", semantic_decomposition: "plan", plan_consensus: "dual" } }),
    /cannot be combined with plan_consensus/,
  );
});

test("TuttiIntake fail-closes invalid structured decomposition instead of silently executing", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-decomposition-invalid-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  let starts = 0;
  const router = {
    probe: async () => ({
      "codex-plan": { available: true, role: "planning", capabilities: ["planning_mode", "structured_output"], approval_contract: { sandbox_mode: "read-only" } },
      "codex-capability": { available: true, role: "execution", strategy_priority: { capability: 0 } },
    }),
    start: () => ({ run_id: `run-invalid-${++starts}`, state: "running" }),
    result: () => ({
      ready: true,
      status: "completed",
      final_text: JSON.stringify({
        decision: "decompose",
        reason: "This looks structured but omits required step verification.",
        work_packages: [{ objective: "STEP_ONE" }, { objective: "STEP_TWO" }],
      }),
    }),
    events: (runId, { after = 0 } = {}) => ({
      run_id: runId,
      dropped: 0,
      oldest_seq: 1,
      latest_seq: 2,
      gap: false,
      events: [
        { seq: 1, event: { type: "approval_state", state: { sandbox_mode: "read-only" } } },
        { seq: 2, event: { type: "side_effect", classification: "none", source: "test-decomposition-plan" } },
      ].filter((item) => item.seq > after),
    }),
    cancel: () => undefined,
  };
  const intake = new TuttiIntake({ store, router, context });
  const result = await intake.runTask("reject malformed semantic decisions", {
    requirements: { execution_strategy: "capability", semantic_decomposition: "plan" },
  });

  assert.equal(starts, 1);
  assert.equal(result.verification.accepted, false);
  assert.equal(result.semantic_decomposition.status, "blocked");
  assert.equal(result.semantic_decomposition.error_code, "SEMANTIC_DECOMPOSITION_ATTEMPT_FAILED");
  assert.equal(store.getTask(result.task.task_id).semantic_decision, null);
});

test("TuttiIntake can advance a persisted terminal decomposition planner after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-decomposition-restart-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const task = await store.createTask({ objective: "resume semantic planning", acceptance: { finalText: "EXECUTED" } });
  const planningWorkPackage = await store.createWorkPackage({
    taskId: task.task_id,
    objective: task.objective,
    requirements: { execution_strategy: "capability", semantic_decomposition: "plan" },
  });
  const planningAttempt = await store.createAttempt({
    workPackageId: planningWorkPackage.work_package_id,
    assignment: { id: "codex-plan", harness: "codex-plan", role: "planning" },
    workspace: root,
  });
  await store.markAttemptRunning(planningAttempt.attempt_id, { runId: "lost-router-run" });
  await store.recordAttemptSideEffects(planningAttempt.attempt_id, { classification: "none", source: "persisted-plan" });
  const persisted = await store.finishAttempt(planningAttempt.attempt_id, {
    result: {
      status: "completed",
      final_text: JSON.stringify({ decision: "single", reason: "One executor is enough.", work_packages: [] }),
    },
    evidence: {},
    acceptance: { accepted: true, checks: [] },
  });

  const runs = new Map();
  const router = {
    probe: async () => ({ "codex-capability": { available: true, role: "execution", strategy_priority: { capability: 0 } } }),
    start: () => {
      runs.set("run-restarted-executor", { status: "completed", final_text: "EXECUTED" });
      return { run_id: "run-restarted-executor", state: "running" };
    },
    result: (runId) => ({ ready: true, run_id: runId, ...runs.get(runId) }),
    events: (runId) => ({ run_id: runId, dropped: 0, oldest_seq: 1, latest_seq: 0, gap: false, events: [] }),
    cancel: () => undefined,
  };
  const context = await LocalContextFabric.open({ root, store });
  const restarted = new TuttiIntake({ store, router, context });
  const result = await restarted.advanceTask({ state: "terminal", attempt: persisted, result: persisted.outcome, evidence: persisted.evidence, verification: persisted.acceptance, closure: null });

  assert.equal(result.closure.task.status, "completed");
  assert.equal(store.getTask(task.task_id).semantic_decision.decision, "single");
  assert.equal(store.getTaskView(task.task_id).work_packages.length, 2);
});

test("TuttiIntake crossfire blocks when a planner returns the executor final marker instead of a plan", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-crossfire-fail-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  let sequence = 0;
  const runs = new Map();
  const starts = [];
  const router = {
    probe: async () => ({
      p1: { available: true, role: "planning", capabilities: ["planning_mode"], approval_contract: { sandbox_mode: "read-only" } },
      p2: { available: true, role: "planning", capabilities: ["planning_mode"], approval_contract: { sandbox_mode: "read-only" } },
      exec: { available: true, role: "execution", strategy_priority: { capability: 0 } },
    }),
    start: ({ harness }) => {
      const runId = `run-crossfire-fail-${++sequence}`;
      starts.push(harness);
      runs.set(runId, { harness, status: "completed", final_text: harness === "p1" ? "PLAN" : "EXECUTED", exit_code: 0 });
      return { run_id: runId, state: "running" };
    },
    result: (runId) => ({ ready: true, run_id: runId, ...runs.get(runId) }),
    events: (runId, { after = 0 } = {}) => {
      const run = runs.get(runId);
      const events = run?.harness === "p1" || run?.harness === "p2" ? [
        { seq: 1, event: { type: "approval_state", state: { sandbox_mode: "read-only" } } },
        { seq: 2, event: { type: "side_effect", classification: "none", source: "test-plan" } },
      ] : [];
      return { run_id: runId, dropped: 0, oldest_seq: 1, latest_seq: events.length, gap: false, events: events.filter((item) => item.seq > after) };
    },
    cancel: () => undefined,
  };
  const intake = new TuttiIntake({ store, router, context });
  const result = await intake.runTask("plan safely", {
    acceptance: { finalText: "EXECUTED" },
    requirements: { execution_strategy: "capability", plan_consensus: "dual", plan_targets: ["p1", "p2"] },
  });

  assert.deepEqual(starts, ["p1", "p2"]);
  assert.equal(result.closure, null);
  assert.equal(result.plan_consensus.status, "blocked");
  assert.equal(result.plan_consensus.error_code, "PLAN_CONSENSUS_ATTEMPT_FAILED");
  assert.equal(store.getTask(result.task.task_id).status, "open");
});

test("TuttiIntake idempotent replay resumes an open Task from a terminal planning boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-crossfire-replay-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  let sequence = 0;
  const runs = new Map();
  const starts = [];
  const router = {
    probe: async () => ({
      p1: { available: true, role: "planning", capabilities: ["planning_mode"], approval_contract: { sandbox_mode: "read-only" } },
      p2: { available: true, role: "planning", capabilities: ["planning_mode"], approval_contract: { sandbox_mode: "read-only" } },
      exec: { available: true, role: "execution", strategy_priority: { capability: 0 } },
    }),
    start: ({ harness }) => {
      const runId = `run-crossfire-replay-${++sequence}`;
      starts.push(harness);
      runs.set(runId, {
        harness,
        status: "completed",
        final_text: harness === "p1" ? "PLAN_ONE" : harness === "p2" ? "PLAN_TWO" : "EXECUTED",
        exit_code: 0,
      });
      return { run_id: runId, state: "running" };
    },
    result: (runId) => ({ ready: true, run_id: runId, ...runs.get(runId) }),
    events: (runId, { after = 0 } = {}) => {
      const run = runs.get(runId);
      const events = run?.harness === "p1" || run?.harness === "p2" ? [
        { seq: 1, event: { type: "approval_state", state: { sandbox_mode: "read-only" } } },
        { seq: 2, event: { type: "side_effect", classification: "none", source: "test-plan" } },
      ] : [];
      return { run_id: runId, dropped: 0, oldest_seq: 1, latest_seq: events.length, gap: false, events: events.filter((item) => item.seq > after) };
    },
    cancel: () => undefined,
  };
  const options = {
    clientRequestId: "crossfire-replay-1",
    acceptance: { finalText: "EXECUTED" },
    requirements: { execution_strategy: "capability", plan_consensus: "dual", plan_targets: ["p1", "p2"] },
  };
  const intake = new TuttiIntake({ store, router, context });
  const started = await intake.startRun("resume durable planning", options);
  const firstPlan = await intake.runAttemptToBoundary(started.attempt.attempt_id);
  assert.equal(firstPlan.verification.accepted, true);
  assert.equal(store.getTask(started.task.task_id).status, "open");
  assert.deepEqual(starts, ["p1"]);

  const restarted = new TuttiIntake({ store, router, context });
  const replay = await restarted.startRun("resume durable planning", options);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.state, "terminal");
  assert.equal(replay.supervision_required, true);
  assert.equal(replay.attempt.attempt_id, firstPlan.attempt.attempt_id);

  const completed = await restarted.driveTask(replay.attempt.attempt_id);
  assert.deepEqual(starts, ["p1", "p2", "exec"]);
  assert.equal(completed.verification.accepted, true);
  assert.equal(completed.closure.task.status, "completed");
});

test("TuttiIntake repairs Task closure after an accepted terminal Attempt was persisted before closure", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-closure-replay-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const task = await store.createTask({ objective: "repair closure" });
  const workPackage = await store.createWorkPackage({ taskId: task.task_id, objective: "repair closure" });
  const attempt = await store.createAttempt({ workPackageId: workPackage.work_package_id, assignment: { id: "exec", role: "execution" }, workspace: root });
  await store.markAttemptRunning(attempt.attempt_id, { runId: "run-closure-replay" });
  const completedAttempt = await store.finishAttempt(attempt.attempt_id, {
    result: { status: "completed", final_text: "ok" },
    evidence: { workspace: root, files: [] },
    acceptance: { accepted: true, checks: [] },
  });
  const intake = new TuttiIntake({ store, router: { probe: async () => ({}) }, context });

  const resumed = await intake.advanceTask({
    state: "terminal",
    attempt: completedAttempt,
    result: completedAttempt.outcome,
    evidence: completedAttempt.evidence,
    verification: completedAttempt.acceptance,
    closure: null,
  });

  assert.equal(resumed.closure.task.status, "completed");
  assert.equal(store.getTask(task.task_id).status, "completed");
  assert.equal(store.getWorkPackage(workPackage.work_package_id).status, "completed");
});

test("TuttiIntake persists approval requirements and lets Broker hard-gate configured targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-approval-routing-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const router = {
    probe: async () => ({
      dsh: { available: true, approval_contract: { interactive: false, response_capability: false, behavior: "fail_closed", session_grants: false, auto_review: false } },
      codex: { available: true, approval_contract: { interactive: true, response_capability: true, session_grants: true, auto_review: false } },
    }),
  };
  const intake = new TuttiIntake({ store, router, context });
  const approval = { interactive: true, response_channel: true, session_grants: "required", auto_review: "forbidden" };

  const submitted = await intake.submit("route by approval policy", { requirements: { approval } });

  assert.deepEqual(submitted.work_package.requirements.approval, approval);
  assert.equal(submitted.assignment.id, "codex");
  assert.deepEqual(submitted.recommendation.rejected, [{ id: "dsh", reasons: ["insufficient:approval.interactive"] }]);
});

test("TuttiIntake cancels and fails an Attempt when runtime approval state drifts from routing", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-approval-drift-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  let cancelled = false;
  const router = {
    probe: async () => ({
      codex: {
        available: true,
        harness: "codex",
        approval_contract: {
          provider: "codex",
          transport: "app-server-v2",
          interactive: true,
          response_capability: true,
          session_grants: true,
          approval_policy: { supported: ["on-request"] },
          reviewers: ["user"],
        },
      },
    }),
    start: () => ({ run_id: "run-approval-drift", state: "running" }),
    events: (_runId, { after = 0 } = {}) => ({
      run_id: "run-approval-drift",
      dropped: 0,
      oldest_seq: 1,
      latest_seq: 1,
      gap: false,
      events: after < 1 ? [{ seq: 1, event: {
        type: "approval_state",
        state: {
          provider: "codex",
          transport: "app-server-v2",
          approval_policy: "never",
          approvals_reviewer: "user",
          interactive: false,
          response_capability: true,
          session_grants: true,
          auto_review: false,
        },
      } }] : [],
    }),
    cancel: () => { cancelled = true; return { state: "cancelling" }; },
    result: () => cancelled
      ? { ready: true, run_id: "run-approval-drift", status: "cancelled", session_id: "thread-drift" }
      : { ready: false, run_id: "run-approval-drift", status: "running" },
  };
  const intake = new TuttiIntake({ store, router, context });

  const completed = await intake.submitAndRun("require interactive approval", {
    requirements: { approval: { interactive: true, response_channel: true, session_grants: "required" } },
  });

  assert.equal(cancelled, true);
  assert.equal(completed.state, "terminal");
  assert.equal(completed.attempt.status, "failed");
  assert.equal(completed.result.error_code, "HARNESS_APPROVAL_STATE_INVALID");
  assert.equal(completed.attempt.approval_validation.compatible, false);
  assert.equal(completed.attempt.approval_validation.reason, "unsupported:approval_state.approval_policy");
  assert.equal(completed.verification.accepted, false);
  assert.equal(completed.closure, null);
  assert.equal(store.getTask(completed.task.task_id).status, "open");
});

test("TuttiIntake fail-closes when actual approval state violates the WorkPackage approval requirement", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-approval-requirement-drift-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  let cancelled = false;
  const router = {
    probe: async () => ({
      codex: {
        available: true,
        harness: "codex",
        approval_contract: {
          provider: "codex",
          transport: "app-server-v2",
          interactive: true,
          response_capability: true,
          session_grants: true,
          approval_policy: { supported: ["on-request", "never"] },
          reviewers: ["user"],
        },
      },
    }),
    start: () => ({ run_id: "run-approval-requirement-drift", state: "running" }),
    events: (_runId, { after = 0 } = {}) => ({
      run_id: "run-approval-requirement-drift",
      dropped: 0,
      oldest_seq: 1,
      latest_seq: 1,
      gap: false,
      events: after < 1 ? [{ seq: 1, event: {
        type: "approval_state",
        state: {
          provider: "codex",
          transport: "app-server-v2",
          approval_policy: "never",
          approvals_reviewer: "user",
          interactive: false,
          response_capability: true,
          session_grants: true,
          auto_review: false,
        },
      } }] : [],
    }),
    cancel: () => { cancelled = true; return { state: "cancelling" }; },
    result: () => cancelled
      ? { ready: true, run_id: "run-approval-requirement-drift", status: "cancelled" }
      : { ready: false, run_id: "run-approval-requirement-drift", status: "running" },
  };
  const intake = new TuttiIntake({ store, router, context });

  const completed = await intake.submitAndRun("require interactive approval", {
    requirements: { approval: { interactive: true } },
  });

  assert.equal(completed.attempt.status, "failed");
  assert.equal(completed.attempt.approval_validation.reason, "insufficient:approval.interactive");
  assert.equal(completed.closure, null);
});

test("TuttiIntake fail-closes configured approval invariants even without an approval requirement", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-approval-invariant-drift-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  let cancelled = false;
  const router = {
    probe: async () => ({
      "dsh-acp": {
        available: true,
        harness: "dsh-acp",
        approval_contract: {
          provider: "dsh",
          transport: "acp-v1",
          profile: "acp",
          interactive: true,
          response_capability: true,
          behavior: "fail_closed",
          one_shot_grants: true,
          session_grants: false,
          remembered_grants: false,
          auto_review: false,
          sandbox_mode: "workspace-write",
        },
      },
    }),
    start: () => ({ run_id: "run-approval-invariant-drift", state: "running" }),
    events: (_runId, { after = 0 } = {}) => ({
      run_id: "run-approval-invariant-drift",
      dropped: 0,
      oldest_seq: 1,
      latest_seq: 1,
      gap: false,
      events: after < 1 ? [{ seq: 1, event: {
        type: "approval_state",
        state: {
          provider: "dsh",
          transport: "acp-v1",
          profile: "acp",
          interactive: false,
          response_capability: true,
          behavior: "fail_closed",
          one_shot_grants: true,
          session_grants: false,
          remembered_grants: false,
          auto_review: false,
          sandbox_mode: "danger-full-access",
        },
      } }] : [],
    }),
    cancel: () => { cancelled = true; return { state: "cancelling" }; },
    result: () => cancelled
      ? { ready: true, run_id: "run-approval-invariant-drift", status: "cancelled" }
      : { ready: false, run_id: "run-approval-invariant-drift", status: "running" },
  };
  const intake = new TuttiIntake({ store, router, context });

  const completed = await intake.submitAndRun("detect configured approval drift");
  assert.equal(cancelled, true);
  assert.equal(completed.attempt.status, "failed");
  assert.equal(completed.attempt.approval_validation.reason, "mismatch:approval_state.sandbox_mode");
  assert.equal(completed.closure, null);
});

test("TuttiIntake rejects a completed configured target when no runtime approval state was emitted", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-approval-state-missing-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const router = {
    probe: async () => ({
      "dsh-acp": {
        available: true,
        harness: "dsh-acp",
        approval_contract: {
          provider: "dsh",
          transport: "acp-v1",
          profile: "acp",
          interactive: true,
          response_capability: true,
          behavior: "fail_closed",
          one_shot_grants: true,
          session_grants: false,
          remembered_grants: false,
          auto_review: false,
          sandbox_mode: "workspace-write",
        },
      },
    }),
    start: () => ({ run_id: "run-approval-state-missing", state: "running" }),
    events: (runId) => ({ run_id: runId, dropped: 0, oldest_seq: 1, latest_seq: 0, gap: false, events: [] }),
    result: () => ({ ready: true, run_id: "run-approval-state-missing", status: "completed", final_text: "ok", exit_code: 0 }),
    cancel: () => undefined,
  };
  const intake = new TuttiIntake({ store, router, context });

  const completed = await intake.submitAndRun("completed without approval state", { acceptance: { finalText: "ok" } });

  assert.equal(completed.attempt.status, "failed");
  assert.equal(completed.result.native_status, "completed");
  assert.equal(completed.result.error_code, "HARNESS_APPROVAL_STATE_INVALID");
  assert.equal(completed.attempt.native_approval_state, null);
  assert.equal(completed.attempt.approval_validation.reason, "unknown:approval_state");
  assert.equal(completed.verification.accepted, false);
  assert.equal(completed.closure, null);
  assert.equal(store.getTask(completed.task.task_id).status, "open");
});

test("TuttiIntake startRun replays a durable client request without starting a second Attempt", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-idempotent-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  let starts = 0;
  const router = {
    probe: async () => ({ dsh: { available: true, harness: "dsh" } }),
    start: () => { starts += 1; return { run_id: "run-idempotent", state: "running" }; },
    status: () => ({ state: "running" }),
  };
  const intake = new TuttiIntake({ store, router, context });
  const first = await intake.startRun("start once", { clientRequestId: "request-once" });
  const replay = await intake.startRun("start once", { clientRequestId: "request-once" });

  assert.equal(first.task.task_id, replay.task.task_id);
  assert.equal(first.attempt.attempt_id, replay.attempt.attempt_id);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.supervision_required, false);
  assert.equal(starts, 1);
  assert.equal(Object.keys(store.snapshot().attempts).length, 1);
});

test("TuttiIntake materializes execution context after WorkspaceRef allocation", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-budget-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const router = {
    probe: async () => ({
      small: { available: true, context_window_tokens: 32_000 },
      large: { available: true, model: "large", context_window_tokens: 128_000, max_output_tokens: 16_000 },
    }),
    start: () => ({ run_id: "run-budget", state: "running" }),
  };
  const intake = new TuttiIntake({ store, router, context });
  const submitted = await intake.startRun("use enough context", { requirements: { min_context_window_tokens: 64_000, required_output_tokens: 8_000 } });

  assert.equal(submitted.assignment.id, "large");
  assert.equal(submitted.routing_context.kind, "routing");
  assert.equal(submitted.execution_context.kind, "execution");
  assert.equal(submitted.execution_context.budget.input_ceiling_tokens, 120_000);
});

test("TuttiIntake submitAndRun closes one accepted task end to end", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-run-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const runs = new Map();
  const router = {
    probe: async () => ({ dsh: { available: true, version: "1", capabilities: ["headless"] } }),
    start: ({ cwd, task }) => {
      assert.match(task, /AIDE shared Context Capsule/);
      writeFileSync(join(cwd, "DONE.txt"), "ok");
      runs.set("run-1", { ready: true, run_id: "run-1", status: "completed", session_id: "session-1", final_text: "ok", exit_code: 0 });
      return { run_id: "run-1", state: "running" };
    },
    result: (runId) => runs.get(runId),
    events: (runId, { after = 0 } = {}) => ({
      run_id: runId,
      dropped: 0,
      oldest_seq: 1,
      latest_seq: 1,
      gap: false,
      events: runs.get(runId)?.status === "failed" && after < 1
        ? [{ seq: 1, event: { type: "side_effect", classification: "none", source: "test:no-effects" } }]
        : [],
    }),
    cancel: () => undefined,
  };
  const intake = new TuttiIntake({
    store,
    router,
    context,
    shadowAdvisor: async () => ({ source: "test-advisor", target_id: "future-target", confidence: 0.61, reason: "shadow only" }),
  });

  const completed = await intake.submitAndRun("finish the bounded task", {
    requirements: { capabilities: ["headless"] },
    acceptance: { finalText: "ok", files: { "DONE.txt": "ok" } },
  });

  assert.equal(completed.assignment.harness, "dsh");
  assert.equal(completed.workspace_ref.mode, "direct");
  assert.equal(completed.attempt.workspace_ref_id, completed.workspace_ref.workspace_ref_id);
  assert.equal(completed.attempt.status, "completed");
  assert.equal(completed.attempt.routing_trace.actual.target_id, "dsh");
  assert.equal(completed.attempt.routing_trace.advisory.status, "available");
  assert.equal(completed.attempt.routing_trace.advisory.advice.target_id, "future-target");
  assert.equal(completed.attempt.routing_trace.outcome.accepted, true);
  assert.equal(completed.verification.accepted, true);
  assert.equal(completed.closure.task.status, "completed");
  assert.deepEqual(store.getCurrentTruth().map((item) => item.facts), [["Completed: finish the bounded task"]]);
});

test("TuttiIntake requires mechanical and criterion-preserving semantic acceptance before Task closure", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-semantic-acceptance-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const router = {
    probe: async () => ({ dsh: { available: true } }),
    start: () => ({ run_id: "run-semantic-pass", state: "running" }),
    result: () => ({ ready: true, run_id: "run-semantic-pass", status: "completed", final_text: "ok" }),
    events: (runId) => ({ run_id: runId, dropped: 0, oldest_seq: 1, latest_seq: 0, gap: false, events: [] }),
    cancel: () => undefined,
  };
  const calls = [];
  const semanticVerifier = async (input) => {
    calls.push(input);
    return {
      source: "test-semantic-verifier",
      checks: input.criteria.map((criterion) => ({ criterion, passed: true, reason: "Supported by the bounded result and evidence." })),
    };
  };
  const intake = new TuttiIntake({ store, router, context, semanticVerifier });
  const completed = await intake.submitAndRun("finish semantically", {
    constraints: ["Preserve the public API."],
    acceptance: { finalText: "ok", semantic: ["The result satisfies the requested behavior."] },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].constraints, ["Preserve the public API."]);
  assert.deepEqual(calls[0].criteria, ["The result satisfies the requested behavior."]);
  assert.equal(completed.verification.accepted, true);
  assert.equal(completed.verification.semantic_review.status, "available");
  assert.equal(completed.verification.semantic_review.source, "test-semantic-verifier");
  assert.equal(completed.closure.task.status, "completed");
});

test("Harness semantic verifier uses Broker-qualified read-only verification target and returns trusted runtime provenance", async () => {
  const context = { query: async () => [] };
  let startedArgs = null;
  const router = {
    probe: async () => ({
      review: {
        available: true,
        role: "verification",
        model: "review-model",
        reasoning_effort: "medium",
        capabilities: ["structured_output", "context_retrieval"],
        approval_contract: { sandbox_mode: "read-only" },
      },
      exec: { available: true, role: "execution", capabilities: ["structured_output", "context_retrieval"] },
    }),
    start: (args) => {
      startedArgs = args;
      return { run_id: "run-review", state: "running" };
    },
    result: () => ({
      ready: true,
      run_id: "run-review",
      harness: "review",
      status: "completed",
      session_id: "session-review",
      final_text: JSON.stringify({ checks: [{ criterion: "Criterion A", passed: true, reason: "Evidence supports A." }] }),
      usage: { provider: "codex", scope: "thread_snapshot", token_usage: { totalTokens: 12 } },
    }),
    events: () => ({
      run_id: "run-review",
      dropped: 0,
      oldest_seq: 1,
      latest_seq: 3,
      gap: false,
      events: [
        { seq: 1, event: { type: "side_effect", classification: "none", source: "codex:no-side-effect-items" } },
        { seq: 2, event: { type: "model_reroute", fromModel: "review-model", toModel: "review-model-safe", reason: "highRiskCyberActivity", turnId: "turn-review" } },
        { seq: 3, event: { type: "context_health", event: "compaction", source: "codex:item/contextCompaction", turnId: "turn-review" } },
      ],
    }),
    cancel: () => undefined,
  };
  const verifier = createHarnessSemanticVerifier({ router, targetId: "review", timeoutMs: 100, pollMs: 1 });
  const review = await verifier({
    goal: "prove A",
    constraints: ["Do not change B."],
    criteria: ["Criterion A"],
    result: { status: "completed", final_text: "done" },
    evidence: { workspace: "/tmp/work", files: [{ path: "a.txt", size: 1, sha256: "abc", text: "not forwarded" }] },
    current_truth: [],
    workspace: "/tmp/work",
    context,
  });

  assert.equal(startedArgs.harness, "review");
  assert.equal(startedArgs.cwd, "/tmp/work");
  assert.equal(startedArgs.context, context);
  assert.equal(startedArgs.outputSchema.properties.checks.minItems, 1);
  assert.equal(startedArgs.task.includes("not forwarded"), false);
  assert.equal(review.source, "review:review-model:medium");
  assert.equal(review.provenance.role, "verification");
  assert.equal(review.provenance.requested_model, "review-model");
  assert.equal(review.provenance.effective_model, "review-model-safe");
  assert.equal(review.provenance.run_id, "run-review");
  assert.equal(review.provenance.session_id, "session-review");
  assert.equal(review.provenance.context_compaction_count, 1);
  assert.deepEqual(review.provenance.reroutes, [{ from_model: "review-model", to_model: "review-model-safe", reason: "highRiskCyberActivity", turn_id: "turn-review" }]);
});

test("TuttiIntake persists semantic reviewer runtime provenance in accepted Attempt evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-semantic-provenance-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const router = {
    probe: async () => ({ dsh: { available: true } }),
    start: () => ({ run_id: "run-semantic-provenance", state: "running" }),
    result: () => ({ ready: true, run_id: "run-semantic-provenance", status: "completed", final_text: "ok" }),
    events: (runId) => ({ run_id: runId, dropped: 0, oldest_seq: 1, latest_seq: 0, gap: false, events: [] }),
    cancel: () => undefined,
  };
  const provenance = {
    target_id: "review",
    harness: "review",
    role: "verification",
    requested_model: "review-model",
    effective_model: "review-model",
    reasoning_effort: "medium",
    run_id: "run-review-evidence",
    session_id: "session-review-evidence",
    usage: { provider: "codex", scope: "thread_snapshot" },
    reroutes: [],
    context_compaction_count: 0,
  };
  const intake = new TuttiIntake({
    store,
    router,
    context,
    semanticVerifier: async ({ criteria }) => ({
      source: "review:review-model:medium",
      checks: criteria.map((criterion) => ({ criterion, passed: true, reason: "verified" })),
      provenance,
    }),
  });
  const completed = await intake.submitAndRun("persist review provenance", {
    acceptance: { finalText: "ok", semantic: ["Semantic criterion"] },
  });

  assert.deepEqual(completed.verification.semantic_review.provenance, provenance);
  assert.deepEqual(store.getAttempt(completed.attempt.attempt_id).acceptance.semantic_review.provenance, provenance);
});

test("TuttiIntake recovers a crash after mechanical evidence without guessing semantic acceptance", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-semantic-pre-review-crash-test-"));
  const filePath = join(root, ".aide-state.json");
  const store = await WorkStateStore.open({ filePath });
  const context = await LocalContextFabric.open({ root, store });
  const router = {
    probe: async () => ({ dsh: { available: true } }),
    start: () => ({ run_id: "run-semantic-pre-review-crash", state: "running" }),
    result: () => ({ ready: true, run_id: "run-semantic-pre-review-crash", status: "completed", final_text: "ok" }),
    events: (runId) => ({ run_id: runId, dropped: 0, oldest_seq: 1, latest_seq: 0, gap: false, events: [] }),
    status: () => { throw Object.assign(new Error("detached"), { code: "HARNESS_RUN_NOT_FOUND" }); },
    cancel: () => undefined,
  };
  const originalCheckpoint = store.recordAttemptFinalizationCheckpoint.bind(store);
  let crashed = false;
  store.recordAttemptFinalizationCheckpoint = async (...args) => {
    const value = await originalCheckpoint(...args);
    if (!crashed && value.semantic_acceptance === null) {
      crashed = true;
      throw new Error("simulated crash before semantic review");
    }
    return value;
  };
  let firstCalls = 0;
  const intake = new TuttiIntake({
    store,
    router,
    context,
    semanticVerifier: async ({ criteria }) => {
      firstCalls += 1;
      return { source: "must-not-run-before-crash", checks: criteria.map((criterion) => ({ criterion, passed: true, reason: "ok" })) };
    },
  });
  await assert.rejects(
    intake.submitAndRun("recover semantic review after crash", { acceptance: { finalText: "ok", semantic: ["criterion"] } }),
    /simulated crash before semantic review/,
  );
  assert.equal(firstCalls, 0);
  const taskId = Object.keys(store.snapshot().tasks)[0];
  const attemptId = store.getTaskView(taskId).active_attempt.attempt_id;
  assert.equal(store.getAttempt(attemptId).finalization_checkpoint.semantic_acceptance, null);

  const reopened = await WorkStateStore.open({ filePath });
  const reopenedContext = await LocalContextFabric.open({ root, store: reopened });
  let recoveryCalls = 0;
  const recovered = await new TuttiIntake({
    store: reopened,
    router,
    context: reopenedContext,
    semanticVerifier: async ({ criteria }) => {
      recoveryCalls += 1;
      return { source: "recovery-reviewer", checks: criteria.map((criterion) => ({ criterion, passed: true, reason: "recovered" })) };
    },
  }).recoverTask(taskId, { action: "finalize", quiescent: true });
  assert.equal(recoveryCalls, 1);
  assert.equal(recovered.verification.accepted, true);
  assert.equal(reopened.getTask(taskId).status, "completed");
});

test("TuttiIntake reuses one durable semantic review after a crash before Attempt completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-semantic-post-review-crash-test-"));
  const filePath = join(root, ".aide-state.json");
  const store = await WorkStateStore.open({ filePath });
  const context = await LocalContextFabric.open({ root, store });
  const router = {
    probe: async () => ({ dsh: { available: true } }),
    start: () => ({ run_id: "run-semantic-post-review-crash", state: "running" }),
    result: () => ({ ready: true, run_id: "run-semantic-post-review-crash", status: "completed", final_text: "ok" }),
    events: (runId) => ({ run_id: runId, dropped: 0, oldest_seq: 1, latest_seq: 0, gap: false, events: [] }),
    status: () => { throw Object.assign(new Error("detached"), { code: "HARNESS_RUN_NOT_FOUND" }); },
    cancel: () => undefined,
  };
  const originalCheckpoint = store.recordAttemptFinalizationCheckpoint.bind(store);
  let crashed = false;
  store.recordAttemptFinalizationCheckpoint = async (...args) => {
    const value = await originalCheckpoint(...args);
    if (!crashed && value.semantic_acceptance?.review?.status === "available") {
      crashed = true;
      throw new Error("simulated crash after semantic review");
    }
    return value;
  };
  let reviewCalls = 0;
  const intake = new TuttiIntake({
    store,
    router,
    context,
    semanticVerifier: async ({ criteria }) => {
      reviewCalls += 1;
      return { source: "durable-reviewer", checks: criteria.map((criterion) => ({ criterion, passed: true, reason: "durable" })) };
    },
  });
  await assert.rejects(
    intake.submitAndRun("reuse semantic review after crash", { acceptance: { finalText: "ok", semantic: ["criterion"] } }),
    /simulated crash after semantic review/,
  );
  assert.equal(reviewCalls, 1);
  const taskId = Object.keys(store.snapshot().tasks)[0];
  const attemptId = store.getTaskView(taskId).active_attempt.attempt_id;
  assert.equal(store.getAttempt(attemptId).finalization_checkpoint.semantic_acceptance.review.source, "durable-reviewer");

  const reopened = await WorkStateStore.open({ filePath });
  const reopenedContext = await LocalContextFabric.open({ root, store: reopened });
  const recovered = await new TuttiIntake({
    store: reopened,
    router,
    context: reopenedContext,
    semanticVerifier: async () => { throw new Error("durable semantic review should have been reused"); },
  }).recoverTask(taskId, { action: "finalize", quiescent: true });
  assert.equal(reviewCalls, 1);
  assert.equal(recovered.verification.semantic_review.source, "durable-reviewer");
  assert.equal(reopened.getTask(taskId).status, "completed");
});

test("TuttiIntake fails closed when semantic acceptance is requested without a verifier", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-semantic-unavailable-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const router = {
    probe: async () => ({ dsh: { available: true } }),
    start: () => ({ run_id: "run-semantic-unavailable", state: "running" }),
    result: () => ({ ready: true, run_id: "run-semantic-unavailable", status: "completed", final_text: "ok" }),
    events: (runId) => ({ run_id: runId, dropped: 0, oldest_seq: 1, latest_seq: 0, gap: false, events: [] }),
    cancel: () => undefined,
  };
  const intake = new TuttiIntake({ store, router, context });
  const completed = await intake.submitAndRun("do not close without semantic proof", {
    acceptance: { finalText: "ok", semantic: ["The implementation matches the intended semantics."] },
  });

  assert.equal(completed.verification.accepted, false);
  assert.equal(completed.verification.semantic_review.status, "unavailable");
  assert.equal(completed.verification.semantic_review.error_code, "SEMANTIC_VERIFIER_UNAVAILABLE");
  assert.equal(completed.closure, null);
  assert.equal(store.getTask(completed.task.task_id).status, "open");
});

test("TuttiIntake rejects malformed semantic acceptance before routing or execution", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-semantic-invalid-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  let probes = 0;
  const intake = new TuttiIntake({
    store,
    context,
    router: { probe: async () => { probes += 1; return {}; } },
  });

  await assert.rejects(
    intake.submit("reject invalid semantic criteria", { acceptance: { semantic: [""] } }),
    /acceptance\.semantic criteria/,
  );
  assert.equal(probes, 0);
  assert.equal(store.snapshot().tasks && Object.keys(store.snapshot().tasks).length, 0);
});

test("TuttiIntake skips semantic verifier work when mechanical acceptance already failed", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-semantic-mechanical-fail-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  let semanticCalls = 0;
  const router = {
    probe: async () => ({ dsh: { available: true } }),
    start: () => ({ run_id: "run-semantic-mechanical-fail", state: "running" }),
    result: () => ({ ready: true, run_id: "run-semantic-mechanical-fail", status: "completed", final_text: "wrong" }),
    events: (runId) => ({ run_id: runId, dropped: 0, oldest_seq: 1, latest_seq: 0, gap: false, events: [] }),
    cancel: () => undefined,
  };
  const intake = new TuttiIntake({
    store,
    router,
    context,
    semanticVerifier: async () => { semanticCalls += 1; return { source: "must-not-run", checks: [] }; },
  });
  const completed = await intake.submitAndRun("fail mechanically first", {
    acceptance: { finalText: "ok", semantic: ["Semantic review should not run."] },
  });

  assert.equal(semanticCalls, 0);
  assert.equal(completed.verification.accepted, false);
  assert.equal(completed.verification.semantic_review.status, "skipped");
  assert.equal(completed.verification.semantic_review.reason, "mechanical_acceptance_failed");
});

test("TuttiIntake never lands an isolated candidate before semantic acceptance passes", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-semantic-isolated-root-"));
  const isolated = await mkdtemp(join(tmpdir(), "aide-intake-semantic-isolated-work-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  let landCalls = 0;
  const workspaceManager = {
    allocate: async () => ({ path: isolated, project_root: root }),
    land: async () => { landCalls += 1; return { method: "must-not-land" }; },
    discard: async () => undefined,
  };
  const router = {
    probe: async () => ({ dsh: { available: true } }),
    start: () => ({ run_id: "run-semantic-isolated", state: "running" }),
    result: () => ({ ready: true, run_id: "run-semantic-isolated", status: "completed", final_text: "ok" }),
    events: (runId) => ({ run_id: runId, dropped: 0, oldest_seq: 1, latest_seq: 0, gap: false, events: [] }),
    cancel: () => undefined,
  };
  const intake = new TuttiIntake({
    store,
    router,
    context,
    workspaceManager,
    semanticVerifier: async ({ criteria }) => ({
      source: "rejecting-verifier",
      checks: criteria.map((criterion) => ({ criterion, passed: false, reason: "The semantic requirement is not satisfied." })),
    }),
  });
  const completed = await intake.submitAndRun("do not land rejected semantics", {
    requirements: { workspace_isolation: "attempt" },
    acceptance: { finalText: "ok", semantic: ["The intended behavior is actually satisfied."] },
  });

  assert.equal(completed.verification.accepted, false);
  assert.equal(completed.verification.semantic_review.accepted, false);
  assert.equal(landCalls, 0);
  assert.equal(store.getWorkspace(completed.workspace_ref.workspace_ref_id).landing_status, "pending");
  assert.equal(store.getTask(completed.task.task_id).status, "open");
});

test("TuttiIntake durably projects context compaction and native model reroute facts", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-native-facts-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const router = {
    probe: async () => ({ codex: { available: true, harness: "codex", model: "gpt-a" } }),
    start: () => ({ run_id: "run-native-facts", state: "running" }),
    result: () => ({ ready: true, run_id: "run-native-facts", status: "completed", final_text: "ok" }),
    events: (_runId, { after = 0 } = {}) => ({
      run_id: "run-native-facts",
      dropped: 0,
      oldest_seq: 1,
      latest_seq: 2,
      gap: false,
      events: [
        { seq: 1, event: { type: "context_health", event: "compaction", source: "codex:item/contextCompaction", turnId: "turn-1" } },
        { seq: 2, event: { type: "model_reroute", fromModel: "gpt-a", toModel: "gpt-b", reason: "highRiskCyberActivity", turnId: "turn-1" } },
      ].filter((item) => item.seq > after),
    }),
    cancel: () => undefined,
  };
  const intake = new TuttiIntake({ store, router, context });
  const completed = await intake.submitAndRun("capture native runtime facts", { acceptance: { finalText: "ok" } });

  assert.equal(completed.attempt.context_health.compaction_count, 1);
  assert.equal(completed.attempt.context_health.last_turn_id, "turn-1");
  assert.equal(completed.attempt.native_model_state.requested_model, "gpt-a");
  assert.equal(completed.attempt.native_model_state.current_model, "gpt-b");
  assert.equal(completed.attempt.native_model_state.reroutes[0].reason, "highRiskCyberActivity");
  assert.equal(completed.attempt.routing_trace.outcome.context_health.compaction_count, 1);
  assert.equal(completed.attempt.routing_trace.outcome.native_model_state.current_model, "gpt-b");
});

test("TuttiIntake keeps rejected work open when expected evidence is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-reject-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const router = {
    probe: async () => ({ dsh: { available: true, capabilities: [] } }),
    start: () => ({ run_id: "run-2", state: "running" }),
    result: () => ({ ready: true, run_id: "run-2", status: "completed", final_text: "done" }),
    cancel: () => undefined,
  };
  const intake = new TuttiIntake({ store, router, context });

  const completed = await intake.submitAndRun("produce evidence", {
    acceptance: { files: { "MISSING.txt": "expected" } },
  });

  assert.equal(completed.verification.accepted, false);
  assert.equal(completed.closure, null);
  assert.equal(store.getTask(completed.task.task_id).status, "open");
  assert.equal(store.getCurrentTruth().length, 0);
});

test("TuttiIntake waits for observed cancellation before releasing Attempt ownership", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-cancel-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  let cancelRequested = false;
  const router = {
    probe: async () => ({ dsh: { available: true } }),
    start: () => ({ run_id: "run-timeout", state: "running" }),
    result: () => cancelRequested
      ? { ready: true, run_id: "run-timeout", status: "cancelled", session_id: null }
      : { ready: false, run_id: "run-timeout", state: "running" },
    cancel: () => { cancelRequested = true; return { state: "cancelling" }; },
  };
  const intake = new TuttiIntake({ store, router, context });
  const completed = await intake.submitAndRun("timeout safely", { timeoutMs: 1, cancelGraceMs: 50 });

  assert.equal(completed.attempt.status, "cancelled");
  assert.equal(completed.boundary_reason, "timeout");
  assert.equal(completed.verification.accepted, false);
  assert.equal(store.getTask(completed.task.task_id).status, "open");
});

test("TuttiIntake runTask may hand off after an internal timeout but not after an explicit user cancel", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-timeout-handoff-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const runs = new Map();
  let sequence = 0;
  const router = {
    probe: async () => ({ dsh: { available: true, harness: "dsh" }, codex: { available: true, harness: "codex" } }),
    start: ({ harness, cwd }) => {
      sequence += 1;
      const runId = `run-timeout-handoff-${sequence}`;
      runs.set(runId, { harness, state: "running" });
      if (harness === "codex") writeFileSync(join(cwd, "TIMEOUT.txt"), "ok");
      return { run_id: runId, state: "running" };
    },
    result: (runId) => {
      const run = runs.get(runId);
      if (run.harness === "dsh") return run.state === "cancelled"
        ? { ready: true, run_id: runId, status: "cancelled", session_id: "dsh-timeout" }
        : { ready: false, run_id: runId, state: "running" };
      return { ready: true, run_id: runId, status: "completed", session_id: "codex-after-timeout", final_text: "ok", exit_code: 0 };
    },
    events: (runId, { after = 0 } = {}) => {
      const run = runs.get(runId);
      const events = run?.harness === "dsh" ? [{ seq: 1, event: { type: "side_effect", classification: "none", source: "test:no-effects" } }] : [];
      return { run_id: runId, dropped: 0, oldest_seq: events[0]?.seq ?? 1, latest_seq: events.at(-1)?.seq ?? 0, gap: false, events: events.filter((item) => item.seq > after) };
    },
    cancel: (runId) => { runs.get(runId).state = "cancelled"; return { state: "cancelling" }; },
  };
  const intake = new TuttiIntake({ store, router, context });
  const completed = await intake.runTask("recover from timeout", {
    requirements: { preferred_targets: ["dsh", "codex"] },
    acceptance: { finalText: "ok", files: { "TIMEOUT.txt": "ok" } },
    timeoutMs: 1,
    cancelGraceMs: 100,
  });

  assert.equal(completed.automation.status, "completed");
  assert.equal(completed.assignment.id, "codex");
  assert.equal(completed.attempt_chain.length, 2);
});

test("TuttiIntake abort signal stops supervision before timeout cancellation or handoff", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-abort-supervision-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  let cancelled = false;
  const router = {
    probe: async () => ({ dsh: { available: true, harness: "dsh" } }),
    start: () => ({ run_id: "run-abort", state: "running" }),
    result: () => ({ ready: false, run_id: "run-abort", state: "running" }),
    cancel: () => { cancelled = true; return { state: "cancelling" }; },
  };
  const intake = new TuttiIntake({ store, router, context });
  const started = await intake.startRun("abort supervisor safely");
  const controller = new AbortController();
  controller.abort("lease-lost");

  await assert.rejects(
    intake.driveTask(started.attempt.attempt_id, { timeoutMs: 1, cancelGraceMs: 10, signal: controller.signal }),
    (error) => error.code === "SERVICE_RUNTIME_ABORTED",
  );
  assert.equal(cancelled, false);
  assert.equal(store.getAttempt(started.attempt.attempt_id).status, "running");
});

test("TuttiIntake detached recovery requires quiescence and side-effect-safe reroute", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-recovery-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const submission = await store.createSubmission({
    objective: "recover detached work",
    acceptance: { finalText: "ok" },
    requirements: { preferred_targets: ["dsh", "codex"] },
  });
  const detached = await store.createAttempt({ workPackageId: submission.work_package.work_package_id, assignment: { id: "dsh", harness: "dsh" }, workspace: root });
  await store.markAttemptRunning(detached.attempt_id, { runId: "run-detached" });
  await store.recordAttemptSession(detached.attempt_id, "session-detached");
  let starts = 0;
  const router = {
    status: () => { throw Object.assign(new Error("missing"), { code: "HARNESS_RUN_NOT_FOUND" }); },
    probe: async () => ({ dsh: { available: true, harness: "dsh" }, codex: { available: true, harness: "codex" } }),
    start: ({ harness }) => { starts += 1; assert.equal(harness, "codex"); return { run_id: "run-recovered", state: "running" }; },
    result: () => ({ ready: true, run_id: "run-recovered", status: "completed", session_id: "session-recovered", final_text: "ok", exit_code: 0 }),
    cancel: () => undefined,
  };
  const intake = new TuttiIntake({ store, router, context });

  await assert.rejects(
    intake.recoverTask(submission.task.task_id, { action: "reroute", quiescent: false }),
    (error) => error.code === "RECOVERY_QUIESCENCE_REQUIRED",
  );
  await assert.rejects(
    intake.recoverTask(submission.task.task_id, { action: "reroute", quiescent: true }),
    (error) => error.code === "RECOVERY_SIDE_EFFECTS_UNSAFE" && error.side_effects === "unknown",
  );
  await assert.rejects(
    intake.recoverTask(submission.task.task_id, { action: "resume", quiescent: true }),
    (error) => error.code === "RECOVERY_RESUME_UNSUPPORTED",
  );

  await store.recordAttemptSideEffects(detached.attempt_id, { classification: "none", source: "verified-read-only-run" });
  const recovered = await intake.recoverTask(submission.task.task_id, { action: "reroute", quiescent: true });
  assert.equal(store.getAttempt(detached.attempt_id).status, "failed");
  assert.equal(store.getAttempt(detached.attempt_id).outcome.error_code, "DETACHED_ATTEMPT_REROUTED");
  assert.equal(recovered.assignment.id, "codex");
  assert.equal(recovered.verification.accepted, true);
  assert.equal(recovered.closure.task.status, "completed");
  assert.equal(starts, 1);
});

test("TuttiIntake can explicitly abandon a quiescent detached Attempt without launching a successor", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-recovery-abandon-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const submission = await store.createSubmission({ objective: "abandon detached work" });
  const detached = await store.createAttempt({ workPackageId: submission.work_package.work_package_id, assignment: { id: "dsh", harness: "dsh" }, workspace: root });
  await store.markAttemptRunning(detached.attempt_id, { runId: "run-abandon" });
  const router = {
    status: () => { throw Object.assign(new Error("missing"), { code: "HARNESS_RUN_NOT_FOUND" }); },
    probe: async () => ({ dsh: { available: true, harness: "dsh" } }),
  };
  const intake = new TuttiIntake({ store, router, context });
  await store.recordAttemptSideEffects(detached.attempt_id, { classification: "workspace_only", source: "verified-workspace-write" });
  const abandoned = await intake.recoverTask(submission.task.task_id, { action: "abandon", quiescent: true });

  assert.equal(abandoned.recovery.status, "abandoned");
  assert.equal(abandoned.attempt.status, "failed");
  assert.equal(store.getTask(submission.task.task_id).status, "open");
});

test("TuttiIntake refuses detached reroute for workspace-only effects in a direct workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-recovery-direct-effects-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const submission = await store.createSubmission({ objective: "do not replay direct writes" });
  const workspaceRef = await store.ensureWorkspace({ path: root, projectRoot: root, mode: "direct" });
  const detached = await store.createAttempt({ workPackageId: submission.work_package.work_package_id, assignment: { id: "dsh", harness: "dsh" }, workspaceRefId: workspaceRef.workspace_ref_id });
  await store.markAttemptRunning(detached.attempt_id, { runId: "run-direct-effects" });
  await store.recordAttemptSideEffects(detached.attempt_id, { classification: "workspace_only", source: "file-write" });
  const router = {
    probe: async () => ({}),
    status: () => { throw Object.assign(new Error("missing"), { code: "HARNESS_RUN_NOT_FOUND" }); },
  };
  const intake = new TuttiIntake({ store, router, context });

  await assert.rejects(
    intake.recoverTask(submission.task.task_id, { action: "reroute", quiescent: true }),
    (error) => error.code === "RECOVERY_SIDE_EFFECTS_UNSAFE" && error.side_effects === "workspace_only",
  );
});

test("TuttiIntake permits detached reroute for workspace-only effects contained in an unlanded isolated WorkspaceRef", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-recovery-isolated-project-"));
  const sourcePath = await mkdtemp(join(tmpdir(), "aide-intake-recovery-isolated-source-"));
  const successorPath = await mkdtemp(join(tmpdir(), "aide-intake-recovery-isolated-successor-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const submission = await store.createSubmission({
    objective: "reroute contained writes",
    acceptance: { finalText: "ok" },
    requirements: { preferred_targets: ["dsh", "codex"], workspace_isolation: "attempt" },
  });
  const sourceWorkspace = await store.ensureWorkspace({ path: sourcePath, projectRoot: root, mode: "isolated" });
  const detached = await store.createAttempt({
    workPackageId: submission.work_package.work_package_id,
    assignment: { id: "dsh", harness: "dsh" },
    workspaceRefId: sourceWorkspace.workspace_ref_id,
  });
  await store.markAttemptRunning(detached.attempt_id, { runId: "run-contained" });
  await store.recordAttemptSideEffects(detached.attempt_id, { classification: "workspace_only", source: "codex:item/fileChange" });
  const router = {
    status: () => { throw Object.assign(new Error("missing"), { code: "HARNESS_RUN_NOT_FOUND" }); },
    probe: async () => ({ dsh: { available: true, harness: "dsh" }, codex: { available: true, harness: "codex" } }),
    start: ({ harness, cwd }) => {
      assert.equal(harness, "codex");
      assert.equal(cwd, successorPath);
      return { run_id: "run-contained-successor", state: "running" };
    },
    result: () => ({ ready: true, run_id: "run-contained-successor", status: "completed", session_id: "session-contained", final_text: "ok", exit_code: 0 }),
    cancel: () => undefined,
  };
  const workspaceManager = {
    allocate: async () => ({ path: successorPath, project_root: root }),
    land: async () => ({ patch_bytes: 0, recovered: true }),
    discard: async () => undefined,
  };
  const intake = new TuttiIntake({ store, router, context, workspaceManager });

  const recovered = await intake.recoverTask(submission.task.task_id, { action: "reroute", quiescent: true });
  assert.equal(recovered.assignment.id, "codex");
  assert.equal(recovered.closure.task.status, "completed");
  assert.equal(store.getAttempt(detached.attempt_id).outcome.recovery.side_effects, "workspace_only");
});

test("TuttiIntake steers a running Attempt only when the frozen assignment supports it", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-steer-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const steered = [];
  const router = {
    probe: async () => ({}),
    steer: async (runId, message) => { steered.push({ runId, message }); return { run_id: runId, accepted: true }; },
  };
  const intake = new TuttiIntake({ store, router, context });
  const task = await store.createTask({ objective: "steer" });
  const workPackage = await store.createWorkPackage({ taskId: task.task_id, objective: "steer" });
  const supported = await store.createAttempt({ workPackageId: workPackage.work_package_id, assignment: { id: "codex", capabilities: ["same_turn_steer"] }, workspace: root });
  await store.markAttemptRunning(supported.attempt_id, { runId: "run-steer" });

  assert.equal((await intake.steerAttempt(supported.attempt_id, "focus on parser")).accepted, true);
  assert.deepEqual(steered, [{ runId: "run-steer", message: "focus on parser" }]);
});

test("TuttiIntake resolves PendingInteraction only after the Harness accepts the response", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-response-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const responses = [];
  const router = {
    probe: async () => ({}),
    respond: async (runId, payload) => { responses.push({ runId, payload }); return { run_id: runId, accepted: true }; },
  };
  const intake = new TuttiIntake({ store, router, context });
  const task = await store.createTask({ objective: "respond" });
  const workPackage = await store.createWorkPackage({ taskId: task.task_id, objective: "respond" });
  const attempt = await store.createAttempt({ workPackageId: workPackage.work_package_id, assignment: { id: "codex", capabilities: ["interaction_response"] }, workspace: root });
  await store.markAttemptRunning(attempt.attempt_id, { runId: "run-response" });
  const interaction = await intake.registerInteractionRequest(attempt.attempt_id, { kind: "user_input", summary: "Pick mode", nativeRequestRef: "req-mode" });

  const resolved = await intake.respondToInteraction(interaction.interaction_id, "compatible");
  assert.equal(resolved.status, "resolved");
  assert.deepEqual(responses, [{ runId: "run-response", payload: { nativeRequestRef: "req-mode", response: "compatible" } }]);
});

test("TuttiIntake projects blocking native interaction events and resumes the same run after response", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-supervisor-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  let finish;
  const responses = [];
  const adapter = {
    probe: async () => ({ available: true, capabilities: ["stream_events", "interaction_response"] }),
    start({ onEvent }) {
      onEvent({ type: "session", sessionId: "session-live" });
      onEvent({ type: "side_effect", classification: "none", source: "read-only-question", detail: null });
      onEvent({ type: "interaction_request", kind: "user_input", summary: "Pick compatibility mode", blocking: true, nativeRequestRef: "req-mode" });
      return {
        pid: 123,
        cancel: () => true,
        respond: async (payload) => { responses.push(payload); return true; },
        done: new Promise((resolve) => { finish = resolve; }),
      };
    },
  };
  const unavailable = { probe: async () => ({ available: false }) };
  const router = new HarnessRouter({ dsh: adapter, dshAcp: unavailable, codex: unavailable, codexEconomy: unavailable, codexCapability: unavailable, codexPlan: unavailable, codexPlanAlt: unavailable, codexReview: unavailable });
  const intake = new TuttiIntake({ store, router, context });

  const started = await intake.startRun("finish after asking one question", { acceptance: { finalText: "ok" } });
  const waiting = await intake.observeAttempt(started.attempt.attempt_id);
  assert.equal(waiting.state, "waiting");
  assert.equal(waiting.attempt.status, "waiting_input");
  assert.equal(waiting.interactions.length, 1);
  assert.equal(waiting.interactions[0].native_request_ref, "req-mode");
  assert.equal(store.getAttempt(started.attempt.attempt_id).event_cursor, 3);
  assert.equal(store.getAttempt(started.attempt.attempt_id).session_id, "session-live");
  assert.equal(store.getAttempt(started.attempt.attempt_id).side_effects, "none");

  const restarted = new TuttiIntake({
    store,
    router: new HarnessRouter({ dsh: unavailable, dshAcp: unavailable, codex: unavailable, codexEconomy: unavailable, codexCapability: unavailable, codexPlan: unavailable, codexPlanAlt: unavailable, codexReview: unavailable }),
    context,
  });
  const detached = restarted.taskStatus(started.task.task_id);
  assert.equal(detached.runtime.attached, false);
  assert.equal(detached.runtime.state, "detached");
  assert.equal(detached.runtime.session_id, "session-live");
  assert.equal(detached.runtime.recovery_required, true);

  const resolved = await intake.respondToInteraction(waiting.interactions[0].interaction_id, "compatible");
  assert.equal(resolved.status, "resolved");
  assert.equal(store.getAttempt(started.attempt.attempt_id).status, "running");
  assert.deepEqual(responses, [{ nativeRequestRef: "req-mode", response: "compatible" }]);

  finish({ status: "completed", exit_code: 0, session_id: "session-interactive", final_text: "ok" });
  await Promise.resolve();
  const completed = await intake.observeAttempt(started.attempt.attempt_id);
  assert.equal(completed.state, "terminal");
  assert.equal(completed.verification.accepted, true);
  assert.equal(completed.closure.task.status, "completed");
});

test("TuttiIntake recovery verifies a persisted same-host native PID before accepting quiescence", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-recovery-pid-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const submission = await store.createSubmission({ objective: "recover by pid" });
  const detached = await store.createAttempt({ workPackageId: submission.work_package.work_package_id, assignment: { id: "dsh", harness: "dsh" }, workspace: root });
  await store.markAttemptRunning(detached.attempt_id, { runId: "run-pid", pid: 4242, hostname: "test-host" });
  await store.recordAttemptSideEffects(detached.attempt_id, { classification: "none", source: "read-only-run" });
  const router = {
    probe: async () => ({}),
    status: () => { throw Object.assign(new Error("missing"), { code: "HARNESS_RUN_NOT_FOUND" }); },
  };

  const alive = new TuttiIntake({ store, router, context, hostName: "test-host", platform: "linux", processAlive: () => true });
  await assert.rejects(
    alive.recoverTask(submission.task.task_id, { action: "abandon", quiescent: true }),
    (error) => error.code === "RECOVERY_PROCESS_STILL_ALIVE" && error.pid === 4242,
  );

  const exited = new TuttiIntake({ store, router, context, hostName: "test-host", platform: "linux", processAlive: () => false });
  const recovered = await exited.recoverTask(submission.task.task_id, { action: "abandon" });
  assert.equal(recovered.recovery.status, "abandoned");
  assert.equal(recovered.result.recovery.quiescence.source, "local_pid_exit");
});

test("TuttiIntake recovery prefers persisted process-group ownership over primary PID exit", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-recovery-pgid-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const submission = await store.createSubmission({ objective: "recover by process group" });
  const detached = await store.createAttempt({ workPackageId: submission.work_package.work_package_id, assignment: { id: "dsh", harness: "dsh" }, workspace: root });
  await store.markAttemptRunning(detached.attempt_id, { runId: "run-pgid", pid: 4242, processGroupId: 5252, hostname: "test-host" });
  await store.recordAttemptSideEffects(detached.attempt_id, { classification: "none", source: "read-only-run" });
  const router = {
    probe: async () => ({}),
    status: () => { throw Object.assign(new Error("missing"), { code: "HARNESS_RUN_NOT_FOUND" }); },
  };

  const alive = new TuttiIntake({ store, router, context, hostName: "test-host", platform: "linux", processAlive: () => false, processGroupAlive: () => true });
  await assert.rejects(
    alive.recoverTask(submission.task.task_id, { action: "abandon", quiescent: true }),
    (error) => error.code === "RECOVERY_PROCESS_GROUP_STILL_ALIVE" && error.process_group_id === 5252,
  );

  const exited = new TuttiIntake({ store, router, context, hostName: "test-host", platform: "linux", processAlive: () => true, processGroupAlive: () => false });
  const recovered = await exited.recoverTask(submission.task.task_id, { action: "abandon" });
  assert.equal(recovered.result.recovery.quiescence.source, "local_process_group_exit");
  assert.equal(recovered.result.recovery.quiescence.process_group_id, 5252);
});

test("TuttiIntake Windows recovery fences on the persisted process tree and never trusts parent PID exit alone", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-recovery-windows-tree-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const submission = await store.createSubmission({ objective: "recover Windows process tree" });
  const detached = await store.createAttempt({ workPackageId: submission.work_package.work_package_id, assignment: { id: "codex", harness: "codex" }, workspace: root });
  await store.markAttemptRunning(detached.attempt_id, { runId: "run-tree", pid: 4242, processTreeRootPid: 4242, hostname: "windows-host" });
  await store.recordAttemptSideEffects(detached.attempt_id, { classification: "none", source: "read-only-run" });
  const router = {
    probe: async () => ({}),
    status: () => { throw Object.assign(new Error("missing"), { code: "HARNESS_RUN_NOT_FOUND" }); },
  };

  const alive = new TuttiIntake({ store, router, context, hostName: "windows-host", platform: "win32", processAlive: () => false, processTreeAlive: async () => true });
  await assert.rejects(
    alive.recoverTask(submission.task.task_id, { action: "abandon", quiescent: true }),
    (error) => error.code === "RECOVERY_PROCESS_TREE_STILL_ALIVE" && error.process_tree_root_pid === 4242,
  );

  const exited = new TuttiIntake({ store, router, context, hostName: "windows-host", platform: "win32", processAlive: () => true, processTreeAlive: async () => false });
  const recovered = await exited.recoverTask(submission.task.task_id, { action: "abandon" });
  assert.equal(recovered.result.recovery.quiescence.source, "local_process_tree_exit");
  assert.equal(recovered.result.recovery.quiescence.process_tree_root_pid, 4242);

  const second = await store.createSubmission({ objective: "legacy Windows pid only" });
  const legacy = await store.createAttempt({ workPackageId: second.work_package.work_package_id, assignment: { id: "codex", harness: "codex" }, workspace: join(root, "legacy") });
  await store.markAttemptRunning(legacy.attempt_id, { runId: "run-legacy", pid: 5252, hostname: "windows-host" });
  await store.recordAttemptSideEffects(legacy.attempt_id, { classification: "none", source: "read-only-run" });
  await assert.rejects(
    exited.recoverTask(second.task.task_id, { action: "abandon", quiescent: true }),
    (error) => error.code === "RECOVERY_PROCESS_TREE_OWNERSHIP_REQUIRED",
  );
});

test("TuttiIntake submitAndRun returns waiting instead of timing out on a blocking interaction", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-waiting-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const adapter = {
    probe: async () => ({ available: true, capabilities: ["stream_events", "interaction_response"] }),
    start({ onEvent }) {
      onEvent({ type: "interaction_request", kind: "permission", summary: "Allow command?", blocking: true, nativeRequestRef: "permission-1" });
      return { pid: 124, cancel: () => true, respond: async () => true, done: new Promise(() => {}) };
    },
  };
  const unavailable = { probe: async () => ({ available: false }) };
  const intake = new TuttiIntake({ store, router: new HarnessRouter({ dsh: adapter, dshAcp: unavailable, codex: unavailable, codexEconomy: unavailable, codexCapability: unavailable, codexPlan: unavailable, codexPlanAlt: unavailable, codexReview: unavailable }), context });

  const waiting = await intake.submitAndRun("wait for approval", { timeoutMs: 1_000 });
  assert.equal(waiting.state, "waiting");
  assert.equal(waiting.attempt.status, "waiting_permission");
  assert.equal(waiting.interactions[0].kind, "permission");
});

test("TuttiIntake lands an accepted isolated Attempt before closing the Task", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-isolated-test-"));
  const stateRoot = await mkdtemp(join(tmpdir(), "aide-intake-isolated-state-"));
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  const git = (...args) => exec(process.env.AIDE_GIT_COMMAND ?? "git", ["-C", root, ...args]);
  await exec(process.env.AIDE_GIT_COMMAND ?? "git", ["init", root]);
  await git("config", "user.name", "AIDE Test");
  await git("config", "user.email", "aide@example.invalid");
  writeFileSync(join(root, "BASE.txt"), "base\n");
  await git("add", ".");
  await git("commit", "-m", "base");

  const store = await WorkStateStore.open({ filePath: join(stateRoot, "work-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const runs = new Map();
  const router = {
    probe: async () => ({ dsh: { available: true, capabilities: ["headless"] } }),
    start: ({ cwd, context: runContext }) => {
      assert.notEqual(cwd, root);
      assert.equal(runContext.root, cwd);
      assert.equal(runContext.projectRoot, root);
      writeFileSync(join(cwd, "RESULT.txt"), "landed\n");
      runs.set("run-isolated", { ready: true, run_id: "run-isolated", status: "completed", session_id: "session-isolated", final_text: "ok", exit_code: 0 });
      return { run_id: "run-isolated", state: "running" };
    },
    result: (runId) => runs.get(runId),
    events: (runId, { after = 0 } = {}) => ({
      run_id: runId,
      dropped: 0,
      oldest_seq: 1,
      latest_seq: 1,
      gap: false,
      events: runs.get(runId)?.status === "failed" && after < 1
        ? [{ seq: 1, event: { type: "side_effect", classification: "none", source: "test:no-effects" } }]
        : [],
    }),
    cancel: () => undefined,
  };
  const intake = new TuttiIntake({ store, router, context });
  const completed = await intake.submitAndRun("land the isolated result", {
    requirements: { capabilities: ["headless"], workspace_isolation: "attempt" },
    acceptance: { finalText: "ok", files: { "RESULT.txt": "landed\n" } },
  });

  assert.equal(completed.workspace_ref.mode, "isolated");
  assert.equal(store.getWorkspace(completed.workspace_ref.workspace_ref_id).landing_status, "landed");
  assert.equal((await (await import("node:fs/promises")).readFile(join(root, "RESULT.txt"), "utf8")).replace(/\r\n/g, "\n"), "landed\n");
  assert.equal(completed.verification.accepted, true);
  assert.equal(completed.closure.task.status, "completed");
  assert.ok(completed.evidence.landing.patch_bytes > 0);
});

test("TuttiIntake automatically hands rejected work to a different qualified Harness", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-handoff-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const runs = new Map();
  let runNumber = 0;
  const router = {
    probe: async () => ({
      dsh: { available: true, harness: "dsh" },
      "z-codex": { available: true, harness: "codex" },
    }),
    start: ({ harness, cwd }) => {
      runNumber += 1;
      const runId = `run-handoff-${runNumber}`;
      if (harness === "dsh") {
        runs.set(runId, { ready: true, run_id: runId, status: "failed", session_id: "dsh-session", error_code: "TEST_FAILURE" });
      } else {
        writeFileSync(join(cwd, "HANDOFF.txt"), "ok");
        runs.set(runId, { ready: true, run_id: runId, status: "completed", session_id: "codex-session", final_text: "ok", exit_code: 0 });
      }
      return { run_id: runId, state: "running" };
    },
    result: (runId) => runs.get(runId),
    events: (runId, { after = 0 } = {}) => ({
      run_id: runId,
      dropped: 0,
      oldest_seq: 1,
      latest_seq: 1,
      gap: false,
      events: runs.get(runId)?.status === "failed" && after < 1
        ? [{ seq: 1, event: { type: "side_effect", classification: "none", source: "test:no-effects" } }]
        : [],
    }),
    cancel: () => undefined,
  };
  const intake = new TuttiIntake({ store, router, context });

  const first = await intake.submitAndRun("finish with automatic fallback", {
    constraints: ["Keep the same external behavior."],
    requirements: { preferred_targets: ["dsh", "z-codex"] },
    acceptance: { finalText: "ok", files: { "HANDOFF.txt": "ok" } },
  });
  assert.equal(first.assignment.id, "dsh");
  assert.equal(first.verification.accepted, false);
  assert.equal(store.getTask(first.task.task_id).status, "open");

  const second = await intake.handoffAndRun(first.attempt.attempt_id, { objective: "continue after the failed DSH attempt" });
  assert.equal(second.assignment.id, "z-codex");
  assert.equal(second.assignment.harness, "codex");
  assert.equal(second.handoff.from_attempt_id, first.attempt.attempt_id);
  assert.deepEqual(second.work_package.lineage, { kind: "handoff", from_attempt_id: first.attempt.attempt_id });
  assert.deepEqual(store.getTask(first.task.task_id).constraints, ["Keep the same external behavior."]);
  assert.equal(second.verification.accepted, true);
  assert.equal(second.closure.task.status, "completed");
});

test("TuttiIntake terminal handoff permits contained workspace-only effects without landing the source", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-contained-handoff-project-"));
  const sourcePath = await mkdtemp(join(tmpdir(), "aide-intake-contained-handoff-source-"));
  const successorPath = await mkdtemp(join(tmpdir(), "aide-intake-contained-handoff-successor-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const submission = await store.createSubmission({
    objective: "continue after contained mutation",
    acceptance: { finalText: "ok" },
    requirements: { preferred_targets: ["dsh-acp", "codex"], workspace_isolation: "attempt" },
  });
  const sourceWorkspace = await store.ensureWorkspace({ path: sourcePath, projectRoot: root, mode: "isolated" });
  const source = await store.createAttempt({
    workPackageId: submission.work_package.work_package_id,
    assignment: { id: "dsh-acp", harness: "dsh-acp" },
    workspaceRefId: sourceWorkspace.workspace_ref_id,
  });
  await store.markAttemptRunning(source.attempt_id, { runId: "run-contained-source" });
  await store.recordAttemptSideEffects(source.attempt_id, { classification: "workspace_only", source: "dsh-acp:tool_call" });
  await store.finishAttempt(source.attempt_id, {
    result: { status: "failed", error_code: "TEST_FAILURE" },
    evidence: { workspace: sourcePath, files: [] },
    acceptance: { accepted: false, checks: [] },
  });

  let landedPath = null;
  const router = {
    probe: async () => ({
      "dsh-acp": { available: true, harness: "dsh-acp" },
      codex: { available: true, harness: "codex" },
    }),
    start: ({ harness, cwd }) => {
      assert.equal(harness, "codex");
      assert.equal(cwd, successorPath);
      return { run_id: "run-contained-handoff-successor", state: "running" };
    },
    result: () => ({ ready: true, run_id: "run-contained-handoff-successor", status: "completed", final_text: "ok", exit_code: 0 }),
    events: (runId) => ({ run_id: runId, dropped: 0, oldest_seq: 1, latest_seq: 0, gap: false, events: [] }),
    cancel: () => undefined,
  };
  const workspaceManager = {
    allocate: async () => ({ path: successorPath, project_root: root }),
    land: async ({ path }) => { landedPath = path; return { patch_bytes: 0, contained_handoff: true }; },
    discard: async () => undefined,
  };
  const intake = new TuttiIntake({ store, router, context, workspaceManager });

  const completed = await intake.handoffAndRun(source.attempt_id);

  assert.equal(completed.assignment.id, "codex");
  assert.equal(completed.handoff.from_attempt_id, source.attempt_id);
  assert.equal(store.getWorkspace(sourceWorkspace.workspace_ref_id).landing_status, "pending");
  assert.equal(landedPath, successorPath);
  assert.equal(completed.verification.accepted, true);
  assert.equal(completed.closure.task.status, "completed");
});

test("TuttiIntake runTask automatically advances across Harnesses and preserves requirements", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-run-task-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const runs = new Map();
  let runNumber = 0;
  const router = {
    probe: async () => ({
      dsh: { available: true, harness: "dsh", capabilities: ["shared"], context_window_tokens: 128_000 },
      codex: { available: true, harness: "codex", capabilities: ["shared"], context_window_tokens: 128_000 },
    }),
    start: ({ harness, cwd }) => {
      runNumber += 1;
      const runId = `run-auto-${runNumber}`;
      if (harness === "dsh") runs.set(runId, { ready: true, run_id: runId, status: "failed", session_id: "dsh-auto", error_code: "TEST_FAILURE" });
      else {
        writeFileSync(join(cwd, "AUTO.txt"), "ok");
        runs.set(runId, { ready: true, run_id: runId, status: "completed", session_id: "codex-auto", final_text: "ok", exit_code: 0 });
      }
      return { run_id: runId, state: "running" };
    },
    result: (runId) => runs.get(runId),
    events: (runId, { after = 0 } = {}) => {
      const run = runs.get(runId);
      const events = run?.status === "failed" ? [{ seq: 1, event: { type: "side_effect", classification: "none", source: "test:no-effects" } }] : [];
      return { run_id: runId, dropped: 0, oldest_seq: events[0]?.seq ?? 1, latest_seq: events.at(-1)?.seq ?? 0, gap: false, events: events.filter((item) => item.seq > after) };
    },
    cancel: () => undefined,
  };
  const intake = new TuttiIntake({ store, router, context });
  const completed = await intake.runTask("finish without manual handoff", {
    requirements: {
      capabilities: ["shared"],
      min_context_window_tokens: 64_000,
      preferred_targets: ["dsh", "codex"],
      policy_tag: "keep-me",
    },
    acceptance: { finalText: "ok", files: { "AUTO.txt": "ok" } },
  });

  assert.equal(completed.automation.status, "completed");
  assert.equal(completed.assignment.id, "codex");
  assert.equal(completed.attempt_chain.length, 2);
  const secondWorkPackage = store.getWorkPackage(completed.attempt.work_package_id);
  assert.deepEqual(secondWorkPackage.requirements.capabilities, ["shared"]);
  assert.equal(secondWorkPackage.requirements.min_context_window_tokens, 64_000);
  assert.equal(secondWorkPackage.requirements.policy_tag, "keep-me");
  assert.ok(secondWorkPackage.requirements.exclude_targets.includes("dsh"));
  assert.equal(completed.closure.task.status, "completed");
});

test("TuttiIntake runTask reports blocked when automatic handoff has no alternate without creating an orphan WorkPackage", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-run-task-blocked-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  const router = {
    probe: async () => ({ dsh: { available: true, harness: "dsh", capabilities: ["headless"] } }),
    start: () => ({ run_id: "run-only", state: "running" }),
    result: () => ({ ready: true, run_id: "run-only", status: "failed", session_id: "only-session", error_code: "TEST_FAILURE" }),
    events: (_runId, { after = 0 } = {}) => ({
      run_id: "run-only",
      dropped: 0,
      oldest_seq: 1,
      latest_seq: 1,
      gap: false,
      events: after < 1 ? [{ seq: 1, event: { type: "side_effect", classification: "none", source: "test:no-effects" } }] : [],
    }),
    cancel: () => undefined,
  };
  const intake = new TuttiIntake({ store, router, context });
  const blocked = await intake.runTask("fail with no alternate", { requirements: { capabilities: ["headless"] } });

  assert.equal(blocked.automation.status, "blocked");
  assert.equal(blocked.automation.error_code, "NO_QUALIFIED_HANDOFF_HARNESS");
  assert.equal(blocked.attempt_chain.length, 1);
  assert.equal(Object.keys(store.snapshot().work_packages).length, 1);
  assert.equal(store.getTask(blocked.task.task_id).status, "open");
});

test("TuttiIntake blocks terminal handoff when source side effects are unknown or external", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-intake-handoff-effects-gate-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  let projectedEffect = null;
  const router = {
    probe: async () => ({ dsh: { available: true, harness: "dsh" }, codex: { available: true, harness: "codex" } }),
    start: () => ({ run_id: "run-effects-gate", state: "running" }),
    result: () => ({ ready: true, run_id: "run-effects-gate", status: "failed", error_code: "TEST_FAILURE" }),
    events: (_runId, { after = 0 } = {}) => ({
      run_id: "run-effects-gate",
      dropped: 0,
      oldest_seq: 1,
      latest_seq: projectedEffect ? 1 : 0,
      gap: false,
      events: projectedEffect && after < 1
        ? [{ seq: 1, event: { type: "side_effect", classification: projectedEffect, source: "test:effect" } }]
        : [],
    }),
    cancel: () => undefined,
  };
  const intake = new TuttiIntake({ store, router, context });
  const unknown = await intake.runTask("unknown effects must not reroute", { requirements: { preferred_targets: ["dsh", "codex"] } });
  assert.equal(unknown.automation.status, "blocked");
  assert.equal(unknown.automation.error_code, "HANDOFF_SIDE_EFFECTS_UNSAFE");
  assert.equal(unknown.automation.side_effects, "unknown");

  projectedEffect = "external_possible";
  const secondSubmission = await intake.submitAndRun("external effects must not reroute", { requirements: { preferred_targets: ["dsh", "codex"] } });
  const external = await intake.advanceTask(secondSubmission);
  assert.equal(external.automation.status, "blocked");
  assert.equal(external.automation.error_code, "HANDOFF_SIDE_EFFECTS_UNSAFE");
  assert.equal(external.automation.side_effects, "external_possible");
});
