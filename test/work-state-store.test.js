import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkStateStore } from "../src/core/work-state-store.js";
import { closeAcceptedTask } from "../src/tutti/task-closure.js";

async function storeFixture() {
  const directory = await mkdtemp(join(tmpdir(), "aide-state-test-"));
  let nextId = 1;
  return { filePath: join(directory, "work-state.json"), id: () => String(nextId++), now: () => "2026-09-17T00:00:00.000Z" };
}

test("WorkStateStore persists Task, WorkPackage, and completed Attempt", async () => {
  const options = await storeFixture();
  const store = await WorkStateStore.open(options);
  const task = await store.createTask({ objective: "prove the slice", acceptance: { finalText: "ok" } });
  const workPackage = await store.createWorkPackage({ taskId: task.task_id, objective: "write smoke file", requirements: { capabilities: ["headless"] } });
  const attempt = await store.createAttempt({ workPackageId: workPackage.work_package_id, assignment: { harness: "dsh" }, workspace: "/tmp/work-1" });
  await store.markAttemptRunning(attempt.attempt_id, { runId: "run-1" });
  await store.finishAttempt(attempt.attempt_id, {
    result: { status: "completed", session_id: "session-1", exit_code: 0 },
    evidence: { files: [{ path: "SMOKE.txt", sha256: "abc" }] },
    acceptance: { accepted: true },
  });
  const closure = await closeAcceptedTask({ store, attemptId: attempt.attempt_id, facts: ["Smoke artifact is verified."] });

  const reopened = await WorkStateStore.open(options);
  assert.equal(reopened.getTask(task.task_id).status, "completed");
  assert.equal(reopened.getTask(task.task_id).closed_by_attempt_id, attempt.attempt_id);
  assert.equal(reopened.getWorkPackage(workPackage.work_package_id).status, "completed");
  assert.equal(closure.truth_update.evidence_attempt_id, attempt.attempt_id);
  assert.deepEqual(reopened.getCurrentTruth().map((item) => item.facts), [["Smoke artifact is verified."]]);
  assert.deepEqual(reopened.getAttempt(attempt.attempt_id), {
    attempt_id: "attempt-3",
    work_package_id: "wp-2",
    assignment: { harness: "dsh" },
    workspace: "/tmp/work-1",
    workspace_ref_id: null,
    status: "completed",
    run_id: "run-1",
    event_cursor: 0,
    session_id: "session-1",
    runtime_process: null,
    native_model_state: { requested_model: null, current_model: null, reroutes: [] },
    native_approval_state: null,
    approval_validation: null,
    side_effects: "unknown",
    side_effect_evidence: [],
    context_health: { compaction_count: 0, last_compaction_at: null, last_source: null, last_turn_id: null },
    routing_trace: null,
    finalization_checkpoint: null,
    outcome: { status: "completed", session_id: "session-1", exit_code: 0 },
    evidence: { files: [{ path: "SMOKE.txt", sha256: "abc" }] },
    acceptance: { accepted: true },
    created_at: "2026-09-17T00:00:00.000Z",
    completed_at: "2026-09-17T00:00:00.000Z",
  });
});

