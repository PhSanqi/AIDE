# AIDE Architecture Synthesis

Status: **Target/reference synthesis** reconciled with implementation evidence. For the Current runtime graph and prioritized gaps, use `CURRENT_ARCHITECTURE.md`.

Architecture/Current-Truth memory: Memhub project `aide`.

Project/reference ownership detail: `PROJECT_RESPONSIBILITIES.md`.

Cross-module ownership/failure contract: `BOUNDARY_CONTRACTS.md`.

Implementation discipline: `EXECUTION_STRATEGY.md`.

## 0. Source-of-Truth hierarchy

Use these sources for different questions:

| Question | Source |
|---|---|
| What architecture are we trying to build? | Original Multi-Harness Engineering Orchestration Architecture Guide + this document |
| What architecture is actually running now? | `CURRENT_ARCHITECTURE.md` |
| Which runtime module owns a state/responsibility? | This document + `PROJECT_RESPONSIBILITIES.md` |
| Is a local/open-source project a runtime dependency or only a reference? | `PROJECT_RESPONSIBILITIES.md` |
| What is actually implemented/verified now? | `CURRENT_TRUTH.md` |
| How do context/session/workspace/cancel/retry/evidence boundaries behave? | `BOUNDARY_CONTRACTS.md` |
| What should be implemented next and how minimally? | `EXECUTION_STRATEGY.md` |
| Is the architecture/Current Truth consistent with recent project decisions? | Memhub project `aide` + Current repo docs/code/tests |

No Current implementation may silently redefine target ownership. If Current evidence shows the target is wrong, update the architecture explicitly rather than letting implementation drift become the new design.

## 1. Original architecture intent

The original architecture guide defines the system around one shared Work State and multiple independent Native Execution States.

The intended responsibility chain is:

```text
WHAT  -> Tutti
WHO   -> Broker recommends, Tutti decides
RUN   -> HarnessRouter
HOW   -> Native Harness
PROVE -> Workspace / Evidence
```

That split remains the AIDE target.

The implementation should be physically simple in V1: logical separation, one local daemon/process unless a real deployment need appears.

Platform topology is also one-product, not two-product: AIDE keeps one Tutti/Broker/Shared-Core/UI architecture and one codebase, with a deliberately small platform/runtime layer for Ubuntu Linux and Windows. Ubuntu is the primary development/proof platform; Windows is a first-class deployment target and must receive equivalent runtime discovery, process ownership/recovery, workspace, and Native Harness validation. Platform mechanics must not fork semantic work state or routing ownership.

## 2. What each of the three parts contributes

### 2.1 Tutti contribution — Work / Context / Decision continuity

Useful ideas retained:

- Goal and acceptance conditions;
- Current Truth;
- Task Graph and dependencies;
- Decisions and constraints;
- Context Capsules rather than full transcript sharing;
- failure/rejected-assumption history when relevant;
- semantic review and verification policy;
- cross-Harness handoff;
- final update of shared state after evidence is accepted.

Tutti answers: **what work exists, why it exists, what is currently believed true, and what must happen next?**

Tutti is not a process manager and does not care how Claude Code/Codex internally execute.

### 2.2 Broker contribution — Resource / Capability intelligence

The original target gives Broker a narrower role than the Current Broker implementation: Broker is primarily the resource/routing oracle.

Useful ideas retained from the target:

- Provider / Account / Harness / Model availability;
- quota and reset state;
- health and current load;
- cost and latency when available;
- historical success/rework/verification outcomes;
- hard capability gates before ranking;
- explainable candidate ranking;
- routing history and user override evidence.

Useful mechanisms learned from the Current Broker implementation:

- explicit Task / WorkPackage / Attempt separation;
- frozen execution assignment per Attempt;
- one-writer lease invariant;
- durable cancellation/recovery bookkeeping;
- deterministic validation patterns;
- safe bounded evidence/audit records;
- semantic authority separated from execution permission.

These mechanisms are reusable **patterns**, not proof that Broker should own every one of those target states.

