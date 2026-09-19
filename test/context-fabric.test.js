import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkStateStore } from "../src/core/work-state-store.js";
import { LocalContextFabric } from "../src/tutti/context-fabric.js";

test("LocalContextFabric finds definitions, references, and bounded source", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-context-test-"));
  await writeFile(join(root, "sample.js"), "export function alpha() { return 1; }\nexport function beta() { return alpha(); }\n");
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const task = await store.createTask({ objective: "inspect alpha" });
  const workPackage = await store.createWorkPackage({ taskId: task.task_id, objective: "inspect alpha" });
  const context = await LocalContextFabric.open({ root, store });

  assert.equal(context.symbol("alpha")[0].line, 1);
  assert.equal(context.references("alpha")[0].line, 2);
  assert.equal(context.search("beta")[0].path, "sample.js");
  assert.match((await context.read("sample.js", { startLine: 2, maxLines: 1 })).text, /beta/);
  const routing = context.buildRoutingCapsule({ taskId: task.task_id, workPackageId: workPackage.work_package_id, query: "please inspect alpha before editing" });
  const execution = context.buildExecutionCapsule({
    taskId: task.task_id,
    workPackageId: workPackage.work_package_id,
    query: "please inspect alpha before editing",
    target: { context_window_tokens: 128_000, max_output_tokens: 16_000 },
  });
  assert.equal(routing.kind, "routing");
  assert.equal(routing.goal, "inspect alpha");
  assert.equal(routing.relevant[0].match, "symbol");
  assert.equal(execution.kind, "execution");
  assert.equal(execution.relevant[0].path, "sample.js");
  assert.equal(execution.budget.context_window_tokens, 128_000);
  assert.equal(execution.budget.max_output_tokens, 16_000);
});

test("LocalContextFabric carries bounded prior WorkPackage, decision, failure, and evidence continuity", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-context-continuity-"));
  await writeFile(join(root, "sample.js"), "export const stable = true;\n");
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const task = await store.createTask({ objective: "finish after one failed attempt", acceptance: { finalText: "done" } });
  const firstWorkPackage = await store.createWorkPackage({ taskId: task.task_id, objective: "first try" });
  const firstAttempt = await store.createAttempt({
    workPackageId: firstWorkPackage.work_package_id,
    assignment: { id: "codex-economy", harness: "codex", model: "gpt-a", reasoning_effort: "low", decision_reason: "strategy_economy" },
    workspace: root,
    routingTrace: { actual: { decision_reason: "strategy_economy" } },
  });
  await store.markAttemptRunning(firstAttempt.attempt_id, { runId: "run-first" });
  await store.recordAttemptModelReroute(firstAttempt.attempt_id, { fromModel: "gpt-a", toModel: "gpt-b", reason: "highRiskCyberActivity", turnId: "turn-1" });
  await store.finishAttempt(firstAttempt.attempt_id, {
    result: { status: "failed", error_code: "TEST_FAILURE", final_text: "failed after checking the relevant file" },
    evidence: { files: [{ path: "sample.js", size: 28, sha256: "abc", text: "must not enter capsule" }] },
    acceptance: { accepted: false },
  });
  const secondWorkPackage = await store.createWorkPackage({
    taskId: task.task_id,
    objective: "second try",
    lineage: { kind: "handoff", from_attempt_id: firstAttempt.attempt_id },
  });
  const context = await LocalContextFabric.open({ root, store });
  const execution = context.buildExecutionCapsule({ taskId: task.task_id, workPackageId: secondWorkPackage.work_package_id, target: {} });

  assert.equal(execution.task_id, task.task_id);
  assert.deepEqual(execution.work_package.lineage, { kind: "handoff", from_attempt_id: firstAttempt.attempt_id });
  assert.equal(execution.continuity.prior_work_packages[0].work_package_id, firstWorkPackage.work_package_id);
  assert.equal(execution.continuity.prior_attempts[0].decision_reason, "strategy_economy");
  assert.equal(execution.continuity.prior_attempts[0].effective_model, "gpt-b");
  assert.equal(execution.continuity.prior_attempts[0].error_code, "TEST_FAILURE");
  assert.deepEqual(execution.continuity.prior_attempts[0].evidence_refs, [{ path: "sample.js", size: 28, sha256: "abc" }]);
  assert.equal(JSON.stringify(execution.continuity).includes("must not enter capsule"), false);
  assert.deepEqual(await context.query("evidence", { taskId: task.task_id, limit: 1 }), execution.continuity.prior_attempts);
});

