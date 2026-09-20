import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkStateStore } from "../src/core/work-state-store.js";
import { HarnessRouter } from "../src/execution/harness-router.js";
import { LocalContextFabric } from "../src/tutti/context-fabric.js";
import { TuttiIntake } from "../src/tutti/intake.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const stateDirectory = await mkdtemp(join(tmpdir(), "aide-intake-state-"));
const store = await WorkStateStore.open({ filePath: join(stateDirectory, "work-state.json") });
const context = await LocalContextFabric.open({ root, store });
const router = new HarnessRouter();
const intake = new TuttiIntake({ store, router, context });
const probes = await router.probe();

const headless = probes.dsh?.available
  ? await intake.submit("Inspect WorkStateStore before making a bounded change.", {
      requirements: { capabilities: ["headless", "json_events"] },
    })
  : null;
if (headless) assert.equal(headless.assignment.id, "dsh");

const acp = probes["dsh-acp"]?.available
  ? await intake.submit("Verify the configured interactive approval target without running it.", {
      requirements: {
        approval: {
          interactive: true,
          response_channel: true,
          session_grants: "forbidden",
          auto_review: "forbidden",
        },
      },
    })
  : null;
if (acp) assert.equal(acp.assignment.id, "dsh-acp");

const economy = await intake.submit("Verify economy routing without running a model.", {
  requirements: { execution_strategy: "economy" },
});
assert.equal(economy.assignment.id, "codex-economy");
assert.equal(economy.assignment.model, "gpt-5.6-luna");

const capability = await intake.submit("Verify capability routing without running a model.", {
  requirements: { execution_strategy: "capability" },
});
assert.equal(capability.assignment.id, "codex-capability");
assert.equal(capability.assignment.model, "gpt-5.6-sol");
assert.equal(capability.assignment.reasoning_effort, "ultra");

const plan = await intake.submit("Verify Plan-mode routing without running a model.", {
  requirements: { target_role: "planning", capabilities: ["planning_mode"], preferred_targets: ["codex-plan"] },
});
assert.equal(plan.assignment.id, "codex-plan");
assert.equal(plan.assignment.collaboration_mode, "plan");

const planAlt = await intake.submit("Verify alternate Plan-mode routing without running a model.", {
  requirements: { target_role: "planning", capabilities: ["planning_mode"], preferred_targets: ["codex-plan-alt"] },
});
assert.equal(planAlt.assignment.id, "codex-plan-alt");
assert.equal(planAlt.assignment.model, "gpt-5.6-sol");
assert.equal(planAlt.assignment.reasoning_effort, "high");

console.log(JSON.stringify({
  headless: {
    available: Boolean(headless),
    ...(headless ? {
      task_id: headless.task.task_id,
      work_package_id: headless.work_package.work_package_id,
      assignment: headless.assignment.id,
      candidates: headless.recommendation.candidates.map((candidate) => candidate.id),
    } : {}),
  },
  dsh_acp: {
    available: Boolean(acp),
    ...(acp ? {
      task_id: acp.task.task_id,
      work_package_id: acp.work_package.work_package_id,
      assignment: acp.assignment.id,
      candidates: acp.recommendation.candidates.map((candidate) => candidate.id),
      rejected: acp.recommendation.rejected,
    } : {}),
  },
  economy: {
    assignment: economy.assignment.id,
    model: economy.assignment.model,
    reasoning_effort: economy.assignment.reasoning_effort,
  },
  capability: {
    assignment: capability.assignment.id,
    model: capability.assignment.model,
    reasoning_effort: capability.assignment.reasoning_effort,
    capabilities: capability.assignment.capabilities,
  },
  planning: {
    assignment: plan.assignment.id,
    model: plan.assignment.model,
    collaboration_mode: plan.assignment.collaboration_mode,
  },
  planning_alt: {
    assignment: planAlt.assignment.id,
    model: planAlt.assignment.model,
    reasoning_effort: planAlt.assignment.reasoning_effort,
    collaboration_mode: planAlt.assignment.collaboration_mode,
  },
  routing_context: (headless ?? economy).routing_context,
}, null, 2));