Broker answers: **given this Task requirement and the live resources, which execution targets are qualified and what are the tradeoffs?**

Final assignment remains a workflow decision owned by Tutti.

### 2.3 HarnessRouter contribution — Native execution lifecycle

Useful ideas retained:

- start / continue / cancel / status / result;
- capability-gated steer / interaction response;
- process ownership;
- transport/protocol lifecycle;
- native session/thread reference;
- streaming normalized lifecycle events;
- timeout, reconnect, exit and failure normalization;
- runtime discovery and capability observation.

HarnessRouter must not normalize away the strongest parts of a Harness.

Claude Code/Codex keep:

- native Agent Loop;
- native context/session;
- native compaction;
- native tools;
- native permission model where safe;
- native subagents/delegation.

HarnessRouter answers: **how do we reliably start and observe this chosen Native Harness without becoming the Harness itself?**

HarnessRouter also owns the OS-specific execution mechanics that cannot be shared safely. The semantic run contract remains identical, while executable discovery, process-tree ownership/termination, and native runtime probing may use different Linux/Windows mechanisms. POSIX process groups are one implementation of process-tree ownership, not the architecture contract itself. The Current Windows V1 counterpart persists a process-tree root, queries descendants through CIM, and requests whole-tree termination with `taskkill /T`; full Windows parity still requires running the same AIDE checkout/service/tests on that host.

AIDE standardizes only a small run-control contract. `steer`, `respond`, and native pause are optional capabilities, not universal promises. Assistant output, terminal runtime result, user follow-up, and permission/user-input responses remain distinct semantics. Durable blocking requests are owned by Tutti/Shared Work State as PendingInteractions; HarnessRouter only transports the corresponding native request/response.

Current Linux discovery gives two concrete adapter shapes:

- **DSH**: executable launcher with a `headless` profile supporting stdin, machine-readable `--json` run events, and `--session-id` continuation. This is the shortest path for proving process/result/session lifecycle.
- **DSH Headless interaction boundary**: current verified control is batch-oriented `start/stream/cancel` plus later `session_resume`; same-turn steer/respond are not advertised. An interactive DSH surface should come from its native ACP path rather than emulation inside HarnessRouter.
- **Codex Desktop**: desktop application with a bundled Codex runtime exposing `app-server`. HarnessRouter should target that native protocol/runtime rather than automate the GUI. The bundled runtime is part of the desktop installation and is not treated as a separately installed standalone CLI.

## 3. Combined AIDE architecture

```text
                         User
                          |
                  Unified Web / CLI
                          |
                          v
                       Tutti
        Intake / Goal / Current Truth / Task Graph / Decisions
        Context Fabric / Capsules / Verification / Handoff
                          |
             requirements + workflow policy
                          |
                          v
                       Broker
      availability / health / quota / capability / history
             hard gate + explainable candidates
                          |
                    recommendation
                          |
                          v
                 Tutti assignment
                          |
                          v
                   HarnessRouter
        process / session / protocol / lifecycle
                          |
              +-----------+-----------+-----------+
              |                       |           |
              v                       v           v
             DSH                 Codex Desktop  Claude Code
          Native Loop             Native Loop   Later/optional
              |                       |           |
              +-----------+-----------+-----------+
                          |
                          v
                 Workspace / Evidence
          worktree / diff / tests / logs / artifacts
                          |
                          v
                       Tutti
                 update Current Truth
```

### 3.1 Desired user-facing execution path

The intended product experience is one logical entry point, not a manual Harness selector for every message:

```text
User message
-> Unified Control entry (MCP / Plugin / Web / CLI adapters)
-> Tutti Intake creates Task / WorkPackage / Acceptance / capability requirements
-> Context Fabric prepares a small target-neutral Routing Capsule
-> Broker hard-gates and recommends qualified execution targets
-> Tutti chooses an assignment using workflow / verification policy
-> Workspace allocates/binds the Attempt workspace
-> Context Fabric materializes the target-aware Execution Capsule against that WorkspaceRef
-> HarnessRouter starts the selected Native Harness
-> Native Harness executes against the assigned workspace
-> Native Harness retrieves more context on demand from the same WorkspaceRef-scoped Context Fabric
-> Workspace / Evidence records physical results
-> Tutti accepts/reworks, updates Current Truth, and closes or creates the next WorkPackage
```

