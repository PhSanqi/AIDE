import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { replayRoutingHistory } from "../src/broker/routing-replay.js";
import { WorkStateStore } from "../src/core/work-state-store.js";
import { defaultStateRoot } from "../src/platform/runtime.js";

const projectRoot = resolve(process.env.AIDE_PROJECT_ROOT ?? process.cwd());
const projectKey = createHash("sha256").update(projectRoot).digest("hex").slice(0, 16);
const stateRoot = resolve(process.env.AIDE_STATE_DIR ?? defaultStateRoot(projectKey));
const statePath = resolve(process.env.AIDE_STATE_PATH ?? join(stateRoot, "work-state.json"));
const limit = Number.parseInt(process.env.AIDE_ROUTING_REPLAY_LIMIT ?? "1000", 10);
const store = await WorkStateStore.open({ filePath: statePath });

console.log(JSON.stringify(replayRoutingHistory(store.listRoutingHistory({ limit })), null, 2));
