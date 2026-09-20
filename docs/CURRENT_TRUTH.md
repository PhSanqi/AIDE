# AIDE Current Truth

Last established: 2026-09-18.

Architecture governance updated: 2026-09-18.

Memhub project `aide` is the authoritative architecture and Current Truth source. The previous Normify architecture state has been migrated to Memhub; repo-local `normify-aide/` material is legacy/reference-only and is not part of the ongoing architecture-update workflow.

`docs/CURRENT_ARCHITECTURE.md` is the concise Current runtime graph and prioritized gap list. `docs/ARCHITECTURE.md` remains the Target/reference synthesis and must not be read as a statement that every listed target mechanism is already Current.

## 1. Target

The target remains the original multi-Harness architecture:

```text
WHAT  -> Tutti
WHO   -> Broker recommends, Tutti decides
RUN   -> HarnessRouter
HOW   -> Native Harness
PROVE -> Workspace / Evidence
```

AIDE will combine useful mechanisms from all three responsibilities rather than choosing one component as the system skeleton.

## 2. Current implementation progress

### AIDE repository

Current root:

```text
/home/z/codex-workspace/AIDE
```

Status: **first executable vertical slice proven; durable Task -> Current Truth closure implemented locally**.

- Git repository initialized.
- Architecture/current-truth documentation exists.
- Minimal AIDE runtime code now exists for the first vertical slice.
- Tutti deterministic acceptance and accepted-Attempt Task closure now exist. Accepted facts are persisted as Current Truth updates with Attempt provenance; broader Decision/Task Graph semantics are not implemented yet.
- Broker V0 hard-gate/recommendation exists and consumes live HarnessRouter probe facts. AIDE does not yet have a learned/score database or history-based ranking policy, but new Attempts now durably persist routing traces containing Broker candidates/rejections, actual frozen assignment, optional shadow advice, sanitized resource facts, and terminal outcome evidence.
- HarnessRouter has three concrete adapter implementations (DSH Headless, DSH ACP v1 stdio, Codex app-server) and eight Current configured targets: `dsh`, `dsh-acp`, `codex`, `codex-economy`, `codex-capability`, `codex-plan`, `codex-plan-alt`, and `codex-review`.
- The DSH Headless adapter supports non-generative probe, start, NDJSON event capture, persisted session continuation, result normalization, and cancel. Large `final` JSON events are no longer rejected by an artificial 64 KiB line cap.
- The separate DSH ACP adapter uses the shipped automation-only ACP v1 stdio profile. It maps native session new/resume/prompt/cancel/close, permission requests/responses, generic tool lifecycle updates, and result normalization without copying the DSH Agent Loop or adding ACP UI/filesystem/terminal extensions.
- The Codex adapter now supports non-generative probe, native `initialize/initialized`, `thread/start|resume`, `turn/start`, `turn/steer`, `turn/interrupt`, normalized approval/user-input server requests, native interaction responses, final turn normalization, and opaque thread-id continuation. The default Codex target does **not** advertise `user_input_requests`: one authorized real turn proved `request_user_input` is unavailable in Codex Default collaboration mode.
- Workspace/Evidence now includes bounded regular-file evidence plus isolated Git worktree allocation/landing for clean repositories with a valid HEAD. Landing applies the isolated binary diff to the unchanged project HEAD, verifies the landed diff, then Tutti re-collects project evidence before Task closure.
- Shared Core now persists `Task`, `WorkPackage`, `Attempt`, and Current Truth updates in a versioned JSON state file using atomic file replacement. Assignment is frozen at Attempt creation, and one non-terminal Attempt per normalized workspace is enforced.
- AIDE-created successor WorkPackages now persist a minimal `lineage` edge instead of relying on array/time ordering: `handoff`, `plan_consensus_planner`, or `plan_consensus_execution` plus the terminal `from_attempt_id`. Initial submissions record `submission`. The store rejects cross-Task lineage and lineage from a non-terminal Attempt. This is the Current Task-graph baseline; no separate graph service/entity has been introduced;
- HarnessRouter live run/event buffers remain in-memory only; the durable Work State records the resulting Attempt outcome/session/evidence after completion.
- No Web/CLI implementation exists yet.

### Broker Current source

Current source:

```text
C:\Users\Administrator\Desktop\CodeX Workspace\Personal\Broker
```

Access: `@DevSpaceV1`.

Status: **mature reference implementation with reusable mechanisms**, not the AIDE skeleton.

Verified useful Current Broker mechanisms include:

- durable Project / GlobalTask / WorkPackage / Attempt state;
- local scheduling;
- workspace isolation;
- one-writer leases;
- executor assignment bookkeeping;
- cancellation/restart recovery;
- deterministic validation;
- safe artifact/evidence/audit patterns;
- provider/runtime health plumbing;
- semantic authority separated from permission/execution authority.

Its bounded `DeepSeekExecutor` / `CodexSubagentExecutor` execution model is not the target Native Harness contract because it owns typed worker/tool rounds. AIDE intends to preserve Native Harness loops/tools/sessions instead.

### Tutti

Status in AIDE: **deterministic acceptance + semantic Task closure + Main Intake V0 + Local Context Fabric V0 implemented**.

Target responsibilities already defined by the architecture guide:

- Goal;
- Current Truth;
- Task Graph;
- Decisions/constraints;
- Context Capsules;
- semantic handoff/review/verification.

Current implemented Tutti surface:

- explicit acceptance criteria;
- harness completion check;
- expected final-text check;
- expected workspace-file existence/content check;
- accepted/rejected result with per-check evidence.
- accepted Attempt -> atomic WorkPackage/Task completion + Current Truth update.

Memhub represents Tutti as the WHAT-owner container with:

- `aide.tutti.workstate` — active;
- `aide.tutti.intake` — active V0: creates Task/WorkPackage, builds Routing Context, asks Broker, selects an assignment, builds target-aware Execution Context, and can run the full local execution/verification/closure path;
- `aide.tutti.context` — active V0: bounded local file index + `search/symbol/references/read` + separate Routing/Execution Capsules + target context-budget metadata + WorkspaceRef-scoped execution retrieval.

Main Intake V0 can execute through `submitAndRun()`. The normal path derives a persisted direct `WorkspaceRef`. A WorkPackage may now request `workspace_isolation=attempt`; Workspace then allocates a detached Git worktree and landing is mandatory before Current Truth/Task closure. The current AIDE repository now has an ordinary baseline Git HEAD (`baseline: AIDE V1 architecture and dual-platform runtime`), so isolated execution is no longer gated by the absence of a base commit; normal dirty-tree/review rules still apply.

Local Context Fabric V0 is deliberately lightweight. It uses Node standard-library filesystem scanning with file-count/size bounds and heuristic symbol extraction. Routing remains project-scoped; after WorkspaceRef allocation, execution context is re-materialized from the actual Attempt workspace. It does not yet provide dependency-graph traversal, semantic/vector retrieval, incremental language-server indexing, or a Native Harness tool/MCP surface.

### HarnessRouter

Status in AIDE: **DSH Headless baseline implemented and real-run verified; DSH ACP configured target implemented with real non-generative protocol verification; Codex app-server adapter implemented with real non-generative protocol verification**.

Target responsibilities already defined:

- start/continue/cancel/status/result;
- process/session lifecycle;
- protocol transport;
- timeout/reconnect/exit normalization;
- capability observation;
- preservation of native Harness behavior.

Current implementation files:

```text
src/execution/dsh-headless-adapter.js
src/execution/dsh-acp-adapter.js
src/execution/codex-app-server-adapter.js
src/execution/harness-router.js
```

The real DSH session-continuation path has not yet been exercised with a second paid task; its launcher contract and adapter plumbing are locally verified.

HarnessRouter now also exposes capability-gated `steer()` and `respond()` transport hooks. The current DSH Headless adapter intentionally does not implement either hook.

The DSH ACP target advertises native `interaction_response` only for ACP `session/request_permission`; it does not advertise `same_turn_steer` or user-input elicitation. Its current DSH implementation exposes only one-shot `allow-once` / `reject-once` choices, so the target truthfully declares `session_grants=false`.

The Codex app-server adapter advertises `same_turn_steer` and `interaction_response` because those map directly to native `turn/steer` and server-request response envelopes. It does not emulate either behavior with cancel/restart. Configured model/effort/collaboration profiles are verified non-generatively against native `model/list` and `collaborationMode/list` before they are reported available.

### Broker V0

Status in AIDE: **minimal hard-gate/recommendation implemented**.

- consumes live HarnessRouter probe facts;
- rejects unavailable Harnesses;
- rejects Harnesses missing required capabilities;
- rejects targets with unknown/insufficient context capacity when the WorkPackage declares a minimum context-window requirement;
- rejects targets with unknown/insufficient output capacity when the WorkPackage declares required output tokens;
- hard-gates provider-neutral `requirements.approval` predicates against each configured target's `approval_contract`: interactive channel, response channel, unattended fail-closed behavior, session-grant policy, and auto-review policy;
- treats approval facts as unknown unless the target contract explicitly declares them; a requirement that depends on an unknown fact is rejected rather than guessed;
- preserves advertised model/context-window/max-output facts on qualified candidates;
- returns explainable qualified candidates;
- supports explicit `execution_strategy=economy|capability` ordering only from frozen target `strategy_priority` facts; Tutti still owns final assignment and explicit `preferred_targets` still override strategy;
- distinguishes `target_role=execution|planning` so read-only planner profiles are not ordinary executors;
- can hard-gate a normalized `sandbox_mode` requirement, used by planning consensus to require `read-only`;
- performs no ML, historical scoring, live price inference, semantic model ranking, quota database, or hidden weighting.

### Shared Core Work State

Status in AIDE: **Task/WorkPackage/Attempt/Current Truth closure implemented and restart-read verified**.

Current implementation file:

```text
src/core/work-state-store.js
```

Implemented now:

