import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { AideControl } from "../src/control/control-service.js";
import { AideHttpTransport } from "../src/control/http-transport.js";
import { AideServiceRuntime } from "../src/control/service-runtime.js";
import { createHistoricalShadowAdvisor } from "../src/broker/routing-replay.js";
import { WorkStateStore } from "../src/core/work-state-store.js";
import { HarnessRouter } from "../src/execution/harness-router.js";
import { LocalContextFabric } from "../src/tutti/context-fabric.js";
import { createHarnessSemanticVerifier, TuttiIntake } from "../src/tutti/intake.js";
import { defaultStateRoot } from "../src/platform/runtime.js";

const projectRoot = resolve(process.env.AIDE_PROJECT_ROOT ?? process.cwd());
const projectKey = createHash("sha256").update(projectRoot).digest("hex").slice(0, 16);
const stateRoot = resolve(process.env.AIDE_STATE_DIR ?? defaultStateRoot(projectKey));
const statePath = resolve(process.env.AIDE_STATE_PATH ?? join(stateRoot, "work-state.json"));
const leasePath = resolve(process.env.AIDE_SERVICE_LEASE ?? join(stateRoot, "service.lease"));
const host = process.env.AIDE_CONTROL_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.AIDE_CONTROL_PORT ?? "8711", 10);

const store = await WorkStateStore.open({ filePath: statePath });
const context = await LocalContextFabric.open({ root: projectRoot, store });
const router = new HarnessRouter();
const executionStrategy = process.env.AIDE_EXECUTION_STRATEGY ?? "economy";
const semanticVerifier = createHarnessSemanticVerifier({ router });
const shadowMinSamples = Number.parseInt(process.env.AIDE_SHADOW_MIN_SAMPLES ?? "10", 10);
const shadowAdvisor = createHistoricalShadowAdvisor({ historyProvider: () => store.listRoutingHistory({ limit: 1_000 }), minSamples: shadowMinSamples });
const intake = new TuttiIntake({ store, router, context, defaultExecutionStrategy: executionStrategy, semanticVerifier, shadowAdvisor });
const control = new AideControl({ intake });
const runtime = await AideServiceRuntime.start({ control, leasePath });

let transport;
try {
  transport = await AideHttpTransport.start({ runtime, host, port });
} catch (error) {
  await runtime.stop();
  throw error;
}

const address = transport.address();
const recoveries = await runtime.recoveries();
console.log(JSON.stringify({
  service: "aide",
  project_root: projectRoot,
  state_path: statePath,
  owner_id: runtime.lease.ownerId,
  http: address,
  mcp_path: "/mcp",
  execution_strategy: executionStrategy,
  shadow_advisor: { version: "history-v0", min_samples: shadowMinSamples, mode: "observe-only" },
  recovery_required: recoveries.map((view) => view.task.task_id),
}, null, 2));

let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  try {
    await transport.stop();
    await runtime.stop();
  } finally {
    if (signal) process.exit(0);
  }
}

process.once("SIGINT", () => { void stop("SIGINT"); });
process.once("SIGTERM", () => { void stop("SIGTERM"); });