When another Harness is needed, the current Native Harness may request handoff/escalation but must not spawn a peer directly. Tutti validates Task/policy/side-effect state, Broker supplies alternate candidates, Tutti freezes the successor assignment, and HarnessRouter starts the next Attempt. This path may be fully automatic when no permission, irreversible-side-effect, or configured-budget boundary requires human approval.

Configured target identity includes execution/approval profile, not merely the underlying model name. Every selected assignment freezes an adapter-declared `approval_contract`; the running Attempt separately records the native approval state actually returned/activated by the Harness. A pending approval then carries its own provider-native response contract. Transport/UI code must render those contracts rather than invent one universal allow/deny/always vocabulary.

The implemented main-entry runner now performs this successor loop itself. One `AideControl.submit()` delegates to Tutti `runTask()`, which may execute multiple Attempts under the same Task. Requirements are inherited across successor WorkPackages, used targets accumulate in `exclude_targets`, internal timeouts may trigger another qualified Harness, explicit user cancellation stops the chain, and blocked routing is surfaced rather than guessed.

The user should normally interact with the **main entry**, not with Broker or HarnessRouter directly.

The backend service lifecycle is explicit. One local Project service owns an atomic filesystem `ServiceLease`; `AideServiceRuntime` renews it, fences long-running supervision with an AbortSignal, and releases the lease only after tracked supervisors/operations have stopped. `enqueue()` returns `task_id`/`attempt_id` after the first Attempt starts and keeps Tutti supervision alive independently of the transport request.

HTTP/Plugin and MCP are thin adapters over that same service runtime. They do not own Tasks, retries, Harness selection, or workspace state. The modern MCP endpoint is intentionally stateless at the protocol layer; AIDE state remains explicit through Task handles in Shared Core.

Retry identity is also part of Shared Core, not transport memory. A client-supplied request id is atomically bound to the initial Task + WorkPackage and a semantic fingerprint; replay returns the existing Task and cannot re-run current Broker assignment for an already-started Attempt.

Current code now implements the local **full orchestration baseline** through `TuttiIntake.submitAndRun()`: one message creates Task/WorkPackage state, Context Fabric creates Routing Context, Broker consumes the live Harness probe, Tutti chooses the assignment, Workspace binds a direct or isolated WorkspaceRef, Context Fabric re-materializes the target-aware Execution Context against that actual workspace, an Attempt starts through HarnessRouter, Evidence is collected, landing is enforced for isolated work, Tutti verifies it, and accepted work updates Current Truth/closes the Task. `AideControl` is a thin shared control facade over Tutti for `submit/observe/respond/steer/cancel`; transport adapters must not duplicate workflow state.

Transport clients should prefer Task identity over Attempt identity. Shared Core can derive a durable Task view (WorkPackages, Attempts, active/latest Attempt, pending interactions), while Tutti enriches it with current runtime attachment state. Native session ids are persisted during execution; if a service restart loses the in-memory Router run, the Task is reported as detached/recovery-required instead of being silently resumed.

The current `ServiceLease` is a **single-host filesystem lease**. It prevents two local service processes from owning the same Project, including stale takeover checks against the recorded local PID. Multi-host active/active deployment needs a distributed fencing primitive before shared writable Work State is safe.

Detached native work is handled conservatively. A durable active Attempt whose Router handle disappeared is surfaced as recovery-required. Attempt side-effect risk is persisted as a monotonic fact with evidence, and current POSIX adapters persist an owned process-group id in addition to the primary PID/hostname. V1 never guesses native resume: Tutti may abandon after quiescence, or reroute only when persisted effects are `none` (or `workspace_only` while still contained in an unlanded isolated WorkspaceRef). Same-host process-group exit is the strongest current local proof; primary PID is fallback for older/non-group Attempts.

