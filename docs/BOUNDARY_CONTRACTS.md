# AIDE Boundary Contracts

Status: V1 architecture contract for cross-module behavior.

This document defines which side owns each decision when AIDE modules meet, which facts may cross that boundary, and which facts must not leak across it.

The authority split remains:

```text
WHAT  -> Tutti
WHO   -> Broker recommends, Tutti decides
RUN   -> HarnessRouter
HOW   -> Native Harness
PROVE -> Workspace / Evidence
```

## 1. External failure modes that shape AIDE

Current references show several recurring problems that AIDE should prevent architecturally:

- HarnessRouter UHP requires capability discovery before assuming session, cancellation, file, or lifecycle behavior. It also treats configured Harness identity and structured failure as first-class concepts.
- Tutti uses worktree isolation, run ledgers/checkpoints, context-health monitoring, and explicit handoff packets. It does not treat full transcript sharing as the only continuity mechanism.
- Multica has a documented case where switching Harness/runtime inside one chat loses provider-native conversational continuity even though history is persisted; the proposed repair is explicit continuity/handoff when provider resume is unavailable.
- c9r validates requirements such as session resume, permission events, workspace sandboxing, and guaranteed cancellation before execution. Provider session tokens remain opaque runtime state.
- Codex app-server exposes thread/turn/item lifecycles and has cases where cancelling one operation does not prove that every underlying worker has already stopped.
- DSH records resolved-route context capacity separately from request content, and that capacity may be absent when the adapter cannot advertise it.

Reference URLs:

- https://github.com/HarnessRouter/harnessrouter/blob/main/protocol/versions/2026-08-11/architecture.md
- https://github.com/nutthouse/tutti
- https://github.com/multica-ai/multica/issues/7738
- https://docs.c9r.io/en/guide/agent-driver-model
- https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md

These projects are references, not hidden AIDE runtime dependencies.

## 2. Intake -> Broker

Tutti sends a WorkPackage requirement description, not a full transcript and not an execution prompt.

Allowed routing facts include:

- required Harness capabilities;
- minimum context-window requirement when the task genuinely needs one;
- required output capacity when known;
- workspace access/isolation requirements;
- session-resume requirement;
- permission-event requirement;
- approval interaction/response-channel requirement;
- session-scoped grant requirement or prohibition;
- unattended fail-closed requirement;
- auto-review allowed/required/forbidden policy when the configured target declares a comparable fact;
- cancellation/idempotency requirement;
- cost/latency/quota policy when such facts exist.

Broker returns resource facts and an explainable candidate set. It never creates an Attempt and never makes the final assignment.

Unknown facts remain unknown. They must not be silently converted to zero, false, or an optimistic default.

Current implementation: availability/capability/context/output hard gates plus provider-neutral approval-policy hard gates exist. Configured Codex targets also expose sanitized native rate-limit facts when `account/rateLimits/read` is available; these facts are evidence only and do not currently change candidate ranking. Other richer structured requirements remain planned.

## 3. Broker -> Tutti assignment

Tutti owns the final assignment.

An assignment should eventually freeze a snapshot of:

- Harness/configuration identity, including behavior-changing native mode/profile;
- provider/model/account identity when available;
- capability facts used by the decision;
- context-window/output facts when known;
- resource-fact observation time/source;
- decision reason.

The snapshot is evidence for why the Attempt used that target. Later Broker health changes must not rewrite history.

Current implementation freezes the selected candidate object in the Attempt and also persists an additive `routing_trace` with Broker candidate ids/rejections, actual target/model/effort/decision reason, sanitized resource facts, optional observational shadow advice, and terminal outcome facts. Shadow advice never participates in assignment. Fact freshness metadata beyond the Attempt timestamps/native reset timestamps is not implemented yet.

With more than one qualified Current Harness, candidate ordering is not an assignment policy. Tutti may auto-assign when only one qualified candidate remains or when workflow requirements provide an explicit ordered `preferred_targets` list. Otherwise it returns an ambiguous-assignment condition rather than choosing by target id/order.

Configured targets that expose different native behavior must be distinct routing identities even when they share one executable. The 2026-09-18 Codex proof showed why: Default collaboration mode rejected `request_user_input`, while app-server separately exposes Plan mode. AIDE must not advertise a capability at the generic Harness level when it only exists under one native mode.

Current WorkPackage graph provenance is deliberately small. When Tutti creates a successor through handoff or dual-plan progression, the successor persists a lineage `kind` and `from_attempt_id`. Shared Core verifies that the source Attempt is terminal and belongs to the same Task. This is sufficient to reconstruct Current execution dependencies without inventing a separate graph database or manager. General semantic decomposition decisions remain outside the Current contract.

## 4. Two-phase context materialization