test("WorkStateStore persists routing telemetry through Attempt completion", async () => {
  const store = await WorkStateStore.open(await storeFixture());
  const task = await store.createTask({ objective: "trace routing", constraints: ["preserve API"], acceptance: { semantic: ["behavior preserved"] } });
  const workPackage = await store.createWorkPackage({ taskId: task.task_id, objective: "trace routing", requirements: { execution_strategy: "economy" } });
  const attempt = await store.createAttempt({
    workPackageId: workPackage.work_package_id,
    assignment: { id: "codex-economy" },
    workspace: "/tmp/routing-trace",
    routingTrace: {
      strategy: "economy",
      recommendation: { candidate_ids: ["codex-economy"], rejected: [] },
      actual: { target_id: "codex-economy" },
      advisory: { status: "available", advice: { source: "test", target_id: "codex-capability", confidence: 0.7 } },
      started_at: null,
      outcome: null,
    },
  });
  const running = await store.markAttemptRunning(attempt.attempt_id, { runId: "run-routing" });
  assert.equal(running.routing_trace.started_at, "2026-09-17T00:00:00.000Z");
  await store.recordAttemptContextCompaction(attempt.attempt_id, { source: "codex:item/contextCompaction", turnId: "turn-1" });
  await store.recordAttemptModelReroute(attempt.attempt_id, { fromModel: "small", toModel: "safe-model", reason: "highRiskCyberActivity", turnId: "turn-1" });
  const finished = await store.finishAttempt(attempt.attempt_id, {
    result: { status: "completed", usage: { input_tokens: 10, output_tokens: 2 } },
    evidence: {},
    acceptance: { accepted: true },
  });
  assert.deepEqual(finished.routing_trace.outcome, {
    status: "completed",
    accepted: true,
    side_effects: "unknown",
    context_health: { compaction_count: 1, last_compaction_at: "2026-09-17T00:00:00.000Z", last_source: "codex:item/contextCompaction", last_turn_id: "turn-1" },
    native_model_state: {
      requested_model: null,
      current_model: "safe-model",
      reroutes: [{ from_model: "small", to_model: "safe-model", reason: "highRiskCyberActivity", turn_id: "turn-1", observed_at: "2026-09-17T00:00:00.000Z" }],
    },
    usage: { input_tokens: 10, output_tokens: 2 },
    completed_at: "2026-09-17T00:00:00.000Z",
  });

  const untraced = await store.createWorkPackage({ taskId: task.task_id, objective: "not routed" });
  const untracedAttempt = await store.createAttempt({ workPackageId: untraced.work_package_id, assignment: { id: "manual" }, workspace: "/tmp/routing-untraced" });
  await store.markAttemptRunning(untracedAttempt.attempt_id, { runId: "run-untraced" });
  await store.finishAttempt(untracedAttempt.attempt_id, { result: { status: "completed" }, evidence: {}, acceptance: { accepted: true } });

  const history = store.listRoutingHistory({ limit: 10 });
  assert.equal(history.length, 1);
  assert.equal(history[0].attempt_id, attempt.attempt_id);
  assert.equal(history[0].task_id, task.task_id);
  assert.deepEqual(history[0].task_shape, { constraints_count: 1, semantic_acceptance_count: 1, semantic_decision: null });
  assert.deepEqual(history[0].requirements, { execution_strategy: "economy" });
  assert.equal(history[0].routing.actual.target_id, "codex-economy");
  assert.equal(history[0].routing.advisory.advice.target_id, "codex-capability");
  assert.equal(history[0].routing.outcome.accepted, true);
  assert.equal(history[0].routing.outcome.usage.input_tokens, 10);
  assert.equal(history[0].wall_duration_ms, 0);
  assert.equal(Object.hasOwn(history[0], "objective"), false);
  assert.throws(() => store.listRoutingHistory({ limit: 0 }), /between 1 and 1000/);
});

test("WorkStateStore persists bounded WorkPackage lineage and rejects invalid graph edges", async () => {
  const store = await WorkStateStore.open(await storeFixture());
  const task = await store.createTask({ objective: "build one durable chain" });
  const sourceWorkPackage = await store.createWorkPackage({ taskId: task.task_id, objective: "source" });
  const sourceAttempt = await store.createAttempt({ workPackageId: sourceWorkPackage.work_package_id, assignment: { id: "dsh" }, workspace: "/tmp/lineage-source" });
  await store.markAttemptRunning(sourceAttempt.attempt_id, { runId: "run-lineage-source" });
  await store.finishAttempt(sourceAttempt.attempt_id, { result: { status: "failed" }, evidence: {}, acceptance: { accepted: false } });

  const successor = await store.createWorkPackage({
    taskId: task.task_id,
    objective: "successor",
    lineage: { kind: "handoff", from_attempt_id: sourceAttempt.attempt_id },
  });
  assert.deepEqual(successor.lineage, { kind: "handoff", from_attempt_id: sourceAttempt.attempt_id });

  const otherTask = await store.createTask({ objective: "other task" });
  await assert.rejects(
    store.createWorkPackage({ taskId: otherTask.task_id, objective: "cross task", lineage: { kind: "handoff", from_attempt_id: sourceAttempt.attempt_id } }),
    (error) => error.code === "WORK_PACKAGE_LINEAGE_TASK_MISMATCH",
  );

  const activeWorkPackage = await store.createWorkPackage({ taskId: task.task_id, objective: "active source" });
  const activeAttempt = await store.createAttempt({ workPackageId: activeWorkPackage.work_package_id, assignment: { id: "codex" }, workspace: "/tmp/lineage-active" });
  await assert.rejects(
    store.createWorkPackage({ taskId: task.task_id, objective: "too early", lineage: { kind: "handoff", from_attempt_id: activeAttempt.attempt_id } }),
    (error) => error.code === "WORK_PACKAGE_LINEAGE_SOURCE_ACTIVE",
  );
});