- versioned local state file, current schema v5;
- `Task` with objective and acceptance payload;
- `WorkPackage` linked to one Task with capability requirements;
- `Attempt` linked to one WorkPackage with frozen assignment and workspace;
- first-class `WorkspaceRef` with `direct|isolated` mode plus explicit landing requirement/status;
- durable `PendingInteraction` for `user_input|permission|authentication` requests, including pending/resolved/cancelled/orphaned lifecycle;
- Attempt `created -> running -> cancelling -> completed|failed|cancelled` lifecycle used by the current execution path;
- normalized-workspace single-writer guard for non-terminal Attempts;
- restart/reopen readback of persisted records;
- durable migration of older Work State through v5; v5 adds durable monotonic `approval_validation` to each Attempt so runtime approval drift cannot disappear after restart or a later event;
- serialized in-process mutations and atomic same-directory file replacement.
- atomic closure transaction that appends accepted Current Truth facts with provenance to the producing Attempt and completes the WorkPackage/Task together.

Not implemented in Shared Core yet:

- `Project` as a first-class persisted entity;
- Decision records / Task Graph dependencies;
- first-class EvidenceRef records;
- cross-process locking/recovery of an interrupted running Attempt.

## 3. Verified Linux development environment

- Git `2.53.0` available.
- Node.js `v22.23.2` available.
- npm `10.9.8` available.
- `python3` was not found in PATH in the latest probe.
- DSH is installed at `/home/z/.local/bin/dsh`, version `0.1.6-alpha.1`.
- DSH `0.1.6-alpha.1` has verified `headless`, shipped `acp`, and `web` surfaces on this host. `headless` supports one-shot prompt execution, stdin input, `--json` run events, and `--session-id` continuation. The shipped `acp` profile serves ACP v1 over JSON-RPC stdio; the local `tui` profile is not installed and must not be assumed available from launcher examples alone.
- There is no standalone `codex` command in PATH.
- The installed OpenAI desktop application is the Debian package `chatgpt` (`26.908.40834`). `/usr/bin/chatgpt` launches the desktop application through `/usr/lib/chatgpt/codex-launcher`.
- The desktop package bundles `/usr/lib/chatgpt/resources/codex`, which reports `codex-cli 0.154.0-alpha.6.2`. Treat this as a **desktop-bundled runtime**, not as evidence that a separately installed Codex CLI is present.
- The bundled Codex runtime exposes `app-server` with `stdio://`, Unix-socket, and WebSocket transports. This gives HarnessRouter a native protocol integration path that does not require GUI automation.
- `claude` was not found in PATH in the latest probe.

Therefore Native Harness execution on this Linux host is no longer Unknown:

- DSH is a directly executable Current Harness candidate.
- Codex Desktop is a Current Harness candidate whose bundled runtime can be investigated through `app-server` without treating the desktop GUI as a CLI.
- Claude Code remains unavailable/unverified on this host.

### Windows parity status

- Windows is now a first-class AIDE runtime target and the **Codex-backed V1 path is parity-Current with Ubuntu** for Shared Core, Tutti/Broker, Control/HTTP, HarnessRouter Codex execution mechanics, Workspace/Evidence, ServiceLease, and the Current management UI. Ubuntu remains the primary development host; this does not imply that every optional Harness is Current on Windows.
- A temporary same-source Windows verification tree was built from the public baseline plus the current uncommitted development changes. Before final validation, the 44 core files under `src + scripts + test + web + package.json` (excluding publish-only `scripts/build-release.mjs`) were normalized for line endings/path separators and produced the same aggregate SHA256 on Ubuntu and Windows: `a27705204de21e9e1dd056125433d4af9f0a40dbf5e63cc0c486ab43b946783d`. The temporary Windows tree was emptied after validation rather than becoming a divergent second source tree.
- Latest non-generative Windows environment probe: Node `v24.19.0`, Git `2.31.1.windows.1`, and `codex-cli 0.152.0` are available; Codex is installed on PATH through the user's npm bin and its `app-server` command exposes the expected stdio/daemon/schema-generation surface. DSH is not currently installed/on PATH on that Windows host.
- Shared Node layers are largely platform-neutral by construction: Work State, Tutti/Broker semantics, Control/HTTP/MCP, Web UI, Context Fabric, and Git command construction do not intentionally encode Linux path separators.
- Cross-platform runtime mechanics are now implemented in one small `src/platform/runtime.js` boundary. Ubuntu keeps the verified desktop-bundled Codex default; Windows defaults to `codex.cmd` and wraps `.cmd/.bat` launchers with `cmd.exe /d /s /c` so Node never depends on PowerShell execution policy or `shell:true`. The same launcher seam is prepared for `dsh.cmd` without claiming DSH availability.
- Real Windows read-only Codex app-server proof now passes through that native command surface: initialize succeeds, the current account reports connected ChatGPT auth, `model/list` returns four models with default `gpt-5.6-sol`, and `collaborationMode/list` reports `plan` and `default`. No model Task was sent and no account mutation was performed.
- Windows process-tree recovery now has a V1 native mechanism. Real OS proof showed a child remains discoverable by `Win32_Process.ParentProcessId` after its launcher parent exits, and `taskkill /PID <root> /T /F` clears a live tree. AIDE persists `process_tree_root_pid` on Windows Native Harness runs, uses CIM for same-host detached quiescence, and refuses recovery for legacy Windows runtime facts that have only a parent PID. POSIX process-group behavior is unchanged.
- ServiceLease's Windows-native primitives were non-generatively proven: exclusive `mkdir`/`EEXIST`, temporary-file rename, directory `utimes`, metadata readback, and `process.kill(pid, 0)` all behave as required on the current NTFS/Node host.
- Windows state-root behavior is implemented and proven as `%LOCALAPPDATA%\AIDE\state\<project-hash>\`; explicit `AIDE_STATE_*` overrides remain unchanged.
- Cross-platform validation exposed one real state-path defect: `defaultStateBase({ platform })` previously used the host OS `path.join()` even when explicitly calculating the other platform's path. `src/platform/runtime.js` now selects `path.posix` or `path.win32` from the requested platform, so both target-path calculations are deterministic on either host. The existing platform-runtime test catches the Windows manifestation and now passes on both systems.
- GitWorkspaceManager's actual Git mechanism was non-generatively proven on Windows: init/HEAD, detached worktree allocation, binary diff, `git apply --check`, landing, and cleanup succeeded. The shared implementation remains path-API/execFile based rather than shell-specific.
- DSH Headless/ACP Windows launcher handling is deterministically covered (`dsh.cmd -> cmd.exe` plus process-tree root), but DSH itself is not installed on the current Windows host, so native DSH Windows runtime/cancellation/continuation remain Unknown.
- The previous complete same-source dual-platform baseline remains Ubuntu `npm test` **185/185 PASS** and Windows `npm test` **185/185 PASS**, with `smoke:platform` and `smoke:intake` PASS on both. The current self-hosting increment raises the Ubuntu suite to **189/189 PASS**. Its Windows delta has now been revalidated on the group's canonical Windows development endpoint `@Group`: the synchronized current runtime tree (`src + scripts + web + package.json`, 29 files) produced the same normalized aggregate SHA256 on Ubuntu and Windows, `fbe3ee15536d1ab4155a8d0366d818e3f31aee0f8e63a96bbcfad299030ac404`; focused HarnessRouter/Control/preflight validation passed 26/26, and both `smoke:platform` and `smoke:intake` passed on Windows.
- Real Windows Chrome HTTP validation was executed against the Windows local AIDE service, not a `file://` approximation. At 1440x1000, the current Conversation layout measured Sidebar 264px, Conversation 821px, Inspector 340px with no horizontal overflow (`scrollWidth=1425 <= viewport 1440`). At an emulated 390x844 viewport, Sidebar/Main/Conversation/Inspector all measured 390px wide, Inspector began exactly at the Conversation bottom, and `scrollWidth=390`; Overview loaded four metric cards and switched from four columns (`274px` each) to one column (`358px`). The page reported `Healthy` in both viewports.
- That browser proof also exposed a shared navigation bug: the generic `switchView("conversations")` convention expects `conversationsView`, while the HTML used `conversationView`. The DOM id is now aligned to `conversationsView` and the HTTP/static test locks the convention. This was a shared UI fix, not a Windows-only branch.
- Report current platform status as `Ubuntu Current / Windows Current (Codex-backed V1); DSH Windows Unknown`.

### AIDE self-development preflight and upstream adoption

- AIDE now exposes one dry-run contract at `TuttiIntake.preflight`, `AideControl.preflight`, `AideServiceRuntime.preflight`, HTTP `POST /v1/preflight`, and MCP `aide_preflight`. It reuses the exact submission validation and Broker assignment gates but does **not** create durable Work State, allocate an isolated worktree, call a model, or start a Native Harness. This is a Tutti/Control capability, not a second planner.
- First real self-hosting preflight has been executed against the AIDE repository for the objective of reviewing latest HarnessRouter/Tutti changes while preserving Ubuntu/Windows parity. It selected `codex-capability`, direct workspace `/home/z/codex-workspace/AIDE`, returned `durable_state_created=false` and `native_run_started=false`, and `/v1/tasks` remained empty. No model quota was consumed.
- Latest HarnessRouter upstream review identified one immediately applicable lifecycle rule: continuation belongs to the Harness that created the native session. AIDE HarnessRouter now records `session_id -> configured target` from native session/result facts, inherits that target for continuation, and rejects an explicit cross-target continuation with `HARNESS_SESSION_HARNESS_MISMATCH`. Production Tutti currently does not invoke `router.continue`, so this closes a boundary before it becomes a live recovery/continuation bug rather than changing current workflow behavior.
- HarnessRouter's new native `incomplete` result is **not** copied into AIDE Work State yet. Current Codex/DSH adapters do not emit it, while actionable human blocking is already represented by `waiting_input` / `waiting_permission`. Add a durable `incomplete` state only when a real AIDE Native Harness emits an evidence-backed incomplete result and Tutti can distinguish it from a Pending Interaction or failure.
- Latest Tutti upstream dry-run semantics were adopted as the AIDE preflight contract. Tutti's artifact-after-idle polling lesson is recorded but not copied into Tutti: AIDE Workspace/Evidence currently collects synchronously after native terminal observation. If real AIDE evidence shows that terminal observation can precede final filesystem flush, bounded polling belongs in Workspace/Evidence. Tutti's operator-console work is also not duplicated because the Current AIDE Overview already presents read-only Control facts without owning policy.
- The Windows revalidation exposed one Native Harness timing defect rather than an orchestration defect: Codex app-server catalog discovery used a fixed 3-second deadline. On `@Group`, the Codex CLI and `app-server --help` were immediately available, but native catalog initialization exceeded 3 seconds and failed with `CODEX_CATALOG_PROBE_TIMEOUT`. Raising the shared catalog probe deadline to 10 seconds made the same Windows `smoke:platform` pass while preserving the Ubuntu path. This remains one shared adapter behavior; no Windows-only branch or PowerShell execution-policy workaround was added.