One canonical Context Space does not mean one identical Prompt for all models.

```text
Canonical Context Space
        |
        +-> Routing Capsule   -- small, target-neutral
        |
        +-> Execution Capsule -- after assignment, target-aware
        |
        +-> Retrieval Context -- bounded queries during execution
        |
        +-> Handoff Capsule   -- new session/Harness/recovery
```

### Routing Capsule

Built before target selection. It contains only enough semantic facts to route safely: Goal, requirements, acceptance, bounded Current Truth, and a small set of relevant code references.

### Execution Capsule

Built only after Tutti freezes the assignment. It carries target context-capacity facts and the task-scoped working set.

Context capacity is a ceiling, not a target to fill. A 128k model should not receive 128k merely because it can.

`context_window_tokens` is normalized as the maximum combined request/response context for routing purposes. If a native provider reports a different capacity model, its adapter must normalize or leave this fact unknown rather than changing the meaning of the field.

### Capacity ownership

- Broker owns advertised model/Harness capacity facts.
- Tutti owns context-budget policy.
- Context Fabric owns materialization and bounded retrieval.
- HarnessRouter may observe native usage/capacity telemetry and transport the Capsule.
- Native Harness owns its tokenizer, compaction, and native session context.

If exact capacity or tokenizer information is unavailable, AIDE enters retrieval-first mode and keeps the initial Capsule structurally small. It must not invent token counts.

Current implementation: Routing and Execution Capsules are separate; context-window facts can hard-gate candidates and are carried into a target-aware budget record. Codex execution preserves native `thread/tokenUsage/updated` as an explicitly scoped **thread snapshot** (`last`, `total`, `modelContextWindow`) rather than inventing per-Attempt token counts. Native compaction occurrence is also durable. Exact tokenizer enforcement, proven per-turn deltas, and exact live occupancy/remaining-budget telemetry are not implemented.

Codex native compaction observations are now durable: `contextCompaction` (and deprecated `thread/compacted`) project to Attempt context-health evidence with count/latest turn/source/time. This proves that compaction occurred; it does not prove exact remaining context capacity.

Requested model identity and runtime model identity are distinct facts. A frozen Assignment keeps the requested model; a native `model/rerouted` event updates durable `native_model_state.current_model` and appends the native reason/turn without rewriting Assignment provenance. Native safety reroutes are observational evidence for AIDE, not a signal to countermand provider safety behavior.

Structured model output is also a Harness capability, not Tutti semantics. HarnessRouter may pass an opaque `outputSchema` to a Native Harness; Codex maps it directly to `turn/start.outputSchema`. Tutti must still own the decision about when a decomposition/planning turn is warranted and must validate the returned semantic decision before creating WorkPackages. Merely having a JSON Schema transport does not authorize extra model calls or make decomposition automatic.

Current semantic decomposition uses that boundary without creating a second authority plane. Control may express `decompose=true`; Tutti converts it to capability-only `semantic_decomposition=plan`, routes one read-only planner that advertises both `planning_mode` and `structured_output`, validates the returned JSON, persists one Task `semantic_decision` with planning-Attempt provenance, then creates one execution successor. Every `decompose` step carries one bounded semantic verification postcondition. The single executor receives those ordered steps as canonical context; after mechanical acceptance, Tutti uses the existing read-only semantic verifier to evaluate all step postconditions before closure and persists the step verdicts in Attempt acceptance. Planner-proposed steps are still not independently closable WorkPackages, and AIDE does not infer mid-turn step-transition gating from the executor's own progress claims. Any future promotion to multiple WorkPackages still requires dependency/retry semantics and real evidence that the extra boundary improves reliability.

Semantic Task constraints are Tutti-owned durable WHAT state. They are not Broker requirements and are not acceptance checks by themselves. Control accepts bounded string constraints; Shared Core stores them on Task; Context Fabric carries them into every Routing/Execution Capsule, including handoff and decomposition successors. WorkPackage `requirements` remain reserved for execution/routing needs such as capabilities, target role, approval/sandbox requirements, context/output limits, isolation, and execution strategy.

Semantic acceptance is likewise Tutti-owned. `acceptance.semantic` defines immutable user criteria; a semantic verifier is only an evidence producer. Tutti must first require mechanical acceptance, then validate that reviewer output preserves every original criterion exactly and returns only PASS/FAIL plus reason. Verifier unavailability, malformed output, or a failed criterion prevents closure. For isolated workspaces semantic acceptance occurs before landing. A reviewer may not invent new acceptance criteria, authorize side effects, rewrite Task constraints, or independently mark the Task complete.

Control may express the same intent through top-level `semantic_acceptance`; the transport maps it to `acceptance.semantic` before Tutti sees the Task. It is an ergonomic alias, not a second acceptance source. If both forms provide semantic criteria, the request is rejected as ambiguous.