The automatic successor topology has real control and mutation proofs. DSH -> Codex and Codex -> DSH both completed through Tutti with isolated WorkspaceRefs and successor Capsules carrying the source target in `exclude_targets`. A later real `DSH ACP -> Codex` run proved contained mutation continuity: the DSH source produced `workspace_only` file evidence and remained unlanded; the Codex successor used a separate isolated workspace, its native file-change paths were verified inside that workspace before approval, and only the accepted successor was landed. Opaque `unknown` or `external_possible` source Attempts still block before a successor is created.

### 3.2 Execution strategy and planning consensus

Model choice is a configured-target policy, not a second authority plane. WorkPackages may declare `execution_strategy=economy|capability`; Broker orders only from explicit target `strategy_priority`, then Tutti freezes the assignment. Each strategy-specific target declares only its own strategy priority, so loss of `codex-economy` cannot silently select `codex-capability` and vice versa. The local service defaults to economy so an omitted setting cannot silently select the highest-consumption profile. Per-task HTTP/MCP strategy overrides that deployment default, while explicit `preferred_targets` remains the stronger operator decision.

Capability mode may additionally request `plan_consensus=dual` (`crossfire=true` at the transport surface). Tutti reuses the ordinary durable graph rather than creating a hidden workflow engine:

```text
Task
 -> read-only Planning WorkPackage / Attempt (Sol / medium)
 -> read-only Planning WorkPackage / Attempt (Sol / high)
 -> Execution WorkPackage / Attempt (Sol / ultra capability executor)
 -> Evidence / acceptance / closure
```

The two planners receive the original Current Truth/Context independently and do not see one another's output. Both must produce substantive independent plans with `side_effects=none`; the current semantic contract rejects executor-marker collapse and requires role-separated planning output. Their WorkPackages complete without closing the Task. The executor receives both prior plan texts as explicitly non-authoritative planning opinions and reconciles disagreements against current evidence before execution. There is still exactly one execution writer Attempt. This current all-Sol path has a real semantic smoke proof; the earlier Astra-based run is Legacy/reference evidence only.

### 3.3 Local management UI and conversation shell

The primary human entry point should be a local management page served by the same AIDE Project service, not a second daemon or a browser-owned workflow engine:

```text
Browser
  |
  v
AIDE Management UI  http://127.0.0.1:8711/
  |
  +--> Conversation / Task control
  +--> Models / Accounts / Modes settings
  +--> Runtime / approval / verification inspector
  +--> Routing history / replay diagnostics
  |
  v
AideControl / AideServiceRuntime
  |
  +--> Tutti -------- WHAT / Conversation / Task / verification
  +--> Broker ------- WHO / provider-account-model catalog / routing facts
  +--> HarnessRouter  RUN / native lifecycle and capability observation
  +--> Native Harness HOW / native session / mode / tools / permissions
```

The browser is a presentation/control client. It must not keep a second Task ledger, decide assignment, invent native approval semantics, or own provider sessions. V1 should serve static HTML/CSS/JS from the existing Node service and reuse the same authenticated HTTP control surface used by other clients; a separate frontend service or framework build chain is unnecessary until the UI itself proves that need.

#### Human-facing Conversation

The management page needs a durable human-facing `Conversation` scope above individual Tasks. Tutti/Shared Core owns this scope because it is continuity of user intent, not a Native Harness session. A Conversation should stay deliberately small: identity, project/workspace identity, title/archive state, ordered Task references, and default launch preferences. It must not duplicate the full transcript or treat a provider thread/session id as canonical memory.

Each composer action has an explicit semantic path:

- idle/terminal Conversation + ordinary send -> create the next Task linked to that Conversation;
- active Attempt + explicit **Steer current** -> use native steering only when the frozen assignment advertises it;
- pending permission/input/authentication -> render the PendingInteraction's provider-native contract and use the dedicated respond path;
- active Attempt without native steering -> queue or defer the next user Task rather than pretending a new message was injected into the running native turn;
- completed Task follow-up -> create a new Task in the same Conversation, carrying continuity through Current Truth / Evidence / bounded prior Task context rather than raw native transcript synchronization.