test("WorkStateStore persists one semantic Task decision from accepted planning evidence", async () => {
  const store = await WorkStateStore.open(await storeFixture());
  const task = await store.createTask({ objective: "decide the work shape" });
  const workPackage = await store.createWorkPackage({ taskId: task.task_id, objective: "plan the work", requirements: { semantic_decomposition: "plan" } });
  const attempt = await store.createAttempt({ workPackageId: workPackage.work_package_id, assignment: { id: "planner", role: "planning" }, workspace: "/tmp/decision" });
  await store.markAttemptRunning(attempt.attempt_id, { runId: "run-decision" });
  await store.finishAttempt(attempt.attempt_id, { result: { status: "completed", final_text: "{}" }, evidence: {}, acceptance: { accepted: true } });

  const decision = await store.recordTaskSemanticDecision(task.task_id, {
    sourceAttemptId: attempt.attempt_id,
    decision: "decompose",
    reason: "Two ordered concerns are independently useful.",
    steps: [
      { objective: "first", verification: "The first concern is satisfied." },
      { objective: "second", verification: "The second concern is satisfied." },
    ],
  });
  assert.equal(decision.source_attempt_id, attempt.attempt_id);
  assert.deepEqual(store.getTask(task.task_id).semantic_decision.steps, [
    { objective: "first", verification: "The first concern is satisfied." },
    { objective: "second", verification: "The second concern is satisfied." },
  ]);
  assert.deepEqual(await store.recordTaskSemanticDecision(task.task_id, {
    sourceAttemptId: attempt.attempt_id,
    decision: "decompose",
    reason: "same source is idempotent",
    steps: [
      { objective: "ignored-a", verification: "ignored verification a" },
      { objective: "ignored-b", verification: "ignored verification b" },
    ],
  }), decision);
});

test("WorkStateStore prevents two active Attempts from writing one workspace", async () => {
  const store = await WorkStateStore.open(await storeFixture());
  const task = await store.createTask({ objective: "one writer" });
  const workPackage = await store.createWorkPackage({ taskId: task.task_id, objective: "edit" });
  await store.createAttempt({ workPackageId: workPackage.work_package_id, assignment: { harness: "dsh" }, workspace: "/tmp/shared" });
  await assert.rejects(
    store.createAttempt({ workPackageId: workPackage.work_package_id, assignment: { harness: "codex" }, workspace: "/tmp/../tmp/shared" }),
    (error) => error.code === "WORKSPACE_WRITER_CONFLICT",
  );
});

test("Tutti refuses Task closure when Attempt evidence was not accepted", async () => {
  const store = await WorkStateStore.open(await storeFixture());
  const task = await store.createTask({ objective: "reject bad result" });
  const workPackage = await store.createWorkPackage({ taskId: task.task_id, objective: "edit" });
  const attempt = await store.createAttempt({ workPackageId: workPackage.work_package_id, assignment: { harness: "dsh" }, workspace: "/tmp/rejected" });
  await store.markAttemptRunning(attempt.attempt_id, { runId: "run-rejected" });
  await store.finishAttempt(attempt.attempt_id, { result: { status: "completed" }, evidence: {}, acceptance: { accepted: false } });
  await assert.rejects(
    closeAcceptedTask({ store, attemptId: attempt.attempt_id, facts: ["should not persist"] }),
    (error) => error.code === "TASK_ACCEPTANCE_REQUIRED",
  );
  assert.equal(store.getTask(task.task_id).status, "open");
  assert.equal(store.getCurrentTruth().length, 0);
});