Model-backed semantic verification is an evidence run rather than a writer Attempt. Broker still hard-gates the dedicated `role=verification` target, HarnessRouter owns the native run, and Tutti persists trusted provenance with the review: target, requested/effective model, reasoning effort, run/session ids, raw usage snapshot, reroutes, and compaction count. The wrapper owns that provenance; model output cannot self-declare its trusted source. Any reviewer side-effect event causes the review to fail closed.

Cross-Harness continuity is derived from durable Work State, not transcript sharing. Routing/Execution Capsules now include bounded prior WorkPackage/Attempt summaries, and Context Fabric exposes `current_truth` plus metadata-only `evidence(taskId)` retrieval. Generic continuity must not leak independent crossfire planner text; planner outputs are a separate explicit consensus channel and become visible to the executor only after planner acceptance.

Current Truth retrieval is provenance-aware. Stored truth updates remain small references plus accepted facts; Context Fabric resolves those references at read time to include Task Goal/Constraints/semantic Decision, accepted verification (including semantic reviewer provenance when present), metadata-only evidence refs, and requested/effective execution model. Do not copy full evidence files or transcripts into Current Truth merely to make context self-contained.

## 5. Context Fabric -> Native Harness

Native Harnesses may retrieve more project context during execution, but the shared surface is read-only project knowledge:

```text
search
symbol
references
dependencies      # planned
read bounded range
evidence lookup   # planned
current truth
```

Writes go through the assigned workspace, never through Context Fabric.

The same query semantics may be exposed using different native transports such as MCP, native tool registration, or adapter RPC. AIDE does not require one universal Harness tool protocol. Current Codex integration uses app-server `dynamicTools` directly; HarnessRouter passes the scoped Context object opaquely, and the Codex adapter translates native tool calls to Context Fabric queries.

Context results must be bounded and scoped to the Project/Attempt. Large artifacts should be returned as references rather than blindly injected into a prompt.

## 6. Tutti -> Workspace / Evidence

Tutti declares intent; Workspace allocates physical space.

Target contract:

```text
WorkspaceRequest
  project
  access: none | read | write
  isolation: shared | attempt
  base revision / expected project state

WorkspaceRef
  stable id
  physical path
  revision/fingerprint
  access/isolation mode
```

Tutti must not invent filesystem paths or own Git worktree mechanics.

For write Attempts, the target default is attempt isolation. One mutable workspace has one writer Attempt.

### Landing boundary

An isolated worktree introduces a state that V0 currently does not model:

```text
Attempt completed
-> Evidence accepted
-> candidate change verified
-> land/merge into Project workspace
-> verify landed state
-> update project Current Truth / close Task
```

AIDE therefore must not auto-create an isolated worktree and then immediately close the Task on candidate acceptance. The current implementation now performs the missing landing boundary for clean Git repositories with a HEAD: detached worktree allocation -> candidate acceptance -> project HEAD/cleanliness check -> binary-diff landing -> landed-diff verification -> project evidence re-collection -> acceptance -> closure. AIDE does not auto-create a Git base commit when HEAD is absent.

## 7. HarnessRouter -> Native Harness

HarnessRouter normalizes lifecycle, not intelligence.

It may own:

- discovery/probe;
- start/continue/status/result;
- process/session handles;
- cancellation transport;
- protocol handshake and event normalization;
- reconnect/timeout mechanics;
- structured runtime errors.

It must not own:

- semantic Task decomposition;
- target selection;
- project Current Truth;
- workspace merge policy;
- universal tool semantics;
- native compaction strategy.

Capability discovery is authoritative. AIDE must not assume that every Harness can resume sessions, emit permission events, guarantee cancellation, expose context usage, or use the same workspace semantics.

Routing strategy is explicit. `execution_strategy=economy|capability` is a selector over configured targets, not a claim that AIDE knows provider billing prices. Broker may use only frozen `strategy_priority` facts; it must not infer cost/capability from lexical model names. `target_role=planning|execution` prevents read-only Plan profiles from entering the normal writer candidate set. A declared `sandbox_mode` is a hard contract fact: unknown or mismatched targets are rejected.

`plan_consensus=dual` is valid only with capability strategy. Planning routing strips execution-only capability/approval requirements, requires `planning_mode + read-only`, and uses exactly two distinct configured planner targets. A planning WorkPackage may complete without closing the parent Task, but Tutti advances only when its Attempt has accepted non-empty output and durable `side_effects=none`. Crossfire planners receive an explicit independent-planning role and must not satisfy executor-only acceptance text themselves; when the Task has a concrete `finalText`, a planner whose entire output equals that executor marker fails `planning_role_separation`. Planner failure, role collapse, or unsafe effects blocks the consensus rather than silently degrading to one opinion.