The timeline may visually interleave user submissions, progress, plans, terminal answers, approvals, semantic-review cards, step-verification results and Current Truth commits, but those remain typed records. The UI must not collapse progress output, terminal result, follow-up, steering and interaction responses into one generic message API.

#### Model, provider and account control

The model picker should borrow DSH's useful product semantics: one provider-grouped live catalog feeds both the new-Conversation composer and the Models settings page; model selection may expose only reasoning-effort values actually advertised for that exact model; a changed selection applies to the next Task/Attempt and never mutates an already frozen Assignment or an in-flight native turn.

Broker owns the provider/account/Harness/model facts behind that catalog. The UI may request one of three levels of intent:

1. **Auto / default** — use the configured AIDE strategy and Broker recommendation;
2. **strategy/profile** — e.g. economy/capability or a named configured target profile;
3. **explicit qualified target/model preference** — only among the live catalog entries Broker says are currently selectable.

An explicit UI selection is an operator preference, not permission to bypass hard capability/approval/sandbox gates. Tutti still freezes the actual Assignment after Broker qualification. If a requested model/profile is unavailable or incompatible, the UI shows the rejection instead of silently substituting another consumption/capability class.

Provider/account setup is a configuration plane, not Work State. AIDE should copy DSH's security boundary rather than its Cordis implementation: list provider/account availability, expose provider-owned authorization methods, render generic notice/prompt/select/secret interactions, and let the provider integration commit the credential. API keys are write-only; stored secrets are never returned to the browser or copied into Task/Attempt/Current Truth state. Browser refresh may restart an in-progress authorization flow in the first slice; durable auth-flow recovery is a later requirement only if real use makes that interruption costly.

#### Mode control

The management UI must keep three different kinds of "mode" visibly separate:

- **AIDE orchestration mode** — Task policy such as Direct, Decompose, or Crossfire; Tutti owns the semantics and validates legal combinations;
- **configured target/profile** — economy/capability, sandbox/approval profile, model and effort; Broker qualifies it and Tutti freezes it per Attempt;
- **Native Harness mode/preset** — provider-specific controls such as Codex collaboration mode or DSH Plan / agent preset; the Native Harness owns semantics, and AIDE exposes only options that the adapter has actually observed and declared.

Do not create one global `mode` enum that pretends these are interchangeable. DSH Plan mode is a useful UX reference: mode state can be visible and durable for the next request/session, while safety still comes from sandbox/approval controls rather than prompt text. DSH agent presets are also a useful reference for "new Conversation only" configuration: once execution has produced content under a native composition, AIDE should not silently swap the underlying tool/preset composition mid-Attempt.

#### Management-page information architecture

The target navigation is intentionally small:

```text
Conversations   -> create/open/archive; chat timeline + composer
Tasks           -> active/recent Task status and recovery-required work
Models & Accounts -> providers, login/API-key status, model catalog, defaults
Harnesses & Modes -> target profiles, native capabilities, presets/modes, approval policy facts
Routing         -> actual vs shadow, routing history, offline replay/calibration
Settings        -> local service defaults and UI preferences
```

The Conversation page is the primary daily-use surface. A top composer bar carries the next-send model/profile, reasoning effort and AIDE orchestration mode. A right-side inspector shows the current Task -> WorkPackage -> Attempt chain, actual Harness/model, native mode, approval state, side-effect state, semantic/step verification and recovery actions. Settings change future defaults; they do not rewrite historical or in-flight Attempts.

### 3.4 Local Context Fabric

Add one Tutti-owned subsystem for context continuity and token efficiency. It is **not** a new top-level authority plane.

```text
                    Tutti Context Fabric
                            |
        +-------------------+-------------------+
        |                   |                   |
        v                   v                   v
   Shared Work State   Repository Index   Evidence / Architecture
   Current Truth       symbols / refs     tests / diffs / logs
   decisions           dependencies       Memhub / constraints
   constraints         semantic search    prior Attempts
        |                   |                   |
        +-------------------+-------------------+
                            |
             two-phase bounded materialization
                            |
       Routing / Execution Capsule + retrieval refs
                            |
                            v
                     Native Harnesses
```