test("closed Tasks and WorkPackages reject new execution branches", async () => {
  const store = await WorkStateStore.open(await storeFixture());
  const task = await store.createTask({ objective: "close once" });
  const workPackage = await store.createWorkPackage({ taskId: task.task_id, objective: "execute once" });
  const attempt = await store.createAttempt({ workPackageId: workPackage.work_package_id, assignment: { harness: "dsh" }, workspace: "/tmp/closed" });
  await store.markAttemptRunning(attempt.attempt_id, { runId: "run-closed" });
  await store.finishAttempt(attempt.attempt_id, { result: { status: "completed" }, evidence: {}, acceptance: { accepted: true } });
  await closeAcceptedTask({ store, attemptId: attempt.attempt_id, facts: ["closed"] });
  await assert.rejects(
    store.createWorkPackage({ taskId: task.task_id, objective: "too late" }),
    (error) => error.code === "TASK_STATE_INVALID",
  );
  await assert.rejects(
    store.createAttempt({ workPackageId: workPackage.work_package_id, assignment: { harness: "codex" }, workspace: "/tmp/another" }),
    (error) => error.code === "WORK_PACKAGE_STATE_INVALID",
  );
});

test("cancelling Attempt retains workspace writer ownership until terminal result", async () => {
  const store = await WorkStateStore.open(await storeFixture());
  const task = await store.createTask({ objective: "cancel safely" });
  const workPackage = await store.createWorkPackage({ taskId: task.task_id, objective: "edit" });
  const attempt = await store.createAttempt({ workPackageId: workPackage.work_package_id, assignment: { harness: "dsh" }, workspace: "/tmp/cancelling" });
  await store.markAttemptRunning(attempt.attempt_id, { runId: "run-cancelling" });
  await store.markAttemptCancelling(attempt.attempt_id);

  await assert.rejects(
    store.createAttempt({ workPackageId: workPackage.work_package_id, assignment: { harness: "dsh" }, workspace: "/tmp/cancelling" }),
    (error) => error.code === "WORKSPACE_WRITER_CONFLICT",
  );

  const finished = await store.finishAttempt(attempt.attempt_id, { result: { status: "cancelled" }, evidence: {}, acceptance: { accepted: false } });
  assert.equal(finished.status, "cancelled");
});

test("WorkStateStore registers one direct WorkspaceRef and reuses it", async () => {
  const store = await WorkStateStore.open(await storeFixture());
  const first = await store.ensureWorkspace({ path: "/tmp/project", projectRoot: "/tmp/project", mode: "direct" });
  const second = await store.ensureWorkspace({ path: "/tmp/project", projectRoot: "/tmp/project", mode: "direct" });

  assert.equal(first.workspace_ref_id, second.workspace_ref_id);
  assert.equal(first.landing_required, false);
  assert.equal(first.landing_status, "not_required");
  await assert.rejects(
    store.ensureWorkspace({ path: "/tmp/project/worktree", projectRoot: "/tmp/project", mode: "direct" }),
    (error) => error.code === "WORKSPACE_DIRECT_PATH_MISMATCH",
  );
});

test("isolated WorkspaceRef blocks Task closure until landing is recorded", async () => {
  const store = await WorkStateStore.open(await storeFixture());
  const task = await store.createTask({ objective: "land first" });
  const workPackage = await store.createWorkPackage({ taskId: task.task_id, objective: "edit isolated" });
  const workspace = await store.ensureWorkspace({ path: "/tmp/project-worktree", projectRoot: "/tmp/project", mode: "isolated" });
  const attempt = await store.createAttempt({ workPackageId: workPackage.work_package_id, assignment: { harness: "dsh" }, workspaceRefId: workspace.workspace_ref_id });
  await store.markAttemptRunning(attempt.attempt_id, { runId: "run-isolated" });
  await store.finishAttempt(attempt.attempt_id, { result: { status: "completed" }, evidence: {}, acceptance: { accepted: true } });

  await assert.rejects(
    closeAcceptedTask({ store, attemptId: attempt.attempt_id, facts: ["not landed yet"] }),
    (error) => error.code === "TASK_LANDING_REQUIRED",
  );
  const landed = await store.markWorkspaceLanded(workspace.workspace_ref_id, { evidence: { method: "test" } });
  assert.equal(landed.landing_status, "landed");
  const closure = await closeAcceptedTask({ store, attemptId: attempt.attempt_id, facts: ["landed"] });
  assert.equal(closure.task.status, "completed");
});