test("LocalContextFabric exposes bounded Current Truth without repository re-interpretation", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-context-truth-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const task = await store.createTask({ objective: "close with truth", constraints: ["Preserve the public boundary."] });
  const workPackage = await store.createWorkPackage({ taskId: task.task_id, objective: "close with truth" });
  const attempt = await store.createAttempt({
    workPackageId: workPackage.work_package_id,
    assignment: { id: "test", role: "execution", model: "gpt-requested", reasoning_effort: "medium" },
    workspace: root,
  });
  await store.markAttemptRunning(attempt.attempt_id, { runId: "run-truth" });
  await store.recordAttemptModelReroute(attempt.attempt_id, { fromModel: "gpt-requested", toModel: "gpt-effective", reason: "highRiskCyberActivity", turnId: "turn-truth" });
  await store.finishAttempt(attempt.attempt_id, {
    result: { status: "completed" },
    evidence: { files: [{ path: "verified.txt", size: 7, sha256: "abc", text: "not copied into truth" }] },
    acceptance: {
      accepted: true,
      semantic_review: {
        status: "available",
        source: "review:gpt:medium",
        accepted: true,
        checks: [{ criterion: "criterion", passed: true, reason: "verified" }],
      },
      step_verification: {
        status: "available",
        accepted: true,
        steps: [{ step_index: 1, objective: "bounded step", criterion: "step postcondition", passed: true, reason: "verified" }],
      },
    },
  });
  await store.commitTaskClosure({ taskId: task.task_id, workPackageId: workPackage.work_package_id, attemptId: attempt.attempt_id, facts: ["truth is durable"] });
  const context = await LocalContextFabric.open({ root, store });

  const truth = await context.query("current_truth", { limit: 1 });
  assert.deepEqual(truth[0].facts, ["truth is durable"]);
  assert.equal(truth[0].goal, "close with truth");
  assert.deepEqual(truth[0].constraints, ["Preserve the public boundary."]);
  assert.equal(truth[0].execution.requested_model, "gpt-requested");
  assert.equal(truth[0].execution.effective_model, "gpt-effective");
  assert.equal(truth[0].verification.accepted, true);
  assert.equal(truth[0].verification.semantic_review.source, "review:gpt:medium");
  assert.equal(truth[0].verification.step_verification.steps[0].criterion, "step postcondition");
  assert.deepEqual(truth[0].verification.evidence_refs, [{ path: "verified.txt", size: 7, sha256: "abc" }]);
  assert.equal(JSON.stringify(truth[0]).includes("not copied into truth"), false);
});

test("LocalContextFabric rejects path escape", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-context-test-"));
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  await assert.rejects(context.read("../outside.txt"), (error) => error.code === "CONTEXT_PATH_OUTSIDE_PROJECT");
});

test("LocalContextFabric scopes execution retrieval to one WorkspaceRef", async () => {
  const project = await mkdtemp(join(tmpdir(), "aide-context-project-"));
  const workspace = await mkdtemp(join(tmpdir(), "aide-context-workspace-"));
  await writeFile(join(project, "sample.js"), "export const source = 'project';\n");
  await writeFile(join(workspace, "sample.js"), "export const source = 'workspace';\nexport const workspaceOnly = true;\n");
  const store = await WorkStateStore.open({ filePath: join(project, ".aide-state.json") });
  const task = await store.createTask({ objective: "inspect workspaceOnly" });
  const workPackage = await store.createWorkPackage({ taskId: task.task_id, objective: "inspect workspaceOnly" });
  const context = await LocalContextFabric.open({ root: project, store });
  const workspaceRef = {
    workspace_ref_id: "workspace-test",
    path: workspace,
    project_root: project,
    mode: "isolated",
  };

  const scoped = await context.forWorkspace(workspaceRef);
  assert.equal(scoped.symbol("workspaceOnly")[0].path, "sample.js");
  assert.equal((await scoped.read("sample.js")).text.includes("workspace"), true);
  const execution = scoped.buildExecutionCapsule({ taskId: task.task_id, workPackageId: workPackage.work_package_id, query: "workspaceOnly", target: {}, workspaceRef });
  assert.equal(execution.retrieval.root, workspace);
  assert.equal(execution.retrieval.project_root, project);
  assert.equal(execution.retrieval.workspace_ref_id, "workspace-test");
  assert.equal(execution.retrieval.scope, "workspace");
});

test("LocalContextFabric rejects a WorkspaceRef from another project", async () => {
  const project = await mkdtemp(join(tmpdir(), "aide-context-project-"));
  const other = await mkdtemp(join(tmpdir(), "aide-context-other-"));
  const store = await WorkStateStore.open({ filePath: join(project, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root: project, store });
  await assert.rejects(
    context.forWorkspace({ workspace_ref_id: "workspace-other", path: other, project_root: other, mode: "isolated" }),
    (error) => error.code === "CONTEXT_WORKSPACE_PROJECT_MISMATCH",
  );
});

test("LocalContextFabric on-demand query refreshes an already-open workspace view", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-context-refresh-"));
  await writeFile(join(root, "sample.js"), "export const before = true;\n");
  const store = await WorkStateStore.open({ filePath: join(root, ".aide-state.json") });
  const context = await LocalContextFabric.open({ root, store });
  assert.equal(context.symbol("after").length, 0);

  await writeFile(join(root, "sample.js"), "export const after = true;\n");
  assert.equal((await context.query("symbol", { name: "after" }))[0].name, "after");
});
