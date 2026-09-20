# AIDE

AIDE is a multi-Harness engineering orchestration system for one developer coordinating multiple native agents.

Its target architecture follows three complementary responsibilities rather than one central component:

- **Tutti** — WHAT: Goal, Current Truth, Task Graph, Decisions, shared context and semantic verification.
- **Broker** — WHO: resource/capability intelligence, health/quota/cost/history and explainable candidate recommendation.
- **HarnessRouter** — RUN: Native Harness process/session/protocol lifecycle.

Native Harnesses such as Claude Code and Codex keep their own agent loops, context, tools, compaction and subagent behavior. Workspace/Evidence provides the physical truth through Git/worktrees, diffs, tests, logs and artifacts.

The Current Windows Broker implementation is an important source of proven mechanisms, but it is not the skeleton of AIDE. Useful Broker patterns are extracted and placed into the target responsibility where they belong.

## Current checkpoint

The current local execution baseline is working across multiple configured targets:

```text
Task requirements
-> Broker hard gate + strategy ranking
-> Tutti assignment
-> DSH Headless / DSH ACP / Codex configured target
-> Workspace/Evidence
-> Tutti acceptance / safe handoff / closure
```

Local contracts are covered by `npm test`. Real model smoke runs are deliberately gated behind `AIDE_ALLOW_MODEL_CALL=1`; do not enable that flag without explicit authorization because it consumes model resources. Current crossfire is `Sol/medium -> Sol/high -> Sol/ultra`; the corrected role-separation + native Plan hydration path has now passed a real semantic smoke with substantive distinct planner outputs and explicit executor arbitration.

Current routing telemetry is provider-neutral and observational: each new Attempt can persist Broker candidates/rejections, the frozen actual target/model/effort, optional fail-open shadow advice, sanitized native Codex rate-limit facts, terminal verification, and the latest native thread token-usage snapshot. These facts do not yet enable automatic `adaptive` routing or claim exact per-Attempt monetary cost.

Codex runtime telemetry also separates requested model provenance from effective runtime model after native `model/rerouted`, and persists native context-compaction observations. These remain evidence for later calibration; AIDE does not countermand native safety reroutes or infer an exact context percentage from a compaction event.

HarnessRouter can also pass an optional native JSON `outputSchema` to Codex turns. The primitive is available for future typed decomposition/planning, but Current Tutti does not add an implicit planning call to normal submissions.

Structured semantic decomposition is available only by explicit capability intent (`decompose=true`, internally `semantic_decomposition=plan`). One read-only structured planner writes a durable Task Decision and ordered steps, then one executor consumes that decision. Economy never gets the extra planner implicitly, and decomposition cannot currently be combined with dual-plan crossfire or expanded into autonomous per-step WorkPackages.

Task `constraints` are also explicit first-class semantic state. They are shared with planners/executors through Context Capsules and survive handoff/decomposition, but remain separate from Broker-facing WorkPackage requirements and from final acceptance criteria.

Tasks may also request explicit semantic acceptance. HTTP/MCP expose top-level `semantic_acceptance: string[]` and map it to durable `acceptance.semantic`; lower-level callers may still use `acceptance.semantic` directly. Mechanical evidence must pass first; the service wires a read-only `codex-review` semantic verifier by default, and it runs only when semantic criteria are explicitly present. The verifier can only judge the supplied criteria verbatim. Missing/invalid/rejecting semantic review fails closed, and isolated candidate work is not landed before semantic acceptance passes.

Task continuity is now shared without transcript synchronization: Execution Capsules include bounded prior WorkPackage/Attempt outcome and evidence-reference summaries, while native Codex context tools can request accepted `current_truth` or bounded `evidence(taskId)` on demand. Crossfire planning text remains isolated between planners.

`current_truth` retrieval also resolves the durable Task/Attempt references into bounded provenance: Goal, constraints, semantic Decision, accepted verification/reviewer evidence refs, and requested/effective model. Evidence-file bodies are not duplicated into the truth layer.

## Repository location

```text
/home/z/codex-workspace/AIDE
```

`ServerWorker` is only the development/remote-control tool used to access this Linux host. It is not an AIDE runtime component.

## Broker Current Source

```text
C:\Users\Administrator\Desktop\CodeX Workspace\Personal\Broker
```

Broker source inspection uses `@DevSpaceV1` unless this project rule is explicitly changed.

See:

- `docs/CURRENT_TRUTH.md` — what is implemented/verified now versus still Target/Unknown.
- `docs/CURRENT_ARCHITECTURE.md` — concise Current runtime graph, durable state, routing/resource telemetry, and prioritized remaining gaps.
- `docs/ARCHITECTURE.md` — synthesis of Tutti + Broker + HarnessRouter based on the original architecture guide.
- `docs/PROJECT_RESPONSIBILITIES.md` — what each AIDE module, local project, Native Harness, and open-source reference is responsible for.
- `docs/BOUNDARY_CONTRACTS.md` — context, session, workspace, cancellation, retry, permission, evidence, and handoff boundaries.
- `docs/EXECUTION_STRATEGY.md` — minimal vertical-slice development policy and current implementation order.
- `docs/COMPONENT_REUSE_MATRIX.md` — useful mechanisms extracted from the three responsibilities and where they belong in AIDE.
- `docs/JEV_REFERENCE_EVALUATION.md` — audited JEV Router / Review / Desktop ideas, what AIDE should reuse, and what should remain external/reference-only.