test("older Work State migrates durably through conversation-capable version 9", async () => {
  const options = await storeFixture();
  await writeFile(options.filePath, `${JSON.stringify({ version: 1, tasks: {}, work_packages: {}, attempts: {}, current_truth: [] })}\n`);
  const store = await WorkStateStore.open(options);
  assert.equal(store.snapshot().version, 9);
  assert.deepEqual(store.snapshot().conversations, {});
  assert.deepEqual(store.snapshot().submissions, {});
  assert.deepEqual(store.snapshot().workspaces, {});
  assert.deepEqual(store.snapshot().interactions, {});
  assert.equal(JSON.parse(await readFile(options.filePath, "utf8")).version, 9);
});

test("WorkStateStore persists Conversations and links durable Tasks without making native sessions canonical", async () => {
  const options = await storeFixture();
  const store = await WorkStateStore.open(options);
  const conversation = await store.createConversation({
    title: "New conversation",
    defaults: { strategy: "capability", mode: "direct", target_id: "codex-capability", model: "gpt-5.6-sol", reasoning_effort: "high" },
  });
  const submission = await store.createSubmission({
    objective: "Implement the UI shell",
    requirements: { execution_strategy: "capability" },
    conversationId: conversation.conversation_id,
  });
  assert.equal(submission.task.conversation_id, conversation.conversation_id);
  assert.equal(store.getConversation(conversation.conversation_id).title, "Implement the UI shell");
  assert.deepEqual(store.getConversation(conversation.conversation_id).defaults, {
    strategy: "capability",
    mode: "direct",
    target_id: "codex-capability",
    model: "gpt-5.6-sol",
    reasoning_effort: "high",
  });
  assert.equal(store.getConversationView(conversation.conversation_id).tasks[0].task.task_id, submission.task.task_id);
  assert.equal(store.listConversations()[0].task_count, 1);

  await store.updateConversation(conversation.conversation_id, { title: "UI work", archived: true, defaults: { strategy: "economy", mode: "direct" } });
  assert.equal(store.listConversations().length, 0);
  assert.equal(store.listConversations({ archived: true })[0].title, "UI work");

  const reopened = await WorkStateStore.open(options);
  assert.equal(reopened.getConversationView(conversation.conversation_id).tasks.length, 1);
  assert.equal(reopened.getTask(submission.task.task_id).conversation_id, conversation.conversation_id);
  assert.equal(Object.hasOwn(reopened.getConversation(conversation.conversation_id), "session_id"), false);
});

test("WorkStateStore durably checkpoints finalization evidence before Attempt completion", async () => {
  const options = await storeFixture();
  const store = await WorkStateStore.open(options);
  const task = await store.createTask({ objective: "recover finalization", acceptance: { semantic: ["criterion"] } });
  const workPackage = await store.createWorkPackage({ taskId: task.task_id, objective: task.objective });
  const attempt = await store.createAttempt({ workPackageId: workPackage.work_package_id, assignment: { id: "codex" }, workspace: "/tmp/finalization-checkpoint" });
  await store.markAttemptRunning(attempt.attempt_id, { runId: "run-finalization" });
  await store.recordAttemptFinalizationCheckpoint(attempt.attempt_id, {
    result: { status: "completed", final_text: "ok" },
    evidence: { workspace: "/tmp/finalization-checkpoint", files: [] },
    verification: { accepted: true, checks: [] },
    semanticInputHash: "hash-1",
    semanticAcceptance: { required: true, accepted: true, review: { status: "available" }, checks: [] },
  });

  const reopened = await WorkStateStore.open(options);
  assert.equal(reopened.getAttempt(attempt.attempt_id).status, "running");
  assert.equal(reopened.getAttempt(attempt.attempt_id).finalization_checkpoint.semantic_input_hash, "hash-1");
  assert.equal(reopened.getAttempt(attempt.attempt_id).finalization_checkpoint.semantic_acceptance.review.status, "available");
});