The important distinction is:

```text
same canonical context source != same full token payload
```

Every Harness should see the same Current Truth, decisions, constraints, evidence references, and repository reality, but AIDE should materialize only the subset needed for the current step. A Harness can request additional context during execution instead of receiving entire files or historical transcripts up front.

Materialization is target-neutral before routing and target-aware after assignment. Broker capacity facts may include model context-window/output limits; unknown capacity remains unknown. Tutti never fills a large window merely because it exists, and exact token enforcement waits for native tokenizer/usage telemetry rather than using a guessed cross-model conversion.

Each AIDE Project therefore gets one logical **Local Project Context Space**. Routing retrieval is project-scoped. Once Workspace allocates the Attempt WorkspaceRef, execution retrieval is scoped to that physical workspace so isolated agents do not read stale base-project files.

The Context Space should eventually contain:

- Goal / Current Truth / Task Graph / Decisions / Constraints;
- Task / WorkPackage / Attempt summaries;
- Context Capsules and useful rejected assumptions;
- repository file metadata and fingerprints;
- language-aware symbols, definitions, references, and dependency edges;
- architecture ownership from Memhub;
- Evidence references: diffs, tests, logs, artifacts, hashes;
- native session references, but not native session contents.

Borrow the proven DevSpace development pattern: locate structure first, then read only the relevant slices.

Preferred lookup order:

```text
Task requirements / Current Truth
-> path and metadata narrowing
-> symbol lookup
-> references / dependency traversal
-> semantic code search when symbol lookup is insufficient
-> bounded context pack around selected symbols/files
-> exact source slices only when still needed
```

This is specifically intended to stop every model from repeatedly reading large directories/files and spending tokens rediscovering project structure.

Context Fabric V0 currently implements `search`, `symbol`, `references`, bounded `read`, WorkspaceRef-scoped execution materialization, and an async bounded `query()` entry that refreshes the live workspace view before on-demand retrieval. The Codex app-server adapter exposes these operations through its native `dynamicTools` namespace; HarnessRouter only passes the scoped Context object through and does not interpret query semantics. The longer-term shared query contract can grow toward:

```text
search(query)
symbol(name)
references(symbol)
dependencies(module)
read(ref/range)
evidence(task/attempt)
current_truth(scope)
```

Do not interpret the listed future operations as all implemented today. Dependency traversal and semantic retrieval remain planned. Native Harness on-demand access is implemented for Codex new threads; DSH Headless still has no interactive context-tool transport.

Do not build a universal tool abstraction just for this. Each Harness adapter should expose the same Context Fabric through the narrowest native mechanism available to that Harness. The shared source and query semantics matter; identical transport semantics do not.

## 4. Shared core versus plane ownership

Some mechanisms are cross-cutting and should live in a small shared core rather than be duplicated inside one plane.

Examples:

```text
Project
Task
WorkPackage
Attempt
WorkspaceRef
EvidenceRef
Event
```

The shared core provides common identifiers, persistence primitives and invariants. It does **not** erase logical ownership:

- semantic Task Graph meaning -> Tutti;
- live resource facts/ranking -> Broker;
- native session/process state -> HarnessRouter;
- physical file/test/log truth -> Workspace/Evidence.

This is the preferred way to reuse good Broker data-model ideas without turning Broker into the architecture skeleton.

## 5. V1 physical implementation

Keep the original guide's physical-singleton recommendation:

```text
aide-daemon/
  core/          shared durable entities + event model
  tutti/         work/context/decision logic
  broker/        resource/capability intelligence
  execution/     HarnessRouter + first Native Harness adapter
  workspace/     worktree/evidence operations
  api/           local API

web/
cli/
```

This is logical separation, physical monolith.

Do not create separate services just because the concepts have different owners.

## 6. V1 routing policy

