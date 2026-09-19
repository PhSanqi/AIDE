import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { WorkStateStore } from "../src/core/work-state-store.js";
import { CodexAppServerAdapter } from "../src/execution/codex-app-server-adapter.js";
import { HarnessRouter } from "../src/execution/harness-router.js";
import { LocalContextFabric } from "../src/tutti/context-fabric.js";
import { createHarnessSemanticVerifier, TuttiIntake } from "../src/tutti/intake.js";
import { defaultCodexCommand, defaultStateBase, nativeCommandSpec } from "../src/platform/runtime.js";

if (process.env.AIDE_ALLOW_MODEL_CALL !== "1") {
  console.error("Refusing model call. Set AIDE_ALLOW_MODEL_CALL=1 only after explicit user authorization.");
  process.exit(2);
}

const mode = process.argv[2];
if (!["context", "plan", "decomposition", "semantic-review", "reattach", "crossfire"].includes(mode)) throw new TypeError("Usage: codex-advanced-smoke.mjs <context|plan|decomposition|semantic-review|reattach|crossfire>");

const root = await mkdtemp(join(tmpdir(), `aide-codex-${mode}-smoke-`));
const stateRoot = await mkdtemp(join(tmpdir(), `aide-codex-${mode}-state-`));
const store = await WorkStateStore.open({ filePath: join(stateRoot, "work-state.json") });
const reportDir = process.env.AIDE_SMOKE_REPORT_DIR ?? join(defaultStateBase(), "smoke-reports");
const reportPath = process.env.AIDE_SMOKE_REPORT_PATH ?? join(reportDir, `${Date.now()}-${mode}-${process.pid}.json`);
const startedAt = new Date().toISOString();

await mkdir(dirname(reportPath), { recursive: true });
function reportValue(status, extra = {}) {
  return {
    mode,
    status,
    started_at: startedAt,
    updated_at: new Date().toISOString(),
    pid: process.pid,
    work_state: store.snapshot(),
    ...extra,
  };
}
async function writeReport(status, extra = {}) {
  await writeFile(reportPath, `${JSON.stringify(reportValue(status, extra), null, 2)}\n`);
}

process.on("uncaughtExceptionMonitor", (error) => {
  writeFileSync(reportPath, `${JSON.stringify(reportValue("failed", {
    error: { name: error?.name ?? null, code: error?.code ?? null, message: error?.message ?? String(error), stack: error?.stack ?? null },
  }), null, 2)}\n`);
});

await writeReport("running");