test("WorkStateStore keeps semantic Task constraints separate from WorkPackage routing requirements", async () => {
  const store = await WorkStateStore.open(await storeFixture());
  const submission = await store.createSubmission({
    objective: "preserve user intent",
    constraints: ["Do not change public APIs.", "Do not change public APIs.", "Keep backward compatibility."],
    requirements: { capabilities: ["json_events"] },
  });

  assert.deepEqual(submission.task.constraints, ["Do not change public APIs.", "Keep backward compatibility."]);
  assert.deepEqual(submission.work_package.requirements, { capabilities: ["json_events"] });
  assert.equal(Object.hasOwn(submission.work_package.requirements, "constraints"), false);
});

test("WorkStateStore createSubmission durably replays one client request id and rejects semantic reuse", async () => {
  const options = await storeFixture();
  const store = await WorkStateStore.open(options);
  const first = await store.createSubmission({
    objective: "do it once",
    acceptance: { finalText: "ok" },
    requirements: { capabilities: ["headless"] },
    clientRequestId: "client-request-1",
    requestFingerprint: "fingerprint-a",
  });
  const replay = await store.createSubmission({
    objective: "do it once",
    acceptance: { finalText: "ok" },
    requirements: { capabilities: ["headless"] },
    clientRequestId: "client-request-1",
    requestFingerprint: "fingerprint-a",
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.task.task_id, first.task.task_id);
  assert.equal(replay.work_package.work_package_id, first.work_package.work_package_id);
  assert.equal(Object.keys(store.snapshot().tasks).length, 1);
  assert.equal(Object.keys(store.snapshot().work_packages).length, 1);

  const reopened = await WorkStateStore.open(options);
  const durableReplay = await reopened.createSubmission({
    objective: "do it once",
    clientRequestId: "client-request-1",
    requestFingerprint: "fingerprint-a",
  });
  assert.equal(durableReplay.task.task_id, first.task.task_id);
  await assert.rejects(
    reopened.createSubmission({ objective: "different", clientRequestId: "client-request-1", requestFingerprint: "fingerprint-b" }),
    (error) => error.code === "SUBMISSION_IDEMPOTENCY_CONFLICT" && error.task_id === first.task.task_id,
  );
});

test("WorkStateStore persists conservative monotonic side-effect classification", async () => {
  const options = await storeFixture();
  const store = await WorkStateStore.open(options);
  const submission = await store.createSubmission({ objective: "classify effects" });
  const attempt = await store.createAttempt({ workPackageId: submission.work_package.work_package_id, assignment: { harness: "codex" }, workspace: "/tmp/effects" });
  await store.markAttemptRunning(attempt.attempt_id, { runId: "run-effects" });

  await store.recordAttemptSideEffects(attempt.attempt_id, { classification: "none", source: "read-only-tool" });
  await store.recordAttemptSideEffects(attempt.attempt_id, { classification: "workspace_only", source: "file-change" });
  await store.recordAttemptSideEffects(attempt.attempt_id, { classification: "none", source: "later-read" });
  await store.recordAttemptSideEffects(attempt.attempt_id, { classification: "external_possible", source: "command-approval", detail: "curl example" });
  const classified = store.getAttempt(attempt.attempt_id);
  assert.equal(classified.side_effects, "external_possible");
  assert.deepEqual(classified.side_effect_evidence.map((item) => item.classification), ["none", "workspace_only", "none", "external_possible"]);

  const reopened = await WorkStateStore.open(options);
  assert.equal(reopened.getAttempt(attempt.attempt_id).side_effects, "external_possible");
});

test("WorkStateStore persists the actual native approval state for one Attempt", async () => {
  const options = await storeFixture();
  const store = await WorkStateStore.open(options);
  const submission = await store.createSubmission({ objective: "persist approval state" });
  const attempt = await store.createAttempt({ workPackageId: submission.work_package.work_package_id, assignment: { harness: "codex" }, workspace: "/tmp/approval-state" });
  await store.markAttemptRunning(attempt.attempt_id, { runId: "run-approval-state" });
  await store.recordAttemptApprovalState(attempt.attempt_id, {
    provider: "codex",
    approval_policy: "on-request",
    approvals_reviewer: "user",
    sandbox: "workspace-write",
  }, {
    validation: { compatible: true, reason: null },
  });
  const reopened = await WorkStateStore.open(options);
  assert.deepEqual(reopened.getAttempt(attempt.attempt_id).native_approval_state, {
    provider: "codex",
    approval_policy: "on-request",
    approvals_reviewer: "user",
    sandbox: "workspace-write",
  });
  assert.equal(reopened.getAttempt(attempt.attempt_id).approval_validation.compatible, true);
  assert.equal(reopened.getAttempt(attempt.attempt_id).approval_validation.reason, null);
});

test("WorkStateStore never downgrades an incompatible approval validation", async () => {
  const store = await WorkStateStore.open(await storeFixture());
  const submission = await store.createSubmission({ objective: "keep approval drift sticky" });
  const attempt = await store.createAttempt({ workPackageId: submission.work_package.work_package_id, assignment: { harness: "codex" }, workspace: "/tmp/approval-drift" });
  await store.markAttemptRunning(attempt.attempt_id, { runId: "run-approval-drift" });
  await store.recordAttemptApprovalState(attempt.attempt_id, { provider: "codex" }, { validation: { compatible: false, reason: "mismatch:approval_state.provider" } });
  await store.recordAttemptApprovalState(attempt.attempt_id, { provider: "codex" }, { validation: { compatible: true, reason: null } });
  assert.deepEqual(store.getAttempt(attempt.attempt_id).approval_validation, {
    compatible: false,
    reason: "mismatch:approval_state.provider",
    observed_at: "2026-09-17T00:00:00.000Z",
  });
});

test("WorkStateStore can persist an approval validation when no native approval state was emitted", async () => {
  const store = await WorkStateStore.open(await storeFixture());
  const submission = await store.createSubmission({ objective: "persist missing approval state" });
  const attempt = await store.createAttempt({ workPackageId: submission.work_package.work_package_id, assignment: { harness: "dsh-acp" }, workspace: "/tmp/approval-missing" });
  await store.markAttemptRunning(attempt.attempt_id, { runId: "run-approval-missing" });
  await store.recordAttemptApprovalValidation(attempt.attempt_id, { compatible: false, reason: "unknown:approval_state" });

  const current = store.getAttempt(attempt.attempt_id);
  assert.equal(current.native_approval_state, null);
  assert.equal(current.approval_validation.compatible, false);
  assert.equal(current.approval_validation.reason, "unknown:approval_state");
});

test("WorkStateStore persists native process-group ownership with the primary PID", async () => {
  const store = await WorkStateStore.open(await storeFixture());
  const submission = await store.createSubmission({ objective: "persist process group" });
  const attempt = await store.createAttempt({ workPackageId: submission.work_package.work_package_id, assignment: { harness: "codex" }, workspace: "/tmp/process-group" });
  await store.markAttemptRunning(attempt.attempt_id, { runId: "run-process-group", pid: 1234, processGroupId: 5678, hostname: "host-a" });
  assert.deepEqual(store.getAttempt(attempt.attempt_id).runtime_process, {
    pid: 1234,
    process_group_id: 5678,
    hostname: "host-a",
    observed_at: "2026-09-17T00:00:00.000Z",
  });
});

test("PendingInteraction persists and only resolves after a native response path can accept it", async () => {
  const options = await storeFixture();
  const store = await WorkStateStore.open(options);
  const task = await store.createTask({ objective: "answer a runtime question" });
  const workPackage = await store.createWorkPackage({ taskId: task.task_id, objective: "ask" });
  const attempt = await store.createAttempt({ workPackageId: workPackage.work_package_id, assignment: { id: "codex", capabilities: ["interaction_response"] }, workspace: "/tmp/interaction" });
  await store.markAttemptRunning(attempt.attempt_id, { runId: "run-interaction" });
  const interaction = await store.createInteraction({
    attemptId: attempt.attempt_id,
    kind: "user_input",
    summary: "Choose compatibility mode",
    nativeRequestRef: "native-request-1",
    nativeContract: { provider: "codex", method: "item/tool/requestUserInput", response: { shape: "answers" } },
  });

  assert.equal(store.listInteractions({ attemptId: attempt.attempt_id, status: "pending" }).length, 1);
  assert.equal(store.getAttempt(attempt.attempt_id).status, "waiting_input");
  const resolved = await store.resolveInteraction(interaction.interaction_id, { response: "compatible", resolvedBy: "user" });
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.response, "compatible");
  assert.equal(store.getAttempt(attempt.attempt_id).status, "running");

  const reopened = await WorkStateStore.open(options);
  assert.equal(reopened.getInteraction(interaction.interaction_id).status, "resolved");
  assert.deepEqual(reopened.getInteraction(interaction.interaction_id).native_contract, {
    provider: "codex",
    method: "item/tool/requestUserInput",
    response: { shape: "answers" },
  });
});