### 7.1 Run Control and Interaction Contract

AIDE standardizes **control semantics**, not native conversation protocols or transcript formats.

Baseline control verbs are `start`, `continue`, `cancel`, `status`, `events`, and `result`. Optional verbs are capability-gated: `steer -> same_turn_steer`, `respond -> interaction_response`, and `nativePause -> native_pause`.

Target capabilities may also describe `stream_events`, `session_resume`, `permission_requests`, `user_input_requests`, `authentication_requests`, and `background_process_control`.

An adapter must not emulate an unsupported native primitive with a semantically different operation:

- `cancel + new prompt` is not `steer`;
- `cancel` is not `pause`;
- replaying a prompt is not `session_resume`;
- storing a request in AIDE is not proof that the native request can resume after adapter restart.

DSH Headless currently advertises `stream_events`, `session_resume`, and `cancel`, but not `same_turn_steer` or `interaction_response`.

DSH ACP is a distinct configured target using the shipped automation-only ACP v1 stdio surface. It advertises `session_resume`, `cancel`, `interaction_response`, `permission_requests`, and structured generic tool lifecycle events. It does not advertise `same_turn_steer`, user-input elicitation, terminal control, or client filesystem operations. The installed DSH ACP permission bridge currently exposes one-shot native choices only; AIDE preserves the exact ACP option ids and does not infer session-grant support from the broader ACP schema.

The Current DSH Headless and DSH ACP target ids are pinned to `workspace-write`. They do not inherit an ambient `DSH_PERMISSION_MODE` change at run time. A different sandbox/approval mode is behavior-changing target configuration and therefore requires a different configured target identity rather than mutating the meaning of `dsh` or `dsh-acp` after routing.

The desktop-bundled Codex app-server adapter currently maps native `thread/start|resume`, `turn/start|steer|interrupt`, `item/tool/requestUserInput`, command/file/permissions approvals, and legacy command/patch approvals into this control surface. Native server request ids remain opaque `native_request_ref` values; HarnessRouter does not reinterpret permission policy. The Codex Default target advertises permission-request transport but not `user_input_requests`, because the installed runtime explicitly reported that `request_user_input` is unavailable in Default collaboration mode. Configured Plan targets do advertise `user_input_requests` after a real Plan turn proved `request_user_input -> PendingInteraction -> response -> same-turn completion`.

These semantics must remain distinct:

```text
assistant/progress output  -> transient Native Harness event
final result               -> terminal Harness runtime fact
user follow-up             -> new turn or same-turn steer, depending on capability
interaction response       -> answer to one concrete native request
permission approval        -> policy/security decision for one concrete native request
```

Do not flatten them into one generic `message` operation.

When a Native Harness emits a blocking request, Tutti projects it into durable Work State as a `PendingInteraction` with `interaction_id`, `attempt_id`, `run_id`, `kind=user_input|permission|authentication`, `blocking`, opaque `native_request_ref`, and `status=pending|resolved|cancelled|orphaned`.

Approval semantics are **Harness-target native**, not model-name native and not globally normalized. AIDE keeps three different layers:

```text
Assignment.approval_contract
  -> what this configured Harness/profile can do

Attempt.native_approval_state
  -> what this concrete run actually activated

Attempt.approval_validation
  -> durable compatible/incompatible verdict against the frozen contract + WorkPackage approval requirements

PendingInteraction.native_contract
  -> how this exact native request must be answered
```

Broker freezes `approval_contract` into the selected assignment. Profiles/configurations with different approval behavior must be distinct configured targets even when they use the same underlying model. DSH Headless and the Current DSH ACP target already demonstrate this: Headless is non-interactive/fail-closed, while ACP has a native permission answer channel but only one-shot grants. Codex Default and separately configured Codex reviewer/profile targets likewise must not inherit each other's approval contract merely because they share a provider/model family.

The current WorkPackage routing surface uses only comparable policy predicates:

```text
requirements.approval
  interactive?: boolean
  response_channel?: boolean
  unattended_fail_closed?: boolean
  session_grants?: allowed | required | forbidden
  auto_review?: allowed | required | forbidden
```

`allowed` is the absence of a hard restriction. `required`/`forbidden`, and boolean `true` requirements, depend on explicit target facts; missing facts reject that target as unknown. These routing modes are policy predicates only and do not define provider response vocabularies such as Codex `acceptForSession` or DSH one-shot outcomes.

After start/resume, routing eligibility is rechecked against reality. The adapter emits actual approval state. Tutti first checks configured invariants whose meaning is exact across contract and runtime: provider, transport, profile, behavior, pinned sandbox mode, stable response/grant capabilities, and membership of actual policy/reviewer values in the frozen supported sets. It then re-applies the WorkPackage approval predicates to concrete activation state.