## 4. Current implementation checkpoint

Local verification:

- previous full same-source dual-platform baseline: `npm test` 185/185 PASS on Ubuntu and Windows, plus `smoke:platform`/`smoke:intake` PASS on both;
- current self-hosting increment: Ubuntu `npm test` 189/189 PASS, `smoke:platform` PASS, `smoke:intake` PASS, and changed-source syntax/diff checks PASS; Windows `@Group` focused delta 26/26 PASS plus `smoke:platform`/`smoke:intake` PASS against a runtime tree whose normalized aggregate SHA256 matches Ubuntu exactly;
- AIDE's live non-generative HarnessRouter probe discovers DSH Headless, DSH ACP `0.1.6-alpha.1`, desktop-bundled Codex `codex-cli 0.154.0-alpha.6.2`, and all four configured Codex profiles below;
- native `model/list` currently verifies `gpt-5.6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-6-astra`, and `gpt-5.5` on this host. Native `collaborationMode/list` verifies `default` and `plan`, with the current Plan preset reporting medium reasoning;
- `codex-economy` freezes `gpt-5.6-luna` + low reasoning and declares strategy priority only for `economy=0`;
- `codex-capability` freezes `gpt-5.6-sol` + ultra reasoning and declares priority only for `capability=0`. The live native catalog reports multi-agent support for this profile, so the target advertises `proactive_multi_agent` without AIDE implementing another agent loop;
- one configured strategy target is never treated as an automatic fallback for the opposite strategy. If the selected strategy-specific target is unavailable and no explicit operator preference resolves the remaining candidates, Tutti blocks on assignment ambiguity rather than silently changing the requested consumption/capability policy;
- `codex-plan` freezes `gpt-5.6-sol` + Plan/medium + read-only + approval-policy `never`; `codex-plan-alt` now freezes `gpt-5.6-sol` + Plan/high with the same read-only/never envelope. Both use `role=planning` and are excluded from ordinary execution routing. The alternate planner intentionally differs by reasoning effort rather than model family because the user rejected Astra for this role;
- `codex-review` freezes `gpt-5.6-sol` + medium + read-only + approval-policy `never` with `role=verification`. Broker keeps verification targets separate from execution/planning. The service uses this target only when `acceptance.semantic` is explicitly non-empty; ordinary Tasks therefore gain no hidden reviewer turn;
- historical non-generative `thread/start(ephemeral)` proof verified the prior Plan-alt=Astra profile. After switching Plan-alt to Sol/high, a fresh non-generative proof verified `gpt-5.6-sol` supports high reasoning and native ephemeral `thread/start` returns `Sol + readOnly + approval never + networkAccess=false`; `smoke:intake` also proves the current Plan-alt routing identity without a model turn;
- Current Codex configured targets also freeze native sandbox network access as a runtime invariant. The verified Plan profiles are `network_access=false`; the current workspace-write economy/capability profiles report `network_access=true`. A mismatch is treated as approval/config drift before acceptance or landing;
- the local service defaults to `execution_strategy=economy`; HTTP/MCP callers may override per Task with top-level `strategy=economy|capability`. Exact model/effort defaults remain deployment configuration through the documented `AIDE_*_CODEX_MODEL/EFFORT` environment variables;
- `crossfire=true` maps to `execution_strategy=capability + plan_consensus=dual`. Economy+crossfire is rejected rather than silently escalating resource use;
- dual planning consensus reuses durable Task/WorkPackage/Attempt state: planner A and planner B run independently as read-only planning Attempts, each must produce non-empty accepted output with durable `side_effects=none`, and neither closes the Task. Only after both succeed does Tutti create the execution WorkPackage and inject both durable plan texts into one capability executor prompt for arbitration/execution;
- failed, empty, or side-effectful planner output blocks consensus; AIDE does not silently collapse dual consensus into single-plan execution;
- crossfire supervision now survives the terminal-boundary restart gap: if one planning Attempt is durably complete but the service exits before creating the next Attempt, idempotent replay resumes advancement from that stored boundary. Likewise, if an accepted execution Attempt was persisted after landing but before Task closure, replay repairs the missing closure instead of stranding an open Task;
- Broker V0 consumes that live probe and admits DSH for `headless + json_events`;
- DSH JSON protocol normalization handles object-form `turn_end.reason.kind` observed in the real runtime;
- Workspace/Evidence rejects lexical path escape and verifies regular bounded files.
- WorkStateStore survives reopen with Task/WorkPackage/Attempt identity and completed outcome intact;
- WorkStateStore rejects a second active writer Attempt for lexical aliases of the same workspace.
- accepted evidence can close the Task and persist Current Truth with Attempt provenance;
- rejected acceptance cannot close the Task or write Current Truth.
- AIDE now exposes a bounded read-only routing history view over terminal routed Attempts. It joins existing Task shape counts, WorkPackage requirements/lineage, frozen routing trace, advisory trace, terminal acceptance, side-effect/context/model state, native usage snapshot, and exact Attempt wall-clock duration without copying raw Task objective text or changing routing behavior. The same observational feed is available through local HTTP `GET /v1/routing-history?limit=...` and MCP `aide_routing_history`; it is intended for offline replay/calibration, not as a second router authority. A replay against the real step-verification smoke produced exactly two routed Attempt records (planner and executor), kept reviewer evidence inside executor acceptance rather than manufacturing a third Attempt, and preserved Codex usage scope as `thread_snapshot` rather than claiming per-Attempt token cost;
- Broker now has a deterministic offline `routing-replay-v0` over that history plus a production-wired **observe-only** `history-v0` shadow advisor. Replay groups terminal Attempts by role/strategy/target/model/effort and reports attempt counts, accepted/rejected/unknown acceptance, acceptance rate, median/P90 wall duration, terminal/side-effect/usage-scope distributions, compactions, reroutes, semantic-review state, step-verification state, and historical shadow disagreement. It does not compute a composite score, billing cost, or inferred per-Attempt token delta. `npm run replay:routing` reads the durable local Work State and emits the same deterministic report without any Harness/model call;
- the production shadow advisor is injected only through the existing Tutti observational hook, after actual assignment is frozen. It compares only durable history with the same role + execution strategy + plan-consensus + semantic-decomposition shape and only among currently qualified candidates. Default `AIDE_SHADOW_MIN_SAMPLES=10`; if the actual target and at least one alternative do not each have enough comparable accepted/rejected history, advice is persisted as `decision=insufficient_history` with sample evidence and no alternate target. With enough history, the deterministic advisory rule is acceptance rate first, median wall duration only as a tie-break, then target id; it still cannot affect current assignment. A replay against the real decomposition smoke correctly returned `insufficient_history` (Plan=1 comparable sample, Plan-alt=0), proving the Current default does not manufacture confidence from sparse data;
- `TuttiIntake.submitAndRun()` locally composes Task/WorkPackage creation, Context Capsule, Broker assignment, Attempt, HarnessRouter execution, Evidence, Tutti acceptance, Current Truth, and Task closure;
- direct `submitAndRun()` now automatically uses a persisted direct WorkspaceRef for the Context Fabric project root;
- `workspace_isolation=attempt` allocates a real detached Git worktree for clean repositories with a HEAD; accepted candidate evidence is landed back to the project workspace, re-collected there, and re-accepted before Task closure;
- isolated WorkspaceRefs still block Task closure until landing is explicitly recorded; project HEAD drift or a dirty project workspace blocks landing instead of attempting an implicit merge;
- `TuttiIntake.handoffAndRun()` can automatically continue an open Task from a terminal source Attempt only when durable side-effect state proves the retry boundary safe (`none`, or `workspace_only` still contained in an unlanded isolated WorkspaceRef); `unknown` and `external_possible` fail closed before Broker selection;
- a controlled two-Harness test verifies automatic `DSH -> Codex` orchestration after the first Attempt fails acceptance;
- Work State persists PendingInteractions and automatically marks unresolved native requests `orphaned` when their source Attempt terminates;
- HarnessRouter forwards `steer/respond` only when the Native Harness handle explicitly supports them and otherwise returns `HARNESS_CAPABILITY_UNSUPPORTED`;
- Tutti only allows same-turn steering when the frozen assignment advertises `same_turn_steer`, and only resolves a PendingInteraction after the Native Harness accepts the response;
- DSH Headless probe advertises `stream_events/session_resume/cancel` but deliberately does not advertise `same_turn_steer` or `interaction_response`. Its frozen `approval_contract` is explicitly non-interactive/fail-closed, has no session-scoped grant channel, and declares auto-review false; the DSH approval subsystem may support `ask|never`, but this AIDE Headless target must not inherit Web/ACP/Auto-review semantics;
- DSH ACP is a separate configured target, not an upgrade of Headless. A real non-generative `initialize` against the shipped ACP server negotiated protocol v1 and reported session `list/resume/close`; AIDE's real adapter probe reports `acp/stream_events/session_resume/cancel/interaction_response/permission_requests/structured_tool_events`. Unit protocol tests cover session new/resume, prompt settlement, native cancellation, permission response, and result mapping without a model call;
- DSH ACP preserves the native permission vocabulary. The installed DSH ACP bridge currently advertises only `allow-once` and `reject-once`, and AIDE responds by exact native option id (or cancellation) rather than translating a global allow/deny enum;
- DSH Headless and DSH ACP Current targets explicitly pin their child process to `DSH_PERMISSION_MODE=workspace-write`; a broader or read-only permission mode is therefore not allowed to silently change the behavior of the same configured target id. A future materially different permission mode must be a separate configured target;
- a real non-generative routing proof now selects `dsh-acp` as the only qualified target for `interactive + response_channel + session_grants=forbidden + auto_review=forbidden`: Codex is rejected because its contract supports session grants, and DSH Headless is rejected because it is non-interactive;
- Codex app-server Default target advertises `app_server/json_events/stream_events/session_resume/cancel/same_turn_steer/interaction_response/permission_requests`, but deliberately does not advertise `user_input_requests`. Its frozen `approval_contract` records app-server request methods, supported approval-policy values, reviewer modes, response capability, and session-scoped grant support. `reviewers` describes supported native reviewer modes; it does not by itself prove that auto-review is active for this configured target;
- approval semantics are attached to a configured **Harness target**, not inferred from a model name. Broker carries `approval_contract` into the frozen assignment; one base model may therefore appear as multiple targets when profiles/sandbox/reviewer/collaboration modes differ;
- WorkPackage approval routing is now implemented without a provider-wide decision enum. `interactive/response_channel/unattended_fail_closed` are boolean requirements; `session_grants/auto_review` accept `allowed|required|forbidden`, where `allowed` is intentionally non-restrictive. Misspelled approval requirement fields fail before routing instead of being silently ignored;
- each running Attempt persists `native_approval_state` separately from the static target contract. Codex records the actual `approvalPolicy`, `approvalsReviewer`, sandbox, active permission profile, model, model provider, and comparable approval facts returned/derived at `thread/start|resume`; DSH Headless records its actual non-interactive fail-closed profile state;
- runtime approval drift is now fail-closed. Tutti validates actual native state against frozen configured invariants (`provider/transport/profile/behavior/sandbox_mode`, stable response/grant capabilities, and supported policy/reviewer sets), then separately re-applies the WorkPackage approval requirement to activation state such as the concrete interactive/auto-review mode. Incompatibility persists monotonic `approval_validation`, requests native cancellation, and forbids acceptance/landing/Task closure even if the native run later reports completion;
- a dedicated regression test proves that a frozen DSH ACP `workspace-write` target fails closed when runtime reports `danger-full-access`, even when the WorkPackage has no approval-specific requirement;
- a configured target that reaches native `status=completed` without ever emitting actual `approval_state` is also rejected before acceptance/landing. Shared Core persists `approval_validation.compatible=false` with `reason=unknown:approval_state` while keeping `native_approval_state=null`, so absence of evidence is not rewritten as a fabricated native state;
- contract-level drift and requirement-level drift are distinct: an actual native policy/reviewer outside the frozen contract is rejected even without a task-specific requirement, while a state inside the target contract can still be rejected when it violates the WorkPackage policy;
- controlled protocol tests verify Codex `requestUserInput -> native response -> same turn completion`, `turn/steer`, and `turn/interrupt` without a model call;
- a real local non-generative app-server probe verified `initialize -> initialized -> thread/start(ephemeral)` and returned a native thread id, `cwd`, `approvalPolicy=on-request`, and `approvalsReviewer=user` without sending `turn/start`;
- one explicitly authorized real Codex turn on 2026-09-18 attempted to force `request_user_input`; Codex Default mode rejected that native tool (`request_user_input is unavailable in Default mode`), emitted the question as ordinary assistant text, and completed the turn. Collaboration mode is therefore part of configured-target identity and Default must not claim `user_input_requests`;
- HarnessRouter event batches expose oldest/latest sequence plus an explicit gap flag so durable orchestration never silently skips a dropped control event;
- each Attempt persists a monotonic event projection cursor; replay of the same native request reference is idempotent;
- blocking `user_input|authentication` requests put the Attempt in `waiting_input`; blocking permission requests put it in `waiting_permission`; resolving the final blocking request returns the same Attempt to `running`;
- a `PendingInteraction` now persists an opaque provider-owned `native_contract` in addition to the shared `kind/summary/native_request_ref`. Tutti does not flatten provider response vocabularies. Current Codex contracts distinguish user-input answers, command approval (including structured policy-amendment variants), file-change approval, native permission-profile grants with `turn|session` scope, and legacy command/patch approvals;
- `TuttiIntake.startRun()` + `observeAttempt()` form the non-blocking run-supervision baseline and project normalized `interaction_request` events into durable PendingInteractions;
- `submitAndRun()` now returns `state=waiting` for a blocking native interaction instead of allowing that wait to become a timeout/cancel;
- a controlled interactive Harness test verifies `interaction_request -> PendingInteraction -> respond -> same native run -> accepted Task closure` without a model call;
- `TuttiIntake.submit()` now separates a small target-neutral Routing Capsule from the target-aware Execution Capsule built only after assignment;
- Broker can hard-gate a declared minimum context window; when a target does not advertise capacity, that fact remains unknown rather than being invented;
- timeout/cancel now preserves a non-terminal `cancelling` state until the Harness produces an observed terminal result, keeping workspace writer ownership held while cancellation is pending;
- DSH final-event parsing accepts legitimate final JSON lines larger than 64 KiB;
- the accepted full-chain test uses a controlled fake HarnessRouter so it does not consume model quota; the real paid DSH path has not yet been re-run through `submitAndRun()`.
- Local Context Fabric resolves symbol definitions/references and bounded source reads while rejecting project-path escape;
- Local Context Fabric can derive a scoped view from a WorkspaceRef, rejects cross-project WorkspaceRefs, and `startRun/submitAndRun` re-materialize the Execution Capsule after Workspace allocation so isolated Attempts read the worktree snapshot rather than the base Project;
- Local Context Fabric now exposes bounded async `query(search|symbol|references|read)` and refreshes the active workspace index before each on-demand query so Native Harnesses do not keep a stale pre-edit symbol/search snapshot;
- HarnessRouter passes the scoped Context object to the selected adapter without interpreting query semantics;
- the Codex app-server adapter exposes `aide_context` as native `dynamicTools` (`search/symbol/references/read`) and handles `item/tool/call` by delegating to the scoped Context Fabric; it now emits explicit `context_tool_call` / `context_tool_result` events so real model-selected retrieval can be proven directly rather than inferred from the final answer;
- a real non-generative Codex protocol probe verified that the installed app-server accepts `thread/start(dynamicTools=[aide_context])`; no `turn/start` or model call was issued;
- `AideControl` is an implemented thin shared facade for `submit/observe/respond/steer/cancel`; it stores no Task/Attempt state, does not call Broker/HarnessRouter directly, and leaves timeout/waiting/resume supervision inside Tutti;
- `AideControl.submit()` now delegates to Tutti `runTask()`, so one entry instruction can continue automatically across rejected/failed Attempts until accepted, waiting for interaction, explicitly cancelled, or blocked/exhausted by routing policy;
- handoff inherits the source WorkPackage requirements and accumulates `exclude_targets`; no-qualified/ambiguous successor or unsafe side effects return structured `automation.status=blocked` without creating an orphan ready WorkPackage;
- internal timeout cancellation is marked as a retryable execution boundary, while an explicit user cancellation stops automation and does not relaunch another Harness;
- Tutti supports a deployment-level target order via constructor `targetPreference` or `AIDE_TARGET_PREFERENCE`; it is only used when the Task did not supply `preferred_targets`, and the effective preference is persisted in the WorkPackage for later handoff;
- Shared Core exposes a durable Task view with WorkPackages, Attempts, active/latest Attempt, and pending interactions. Control can query status and steer/cancel by `task_id` without requiring transport clients to retain internal Attempt ids;
- native session ids and local runtime ownership are persisted while an Attempt is running. Current POSIX adapters launch the native runtime in an owned process group and persist both primary PID and process-group id. If durable Work State says an Attempt is active but the current HarnessRouter no longer owns that run, Task status reports `runtime.attached=false`, `state=detached`, and `recovery_required=true` rather than pretending the run was recovered;
- a real non-generative OS proof verified the stronger fence: the primary PID exited while a descendant in the same process group remained alive, and AIDE rejected recovery until the entire group exited; recovery evidence then recorded `local_process_group_exit`;
- Shared Core now includes an atomic local `ServiceLease`. One service owner renews the lease by directory mtime; stale takeover is allowed only after TTL and, on the same host, only when the recorded owner PID is no longer alive. Lost ownership fails closed;
- `AideServiceRuntime` owns the service lifecycle above `AideControl`: heartbeat, lease fencing, background Task supervision, recovery enumeration, and graceful shutdown ordering. `enqueue()` returns a durable `task_id`/`attempt_id` before the Task reaches its final/waiting boundary, so transport disconnect does not end the Task;
- graceful shutdown aborts supervisors first, waits for tracked operations/background jobs to settle, then releases the service lease;
- one JSON HTTP/Plugin transport now exposes `/health`, Task submit/status/steer/cancel, PendingInteraction response, and recovery listing. It binds loopback by default; a non-loopback bind requires a bearer token;
- the same HTTP server exposes `/mcp` for MCP `2026-07-28` with `server/discover`, `tools/list`, and `tools/call`. MCP tools are `aide_submit`, `aide_status`, `aide_respond`, `aide_steer`, `aide_cancel`, `aide_recoveries`, and `aide_recover`; they use the same AideServiceRuntime and explicit AIDE Task handles rather than a second MCP-owned task state;
- `npm run service` is now the composition root: WorkStateStore -> Context Fabric -> HarnessRouter -> Tutti -> AideControl -> AideServiceRuntime -> HTTP/MCP. Default state/lease files live outside the repository under the platform state root: Ubuntu `~/.local/state/aide/<project-hash>/`, Windows `%LOCALAPPDATA%\AIDE\state\<project-hash>\`;
- a real non-generative service smoke started that composition on an ephemeral loopback port, passed `/health` and MCP `server/discover`, then shut down cleanly without a model turn;
- Work State schema v4 adds durable submission idempotency. `createSubmission()` atomically creates the initial Task + WorkPackage + hashed `client_request_id` mapping; replay after reopen returns the same Task/WorkPackage, while reuse of one key for different submission semantics fails with `SUBMISSION_IDEMPOTENCY_CONFLICT`;
- Tutti computes the idempotency fingerprint from objective, acceptance, effective requirements, and execution workspace identity. Idempotent replay never re-routes the already-created Attempt itself. If the Task is still open at a durable terminal boundary, replay may continue the already-defined workflow transition (next planner, safe handoff, or closure repair) from that stored Attempt rather than creating a second initial branch;
- `AideServiceRuntime.enqueue()` coalesces concurrent same-key requests before lease/file I/O, while Shared Core provides the durable cross-restart guarantee. HTTP accepts `Idempotency-Key`; MCP `aide_submit` accepts `client_request_id`;
- Attempt side effects are now a durable conservative fact: `unknown | none | workspace_only | external_possible`, with bounded provenance. Classifications only move toward greater risk; later weaker observations never downgrade an Attempt;
- Codex app-server projects native execution items into durable side-effect evidence without treating approval requests as execution. A `fileChange` is `workspace_only` only when every native `changes[].path` resolves inside the Attempt cwd. `commandExecution` is now classified from `item/completed` rather than prematurely from `item/started`: native `read/listFiles/search` actions prove `none`; the bounded local inspection fallback used by the P1 dogfood proof can prove `workspace_only`; a known bubblewrap pre-launch failure proves `none`; missing completion, unknown commands, `mcpToolCall`, and `imageGeneration` remain `external_possible`. File-change approval contracts preserve the native `itemId` and `grantRoot` so approval can be correlated with observed file-change evidence rather than trusted by method name alone. DSH Headless still has no equivalent structured observation and therefore remains `unknown` unless another trusted path records evidence. DSH ACP exposes committed generic tool lifecycle: a completed prompt with no observed `tool_call` proves `none`; `write`/`edit` are `workspace_only` only when the pinned mode is `workspace-write`, no wider sandbox escalation was requested, and native `rawInput.file_path` resolves inside the Attempt cwd; all other observed tool calls remain `external_possible`;
- the ordinary terminal handoff path has both deterministic and real mutating proof for `workspace_only + isolated + landing=pending`: the source workspace remains unlanded, the successor receives a new isolated workspace, only the accepted successor is landed, and Task closure occurs after successor acceptance;
- detached recovery now consumes the persisted Attempt side-effect fact rather than accepting a caller-supplied classification. Reroute is allowed for `none`, or for `workspace_only` only when the source is still contained in an unlanded isolated WorkspaceRef; direct-workspace `workspace_only`, `unknown`, and `external_possible` are blocked;
- same-host recovery prefers a persisted owned process-group id when available. A still-live group fails closed with `RECOVERY_PROCESS_GROUP_STILL_ALIVE`; only after the whole group exits does `local_process_group_exit` satisfy the local quiescence gate. Older/non-group Attempts fall back to the primary PID. Missing ownership/cross-host cases still require an explicit quiescence assertion; descendants that deliberately escape the owned group with a new session/process group remain outside this proof boundary;
- recovery finalizes the detached source Attempt before successor creation, preserving one-writer ownership. `abandon` leaves the Task open without launching a successor; safe `reroute` feeds the now-terminal source back through the existing Tutti successor loop;
- HTTP exposes `POST /v1/tasks/:task_id/recover`; MCP exposes `aide_recover`, and recovery precondition failures are surfaced as conflicts rather than silently forcing a new run;
- MCP `2026-07-28` responses now include required `resultType="complete"` on discovery/list/tool success. Tool-domain failures are returned as completed tool results with `isError=true`, while malformed protocol/tool arguments remain JSON-RPC errors;
- `TuttiIntake.submit()` creates durable work, refreshes the shared context source, and consumes a real HarnessRouter probe through Broker V0. Tutti now assigns automatically only when one qualified candidate remains or `preferred_targets` supplies an explicit preference; multiple qualified candidates never fall back to alphabetical target order.
- `npm run smoke:intake` is a non-generative real-environment smoke: it proves `headless+json_events -> dsh`, the interactive/no-session-grant profile -> `dsh-acp`, `economy -> codex-economy (Luna/low)`, `capability -> codex-capability (Sol/ultra)`, and planning -> `codex-plan`, while also retrieving bounded `WorkStateStore` context without a model call.
- authorization-gated `smoke:codex-context`, `smoke:codex-plan`, `smoke:codex-decomposition`, `smoke:codex-semantic-review`, `smoke:codex-reattach`, and `smoke:crossfire` scripts refuse to run unless `AIDE_ALLOW_MODEL_CALL=1`. Real smoke wrappers now also persist a durable local report under `~/.local/state/aide/smoke-reports/` (or `AIDE_SMOKE_REPORT_PATH`) containing running/passed/failed status plus the bounded Work State snapshot; an `uncaughtExceptionMonitor` synchronously records fatal process errors so outer supervisor/stdout loss no longer destroys the smoke verdict. A non-model EPIPE fault injection proved the fatal-report path. Context, Plan interaction, crossfire, semantic-review provider behavior, the older one-planner/one-executor decomposition slice, and the Codex restart boundary have each been exercised under explicit authorization. `smoke:codex-reattach` is a negative-boundary regression: Current Codex app-server loss is expected to interrupt the active turn rather than preserve it.
- the real Context smoke completed on one Codex turn: the model selected native `aide_context.symbol` with `name=AideContextProbeSymbol`, AIDE returned the scoped symbol result, and the same turn completed with exact final text `AIDE_CONTEXT_SMOKE_OK`;
- the real Plan smoke entered durable `waiting_input`, projected native `request_user_input`, accepted the AIDE response, and the same native turn reached `status=completed` with a non-empty native `plan` item ending in `AIDE_PLAN_SMOKE_OK`. The smoke wrapper initially failed only because the adapter treated `agentMessage` as the sole final-text carrier; real Codex thread history showed Plan mode emitted `plan.text` instead. The adapter now accepts `plan.text` as terminal text only for configured Plan mode, with regression coverage. No extra model turn was spent merely to repeat the wrapper after this parser fix;
- because that real interaction path is now proven, configured Plan targets advertise `user_input_requests`; generic/Default Codex still does not;
- an early historical crossfire smoke used `codex-plan` (GPT-5.6 Sol) -> `codex-plan-alt` (GPT-6 Astra) -> `codex-capability` (GPT-5.6 Sol). It proved orchestration/role isolation/side-effect topology but exposed executor-marker leakage and did **not** prove substantive plan arbitration quality. Astra is not part of the Current planner configuration;
- that historical evidence exposed a real prompt/acceptance defect: planners and executor shared the same objective, so executor-only final-output constraints leaked into planning. Tutti now prepends a dedicated independent-crossfire planning role and rejects a planner whose entire output equals the Task's executor `finalText` (`planning_role_separation`). A later authorized all-Sol semantic re-proof initially stopped after Planner A because real `turn/completed` did not hydrate Plan items; native `thread/read(includeTurns=true)` is now used when Plan completion lacks terminal text. After that native hydration fix, the full `Sol/medium -> Sol/high -> Sol/ultra` semantic smoke passed: both planners produced substantive, non-identical plans with `PLAN_STEPS` and `TRADEOFF`, both remained `side_effects=none`, and the executor explicitly emitted `ARBITRATION`, `ADOPTED`, `REJECTED_OR_DEFERRED`, ending with `AIDE_CROSSFIRE_SEMANTIC_OK`;
- external JEV-family repositories were reviewed as architecture references on 2026-09-18: `gargpratyush/jev-router`, `0xNatoshi/jev-codex-router`, `NiazMorshed2007/jev-review`, `devagrawal09/jev-review`, and `LichHsu/codex-desktop-jev-worker`. Current decision is **reference only**: no JEV package, API key, proxy, MCP server or external data transfer has been added to AIDE. The reusable policies and rejected mechanisms are recorded in `docs/JEV_REFERENCE_EVALUATION.md`;
- routing ideas judged compatible with AIDE are fresh-boundary/sticky routing, explicit human override, conservative confidence gating, cache-aware downgrade once telemetry exists, explainable decision history, and shadow/replay calibration. Per-tool-step model flipping and Codex loopback-provider injection are rejected for Current because they conflict with frozen Attempt identity and duplicate the verified native app-server plane;
- JEV Review is considered a possible future read-only Verification advisor only. Scores/confidence/deltas may become review evidence, but cannot independently fail acceptance, add new acceptance criteria, or authorize scope. Sending task/diff/code to TypeSafe would be a new external-data/paid-service boundary and requires separate explicit authorization;
- provider-neutral Shadow Routing plumbing is now implemented without adding a JEV dependency. `TuttiIntake` may receive an optional `shadowAdvisor`; its output is validated and persisted but never enters `chooseAssignment`. Advisor failure is recorded as unavailable and does not block or alter execution;
- new Attempts persist a `routing_trace` containing execution strategy/plan-consensus mode, Broker candidate ids and rejections, actual target/harness/role/model/reasoning effort/decision reason, sanitized provider resource facts, optional advisory evidence, start time, and terminal status/acceptance/side-effect/usage facts. The trace is part of the Attempt rather than a second routing authority;
- configured Codex probes now best-effort read native `account/rateLimits/read` without starting a model turn. Only routing-relevant facts are retained: ordinary-usage availability, limit id/name/model alias, primary/secondary used-percent/reset/window values, and reached-state flags. Account identity, plan metadata, balances and unrelated account data are not propagated into Broker candidates;
- during Codex execution, native `thread/tokenUsage/updated` is preserved as a raw `scope=thread_snapshot` usage record with `last`, `total`, and `modelContextWindow` when provided. AIDE deliberately does not relabel cumulative thread totals as exact per-Attempt cost or use them for automatic routing until turn/delta semantics are proven;
- native Codex context compaction is now projected as durable Attempt context-health evidence. Current app-server represents compaction as the `contextCompaction` ThreadItem and also retains deprecated `thread/compacted`; AIDE deduplicates those per turn and stores compaction count plus latest turn/source/time. This is a factual pressure signal, not a guessed context-occupancy percentage;
- native Codex `model/rerouted` is now projected into durable `native_model_state`: requested model remains frozen as assignment provenance, while current runtime model and reroute history are recorded separately. Current native schema exposes `highRiskCyberActivity` as a reroute reason. AIDE records the native safety-owned reroute rather than cancelling it or trying to force the original model back;

Authorized real DSH vertical slice on 2026-09-16:

- process exit: `0`;
- normalized `turn_end_reason`: `completed`;
- native session ID captured;
- final text: `AIDE_DSH_SMOKE_OK`;
- workspace artifact: `SMOKE.txt`;
- artifact bytes: `AIDE_DSH_SMOKE_OK` (17 bytes);
- SHA-256: `f959187086016c09530494e7561007c3eedbbb54b1d42e65369db95cc2093183`;
- Tutti deterministic acceptance: `accepted=true`.

The real DSH run proves:

```text
HarnessRouter
-> real DSH Native Harness
-> workspace mutation
-> bounded file/hash evidence
-> Tutti deterministic acceptance
```

The new durable closure path is locally verified but has not yet been re-exercised with another paid DSH call.

Authorized real cross-Harness control validation on 2026-09-18:

- `DSH -> Codex` completed through `TuttiIntake.runTask()` with exactly two real Attempts;
  - DSH was the preferred first target and returned `FIRST_ATTEMPT_ONLY`, so deterministic acceptance rejected it;
  - Tutti created a successor WorkPackage with `exclude_targets=["dsh"]`, Broker selected Codex, and the Codex successor returned `CROSS_DSH_CODEX_OK|handoff-from=dsh`;
  - the Task closed successfully and Current Truth points to the accepted Codex Attempt;
- `Codex -> DSH` completed through the same automatic path with exactly two real Attempts;
  - Codex returned `FIRST_ATTEMPT_ONLY` and was rejected;
  - the successor Capsule contained `exclude_targets=["codex"]`, DSH returned `CROSS_CODEX_DSH_OK|handoff-from=codex`, and the Task closed successfully;
- all four Attempts used `workspace_isolation=attempt`; rejected source workspaces remained unlanded, while each accepted successor workspace landed successfully with a zero-byte patch because the control test intentionally used no tools or file mutation;
- no permission was approved in the successful validation. An earlier file-oriented DSH -> Codex probe reached a Codex request to retry a failed command outside the sandbox; AIDE refused that request and that probe was aborted rather than weakening the permission boundary;
- the successful test proves real bidirectional automatic Harness replacement, preferred-target ordering, source-target exclusion, successor Execution Capsule regeneration, deterministic acceptance, isolated WorkspaceRef lifecycle, landing, Task closure, and Current Truth provenance;
- that historical control test did **not** prove continuity of rejected workspace mutations or external side effects because it intentionally used no tools and both Harnesses remained conservatively `side_effects=unknown`.

The real validation's terminal-handoff safety gap is now closed: ordinary `handoffAndRun()/advanceTask()` uses the same durable side-effect boundary as detached recovery. The historical no-tool DSH <-> Codex control proof used `side_effects=unknown`; under the current stricter code that source would block until the Harness can prove a safe classification. This is intentional: a prior proof of topology is not evidence that an opaque runtime had no external effects.

Authorized real **mutating** cross-Harness validation on 2026-09-18:

- a disposable clean Git project with a temporary baseline commit was used only for the smoke; AIDE itself was not committed or pushed;
- Broker/Tutti selected `dsh-acp` first with `workspace_isolation=attempt` and preferred targets `["dsh-acp", "codex"]`;
- the real DSH ACP source created only `SOURCE_ONLY.txt` inside its isolated worktree. Native tool evidence classified the Attempt `workspace_only`; deterministic acceptance intentionally failed because `RESULT.txt` was absent; the source WorkspaceRef remained `landing_status=pending`, and `SOURCE_ONLY.txt` never appeared in the project root;
- Tutti created the successor with the source target excluded and selected Codex in a different isolated worktree;
- the real Codex turn emitted native `item/started` type `fileChange` with one path, `RESULT.txt`, under the successor workspace. The subsequent `item/fileChange/requestApproval` carried the same native `itemId`; `grantRoot` was null. AIDE approved only after correlating that request with the persisted `workspace_only` evidence for the same item and verifying every native change path was inside the successor WorkspaceRef;
- Codex completed with `side_effects=workspace_only`, deterministic acceptance passed, successor landing produced a non-zero patch, the Task closed, project-root `RESULT.txt` contained the expected value, and project-root `SOURCE_ONLY.txt` remained absent;
- no command/MCP/web/unknown approval was accepted. Earlier probes with insufficient path evidence were cancelled rather than weakening the boundary;
- this proves real cross-Harness continuity for **contained workspace mutation**. It does not authorize or prove automatic continuity for `external_possible` effects; those remain blocked.

## 5. Current design conclusion

The desired product-level flow is now explicitly:

```text
one main entry
-> Tutti Intake
-> Task / WorkPackage requirements
-> minimal shared context
-> Broker recommendation
-> Tutti assignment
-> HarnessRouter / Native Harness
-> evidence / acceptance
-> Current Truth / closure
```

Main-entry **local full orchestration baseline is now implemented** through `TuttiIntake.submitAndRun()`: one message can become Task/WorkPackage, shared context, Broker recommendation, automatic assignment, WorkspaceRef, Attempt, Harness execution, Evidence, acceptance, Current Truth, and closure. The direct-project path no longer requires an explicit workspace argument, and this exact entry method has not yet been re-verified with a paid real DSH task.

Tutti also now has an **automatic cross-Harness handoff baseline**: a terminal rejected/failed Attempt can continue under the same open Task only after the source side-effect boundary is proven safe, the previous target is excluded by default, Broker recommends alternate qualified targets, and Tutti starts the successor Attempt only when the assignment is unambiguous or explicitly preferred. Native Harnesses do not spawn each other directly. Real bidirectional DSH <-> Codex control execution and real contained-mutating `DSH ACP -> Codex` execution have both been verified; handoff remains intentionally blocked when source effects are unknown/external.

The Tutti-owned **Local Context Fabric V0 is now implemented** with local workspace identity, bounded text indexing, symbol/reference lookup, bounded reads, WorkspaceRef-aware execution materialization, and live on-demand query refresh. Codex new threads can query that same scoped fabric through native app-server dynamic tools without routing the semantics through HarnessRouter. Dependency-aware and semantic retrieval remain planned.

The shared **Control baseline** is also implemented as `AideControl`. It is deliberately a facade, not another orchestration plane: `submit` runs Tutti to the next user-visible boundary, `respond` resolves the PendingInteraction and lets Tutti continue to the next boundary, while `observe/steer/cancel` delegate to Tutti. MCP/Plugin/Web/CLI adapters can share this object/API shape without creating separate Task state.

The main-entry automation baseline now advances one open Task across alternate Harnesses without requiring callers to invoke `handoffAndRun()` manually. It preserves the previous WorkPackage requirements, excludes already-used targets, may reroute after an internal timeout, stops after explicit user cancellation, and returns a structured blocked state when no safe unambiguous alternate remains.

The **service lifecycle baseline** is now implemented as well. A local Project has one service lease owner, transport calls may return a Task handle immediately while Tutti continues supervision in-process, and service restart exposes detached Tasks through `recoveries` instead of silently replaying an unknown native turn. HTTP/Plugin and MCP share this exact runtime rather than owning parallel orchestration.

AIDE now also has a **run-control interaction supervision baseline**: durable PendingInteraction state, capability-gated `steer/respond`, normalized blocking interaction-event projection, restart-safe event cursors, and non-blocking `startRun()/observeAttempt()` supervision. Codex app-server is connected as the first real interactive adapter. A real Default-mode turn proved the important negative capability that `request_user_input` is unavailable in Default. Plan is represented as separate verified configured targets (`codex-plan`, `codex-plan-alt`), and native Plan `request_user_input` + durable response/resume has already been real-proven.

Workspace isolation is now a real local path rather than only a closure gate. For a clean Git project with a HEAD, Workspace can create a detached attempt worktree, preserve one-writer isolation, land its tracked/new-file binary diff only if project HEAD is unchanged, re-verify the landed diff, and let Tutti re-run acceptance against the project workspace. The current AIDE repository still cannot use this path until it has a base commit.

Preferred implementation order for the Current host:

```text
1. Harden local quiescence from primary-PID exit toward provider/process-tree proof only where the Native Harness exposes a trustworthy primitive
   -> durable side-effect classification and same-host primary-PID fencing are implemented; guessed resume remains forbidden