Do not start with ML or a large scoring model.

V1 flow:

```text
Tutti describes task requirements
-> Broker hard-gates incompatible targets
-> Broker returns a small explainable candidate list
-> Tutti selects one target using workflow policy
-> HarnessRouter executes it
```

The first candidate policy can be mostly static role mappings plus live health/quota checks.

Experience-based scoring is added only after real AIDE attempts produce enough data.

## 7. Workspace and writer ownership

The original architecture gives Project Workspace / Task Worktree ownership to the shared work side, not HarnessRouter.

For AIDE V1:

- Workspace/Evidence module creates and tracks task worktrees;
- Tutti associates them with Task/WorkPackage semantics;
- HarnessRouter receives only the workspace reference it needs to execute;
- one mutable workspace has one active writer Attempt;
- reroute/retry creates a new Attempt/worktree when isolation is required.

The one-writer lease concept is borrowed from Current Broker because it protects a real invariant, but it does not make Broker the workspace owner.

## 8. Verification

Verification is two layers:

1. **mechanical evidence** — tests, exit code, diff, logs, required checks;
2. **semantic acceptance** — Tutti determines whether the Task goal/acceptance is actually satisfied.

The Current Broker's deterministic validation implementation is a useful reference for layer 1.

The original architecture's Tutti Verification State remains the owner of layer 2 and overall closure.

## 9. Explicit non-goals for V1

- full transcript synchronization;
- Universal Memory;
- ML Router;
- unlimited model debate;
- cross-Harness native-session migration;
- universal Harness tool/permission semantics;
- distributed workers;
- multi-tenant/RBAC;
- deep TeamAI integration.

## 10. Acceptance sequence

V1 should prove one vertical slice before breadth:

```text
Task created in Tutti
-> Broker returns qualified candidates
-> Tutti assigns one target
-> Workspace creates isolated attempt workspace
-> HarnessRouter launches one real Native Harness
-> Native Harness completes work
-> mechanical evidence captured
-> Tutti performs semantic acceptance
-> Current Truth updated
```

Then prove the second path:

```text
Harness A investigation/design
-> Context Capsule
-> Harness B implementation/verification
```

Only then add richer routing and more Harnesses. A basic management UI is now part of the usable product surface; visual polish remains downstream of the proven control/Conversation contract.

### Current V1 adapter sequence

Use the simplest real Harness first:

```text
DSH headless
-> prove start/status/cancel/result + workspace/evidence
```

Current status: the DSH headless adapter and minimal HarnessRouter lifecycle are implemented and locally tested. The implementation uses DSH's native one-shot process, NDJSON event stream, persisted session identity, and exit semantics rather than introducing an AIDE-specific worker protocol.

Then prove the richer native protocol path:

```text
Codex Desktop bundled app-server
-> prove native session/protocol lifecycle without GUI automation
```

Then prove the architecture's central multi-Harness hypothesis:

```text
DSH or Codex investigation
-> Context Capsule
-> the other Harness continues the task
```

The adapter order is environment-driven and does not alter the original `WHAT / WHO / RUN / HOW / PROVE` responsibility model.

### Current implementation checkpoint

The first real execution checkpoint is now proven:

```text
HarnessRouter DSH adapter
-> DSH headless native loop
-> isolated smoke workspace
-> bounded file/hash evidence
-> Tutti deterministic acceptance
```

Broker V0 now consumes HarnessRouter probe facts and performs the original architecture's minimal `WHO` hard gate with explainable eligibility. It deliberately does not implement scoring history, ML, or semantic ranking yet.

The durable shared Work State, WorkspaceRef/landing path, WorkspaceRef-aware Context Fabric, and thin shared Control facade are now implemented baselines. The next architecture checkpoint is exposing the same scoped Context Fabric to a running Native Harness without giving HarnessRouter context ownership:

```text
Attempt WorkspaceRef
-> Tutti Context Fabric scoped view
-> narrow native query transport
-> Native Harness on-demand search/symbol/references/read
```

Do this before richer routing, a vector database, or a second generalized execution framework.