Capability and activation are not symmetric. For example, `approval_contract.interactive=true` means the target can provide an interactive approval path, while `native_approval_state.interactive=false` may be a legitimate concrete run when a supported non-interactive policy is active. That is not contract drift by itself; it becomes an error when the WorkPackage required interactivity. Conversely, a target declaring `interactive=false` or `auto_review=false` may not report those features active at runtime. This keeps target capability selection separate from per-run activation without weakening fail-closed requirements.

Any invariant mismatch, unsupported native policy/reviewer value, or requirement incompatibility is persisted as monotonic `approval_validation.compatible=false`; native cancellation is requested, and that Attempt is never eligible for acceptance, isolated landing, or Task closure. A later apparently compatible event cannot erase an already-observed incompatibility.

Configured Codex sandbox invariants include both the normalized sandbox mode and, when frozen by the target, native `networkAccess`. Current Plan targets require `read-only + network_access=false`; current economy/capability targets use `workspace-write + network_access=true`. This is a target fact, not a generic assumption about all Codex profiles.

For a configured target, a native `completed` result is not sufficient proof by itself. If no `approval_state` was observed at all, Tutti records `approval_validation.compatible=false` with `unknown:approval_state` and rejects the Attempt before evidence acceptance or landing. `native_approval_state` remains `null`; AIDE does not invent an empty/native-default state to satisfy the invariant.

Only comparable facts are normalized. Provider-native fields remain present in `native_approval_state`. Current Codex normalization includes whether the actual reviewer/policy combination is human-interactive, response/session-grant capability, whether auto-review is actually selected, and normalized sandbox mode; DSH Headless and DSH ACP report their pinned sandbox modes as well. A WorkPackage may hard-require `sandbox_mode`; unknown or mismatched target/runtime facts fail closed rather than being inferred from provider names.

Shared `kind=permission` means only "this is a blocking policy/security interaction". It does **not** define the answer vocabulary. The adapter-owned `native_contract` defines that vocabulary/shape. Current Codex examples include `accept|acceptForSession|decline|cancel`, structured command policy amendments, native `{permissions, scope}` grants, and legacy approval decisions. DSH Headless exposes no answer channel and fails closed. DSH ACP instead exposes ACP `session/request_permission`; AIDE stores its advertised native option ids/kinds and replies with ACP `{outcome:selected, optionId}` or `{outcome:cancelled}`.

For DSH ACP side-effect projection, generic ACP `tool_call` alone is not enough to prove workspace confinement because the installed bridge reports tool kind as `other`. AIDE narrows only the installed fs `write`/`edit` calls when three facts agree: configured mode is pinned `workspace-write`, no per-call wider `sandbox_permissions` request is present, and the native `rawInput.file_path` resolves under the Attempt cwd. This matches the installed `dsh-fs-sandbox` contract, whose `workspace-write` backend canonicalizes mutations against the session workspace. Paths outside the Attempt cwd, wider escalation, shell/web/jobs/unknown tools, and any other uncertain case remain `external_possible`.

Shared Core persists the record; Tutti owns the answer/approval policy; HarnessRouter only transports the native response. A persisted PendingInteraction does **not** prove that the native responder is still valid. If its source Attempt terminates first, AIDE marks the interaction `orphaned`; reconnect may rebind only when the adapter explicitly proves the native request is replayable.

Semantic waiting and physical pause are separate. Tutti may later represent `waiting_input`, `waiting_permission`, or `waiting_external`, but HarnessRouter exposes `native_pause` only when the Native Harness truly supports it. For long waits, persist Work State, let the Harness stop when safe, then wake via compatible resume or a new session plus Handoff Capsule.

Restart recovery is transport-specific but now converges on one Current policy: quiescence before replacement execution. Codex has a reconnectable thread protocol, but a real active-turn crash/reconnect proof showed that loss of the owning app-server changes the old turn to `interrupted`; only completed rollout history is resumable for later turns. DSH Headless/ACP use AIDE-owned stdio children whose live pipes and outstanding ACP JSON-RPC requests are not reconnectable after the owner dies. Therefore AIDE does not promise live turn/request rebinding for either transport; it persists identity/evidence, fences while the old process group is alive, then abandons or safely reroutes/continues after quiescence.

## 8. Session and handoff boundary

Native session/thread ids are opaque runtime references, not canonical shared memory.

Resume is allowed only when the selected Harness/configuration and workspace are compatible with the original session. A provider session must not be silently resumed against a different workspace or incompatible configuration.