2. Prove a real authorized Codex turn actually invokes one `aide_context` dynamic tool and continues on the same native turn
   -> protocol registration is verified without a model call; model-selected tool execution remains intentionally unspent

3. Add a separately verified configured Codex Plan target only if real `request_user_input` behavior is needed
   -> collaboration mode must be frozen in assignment identity; do not overstate Default capabilities

4. Extend automatic handoff beyond contained workspace mutation only if a future operation has an idempotent/compensatable external-effect contract
   -> real contained `workspace_only` mutation is proven; `external_possible` remains fail-closed
```

This order is an implementation choice based on the Current environment. It does not change the architecture authority split or assign permanent roles to either Harness.

## 6. Explicit Unknowns

- Real DSH `--session-id` continuation behavior through AIDE has not yet been exercised with a second paid task.
- Real DSH cancellation behavior during an active paid run has not yet been exercised.
- DSH Headless cannot currently receive AIDE same-turn steering or interaction responses; its verified surface remains batch-oriented. DSH ACP is the separate Current interactive target and must not be emulated inside Headless.
- The Codex app-server adapter currently defaults to the verified desktop-bundled Linux path unless `AIDE_CODEX_COMMAND` overrides it. Windows runtime discovery is now a first-class parity requirement rather than a deferred portability enhancement.
- Codex interaction projection is implemented for current user-input, command/file approval, permissions approval, and legacy command/patch approval server requests. Default collaboration mode does not expose `request_user_input`; Plan-mode `request_user_input -> PendingInteraction -> response -> same turn completion` is now real-proven. Crash/reconnect rebinding of an already-pending native request remains unverified.
- Explicit capability semantic decomposition is implemented and real-proven, but **automatic arbitrary-objective decomposition into independently executable WorkPackages is not**. Current `decompose=true` creates one read-only structured planning Attempt, persists a Task-level `single|decompose` Decision with ordered steps, then creates one execution successor that consumes those steps as canonical context. Promoting each proposed step to its own WorkPackage remains intentionally deferred until step-level acceptance/dependency/retry semantics are justified.
- Local Context Fabric V0 is implemented with WorkspaceRef-scoped execution retrieval and Codex native dynamic-tool transport; dependency graphs, semantic/vector retrieval, incremental indexing, and DSH in-Harness retrieval transport are not.
- Codex `thread/start` accepts AIDE dynamic context tools on the installed runtime. Whether an externally created/resumed Codex thread reliably preserves or acquires those dynamic tools is not yet proven; AIDE-created new threads are the verified path.
- Exact token packing is not implemented. Routing/Execution Capsule separation and capacity facts exist, Codex exposes raw native thread token/context-window snapshots, and actual compaction events are now durable. AIDE still lacks proven live occupancy/remaining-budget semantics and model-specific packing enforcement. Unknown capacity stays retrieval-first rather than being guessed.
- Isolated Git worktree allocation/landing is implemented for clean repositories with a valid HEAD. Current AIDE still has no ordinary commit/HEAD, and no automatic initial commit is created just to satisfy Workspace isolation.
- Session compatibility/handoff rules are architecture-defined in `BOUNDARY_CONTRACTS.md`, but no durable Handoff record exists yet.
- Automatic alternate-Harness handoff is implemented, gated by durable side-effect classification, and has both a real bidirectional no-tool control proof and a real contained-mutating `DSH ACP -> Codex` proof. Continuity for external/non-idempotent effects remains intentionally unsupported without a stronger operation-specific contract.
- General durable Decision/decomposition semantics remain open. `Task`, `WorkPackage`, `Attempt`, minimal Current Truth closure, and the lineage edges for currently implemented WorkPackage transitions are no longer unknown; a second generic Task Graph store is not needed for the Current flow.
- Broker V0 currently performs hard gating and explainable eligibility only. Sanitized native Codex quota facts and durable routing/outcome traces now exist, but history/quota/cost/load **ranking** remains intentionally unimplemented until enough AIDE-specific evidence exists. No current resource fact silently changes an Assignment.
- Cross-process writer locking/recovery is not implemented. Current phase only enforces one active Attempt per normalized workspace inside the persisted Work State; add a real lease only when concurrent daemon/process behavior requires it.
- Live native turn reattachment is now a resolved **unsupported Current capability**, not an open implementation assumption. Under explicit authorization on 2026-09-18, `smoke:codex-reattach` started one real Codex turn, killed its owning app-server, opened a fresh app-server, resumed the same thread, and observed the same pre-crash turn as `status=interrupted`. The active turn therefore does not survive owning-app-server loss in the Current native runtime. Because the containing turn terminates, pending approval/user-input request rebinding is not pursued as a separate Current feature;
- complementary non-generative Codex probes proved (1) an empty thread with no rollout is not resumable, (2) a completed rollout is resumable by a fresh app-server process and returns `idle + canAcceptDirectInput=true`, (3) a second simultaneous resume is rejected with `already has an active writer`, and (4) after the current writer exits, a later app-server can resume the same completed rollout again. These facts support safe later-turn continuation, not live active-turn takeover;
- the Codex adapter guards the duplication boundary explicitly: if ordinary `start(..., sessionId)` ever resumes a thread whose native status is still `active`, it returns `CODEX_THREAD_REATTACH_REQUIRED` and never sends `turn/start`;
- DSH recovery follows the same high-level quiescence-first result for a different transport reason. Current DSH Headless and ACP transports are AIDE-owned stdio child processes; live event streams and ACP pending JSON-RPC permissions are bound to those process pipes. While the recorded process group is alive AIDE does not take over; only after quiescence may a later Attempt/session continuation path proceed. No synthetic stdio reattachment layer is planned;
- Codex schema exposes optional thread-scoped billing usage through `account/usage/read({threadId})`, including estimated credits/USD and per-model token groups. A real non-generative read against an existing completed AIDE Codex rollout returned `threadUsage=null` on the Current account/billing route. This is not treated as Current cost evidence; raw `thread/tokenUsage/updated` remains the strongest available native token fact;
- The filesystem ServiceLease is intentionally single-host. It is not a distributed consensus/fencing mechanism for multiple machines sharing one writable Work State.
- Submit idempotency is durable when callers provide `Idempotency-Key` (HTTP) or `client_request_id` (MCP). Requests without a key intentionally retain at-least-once submission semantics.
- Same-host detached recovery now verifies the persisted owned process group when available, with primary PID as fallback only. This is stronger than the old primary-process check but still does not prove descendants that deliberately escape the owned process group.
- AIDE-created Codex threads now have real model-selected `aide_context` proof. Externally created/resumed threads preserving or acquiring the same dynamic-tool surface remain unverified.
- installed Codex v2 schema exposes `turn/start.outputSchema` as an optional JSON Schema constraining the final assistant message. `CodexAppServerAdapter` and `HarnessRouter` now pass this schema through with object validation and deterministic tests. Tutti does **not** yet invoke a decomposition planner automatically; using this primitive for semantic decomposition would add a model turn and therefore needs an explicit capability/resource policy rather than being silently added to normal submit;
- Shared Core Work State is now version 9. In addition to the existing Task/WorkPackage/Attempt/Workspace/Interaction state, it persists a deliberately small human-facing `Conversation`: id, title/archive state, next-send defaults, timestamps, and Task linkage. Existing v8 state migrates by adding an empty Conversation map and `conversation_id=null` on historical Tasks. A Conversation does not persist a provider-native session/thread id and does not duplicate a full transcript. Task still persists bounded semantic `constraints` separately from `acceptance` and WorkPackage `requirements`, and may persist one provenance-bound `semantic_decision`; Attempts retain the bounded durable `finalization_checkpoint` used between observed native terminal result and final Attempt completion;
- local management UI V1 is now Current on the same AIDE service at `/` (default `http://127.0.0.1:8711/`) with no frontend daemon or framework build chain. It serves vanilla HTML/CSS/JS plus thin Control APIs. Current screens: Overview, Conversations, Tasks, Models & Accounts, Harnesses & Modes, Routing, Settings. The Overview is read-only presentation aggregation over existing Control facts: active/recent Tasks, available configured targets, connected providers and recent routing. It does not own policy or routing. Conversation UI can create/rename/archive durable Conversations, submit the next Task with economy/capability + explicit qualified target preference + Direct/Decompose/Crossfire intent, poll Task/Attempt state, inspect assignment/model/effort/side-effects/verification, answer pending interactions, and issue steer/cancel/recover actions. Next-send selections are persisted as Conversation defaults and do not mutate in-flight Assignments;
- the management UI has adopted the reusable WebMaker frontend baseline without changing AIDE's stack or ownership. Current visual/interaction changes include semantic design tokens, consistent Card/Badge/empty-state composition, a control-center Overview, responsive Sidebar/Workspace/Inspector layouts, no fixed `980px/760px` body minimum width, narrow-screen top navigation, a `Jump to latest` control, polling that yields when a user scrolls away from the live edge, and Ctrl/Cmd+Enter submission. No React/shadcn runtime dependency was introduced merely for styling;
- non-network browser layout QA on the Current UI was executed with local Chrome `file://` rendering because the Linux host blocks Chrome platform sockets for `http://127.0.0.1`, producing a Chrome error page for HTTP headless screenshots. The file-rendered CSS layout proved no horizontal overflow at desktop (1440 requested, `scrollWidth=1425`) and the narrow-screen breakpoint (Chrome headless CSS viewport 500, `scrollWidth=485`); Conversation stacks Inspector below the workspace on narrow screens, and populated Overview cards switch from a compact desktop grid to a single-column narrow layout. This is real layout evidence, but not a claim that an HTTP screenshot rendered successfully in that sandbox;
- the UI target/model catalog is live HarnessRouter/provider data sanitized through Tutti/Control: target availability, provider, role, configured model/effort, collaboration mode, strategy priorities, capabilities, approval contract, resource facts, plus provider account status and exact model/effort directories where a verified native seam exists. The real Codex app-server `account/read`, `model/list`, and `collaborationMode/list` surfaces are now wired. A read-only live validation on 2026-09-19 confirmed the current local ChatGPT account is connected and the native model directory exposes multiple current Codex models with per-model reasoning-effort sets and `default|plan` collaboration modes; no model turn was consumed;
- Codex provider authentication is now a real AIDE configuration seam over the native app-server protocol rather than a simulated login. Current HTTP/UI operations cover `account/login/start` for ChatGPT browser OAuth, device code, or write-only API key, `account/login/cancel`, login-status polling via native `account/login/completed`, and `account/logout`. Browser/API results expose only sanitized account/flow facts. API-key bytes travel only from the browser request into the one native login request and are never written to Work State, Current Truth, routing telemetry, logs, or returned catalog data. Waiting login flows are process-local and are closed on service shutdown; durable auth-flow recovery remains intentionally absent. Native protocol behavior is deterministic-tested, while a real login/logout was **not** performed because that would mutate the user's account state;
- exact Codex model/effort selection is now executable for the bounded **Direct + one preferred Codex target/profile** case. Conversation defaults may persist `model` and `reasoning_effort`; Broker verifies the model exists in that target's live `model_directory`, verifies the requested effort is supported, applies the model's declared default effort when none is supplied, and re-evaluates model-dependent capabilities before freezing the candidate. Tutti rejects explicit model selection before Task creation when no single target profile is named or when Decompose/Crossfire is requested. HarnessRouter passes the frozen model/effort to Codex while the selected profile's sandbox/approval contract remains unchanged. Targets without a verified model directory advertise `model_selection=false`, so the UI does not offer a control that Broker must reject;
- DSH remains `Native-managed` in `Models & Accounts`. Installed DSH packages confirm useful write-only credential, provider model-directory, and human authorization-flow semantics, but those surfaces are Cordis/profile services (`dsh-authorization`, settings controller, Models UI), not a verified stable protocol exposed by the Current AIDE DSH Headless/ACP adapters. They remain Reference only; AIDE does not turn them into a hidden runtime dependency;
- semantic decomposition now has an explicit Current vertical slice. `decompose=true` on HTTP/MCP maps to capability strategy plus `semantic_decomposition=plan`; economy+decompose and decompose+crossfire fail closed. The planner is hard-gated on `planning_mode + structured_output`, remains read-only, receives a native output schema, and its JSON is deterministically validated before Task decision persistence. For `decision=decompose`, each ordered step must now include one bounded `verification` postcondition in addition to its objective. A valid accepted decision creates exactly one `semantic_decomposition_execution` successor WorkPackage; that executor receives the durable decision through Context Fabric and final Task acceptance remains unchanged;
- step-level verification now has a minimal Current baseline without materializing independent step WorkPackages. After mechanical Task acceptance passes, Tutti combines immutable user `acceptance.semantic` criteria with the durable decomposition step postconditions and evaluates them in one existing read-only semantic-verifier evidence run. Attempt acceptance persists a separate `step_verification` view with step index/objective/criterion/PASS-FAIL/reason. Any failed step postcondition blocks Task closure. This is **post-execution verification only**: the current single executor does not expose a trustworthy mid-turn boundary, so AIDE does not claim that step N is independently gated before step N+1 begins;
- Control HTTP/MCP now also exposes top-level Task `constraints: string[]`. Passing both top-level constraints and `options.constraints` is rejected as ambiguous rather than silently merged or overridden. Intake idempotency fingerprints include constraints, so reusing a client request id with different semantic constraints cannot be mistaken for the same submission;
- Control HTTP/MCP now exposes semantic verification intent directly as top-level `semantic_acceptance: string[]` (max 16 bounded criteria), mapped to the existing durable `acceptance.semantic`. Existing mechanical `finalText/files` may remain in `options.acceptance`; specifying semantic criteria both top-level and under `options.acceptance.semantic` is rejected rather than silently merged. This keeps semantic review discoverable without exposing internal routing fields;
- Tutti now implements an optional fail-closed semantic acceptance contract using `acceptance.semantic` as the immutable user criteria. Mechanical acceptance always runs first; semantic verifier work is skipped when mechanical evidence already fails. When semantic criteria exist, the verifier must return exactly one check per original criterion in the same order with `passed:boolean` and a bounded reason. It cannot add criteria, rewrite constraints, or close the Task directly. Tutti combines both layers and persists the structured semantic review inside Attempt acceptance;
- semantic criteria without a configured verifier fail closed with `SEMANTIC_VERIFIER_UNAVAILABLE`. Semantic rejection occurs before isolated landing; deterministic coverage proves rejected semantics leave landing pending and Task open. This prevents a model/reviewer PASS declaration from bypassing Workspace/Evidence or causing rejected candidate changes to land;
- production semantic-review wiring now exists without introducing a Reviewer service or second WorkPackage. `createHarnessSemanticVerifier` asks Broker for a qualified `role=verification + structured_output + context_retrieval + read-only` target, runs it through HarnessRouter, rejects non-read-only/side-effectful/incomplete evidence, and returns criterion verdicts plus trusted runtime provenance. `scripts/aide-service.mjs` wires that verifier by default; it is invoked only for explicit `acceptance.semantic`. The review provenance persisted inside the execution Attempt acceptance includes target, requested/effective model, effort, run/session ids, raw native usage snapshot, native reroutes, and compaction count;
- semantic finalization is now restart-durable across the previously unproven reviewer boundary. Before a semantic verifier call, Tutti persists the observed terminal result, bounded evidence, mechanical verification, and a semantic-input fingerprint. After a valid `status=available` semantic review, it persists that normalized review before final Attempt completion. Explicit detached recovery supports `action=finalize` after native quiescence: a pre-review crash reruns the missing review, while a post-review crash reuses the matching durable review and does not pay for or trust a duplicate reviewer call. Unavailable/failed reviews are deliberately not reused as valid semantic evidence. Existing accepted-terminal-before-Task-closure replay still repairs the later closure boundary;
- the underlying Sol/medium read-only structured semantic-review behavior was real-proven on 2026-09-19. After that proof the smoke and service were consolidated onto the same production verifier factory. That consolidated factory path is deterministic-tested but has not consumed another model call merely to repeat the already-proven provider behavior;
- this Current decomposition mode is intentionally **plan-before-one-executor**, not multi-step autonomous execution. Ordered planner steps are canonical decision context only. Promoting them to independent WorkPackages remains Target until step-level semantic acceptance/dependency/retry semantics are justified by real AIDE Tasks;
- deterministic coverage proves the structured decision happy path, missing-step-verification fail-closed behavior, capability/crossfire policy boundaries, durable decision provenance, restart advancement from a persisted terminal planning Attempt, and final step-verification closure blocking. The newer step-verification path is now also **real-proven** under explicit authorization on 2026-09-19 using the durable smoke report: `codex-plan` on `gpt-5.6-sol` / medium produced a schema-constrained `decompose` Decision with two ordered `objective + verification` steps and `side_effects=none`; `codex-capability` on `gpt-5.6-sol` / ultra completed the execution successor; `codex-review` on `gpt-5.6-sol` / medium evaluated both durable step postconditions; `step_verification.accepted=true` with two step verdicts; the execution Attempt was accepted, the Task closed, and one Current Truth record was committed. The earlier inconclusive smoke remains historical evidence only of the old stdout/supervisor weakness, which the durable report path now removes;
- Local Context Fabric now carries bounded cross-Attempt continuity for the same Task: prior WorkPackage lineage plus terminal status, routing decision reason, requested/effective model, acceptance, side-effect class, error code, bounded non-planning final-text excerpt, context health, and file evidence refs. Evidence file bodies are deliberately excluded. Independent planning Attempt text is also excluded from generic continuity so Planner B cannot see Planner A; accepted plans reach the executor only through the explicit plan-consensus channel;
- Context Fabric/Codex `aide_context` now support on-demand `current_truth` and `evidence` in addition to repository `search/symbol/references/read`. `evidence(taskId)` is a bounded durable Attempt summary rather than transcript replay. This closes the main V0 continuity gap for handoff/rework without adding another memory or graph service;
- `current_truth` no longer exposes only closure fact strings. Context Fabric resolves each durable truth reference back to its Task and evidence Attempt and returns a bounded provenance view: Goal, Task constraints, semantic Decision, requested/effective model, accepted semantic review, and metadata-only evidence refs. The underlying Work State remains normalized; no evidence-file body or transcript is duplicated into Current Truth;
- Codex Plan is real-proven for native `request_user_input` and `plan.text` completion. A post-fix repeat of the exact wrapper was intentionally not purchased after thread-history evidence isolated the adapter-only parsing defect; deterministic regression coverage now guards that parser path.
- Capability dual-plan crossfire is now semantically real-proven for the Current all-Sol configuration: Plan-Sol/medium + Plan-Sol/high -> Sol/ultra. The first historical Astra-based run remains useful only as evidence that exposed executor-marker leakage. Current planning role separation plus native Plan hydration have since passed a paid semantic smoke with substantive distinct plans, `side_effects=none`, and explicit executor arbitration. Automatic task-complexity heuristics remain intentionally unimplemented; `crossfire=true` stays explicit until broader task-quality/cost/latency history exists.
- `economy` and `capability` are explicit routing profiles, not measured monetary prices. AIDE does not yet ingest billing tables, quota burn, or observed token/latency history; deployment owners may override configured models/efforts as native catalogs change.
- The MCP transport intentionally implements the current `2026-07-28` stateless era only; legacy `2025-11-25` initialize/session compatibility is not implemented in this minimal transport.

