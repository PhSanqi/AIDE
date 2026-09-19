import { randomUUID } from "node:crypto";
import { CodexAppServerAdapter } from "./codex-app-server-adapter.js";
import { DshAcpAdapter } from "./dsh-acp-adapter.js";
import { DshHeadlessAdapter } from "./dsh-headless-adapter.js";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const MAX_BUFFERED_EVENTS = 512;

export class HarnessRouter {
  constructor({
    dsh = new DshHeadlessAdapter(),
    dshAcp = new DshAcpAdapter(),
    codex = new CodexAppServerAdapter(),
    codexEconomy = new CodexAppServerAdapter({
      profile: "economy",
      model: process.env.AIDE_ECONOMY_CODEX_MODEL ?? "gpt-5.6-luna",
      effort: process.env.AIDE_ECONOMY_CODEX_EFFORT ?? "low",
      sandbox: "workspace-write",
      approvalPolicy: "on-request",
      strategyPriority: { economy: 0 },
    }),
    codexCapability = new CodexAppServerAdapter({
      profile: "capability",
      model: process.env.AIDE_CAPABILITY_CODEX_MODEL ?? "gpt-5.6-sol",
      effort: process.env.AIDE_CAPABILITY_CODEX_EFFORT ?? "ultra",
      sandbox: "workspace-write",
      approvalPolicy: "on-request",
      strategyPriority: { capability: 0 },
    }),
    codexPlan = new CodexAppServerAdapter({
      profile: "plan",
      model: process.env.AIDE_PLAN_CODEX_MODEL ?? "gpt-5.6-sol",
      effort: process.env.AIDE_PLAN_CODEX_EFFORT ?? "medium",
      collaborationMode: "plan",
      sandbox: "read-only",
      approvalPolicy: "never",
      targetRole: "planning",
    }),
    codexPlanAlt = new CodexAppServerAdapter({
      profile: "plan-alt",
      model: process.env.AIDE_PLAN_ALT_CODEX_MODEL ?? "gpt-5.6-sol",
      effort: process.env.AIDE_PLAN_ALT_CODEX_EFFORT ?? "high",
      collaborationMode: "plan",
      sandbox: "read-only",
      approvalPolicy: "never",
      targetRole: "planning",
    }),
    codexReview = new CodexAppServerAdapter({
      profile: "review",
      model: process.env.AIDE_REVIEW_CODEX_MODEL ?? "gpt-5.6-sol",
      effort: process.env.AIDE_REVIEW_CODEX_EFFORT ?? "medium",
      sandbox: "read-only",
      approvalPolicy: "never",
      targetRole: "verification",
    }),
  } = {}) {
    this.adapters = {
      dsh,
      "dsh-acp": dshAcp,
      codex,
      "codex-economy": codexEconomy,
      "codex-capability": codexCapability,
      "codex-plan": codexPlan,
      "codex-plan-alt": codexPlanAlt,
      "codex-review": codexReview,
    };
    this.runs = new Map();
  }

  async probe() {
    const entries = await Promise.all(Object.entries(this.adapters).map(async ([id, adapter]) => [id, await adapter.probe()]));
    return Object.fromEntries(entries);
  }

  async providerCatalog() {
    const codex = typeof this.adapters.codex?.providerCatalog === "function"
      ? await this.adapters.codex.providerCatalog()
      : { provider: "codex", account: { connected: false }, auth: { methods: [] }, models: [], collaboration_modes: [] };
    return {
      providers: [
        codex,
        {
          provider: "dsh",
          account: { connected: null, status: "native_managed" },
          auth: { methods: [], native_managed: true },
          models: [],
          collaboration_modes: [],
        },
      ],
    };
  }

  startProviderLogin(provider, options = {}) {
    if (provider !== "codex" || typeof this.adapters.codex?.startLogin !== "function") {
      throw Object.assign(new Error(`Provider login is not controlled by AIDE for ${provider}.`), { code: "PROVIDER_AUTH_UNSUPPORTED" });
    }
    return this.adapters.codex.startLogin(options);
  }

  providerLoginStatus(provider, loginId) {
    if (provider !== "codex" || typeof this.adapters.codex?.loginStatus !== "function") {
      throw Object.assign(new Error(`Provider login status is not controlled by AIDE for ${provider}.`), { code: "PROVIDER_AUTH_UNSUPPORTED" });
    }
    return this.adapters.codex.loginStatus(loginId);
  }

  cancelProviderLogin(provider, loginId) {
    if (provider !== "codex" || typeof this.adapters.codex?.cancelLogin !== "function") {
      throw Object.assign(new Error(`Provider login cancellation is not controlled by AIDE for ${provider}.`), { code: "PROVIDER_AUTH_UNSUPPORTED" });
    }
    return this.adapters.codex.cancelLogin(loginId);
  }

  logoutProvider(provider) {
    if (provider !== "codex" || typeof this.adapters.codex?.logout !== "function") {
      throw Object.assign(new Error(`Provider logout is not controlled by AIDE for ${provider}.`), { code: "PROVIDER_AUTH_UNSUPPORTED" });
    }
    return this.adapters.codex.logout();
  }