test("PendingInteraction is idempotent per native request and permission waiting has priority", async () => {
  const store = await WorkStateStore.open(await storeFixture());
  const task = await store.createTask({ objective: "dedupe native prompts" });
  const workPackage = await store.createWorkPackage({ taskId: task.task_id, objective: "ask twice" });
  const attempt = await store.createAttempt({ workPackageId: workPackage.work_package_id, assignment: { id: "codex" }, workspace: "/tmp/interaction-dedupe" });
  await store.markAttemptRunning(attempt.attempt_id, { runId: "run-dedupe" });
  const first = await store.createInteraction({ attemptId: attempt.attempt_id, kind: "user_input", summary: "Pick mode", nativeRequestRef: "req-1" });
  const duplicate = await store.createInteraction({ attemptId: attempt.attempt_id, kind: "user_input", summary: "Pick mode", nativeRequestRef: "req-1" });
  assert.equal(first.interaction_id, duplicate.interaction_id);

  const permission = await store.createInteraction({ attemptId: attempt.attempt_id, kind: "permission", summary: "Allow command?", nativeRequestRef: "req-2" });
  assert.equal(store.getAttempt(attempt.attempt_id).status, "waiting_permission");
  await store.resolveInteraction(permission.interaction_id, { response: "allow", resolvedBy: "policy" });
  assert.equal(store.getAttempt(attempt.attempt_id).status, "waiting_input");
  await store.resolveInteraction(first.interaction_id, { response: "compatible", resolvedBy: "user" });
  assert.equal(store.getAttempt(attempt.attempt_id).status, "running");
});