## 7. Historical V1 vertical-slice acceptance

The original V1 vertical-slice acceptance sequence is now satisfied. AIDE can show:

- which target was recommended and why;
- which target Tutti assigned;
- which Attempt/workspace executed;
- native lifecycle result;
- current diff/test/log evidence;
- semantic acceptance/rework result;
- updated Current Truth.

## Pending Next Actions (2026-09-20)

1. **TODO — P3 version closure.** Audit the current dirty scope, separate release-worthy changes from one-off proof/test artifacts, decide the treatment of `docs/P1_SELF_HOSTING_PROOF.md`, rerun same-source Ubuntu and Windows release gates, and prepare the Self-hosting Baseline release. Commit/push and destructive cleanup remain separately authorization-gated.
2. **TODO — Memhub Agent Plugin installation and plugin-transport verification.** After P3, install the canonical portable plugin from `PhSanqi/Memhub/adapters/plugin` and test it through a supported OpenAI/Codex Agent Plugin host. The package is an `agent-plugins.org` plugin (not a ChatGPT Plugin Directory listing): `plugin.json` declares Memhub v0.2.0, `mcp.json` connects to the local Bridge at `http://127.0.0.1:17861/mcp`, and OpenAI hooks provide UserPromptSubmit/Stop/SessionStart/PostCompact/SessionEnd recall/capture. Verify plugin loading, MCP availability, project resolution, pre-turn recall, turn capture, compaction restore, session close, and parity/differences versus the current remote MCP transport. Codex supports Agent Plugins through its plugin/marketplace surfaces; the Memhub repository currently does not include a `marketplace.json`, so the exact local installation wrapper/marketplace packaging must be established during this test rather than guessed. Do not treat the plugin as an AIDE runtime dependency or architecture change without evidence.