Current local checks:

```bash
npm test
npm run smoke:intake   # real local routing probe: DSH + ACP + economy + capability + Plan; no model call
```
- Memhub project `aide` — authoritative architecture and Current Truth source for ongoing AIDE work. Legacy repo-local Normify material is reference-only.

## Run the local AIDE service

The composition root serves the JSON HTTP/Plugin API and modern MCP `2026-07-28` from one backend runtime:

```bash
AIDE_PROJECT_ROOT=/path/to/project \
AIDE_EXECUTION_STRATEGY=economy \
npm run service
```

From the AIDE repository itself, both Ubuntu and Windows can use the same default entrypoint with no shell-specific environment syntax:

```bash
npm run service
```

Ubuntu remains the primary development host. The Current Codex-backed V1 runtime/control/UI path is validated on both Ubuntu and Windows using the same Node/Tutti/Broker/Control/UI code; only launcher, state-root, and process-tree mechanics differ below the runtime boundary. Before calling a future runtime/UI change cross-platform Current, run on each supported host:

```bash
npm test
npm run smoke:platform
```

`smoke:platform` is non-generative. It does not send a model Task. Windows Codex npm shims are launched through `cmd.exe`; PowerShell execution policy is therefore not part of AIDE's runtime contract.

Defaults:

- HTTP: `127.0.0.1:8711`;
- Management UI: `http://127.0.0.1:8711/`;
- MCP: `/mcp` on the same server;
- Work State + service lease: Ubuntu `~/.local/state/aide/<project-hash>/`; Windows `%LOCALAPPDATA%\AIDE\state\<project-hash>\`;
- execution strategy: `economy` unless overridden;
- optional overrides: `AIDE_CONTROL_HOST`, `AIDE_CONTROL_PORT`, `AIDE_CONTROL_TOKEN`, `AIDE_STATE_DIR`, `AIDE_STATE_PATH`, `AIDE_SERVICE_LEASE`, `AIDE_SHADOW_MIN_SAMPLES`.

Execution strategy is explicit and does not depend on alphabetical model names:

- `economy` defaults to the verified `codex-economy` profile (`gpt-5.6-luna`, low reasoning) and is the service default;
- `capability` defaults to `codex-capability` (`gpt-5.6-sol`, ultra reasoning). The current native catalog declares proactive multi-agent support for this profile;
- the two configured profiles are not automatic fallbacks for one another. If a requested profile is unavailable, AIDE blocks unless another explicit routing preference resolves the choice;
- per-task HTTP/MCP submission may set `strategy: "economy" | "capability"`, overriding the service default;
- `crossfire: true` is an explicit capability-mode opt-in. Tutti runs two independent read-only Plan targets, then passes both durable plan outputs to one capability executor for arbitration/execution. Crossfire is never enabled implicitly in economy mode;
- exact configured models can be overridden with `AIDE_ECONOMY_CODEX_MODEL`, `AIDE_ECONOMY_CODEX_EFFORT`, `AIDE_CAPABILITY_CODEX_MODEL`, `AIDE_CAPABILITY_CODEX_EFFORT`, `AIDE_PLAN_CODEX_MODEL`, `AIDE_PLAN_CODEX_EFFORT`, `AIDE_PLAN_ALT_CODEX_MODEL`, and `AIDE_PLAN_ALT_CODEX_EFFORT`.

These are routing profiles, not price claims. AIDE verifies the configured models/efforts against the live Codex `model/list` catalog but does not currently ingest a billing-price table.

Non-loopback HTTP binding requires a bearer token. The service prints its owner id, address, state path, and Tasks that require recovery after restart. An enqueued Task keeps running after its transport request returns.

The local management UI is the primary human entry. The Current UI provides an Overview control-center snapshot plus durable Conversations, Task timeline/inspection, next-send strategy/target/model/reasoning-effort/orchestration-mode selection, cancel/steer/recovery/interaction controls, Harness/mode inspection, routing history, and service settings. It remains dependency-light vanilla HTML/CSS/JS served by the same AIDE process, but is now responsive instead of relying on a fixed desktop minimum width. Conversation defaults apply only to future Tasks; they never mutate an in-flight frozen Assignment.

Before creating durable work, clients can call `POST /v1/preflight` or MCP `aide_preflight`. Preflight uses the same Tutti/Broker request, routing, exact-model, and workspace-isolation gates as submission, but creates no Task/WorkPackage/Attempt, allocates no worktree, and starts no Native Harness. This is the preferred first step for AIDE self-development and other high-impact automation.

`Models & Accounts` now uses the Codex app-server's native account/model APIs. It can read sanitized account status, list the live exact model directory and each model's supported reasoning efforts, start ChatGPT browser login or device-code login, accept an API key as a write-only value, cancel an in-flight login, and request native logout. API keys are never returned by AIDE and are not copied into Work State, Current Truth, or model prompts. DSH remains explicitly `Native-managed`: the installed DSH Web product has useful authorization/settings/credential semantics, but the currently verified AIDE DSH adapters do not expose a stable provider-auth/configuration protocol and AIDE does not import DSH's internal Cordis services as runtime dependencies.

For **Direct** execution, the composer may also select an exact Codex model and one reasoning effort advertised for that model, but only after choosing one concrete Codex target/profile. Broker validates the requested pair against that target's live model directory and keeps all target capability, sandbox, and approval gates in force; Tutti freezes the resulting model/effort in the Assignment. Explicit model overrides are intentionally rejected for Decompose/Crossfire in the Current slice because those workflows have separate planner/executor/reviewer profiles.

For retry-safe submission, send an explicit request id:

- HTTP: `Idempotency-Key: <opaque-client-request-id>` on `POST /v1/tasks`;
- MCP: `client_request_id` in `aide_submit` arguments.

The same id returns the same durable Task after reconnect/restart. Reusing it with different task semantics is rejected.

Routing/outcome history is exposed as a read-only observational surface for offline analysis:

- HTTP: `GET /v1/routing-history?limit=100`;
- MCP: `aide_routing_history { limit }`.

This history never changes current assignment policy. It reports bounded terminal routing facts, outcomes, native usage scope, and wall-clock Attempt duration, and intentionally omits raw Task objective text.

For deterministic offline calibration without starting a Harness or calling a model:

```bash
npm run replay:routing
```

The local service also wires an observe-only historical shadow advisor. By default it requires at least 10 comparable samples for the actual target and one alternative (`AIDE_SHADOW_MIN_SAMPLES=10`). Sparse history is recorded as `insufficient_history`; it does not invent confidence or choose an alternate target. Even when history is sufficient, shadow advice is telemetry only and cannot change the actual assignment.

Detached active Attempts are never silently resumed. Use `/v1/recoveries` / `aide_recoveries` to inspect them, then explicitly recover with `abandon`, `reroute`, or `finalize`. `finalize` is only for an Attempt with a durable terminal-result/finalization checkpoint after native quiescence; it resumes verification/closure without re-executing the native task. AIDE uses the persisted Attempt side-effect classification; callers no longer supply `side_effects`. Current POSIX Native Harness launches persist an owned process-group id; same-host recovery fences on the whole group when available and falls back to the primary PID only for older/non-group Attempts. Otherwise pass `quiescent=true` only after independently confirming the old native process is stopped. `reroute` is permitted only for persisted `none`, or contained `workspace_only` effects in an unlanded isolated workspace.

Windows uses the same recovery contract with different OS mechanics: Native Harness launches persist a `process_tree_root_pid`, cancellation requests `taskkill /T /F`, and detached recovery queries the Windows process tree through CIM before accepting quiescence. Legacy Windows Attempts that only persisted a parent PID fail closed instead of assuming that descendants exited with the parent.

For a non-generative host/runtime check:

```bash
npm run smoke:platform
```

This verifies the host state-root convention, ServiceLease primitives, Git worktree allocation/landing, and a read-only Codex app-server catalog. On Windows it additionally verifies process-tree fencing. It does not send a model Task.

Approval UI/clients must not assume one universal decision set. Read the Task status fields in this order: the frozen assignment `approval_contract`, the Attempt `native_approval_state`, then each pending interaction's `native_contract`. Different Harness profiles may expose different policies and response shapes even when they use the same underlying model. The current DSH Headless target is non-interactive/fail-closed; Codex app-server exposes native approval requests and request-specific response contracts.

## Current implementation

Current execution adapters include:

```text
src/execution/dsh-headless-adapter.js
src/execution/dsh-acp-adapter.js
src/execution/codex-app-server-adapter.js
src/execution/harness-router.js
```

Real-model smoke scripts remain authorization-gated:

```bash
npm run smoke:codex-context  # model-selected aide_context tool use
npm run smoke:codex-plan     # Plan-mode request_user_input/resume
npm run smoke:codex-decomposition # real-proven: structured Plan outputSchema -> durable step postconditions -> Sol capability executor -> read-only reviewer
npm run smoke:codex-semantic-review # real-proven: one read-only Sol structured review over fixed criteria/evidence
npm run smoke:codex-reattach # regression: app-server loss interrupts active turn; live reattach is unsupported
npm run smoke:crossfire      # two independent planners + capability executor
```

Each refuses to run unless `AIDE_ALLOW_MODEL_CALL=1` is explicitly set after authorization.