Session ids and local runtime ownership are persisted while execution is active. The architecture contract is **owned process tree + same-host quiescence evidence**, not POSIX process groups specifically. Current POSIX adapters implement this with `pid + process_group_id + hostname`; same-host recovery checks the whole owned group first and falls back to primary PID only for older/non-group records. Current Windows adapters persist `pid + process_tree_root_pid + hostname`; recovery queries the live Windows process tree through CIM and only accepts `local_process_tree_exit` after no root/descendant remains. Windows cancellation requests native whole-tree termination. Legacy Windows Attempts that persisted only a parent PID fail closed with `RECOVERY_PROCESS_TREE_OWNERSHIP_REQUIRED` rather than assuming descendant exit.

Platform-specific executable locations, state roots, process-control primitives, and native launcher details belong below Tutti/Broker/Shared Work State. They may differ between Ubuntu and Windows, but Assignment, Attempt, PendingInteraction, Evidence, and recovery semantics must not fork by OS.

### Service lease boundary

Transport connections are not service ownership. One local AIDE Project service must hold the Shared Core `ServiceLease` before serving Control requests. The service renews that lease independently of any HTTP/MCP connection, so client disconnect does not release Task ownership.

On graceful shutdown the service first fences/aborts supervisors, waits for them to stop, and only then releases the lease. Stale takeover checks the recorded PID when the old owner is on the same host. This is a single-host safety primitive, not a multi-host distributed lock.

HTTP/Plugin and MCP are transport adapters over the same `AideServiceRuntime`; they must not maintain a second Task ledger, hidden retry state, or protocol-specific Harness assignment.

### Management UI boundary

The local management page is another client of the same Control/runtime boundary. It may present a richer Conversation timeline and settings experience, but browser state is never orchestration authority.

- Conversation identity/ordered Task references/default launch preferences belong to Tutti/Shared Core, not browser local state and not a provider-native session.
- An ordinary composer send creates the next Task when the Conversation is idle/terminal. It is not silently reinterpreted as native steering.
- Steering is a distinct action and is enabled only when the active frozen assignment advertises same-turn steering.
- Pending user-input/permission/authentication requests use the existing PendingInteraction response path and provider-native `native_contract`; the UI must not normalize them to a universal allow/deny shape.
- Model/profile/mode changes during an active Attempt never mutate that frozen Assignment. They become defaults/preferences for the next eligible Task/Attempt.
- UI settings and provider credentials are configuration state, not Task/Attempt/Current Truth. Stored secrets must never be returned to the browser after write or copied into Work State.

The model/account surface must consume Broker/provider catalog facts rather than construct a second model registry. A UI-selected target/model is an operator preference subject to the same Broker hard gates and Tutti assignment freeze as any other client. If qualification fails, Control returns the reason; the browser must not silently choose another target.

Overview/dashboard aggregation is presentation only. The browser may summarize existing Control facts such as active Task counts, available targets, connected providers, and recent routing, but those summaries are not durable routing evidence and must never become an alternate policy engine, cache of provider truth, or source for Assignment decisions.

Preflight is also presentation/control preparation rather than execution. `aide_preflight` / `/v1/preflight` must share Tutti's normal request validation and Broker qualification but may not create Task/WorkPackage/Attempt records, allocate isolated workspaces, consume a model call, or start/continue a Native Harness. A successful preflight is not authorization to execute; later submission still freezes a new Assignment against then-current facts.

Native continuation has session affinity. Once HarnessRouter observes a native `session_id` for a configured target, a continuation without an explicit target inherits that target. A caller that explicitly requests a different target for the same known session is rejected; cross-Harness continuation is not emulated as session migration.

Current Codex account control is a provider-owned native configuration seam: AIDE transports native account status/login/cancel/logout and exact model-directory facts but does not become the credential store. API-key values are write-only input and must disappear at the provider call boundary; OAuth/device login flow state is operational process state, not Shared Work State, and is cancelled on service shutdown. A service restart may therefore require a fresh login attempt. This is preferable to persisting provider secrets or inventing an AIDE auth database.

Exact model/effort selection is also bounded by the target/profile contract. In the Current slice it is legal only for Direct execution with exactly one explicit target profile that advertises a verified model directory. Broker validates the model and its exact effort, including model-dependent capabilities; Tutti freezes the resulting Assignment; HarnessRouter transports it. The override changes neither target identity nor its sandbox/approval contract. Multi-stage Decompose/Crossfire workflows reject this direct override rather than ambiguously applying one model choice to planner/executor/reviewer stages.

DSH's installed authorization/settings/credential packages are Reference, not AIDE runtime dependencies. Until the AIDE DSH adapter exposes an equivalent stable public seam, DSH account/model configuration remains Native-managed and the UI must say so explicitly.

