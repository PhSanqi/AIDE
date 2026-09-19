import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recommendCandidates, targetsFromHarnessProbe } from "../src/broker/recommend.js";
import { WorkStateStore } from "../src/core/work-state-store.js";
import { HarnessRouter } from "../src/execution/harness-router.js";
import { evaluateAcceptance } from "../src/tutti/acceptance.js";
import { closeAcceptedTask } from "../src/tutti/task-closure.js";
import { collectFileEvidence } from "../src/workspace/evidence.js";

if (process.env.AIDE_ALLOW_MODEL_CALL !== "1") {
  console.error("Refusing model call. Set AIDE_ALLOW_MODEL_CALL=1 after explicit user authorization.");
  process.exit(2);
}

const expected = "AIDE_DSH_SMOKE_OK";
const workspace = await mkdtemp(join(tmpdir(), "aide-dsh-smoke-"));
const stateDirectory = await mkdtemp(join(tmpdir(), "aide-state-smoke-"));
const workState = await WorkStateStore.open({ filePath: join(stateDirectory, "work-state.json") });
const task = await workState.createTask({ objective: "Prove one DSH execution through AIDE.", acceptance: { finalText: expected, files: { "SMOKE.txt": expected } } });
const workPackage = await workState.createWorkPackage({ taskId: task.task_id, objective: "Create the smoke artifact.", requirements: { capabilities: ["headless", "json_events"] } });
const router = new HarnessRouter();
const recommendation = recommendCandidates({
  requirements: workPackage.requirements,
  targets: targetsFromHarnessProbe(await router.probe()),
});
const assignment = recommendation.candidates[0];
if (!assignment) throw Object.assign(new Error("Broker found no qualified Harness for the smoke task."), { code: "NO_QUALIFIED_HARNESS" });
const attempt = await workState.createAttempt({ workPackageId: workPackage.work_package_id, assignment, workspace });
const started = router.start({
  harness: assignment.harness,
  cwd: workspace,
  task: `Create a file named SMOKE.txt in the current workspace containing exactly ${expected}. Do not modify anything else. Then reply with exactly ${expected}.`,
});
await workState.markAttemptRunning(attempt.attempt_id, { runId: started.run_id });

const deadline = Date.now() + 120_000;
let result;
while (Date.now() < deadline) {
  result = router.result(started.run_id);
  if (result.ready) break;
  await new Promise((resolve) => setTimeout(resolve, 200));
}
if (!result?.ready) {
  router.cancel(started.run_id);
  throw Object.assign(new Error("DSH smoke run timed out."), { code: "DSH_SMOKE_TIMEOUT" });
}

const evidence = await collectFileEvidence({ cwd: workspace, paths: ["SMOKE.txt"] });
const acceptance = evaluateAcceptance({ result, evidence, criteria: { finalText: expected, files: { "SMOKE.txt": expected } } });
const completedAttempt = await workState.finishAttempt(attempt.attempt_id, { result, evidence, acceptance });
const closure = acceptance.accepted
  ? await closeAcceptedTask({ store: workState, attemptId: completedAttempt.attempt_id, facts: ["AIDE completed the DSH smoke WorkPackage with verified file evidence."] })
  : null;

console.log(JSON.stringify({
  state_file: join(stateDirectory, "work-state.json"),
  task,
  work_package: workPackage,
  attempt: completedAttempt,
  closure,
  current_truth: workState.getCurrentTruth(),
  workspace,
  recommendation,
  assignment,
  run_id: started.run_id,
  session_id: result.session_id,
  result: {
    status: result.status,
    exit_code: result.exit_code,
    turn_end_reason: result.turn_end_reason,
    final_text: result.final_text,
    error_code: result.error_code,
  },
  evidence,
  acceptance,
}, null, 2));

if (!acceptance.accepted) process.exitCode = 1;