test("terminal Attempt orphans unresolved interactions", async () => {
  const store = await WorkStateStore.open(await storeFixture());
  const task = await store.createTask({ objective: "do not leave stale prompts" });
  const workPackage = await store.createWorkPackage({ taskId: task.task_id, objective: "ask then exit" });
  const attempt = await store.createAttempt({ workPackageId: workPackage.work_package_id, assignment: { id: "codex" }, workspace: "/tmp/orphan-interaction" });
  await store.markAttemptRunning(attempt.attempt_id, { runId: "run-orphan" });
  const interaction = await store.createInteraction({ attemptId: attempt.attempt_id, kind: "permission", summary: "Allow command?", nativeRequestRef: "permission-1" });
  assert.equal(store.getAttempt(attempt.attempt_id).status, "waiting_permission");
  await store.finishAttempt(attempt.attempt_id, { result: { status: "failed" }, evidence: {}, acceptance: { accepted: false } });

  const orphaned = store.getInteraction(interaction.interaction_id);
  assert.equal(orphaned.status, "orphaned");
  assert.equal(orphaned.response, "attempt_terminal");
});

test("WorkStateStore exposes one durable Task view with latest active Attempt and pending interactions", async () => {
  const options = await storeFixture();
  const store = await WorkStateStore.open(options);
  const task = await store.createTask({ objective: "inspect current task" });
  const workPackage = await store.createWorkPackage({ taskId: task.task_id, objective: "inspect current task" });
  const attempt = await store.createAttempt({ workPackageId: workPackage.work_package_id, assignment: { harness: "codex" }, workspace: "/tmp/task-view" });
  await store.markAttemptRunning(attempt.attempt_id, { runId: "run-task-view" });
  const interaction = await store.createInteraction({ attemptId: attempt.attempt_id, kind: "permission", summary: "approve", nativeRequestRef: "native-task-view" });

  const view = store.getTaskView(task.task_id);
  assert.equal(view.task.task_id, task.task_id);
  assert.equal(view.work_packages.length, 1);
  assert.equal(view.attempts.length, 1);
  assert.equal(view.active_attempt.attempt_id, attempt.attempt_id);
  assert.equal(view.latest_attempt.attempt_id, attempt.attempt_id);
  assert.equal(view.pending_interactions[0].interaction_id, interaction.interaction_id);
  assert.equal(store.listTaskViews({ status: "open" })[0].task.task_id, task.task_id);
});