Harness-native mode/preset controls remain provider-specific. The UI may render Codex collaboration modes, DSH Plan mode, DSH agent presets, permission profiles, or future equivalents only when the selected target advertises the corresponding native capability/configuration contract. There is no global cross-provider `mode` enum.

### Submission idempotency boundary

Network retry identity is explicit, not inferred from message text. HTTP callers may provide `Idempotency-Key`; MCP `aide_submit` may provide `client_request_id`. Shared Core hashes the opaque client key and atomically persists the mapping together with the initial Task + WorkPackage.

The same client key may replay only the same semantic submission fingerprint (objective, acceptance, effective requirements, execution workspace identity). Reuse for different semantics is a conflict. A replay of an existing Attempt returns that Task/Attempt identity and must not re-run Broker assignment against today's candidate set.

No key means no exactly-once guarantee: AIDE treats each submission as new work.

If resume is unavailable, unsafe, or the Harness changes:

```text
old Native Session
-> Evidence + Current Truth
-> Handoff Capsule
-> new Native Session
```

Do not synchronize full transcripts between Harnesses.

## 9. Cancellation and timeout boundary

These states are distinct:

```text
running
-> cancelling / cancel_requested
-> cancelled (observed terminal result)
```

Sending a cancel request is not proof that the process stopped. While cancellation is pending, writer ownership remains held and the workspace must not be reassigned.

If a target only supports best-effort cancellation, non-idempotent external actions must either be rejected by routing policy or wrapped in an idempotent/compensatable operation.

Current implementation now preserves `cancelling` as non-terminal and waits for a terminal Harness result before releasing the Attempt.

## 10. Retry and reroute boundary

A retry is a new Attempt, never a rewrite of the previous Attempt.

Safe reroute depends on how far the failed Attempt progressed:

- before start / no side effects observed -> reroute may be automatic;
- workspace mutation observed -> collect evidence and use a new isolated workspace before rerouting;
- external non-idempotent side effect possible -> do not silently reroute;
- repeated same-path failure -> stop patching and return to investigation/planning.

Broker may provide a new candidate set; Tutti decides whether retry/reroute is semantically valid.

Attempt side-effect classification is durable and conservative: `unknown`, `none`, `workspace_only`, or `external_possible`. Evidence may only increase the risk envelope; a later weaker observation cannot downgrade it. Native adapters may emit structured side-effect observations, but HarnessRouter does not interpret them.

For Codex native `fileChange`, `workspace_only` requires path evidence, not just the item type. Every native `changes[].path` must resolve inside the active Attempt cwd. Missing or escaping paths are `external_possible`. `item/fileChange/requestApproval` preserves the native `itemId` and `grantRoot`; an automatic/local policy may approve only when the request can be correlated to already-observed safe file-change evidence for the same item and any non-null grant root stays inside the same WorkspaceRef.

### Automatic cross-Harness handoff

Automatic model-to-model continuation is allowed, but Native Harnesses do **not** directly spawn one another.

```text
Native Harness
-> terminal result / structured handoff or escalation request
-> Tutti validates Task state + side effects + policy
-> Broker recommends qualified alternate targets
-> Tutti freezes the new assignment
-> new WorkPackage / Attempt
-> HarnessRouter starts the next Native Harness
```

This path may run without human assistance when all policy gates are already satisfied. Human approval is reserved for explicit boundaries such as permission escalation, irreversible external side effects, or configured budget limits.

V0 automatic handoff requires the source Attempt to be terminal before a successor starts. This preserves one-writer ownership and avoids treating a handoff request as proof that the source process has stopped. By default the source target is excluded from the handoff Broker query; same-target retry is a separate policy decision.

Terminal status alone is not sufficient for automatic handoff. Before Broker is queried, Tutti requires durable side effects to be `none`, or `workspace_only` while still contained in an unlanded isolated WorkspaceRef. `unknown` and `external_possible` return `HANDOFF_SIDE_EFFECTS_UNSAFE`. This applies equally to timeout-driven terminal attempts and ordinary rejection/failure.

This boundary now has a real mutating proof: DSH ACP produced a contained `workspace_only` source mutation in an isolated WorkspaceRef, Tutti left that source unlanded, a Codex successor ran in a new isolated WorkspaceRef, and only the accepted successor landed. This proof does not generalize to external side effects.

The main-entry runner now drives this loop without transport assistance. Successor WorkPackages inherit the previous requirements and accumulate excluded target ids. A Tutti-initiated timeout cancellation may continue to another qualified Harness; an explicit user cancellation stops automation. If no qualified or unambiguously selectable successor exists, Tutti returns a structured blocked boundary rather than creating an unused ready WorkPackage or guessing a target.

### Detached recovery boundary