  closeProviderAuth() {
    this.adapters.codex?.closeProviderFlows?.();
  }

  start({ harness = "dsh", task, cwd, sessionId = undefined, context = undefined, outputSchema = undefined, model = undefined, reasoningEffort = undefined } = {}) {
    const adapter = this.adapters[harness];
    if (!adapter) throw Object.assign(new Error(`Unsupported harness: ${harness}`), { code: "HARNESS_UNSUPPORTED" });
    const runId = `run-${randomUUID()}`;
    const run = { runId, harness, state: "starting", pid: null, processGroupId: null, processTreeRootPid: null, sessionId: sessionId ?? null, result: null, events: [], droppedEvents: 0, nextSeq: 1, handle: null };
    this.runs.set(runId, run);

    const onEvent = (event) => {
      if (event.type === "session" && typeof event.sessionId === "string") run.sessionId = event.sessionId;
      run.events.push({ seq: run.nextSeq++, event });
      if (run.events.length > MAX_BUFFERED_EVENTS) { run.events.shift(); run.droppedEvents += 1; }
    };

    try {
      run.handle = adapter.start({ task, cwd, sessionId, context, outputSchema, model, reasoningEffort, onEvent });
      run.pid = run.handle.pid;
      run.processGroupId = run.handle.process_group_id ?? null;
      run.processTreeRootPid = run.handle.process_tree_root_pid ?? null;
      run.state = "running";
      void run.handle.done.then((result) => {
        run.result = result;
        run.sessionId = result.session_id ?? run.sessionId;
        run.state = result.status;
      });
      return this.status(runId);
    } catch (error) {
      run.state = "failed";
      run.result = { status: "failed", error_code: error?.code ?? "HARNESS_START_FAILED", error_message: error?.message ?? "Harness failed to start." };
      return this.status(runId);
    }
  }

  continue({ sessionId, task, cwd, harness = "dsh", context = undefined, outputSchema = undefined, model = undefined, reasoningEffort = undefined } = {}) {
    if (typeof sessionId !== "string" || sessionId.length === 0) throw new TypeError("sessionId is required to continue a harness session.");
    return this.start({ harness, task, cwd, sessionId, context, outputSchema, model, reasoningEffort });
  }

  status(runId) {
    const run = this.#get(runId);
    return { run_id: run.runId, harness: run.harness, state: run.state, pid: run.pid, process_group_id: run.processGroupId, process_tree_root_pid: run.processTreeRootPid, session_id: run.sessionId, terminal: TERMINAL.has(run.state) };
  }

  events(runId, { after = 0 } = {}) {
    const run = this.#get(runId);
    const oldestSeq = run.events[0]?.seq ?? run.nextSeq;
    return {
      run_id: run.runId,
      dropped: run.droppedEvents,
      oldest_seq: oldestSeq,
      latest_seq: run.nextSeq - 1,
      gap: after < oldestSeq - 1,
      events: run.events.filter(({ seq }) => seq > after),
    };
  }

  result(runId) {
    const run = this.#get(runId);
    return TERMINAL.has(run.state) ? { ready: true, run_id: run.runId, harness: run.harness, ...run.result } : { ready: false, ...this.status(runId) };
  }

  cancel(runId) {
    const run = this.#get(runId);
    if (TERMINAL.has(run.state)) return this.status(runId);
    const accepted = run.handle?.cancel() === true;
    if (accepted) run.state = "cancelling";
    return this.status(runId);
  }

  async steer(runId, input) {
    if (typeof input !== "string" || input.trim().length === 0) throw new TypeError("steer input must be a non-empty string.");
    const run = this.#get(runId);
    if (run.state !== "running") throw Object.assign(new Error("Harness run is not steerable in its current state."), { code: "HARNESS_RUN_NOT_RUNNING" });
    if (typeof run.handle?.steer !== "function") throw Object.assign(new Error("Harness does not support same-turn steering."), { code: "HARNESS_CAPABILITY_UNSUPPORTED" });
    return { run_id: run.runId, accepted: (await run.handle.steer(input)) !== false };
  }

  async respond(runId, { nativeRequestRef, response } = {}) {
    const run = this.#get(runId);
    if (run.state !== "running") throw Object.assign(new Error("Harness run is not accepting interaction responses."), { code: "HARNESS_RUN_NOT_RUNNING" });
    if (typeof run.handle?.respond !== "function") throw Object.assign(new Error("Harness does not support interaction responses."), { code: "HARNESS_CAPABILITY_UNSUPPORTED" });
    return { run_id: run.runId, accepted: (await run.handle.respond({ nativeRequestRef, response })) !== false };
  }

  #get(runId) {
    const run = this.runs.get(runId);
    if (!run) throw Object.assign(new Error(`Unknown harness run: ${runId}`), { code: "HARNESS_RUN_NOT_FOUND" });
    return run;
  }
}