try {
  if (mode === "reattach") {
    const command = process.env.AIDE_CODEX_COMMAND ?? defaultCodexCommand();
    const model = process.env.AIDE_REATTACH_SMOKE_MODEL ?? "gpt-5.6-luna";
    const effort = process.env.AIDE_REATTACH_SMOKE_EFFORT ?? "medium";

    const connect = async () => {
      const launch = nativeCommandSpec(command, ["app-server", "--stdio"]);
      const child = spawn(launch.command, launch.args, { cwd: root, stdio: ["pipe", "pipe", "pipe"], windowsHide: process.platform === "win32" });
      let buffer = "";
      let nextId = 1;
      const pending = new Map();
      const notifications = [];
      const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
      const request = (method, params = {}) => new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(String(id), { resolve, reject, method });
        send({ id, method, params });
      });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          if (message.id !== undefined && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) {
            const waiter = pending.get(String(message.id));
            if (!waiter) continue;
            pending.delete(String(message.id));
            if (message.error) waiter.reject(Object.assign(new Error(message.error.message ?? `${waiter.method} failed.`), { code: message.error.code, data: message.error.data }));
            else waiter.resolve(message.result);
          } else if (typeof message.method === "string") notifications.push(message);
        }
      });
      await request("initialize", { clientInfo: { name: "aide-reattach-smoke", title: "AIDE Reattach Smoke", version: "0.0.0" }, capabilities: { experimentalApi: true, requestAttestation: false } });
      send({ method: "initialized" });
      return {
        child,
        notifications,
        request,
        async stop(signal = "SIGTERM") {
          if (child.exitCode !== null || child.signalCode !== null) return;
          await new Promise((resolve) => {
            child.once("close", resolve);
            child.kill(signal);
          });
        },
      };
    };

    let first = null;
    let second = null;
    try {
      first = await connect();
      const thread = await first.request("thread/start", { cwd: root, model, sandbox: "read-only", approvalPolicy: "never" });
      const threadId = thread.thread.id;
      const turn = await first.request("turn/start", {
        threadId,
        input: [{ type: "text", text: "Do not use tools. Produce a careful multi-paragraph explanation of why durable orchestration state and native execution state must be separated. End exactly with AIDE_REATTACH_SMOKE_OK.", text_elements: [] }],
        model,
        effort,
      });
      const turnId = turn.turn.id;
      assert.equal(first.notifications.some((message) => message.method === "turn/completed" && message.params?.turn?.id === turnId), false, "Turn completed before crash injection; reattach smoke is inconclusive.");
      await first.stop("SIGKILL");
      first = null;

      second = await connect();
      const resumed = await second.request("thread/resume", { threadId, cwd: root, excludeTurns: true });
      const initialStatus = resumed.thread.status ?? null;
      const deadline = Date.now() + 120_000;
      let observedTurn = null;
      while (Date.now() < deadline) {
        const read = await second.request("thread/read", { threadId, includeTurns: true });
        observedTurn = read?.thread?.turns?.find((item) => item.id === turnId) ?? null;
        if (observedTurn && observedTurn.status !== "inProgress") break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const completionNotification = second.notifications.find((message) => message.method === "turn/completed" && message.params?.turn?.id === turnId) ?? null;
      assert.ok(observedTurn, "Resumed thread did not expose the pre-crash turn.");
      assert.equal(observedTurn.status, "interrupted", `Expected app-server loss to terminate the active turn, got: ${observedTurn.status ?? "unknown"}.`);
      const finalTextMatches = observedTurn.items?.some((item) => typeof item.text === "string" && item.text.trim().endsWith("AIDE_REATTACH_SMOKE_OK")) ?? false;
      assert.equal(finalTextMatches, false, "Interrupted pre-crash turn unexpectedly produced the requested final marker.");
      console.log(JSON.stringify({
        mode,
        ok: true,
        live_reattach_supported: false,
        model,
        thread_id: threadId,
        turn_id: turnId,
        resume_status: initialStatus,
        can_accept_direct_input: resumed.thread.canAcceptDirectInput ?? null,
        terminal_turn_status: observedTurn.status,
        completion_notification_received: completionNotification !== null,
        final_text_matches: finalTextMatches,
      }, null, 2));
    } finally {
      await first?.stop().catch(() => {});
      await second?.stop().catch(() => {});
    }
  }

  if (mode === "context") {
    await writeFile(join(root, "probe.js"), "export const AideContextProbeSymbol = 1729;\n");
    const context = await LocalContextFabric.open({ root, store });
    const adapter = new CodexAppServerAdapter({
      profile: "context-smoke",
      model: process.env.AIDE_CONTEXT_SMOKE_MODEL ?? "gpt-5.6-sol",
      effort: "medium",
      sandbox: "read-only",
      approvalPolicy: "never",
    });
    const events = [];
    const handle = adapter.start({
      cwd: root,
      context,
      onEvent: (event) => events.push(event),
      task: "Do not use shell, filesystem, web, MCP, or other tools. You must use aide_context.symbol to locate AideContextProbeSymbol, then reply exactly AIDE_CONTEXT_SMOKE_OK.",
    });
    const result = await handle.done;
    assert.equal(result.status, "completed");
    assert.equal(result.final_text?.trim(), "AIDE_CONTEXT_SMOKE_OK");
    assert.ok(events.some((event) => event.type === "context_tool_call" && event.tool === "symbol"));
    assert.ok(events.some((event) => event.type === "context_tool_result" && event.tool === "symbol" && event.success === true));
    console.log(JSON.stringify({ mode, ok: true, session_id: result.session_id, context_calls: events.filter((event) => event.type === "context_tool_call") }, null, 2));
  }

  if (mode === "plan") {
    const context = await LocalContextFabric.open({ root, store });
    const intake = new TuttiIntake({ store, router: new HarnessRouter(), context });
    const started = await intake.startRun(
      "Before giving the plan, ask exactly one concise clarification using request_user_input. After I answer, produce a non-empty plan ending with AIDE_PLAN_SMOKE_OK. Do not execute tools or modify files.",
      { requirements: { target_role: "planning", capabilities: ["planning_mode"], sandbox_mode: "read-only", preferred_targets: ["codex-plan"] } },
    );
    const deadline = Date.now() + 120_000;
    let boundary = await intake.observeAttempt(started.attempt.attempt_id);
    while (boundary.state === "running" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      boundary = await intake.observeAttempt(started.attempt.attempt_id);
    }
    assert.equal(boundary.state, "waiting", "Plan smoke must prove native request_user_input before completion.");
    const interaction = boundary.interactions.find((item) => item.kind === "user_input");
    assert.ok(interaction, "Plan smoke did not emit a durable user_input interaction.");
    await intake.respondToInteraction(interaction.interaction_id, "Use the safer minimal-change option.", { resolvedBy: "plan-smoke" });
    boundary = await intake.runAttemptToBoundary(started.attempt.attempt_id, { timeoutMs: 120_000 });
    assert.equal(boundary.state, "terminal");
    assert.equal(boundary.verification.accepted, true);
    assert.ok(boundary.result.final_text?.includes("AIDE_PLAN_SMOKE_OK"));
    console.log(JSON.stringify({ mode, ok: true, target: started.assignment.id, interaction, result: boundary.result.final_text }, null, 2));
  }

  if (mode === "decomposition") {
    const context = await LocalContextFabric.open({ root, store });
    const router = new HarnessRouter();
    const intake = new TuttiIntake({ store, router, context, semanticVerifier: createHarnessSemanticVerifier({ router }) });
    const completed = await intake.runTask(
      [
        "This is a read-only semantic decomposition smoke. Do not modify files, use tools, or access the network.",
        "The work has two ordered concerns: first identify the durable decision boundary, then explain how the executor should consume that decision without creating a second authority plane.",
        "The decomposition planner should represent those as a small ordered decomposition rather than inventing unrelated requirements.",
        "The execution response must be concise and its final line must be exactly AIDE_DECOMPOSITION_SMOKE_OK.",
      ].join(" "),
      {
        requirements: { execution_strategy: "capability", semantic_decomposition: "plan" },
        timeoutMs: 180_000,
      },
    );
    const view = store.getTaskView(completed.task.task_id);
    assert.equal(completed.verification.accepted, true);
    assert.equal(view.task.semantic_decision?.kind, "task_decomposition");
    assert.equal(view.task.semantic_decision?.decision, "decompose");
    assert.ok(view.task.semantic_decision.steps.length >= 2);
    assert.ok(view.task.semantic_decision.steps.every((step) => typeof step.verification === "string" && step.verification.length > 0));
    assert.equal(view.work_packages.length, 2);
    assert.deepEqual(view.work_packages.map((workPackage) => workPackage.lineage?.kind ?? null), ["submission", "semantic_decomposition_execution"]);
    const planner = view.attempts.find((attempt) => attempt.assignment?.role === "planning");
    assert.ok(planner);
    assert.equal(planner.side_effects, "none");
    assert.equal(completed.verification.step_verification?.accepted, true);
    assert.equal(completed.verification.step_verification?.steps.length, view.task.semantic_decision.steps.length);
    assert.ok(completed.result.final_text?.trim().endsWith("AIDE_DECOMPOSITION_SMOKE_OK"));
    console.log(JSON.stringify({
      mode,
      ok: true,
      decision: view.task.semantic_decision,
      planner: { target: planner.assignment.id, model: planner.assignment.model ?? null, reasoning_effort: planner.assignment.reasoning_effort ?? null },
      executor: { target: completed.assignment.id, model: completed.assignment.model ?? null, reasoning_effort: completed.assignment.reasoning_effort ?? null },
    }, null, 2));
  }

  if (mode === "semantic-review") {
    await writeFile(join(root, "REVIEW_EVIDENCE.txt"), "The bounded change preserves the existing public boundary and does not introduce a second authority plane.\n");
    const context = await LocalContextFabric.open({ root, store });
    const fixture = {
      probe: async () => ({ available: true, capabilities: [] }),
      start: ({ onEvent }) => {
        onEvent({ type: "side_effect", classification: "none", source: "semantic-review-fixture" });
        return {
          pid: null,
          cancel: () => false,
          done: Promise.resolve({ status: "completed", exit_code: 0, session_id: "fixture-session", final_text: "mechanical-ok" }),
        };
      },
    };
    const unavailable = { probe: async () => ({ available: false }) };
    const router = new HarnessRouter({
      dsh: fixture,
      dshAcp: unavailable,
      codex: unavailable,
      codexEconomy: unavailable,
      codexCapability: unavailable,
      codexPlan: unavailable,
      codexPlanAlt: unavailable,
    });
    const semanticVerifier = createHarnessSemanticVerifier({ router, targetId: "codex-review" });
    const intake = new TuttiIntake({ store, router, context, semanticVerifier });
    const completed = await intake.submitAndRun("Verify the bounded architectural result semantically.", {
      constraints: ["Do not introduce a second authority plane."],
      acceptance: {
        finalText: "mechanical-ok",
        files: { "REVIEW_EVIDENCE.txt": "The bounded change preserves the existing public boundary and does not introduce a second authority plane.\n" },
        semantic: ["The evidence supports that the existing public boundary is preserved without creating a second authority plane."],
      },
    });
    assert.equal(completed.verification.accepted, true);
    assert.equal(completed.verification.semantic_review?.status, "available");
    assert.equal(completed.verification.semantic_review?.accepted, true);
    assert.equal(completed.verification.semantic_review?.provenance?.target_id, "codex-review");
    assert.equal(completed.verification.semantic_review?.provenance?.role, "verification");
    assert.equal(completed.closure?.task?.status, "completed");
    console.log(JSON.stringify({
      mode,
      ok: true,
      reviewer: completed.verification.semantic_review.provenance,
      semantic_review: completed.verification.semantic_review,
    }, null, 2));
  }

  if (mode === "crossfire") {
    const context = await LocalContextFabric.open({ root, store });
    const intake = new TuttiIntake({ store, router: new HarnessRouter(), context });
    const completed = await intake.runTask(
      [
        "This is a read-only semantic planning-consensus smoke. Do not modify files or invoke tools.",
        "Each planning target must independently produce a substantive plan containing the literal headers PLAN_STEPS: and TRADEOFF:, with at least three concrete numbered steps and at least one real tradeoff. Do not output the final executor marker as the plan.",
        "The final execution target must compare both plans, resolve at least one agreement or disagreement, and return a concise arbitration containing the literal headers ARBITRATION:, ADOPTED:, and REJECTED_OR_DEFERRED:.",
        "The final line of the executor response must be exactly AIDE_CROSSFIRE_SEMANTIC_OK.",
      ].join(" "),
      {
        requirements: { execution_strategy: "capability", plan_consensus: "dual", plan_targets: ["codex-plan", "codex-plan-alt"] },
        timeoutMs: 180_000,
      },
    );
    assert.equal(completed.verification.accepted, true);
    assert.equal(completed.attempt_chain.length, 3);
    const view = store.getTaskView(completed.task.task_id);
    const plans = view.attempts.filter((attempt) => attempt.assignment?.role === "planning");
    assert.equal(plans.length, 2);
    assert.ok(plans.every((attempt) => attempt.side_effects === "none"));
    assert.ok(plans.every((attempt) => attempt.assignment.model === "gpt-5.6-sol"));
    assert.deepEqual(plans.map((attempt) => attempt.assignment.reasoning_effort).sort(), ["high", "medium"]);
    const planTexts = plans.map((attempt) => attempt.outcome.final_text?.trim() ?? "");
    assert.ok(planTexts.every((plan) => plan.length >= 180), "Each planner must produce substantive text.");
    assert.ok(planTexts.every((plan) => plan.includes("PLAN_STEPS:") && plan.includes("TRADEOFF:")), "Each planner must satisfy the semantic plan contract.");
    assert.ok(planTexts.every((plan) => plan !== "AIDE_CROSSFIRE_SEMANTIC_OK"));
    assert.notEqual(planTexts[0], planTexts[1], "Independent planners must not collapse to identical plans.");
    const executorText = completed.result.final_text?.trim() ?? "";
    assert.equal(completed.assignment.model, "gpt-5.6-sol");
    assert.equal(completed.assignment.reasoning_effort, "ultra");
    assert.ok(executorText.includes("ARBITRATION:"));
    assert.ok(executorText.includes("ADOPTED:"));
    assert.ok(executorText.includes("REJECTED_OR_DEFERRED:"));
    assert.ok(executorText.endsWith("AIDE_CROSSFIRE_SEMANTIC_OK"));
    console.log(JSON.stringify({
      mode,
      ok: true,
      attempt_chain: completed.attempt_chain,
      planners: plans.map((attempt) => ({ target: attempt.assignment.id, model: attempt.assignment.model, reasoning_effort: attempt.assignment.reasoning_effort, plan: attempt.outcome.final_text })),
      executor: { target: completed.assignment.id, model: completed.assignment.model, reasoning_effort: completed.assignment.reasoning_effort, final_text: completed.result.final_text },
    }, null, 2));
  }
  await writeReport("passed");
  console.log(`AIDE_SMOKE_REPORT=${reportPath}`);
} catch (error) {
  await writeReport("failed", {
    error: {
      name: error?.name ?? null,
      code: error?.code ?? null,
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
    },
  });
  console.error(`AIDE_SMOKE_REPORT=${reportPath}`);
  throw error;
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(stateRoot, { recursive: true, force: true });
}