An active durable Attempt with no live Router run is detached, not failed and not resumed. V1 exposes two explicit recovery actions after quiescence is established:

- `abandon` -> mark the detached Attempt failed with recovery provenance and stop there;
- `reroute` -> allowed when persisted side effects are `none`, or when they are `workspace_only` and remain contained in an unlanded isolated WorkspaceRef; then mark the source terminal and reuse the ordinary Tutti handoff path.

For a same-host Attempt with a persisted owned process-group id, Tutti checks the whole group first. A live group fences recovery even if the primary PID already exited or a caller claims quiescence; group exit can satisfy the local gate without a caller assertion. Older/non-group Attempts fall back to the persisted primary PID. If local ownership identity is unavailable or belongs to another host, an explicit quiescence assertion is still required. This still does not claim that a descendant which deliberately escaped into another session/process group has exited.

Native `resume` is intentionally not synthesized for detached in-progress work. A session id alone is insufficient proof that takeover is safe.

Cross-Harness continuity comes from Current Truth, Evidence, WorkPackage state, and a Handoff/Execution Capsule. Native session IDs remain opaque and are never migrated between Harnesses.

## 11. Permission and approval boundary

Native Harness owns enforcement of its native permission/tool model.

HarnessRouter may transport permission-request events. Tutti/workflow policy decides whether an approval is allowed or requires human attention. Broker may hard-gate candidates that cannot surface required approval events.

Permission, user-input, and authentication requests use the durable PendingInteraction path. Automatic resolution is allowed only when explicit workflow policy or Current Truth makes the answer unambiguous and safe.

Do not implement approve-everything in HarnessRouter and do not flatten all native permission models into one tool schema.

## 12. Evidence and acceptance boundary

Harness completion is a runtime fact, not semantic success.

```text
Harness result
       +
Workspace Evidence
       |
       v
Tutti Acceptance
```

Only Workspace/Evidence asserts physical facts such as files, hashes, diffs, tests, logs, and artifacts. Tutti owns acceptance criteria and the semantic closure decision.

Agent claims never substitute for evidence.

## 13. Event durability boundary

Not every stream event belongs in durable Work State.

- transient text/token deltas may remain in HarnessRouter/native buffers;
- assistant/progress output remains transient unless an explicit product/audit requirement promotes it;
- blocking user-input/permission/authentication requests are durable PendingInteractions;
- stable lifecycle outcomes, session refs, structured errors, evidence refs, verification, and decisions belong in durable Work State when needed for recovery/audit;
- UI rendering state is never architecture truth.

Progress events should describe facts rather than presentation instructions.

## 14. Routing race and stale facts

Resource state can change between recommendation and start.

If start fails because availability/quota/auth facts changed, HarnessRouter returns a structured start failure. Tutti may ask Broker for new candidates only after it knows whether the failed Attempt could have produced side effects.

Future Broker facts should carry observation time/source. Stale resource facts must not be treated as permanent target properties.

## 15. Context drift during an Attempt

Routing Context indexes the Project root. Execution Context is now re-materialized after WorkspaceRef allocation and indexes the actual Attempt workspace.

Before Native Harness on-demand retrieval is enabled for isolated write workspaces:

- the Execution Capsule identifies both `project_root` and the active `workspace_ref_id`/workspace root;
- retrieval during a write Attempt must use a Context Fabric view derived from that WorkspaceRef;
- stale Context results must never silently overwrite fresher Workspace Evidence.

## 16. V1 next boundaries to implement

In order:

The first interaction-supervision baseline is implemented locally: normalized `interaction_request` events can become durable PendingInteractions, Attempts enter `waiting_input|waiting_permission`, answers resume the same Attempt, and durable event cursors detect replay/gaps. Codex app-server is connected to this surface. One real Default-mode turn proved that `request_user_input` is mode-gated rather than universally available. Isolated Git worktree allocation/landing and WorkspaceRef-scoped execution context are also implemented. A thin `AideControl` facade delegates all workflow semantics to Tutti so future MCP/Plugin adapters share one backend contract.

1. thin MCP/Plugin transport adapters over `AideControl` once the backend service lifecycle is selected;
2. preserve the now real-proven model-selected `aide_context` dynamic-tool contract and fail closed if future native protocol changes remove it;
3. keep configured-target collaboration semantics separate: Default has no `user_input_requests`, while Plan now has real `request_user_input -> PendingInteraction -> response -> same-turn completion` proof;
4. durable handoff/escalation request record; automatic successor orchestration is implemented locally;
5. richer retry/reroute policy after side-effect classification;
6. context-health/tokenizer integration only where a real adapter exposes it.

Do not add a mailbox, distributed queue, vector database, universal session object, or generalized workflow engine before these boundaries are exercised by two real Harnesses.
