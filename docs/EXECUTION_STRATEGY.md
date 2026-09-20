# AIDE Execution Strategy

Status: Ponytail execution policy for the Current AIDE implementation.

## 1. Principle

Implement the smallest real path that proves the architecture. Do not build a generalized orchestration framework before two real implementations demonstrate the common contract.

The development loop is:

```text
Current Truth
-> one missing architecture link
-> smallest implementation
-> focused test
-> one real vertical-slice proof when needed
-> evidence
-> update Current Truth
```

## 2. Mandatory order before coding

For architecture/runtime work:

1. read `docs/ARCHITECTURE.md`;
2. read `docs/PROJECT_RESPONSIBILITIES.md`;
3. read `docs/CURRENT_TRUTH.md`;
4. inspect the affected Current source/runtime;
5. inspect Memhub architecture only when ownership/dependency shape is relevant;
6. make the smallest change at the true shared failure/feature boundary.

Do not code from Target assumptions when Current evidence is available.

## 3. What to optimize for

AIDE is for one developer coordinating multiple agents. Optimize for:

- clear state ownership;
- recoverable work;
- isolated writes;
- preserved Native Harness strengths;
- explainable routing;
- bounded context handoff;
- evidence-backed completion;
- low operational overhead.

Do not optimize V1 for multi-tenant SaaS, distributed workers, generalized plugin markets, or enterprise RBAC.

## 4. Current implementation sequence

### Completed baseline

```text
HarnessRouter DSH adapter
-> real DSH headless run
-> Workspace file evidence + SHA-256
-> Tutti deterministic acceptance
```

Broker V0 also consumes real HarnessRouter probe facts and performs availability/capability hard gating with explainable reasons.

### Shared Work State closure completed

The durable shared-core path now exists:

```text
Task
-> WorkPackage
-> Attempt(frozen assignment + workspace)
-> persisted local state
-> accepted evidence
-> Current Truth update
-> Task closure
```

It intentionally uses one versioned JSON file with serialized in-process mutations and atomic replacement. Do not replace it with SQLite/ORM/event sourcing until real query/concurrency/recovery pressure demonstrates the need.

### Main Intake + Context Fabric V0 completed

The local single-entry orchestration baseline now exists:

```text
user message
-> Tutti Intake
-> Task / WorkPackage requirements
-> small target-neutral Routing Capsule
-> Broker recommendation
-> Tutti assignment
-> target-aware Execution Capsule
-> Attempt
-> HarnessRouter start
-> result / evidence
-> acceptance
-> Current Truth / closure
```

The V0 routing rule is intentionally small: Broker hard-gates unavailable/incompatible targets. Tutti auto-assigns only when one candidate remains or an explicit ordered `preferred_targets` policy chooses one. Multiple qualified candidates never use alphabetical id order as a hidden policy. Do not call this semantic model intelligence; task-class/model-quality policy still waits for trustworthy attempt history and explicit workflow rules.

Context Fabric V0 currently provides:

- bounded local project scan;
- lightweight symbol definition index;
- exact-symbol reference lookup;
- bounded text/path search;
- exact bounded source read;
- separate Routing/Execution Capsules;
- target context-window/output budget facts without inventing tokenizer counts;
- Current Truth + WorkPackage + relevant-symbol working set.

The Work State JSON file is consumed through the WorkStateStore API and excluded from repository text indexing to avoid duplicating canonical state as token context.

`TuttiIntake.submitAndRun()` now composes that path locally. Its full-chain automated test uses a controlled fake HarnessRouter, so it verifies orchestration without consuming model quota. The exact entry has not yet been re-run against a paid real DSH task.

### Next

The local interaction supervisor and Codex app-server adapter are connected. One authorized real Default-mode turn proved that `request_user_input` is unavailable in that native mode; the capability is therefore not advertised on the Default target. Isolated Git worktree allocation/landing and WorkspaceRef-aware execution context are implemented. Codex new threads now receive native `aide_context` dynamic tools backed by the live scoped Context Fabric. `AideControl` remains the thin shared facade for future MCP/Plugin/Web/CLI transports.

Approval handling is now target/profile-aware. Probe results carry a frozen `approval_contract`, running Attempts persist actual native approval state, and each PendingInteraction carries a provider-owned response contract. Shared `permission` is only a waiting/security category; it is not an approval decision enum. DSH Headless remains non-interactive/fail-closed, while Codex app-server exposes its own approval policies, reviewers, request methods, and request-specific response shapes.

Approval policy routing is now implemented at the existing Broker hard-gate boundary. `WorkPackage.requirements.approval` can require an interactive approval channel, a response channel, unattended fail-closed behavior, and required/forbidden session grants or auto-review. Unknown contract facts fail closed when a requirement depends on them. No new workflow engine or cross-provider approval decision enum was added.

Runtime approval drift protection is also implemented. Exact configured invariants and supported native policy/reviewer sets are checked against the first actual `approval_state`; concrete activation state is then checked against WorkPackage approval requirements. Capability (`target can do X`) is not confused with activation (`this run actually enabled X`). Incompatibility is persisted on the Attempt, cancellation is requested, and finalization forcibly records failure before evidence acceptance or landing.

The same gate also covers missing runtime evidence: a configured target cannot be accepted after native completion unless an actual approval state was observed and validated. Missing state becomes a durable incompatible validation while the native-state field remains null.

The main Control path now executes a full Task rather than one Attempt. Tutti automatically advances rejected/failed work across alternate qualified Harnesses while preserving requirements and exclusions. `execution_strategy=economy|capability` gives Broker an explicit configured-target order without hidden alphabetical/model-name inference; explicit `preferred_targets` remains the stronger operator override. The service defaults to economy, while per-task HTTP/MCP requests may select either strategy.

The backend service lifecycle is now implemented for one host: `ServiceLease -> AideServiceRuntime -> AideControl`. `enqueue()` returns a Task handle immediately and keeps supervision alive after the transport request returns. HTTP/Plugin and MCP `2026-07-28` share this runtime and therefore share the same Task, PendingInteraction, lease, and recovery view. Durable client-request idempotency is implemented on top of Shared Core rather than transport memory. Attempt side-effect risk plus current POSIX process-group ownership are durable recovery facts rather than request-time guesses.

Platform execution policy is now explicit: Ubuntu is the primary implementation/proof platform and Windows is a first-class parity target developed in parallel. Keep one shared orchestration code path. Add platform-specific code only for facts that genuinely differ—runtime discovery, process-tree ownership/termination, state-root conventions, or native launcher behavior. Do not duplicate Tutti/Broker/Control/UI for Windows.

For each production runtime change, verify the shared contract with deterministic tests, then record platform evidence separately. `Linux PASS` does not imply `Windows PASS`. Windows parity does not require repeating paid/model semantic proofs when the same provider protocol is unchanged; prefer non-generative executable/protocol/process/workspace proofs and spend model quota only when platform behavior can affect model/session semantics.

Capability crossfire is implemented as durable dual planning consensus rather than multiple writers. Current configured planners are `codex-plan` (Sol/medium) and `codex-plan-alt` (Sol/high), both read-only; the reasoning-effort difference provides a small independent planning perturbation without using Astra. Each planner must return non-empty accepted output with durable `side_effects=none`; its WorkPackage completes without closing the Task. Only after both succeed does Tutti create one execution WorkPackage, inject both plans as non-authoritative opinions, and let the capability executor reconcile them against current evidence. `crossfire=true` is explicit and economy+crossfire is rejected.

The planning envelope is now verified at two levels. Catalog probe proves the model/effort/collaboration presets exist; a separate non-generative ephemeral thread-start proof verifies the native model, sandbox, and approval policy returned by app-server. Plan targets currently return `readOnly` with network access disabled. These sandbox/network facts are frozen into runtime drift validation. Crossfire progression is also restart-safe across terminal planner boundaries, and an accepted execution Attempt can repair a missing Task closure after replay.

The current local strategy profiles are configuration, not price claims. `codex-economy` defaults to Luna/low and declares only the economy priority; `codex-capability` defaults to Sol/ultra and declares only the capability priority. Native `model/list` and `collaborationMode/list` verify those combinations before the targets are advertised. Configured Codex probes now also retain sanitized `account/rateLimits/read` facts when available, and completed runs may retain raw native thread token snapshots; neither is yet a pricing model or automatic ranking signal. If the requested strategy-specific target is unavailable, AIDE does not silently substitute the opposite profile; an explicit preference or future evidence-backed fallback policy is required.

Runtime model identity is not assumed to remain equal to requested Assignment identity. If Codex emits native `model/rerouted`, AIDE records the effective runtime model and reason separately while preserving the frozen requested model. Native safety-owned reroutes are never automatically reversed by AIDE. Context compaction observations are likewise recorded as evidence only; they do not yet trigger automatic strategy changes.

JEV-family routing/review projects are external references, not dependencies. Provider-neutral **shadow routing plumbing is now Current**: Tutti may call an optional internal `shadowAdvisor`, but the returned advice is observational only and cannot alter the frozen Assignment. Each new Attempt persists recommendation/actual/advisory/resource/outcome routing trace. With no advisor configured, traces still record actual routing facts and outcomes. Do not route individual tool continuations to different models inside one Attempt. Detailed evaluation: `docs/JEV_REFERENCE_EVALUATION.md`.

The DSH native-surface investigation is now resolved: the shipped automation-only ACP v1 profile provides persistent session lifecycle, native permission request/response, cancellation, and committed generic tool lifecycle updates. AIDE therefore has a separate `dsh-acp` target. Headless remains unchanged; ACP does not gain unsupported steer, elicitation, terminal, or filesystem-client semantics. Both Current DSH targets pin `workspace-write` so ambient environment changes cannot silently alter frozen target semantics.

DSH ACP side-effect classification is deliberately narrow. A no-tool turn can prove `none`; workspace-confined native fs `write/edit` calls can prove `workspace_only`; everything else stays `external_possible`. Codex file-change classification is equally path-bound: native `changes[].path` must all resolve inside the Attempt cwd, and file-change approval is correlated by native `itemId` rather than trusted by method name alone. Codex command execution is finalized only from `item/completed`: native read/list/search evidence can prove `none`, a bounded local inspection sequence can prove `workspace_only`, and unknown or incomplete commands fail closed to `external_possible`.

The authorized real isolated mutating proof is now complete: DSH ACP created a contained source file, source acceptance failed and remained unlanded, Tutti handed off to Codex, Codex exposed one workspace-contained native file-change item, the correlated approval was accepted, successor acceptance passed, and only the successor landed/closed the Task. External-effect continuity remains out of scope and fail-closed.

1. retain the now real-proven `aide_context` contract and add resumed/external-thread dynamic-tool preservation only if that workflow becomes necessary;
2. retain `user_input_requests` only on configured Plan targets; Default remains unadvertised because the real Default-mode probe proved the native tool unavailable there;
3. keep capability crossfire explicit. The corrected all-Sol semantic re-proof is now real-proven at `Sol/medium -> Sol/high -> Sol/ultra`: both planners produced substantive distinct plans with no side effects and the executor performed explicit arbitration. One successful semantic proof is still not enough evidence for automatic complexity-based activation; collect real task quality/cost/latency history first;
4. collect real quota/price/token/latency/quality history before adding learned cost routing or automatic crossfire policy. Until then economy/capability remain explicit configured profiles rather than a learned cost model.
5. collect shadow-ready routing traces on AIDE Tasks. Add a real advisory provider only behind the existing observational boundary; calibrate before introducing an explicit `adaptive` mode. Do not install/call JEV or transmit code externally without a separate explicit authorization.

Automatic crash takeover still never resumes an unknown in-progress native turn. The local service lease prevents duplicate local owners. Current POSIX adapters create an owned process group; same-host recovery fences on that whole group when available and falls back to primary PID only for older/non-group Attempts. A real non-generative OS proof verified that a live descendant keeps recovery fenced after the leader exits. Descendants that deliberately escape the group and opaque/cross-host cases remain explicit.

Real cross-Harness control has now been exercised at two evidence levels on 2026-09-18. `DSH -> Codex` and `Codex -> DSH` proved the automatic successor topology with no tools. A later authorized `DSH ACP -> Codex` run proved contained mutation continuity: source `workspace_only` mutation remained unlanded; successor native file-change paths were inside its isolated workspace; only the correlated file-change approval was accepted; successor landing/Task closure succeeded. Opaque DSH Headless retries with `side_effects=unknown` and all `external_possible` sources still block rather than assume safety.

Do this before adding semantic routing or a vector database.

For Task Graph work, reuse the existing durable entities first. Current handoff and dual-plan successors now record WorkPackage lineage back to the terminal source Attempt. Do not introduce a parallel graph store, graph manager, or generic decomposition framework until AIDE has a real semantic rule that creates additional WorkPackages from one user objective.

Codex now gives that future rule a clean typed boundary: HarnessRouter can forward native `turn/start.outputSchema`. Prefer this over parsing free-text plans when semantic decomposition is eventually enabled. Keep the planning turn explicit/capability-scoped until AIDE has evidence that its quality gain justifies the extra model resource use; economy mode must not silently acquire an extra decomposition turn.

That first typed slice is now Current and real-proven as explicit `decompose=true`: one capability/read-only Sol structured planner produces a durable `single|decompose` Decision and ordered plan, then one Sol capability executor consumes it. For `decompose`, every step now includes one bounded semantic verification postcondition; after mechanical acceptance, the existing read-only semantic verifier evaluates those postconditions together with any user semantic criteria, and any failed step blocks closure. This remains post-execution verification inside one executor boundary, not mid-turn gating. It is intentionally not combined with dual-plan crossfire and is not enabled in economy. Only materialize plan steps as independent WorkPackages after real Tasks show that stronger transition/retry boundaries improve reliability enough to justify them.

Keep Task semantics out of Broker routing. User invariants belong in durable Task `constraints`; final proof belongs in Task `acceptance`; execution feasibility belongs in WorkPackage `requirements`. All Harnesses receive the same semantic constraints through Context Capsules, while Broker sees only the requirements it can factually gate/rank. This separation is the Current baseline for any future step-level decomposition.

Final verification follows the same authority split. Mechanical evidence is mandatory and cheap; optional `acceptance.semantic` criteria add a second Tutti-controlled semantic layer only after mechanical PASS. Reviewer/model output is evidence, not authority: it must answer the fixed criteria exactly, and Tutti remains the only closure owner. The reviewer boundary is real-proven and production-wired as the dedicated read-only `codex-review` verification target. Do not create a parallel Reviewer service or reviewer WorkPackage: persist verifier runtime provenance inside the execution Attempt acceptance. Keep semantic review explicit through `acceptance.semantic` until real Task history shows a reliable trigger for proposing it automatically.
At the public HTTP/MCP boundary, prefer the explicit `semantic_acceptance` field over making clients understand nested internal acceptance state. It maps to the same immutable Task criteria and exists only to improve product ergonomics/data collection; it must not alter reviewer authority or routing.

The architecture-wide priority remains Tutti semantic quality, not more Harness plumbing. Goal/acceptance/Current Truth/closure, WorkPackage lineage, bounded prior Attempt/evidence continuity, and a provenance-bound Task semantic Decision now exist. Do not build an independent Decision service, generic DAG engine, vector store, JEV router, or multi-project registry first; first real-prove whether this decision improves actual work and what step-level verification is missing.

Current Truth now resolves its existing Task/Attempt references into bounded provenance when consumed. Prefer this normalized-reference approach over duplicating execution transcripts or evidence bodies into a second memory store. Future context work should be triggered by a measured retrieval miss, not by the desire to make Current Truth larger.

Current entity status:

- `Task` — implemented baseline;
- `WorkPackage` — implemented baseline;
- `Attempt` — implemented baseline, including frozen assignment and workspace writer guard;
- `WorkspaceRef` — implemented for direct identity plus isolated Git worktree allocation/landing on clean repositories with a valid HEAD;
- `PendingInteraction` — implemented baseline for durable user-input/permission/authentication requests plus normalized event projection, waiting Attempt states, response-to-running transition, and durable projection cursor;
- `CurrentTruth` update record — implemented baseline with provenance back to the producing Attempt;
- Task closure — implemented and allowed only after Tutti acceptance is true.

Next Context Fabric increments, only when needed by the running Harness:

1. dependency-aware search;
2. evidence lookup by Attempt;
3. semantic search only when symbols/paths/relations are insufficient.

Do not implement a broad workflow engine, generic scheduler, event bus, or migration framework unless this path proves it needs one.

### After shared Work State

1. thin MCP/Plugin adapters over `AideControl` after service lifecycle is explicit;
2. real automatic DSH <-> Codex handoff using Tutti, never direct Harness-to-Harness spawning;
3. add DSH ACP context retrieval only if the native protocol exposes a useful bounded context primitive; do not emulate one by injecting broad context into every prompt;
4. compare DSH and Codex shapes and extract only the actually shared control contract;
5. only then richer Broker history/ranking;
6. richer Web/CLI presentation after the execution chain is stable enough to expose.

## 5. Harness implementation rule

For each Harness:

```text
discover/probe
start
observe events
capture native session reference
cancel
collect result/exit
```

Optional native controls such as `steer`, interaction `respond`, or pause are capability-gated. Never synthesize one from a semantically different operation.

Use the Harness's native protocol first.

Do not:

- automate a GUI when a native runtime protocol exists;
- copy the Harness's Agent Loop into AIDE;
- translate every native tool into an AIDE universal tool schema;
- assume native sessions can migrate between Harnesses.

HarnessRouter normalizes lifecycle, not intelligence.

## 6. Context rule

Cross-Harness continuity uses a bounded Context Capsule:

```text
Goal
Current Truth
Task / WorkPackage
Constraints
Decisions
Evidence refs
Previous Attempt outcome
Acceptance
```

Do not synchronize full transcripts.

Native Transcript remains Harness-private. Rejected assumptions are carried only when they are useful to avoid repeating a failed path.

## 7. Workspace and concurrency rule

- one mutable workspace/worktree has one writer Attempt;
- independent Attempts that may edit files use independent worktrees when needed;
- HarnessRouter receives a workspace reference; it does not own workspace truth;
- retry/reroute keeps Attempt identity and evidence separate;
- no two agents independently edit the same mutable directory.

Use the simplest lock/lease mechanism that actually protects this invariant. Persisted lease machinery is added only when restart/concurrency behavior requires it.

## 8. Routing rule

V1 Broker logic:

```text
live probe/resource facts
-> hard capability gate
-> small explainable candidate set
-> Tutti workflow decision
```

Do not add ML scoring or opaque semantic ranking.

Record history only after real Attempts exist. Add cost/quota/load/success/rework weights one by one when each has trustworthy data and changes a real decision.

## 9. Verification rule

Completion has two distinct layers:

1. mechanical evidence — exit code, diff, tests, logs, files/artifacts/hashes;
2. semantic acceptance — Tutti evaluates whether the Task acceptance is satisfied.

An agent saying "done" is not evidence.

Executed/observed evidence is stronger than completion claims.

## 10. Failure escalation

For one implementation path:

```text
Attempt 1 fails
-> use new evidence and fix root cause

Attempt 2 fails on the same path
-> STOP PATCHING
-> reinvestigate repo/runtime truth
```

Escalate architecture reasoning only when the uncertainty is actually architectural, cross-module, or high-impact.

Do not compensate for uncertainty with many boundary tests or speculative abstraction.

## 11. Explicit deferred work

Until a verified need appears, do not build:

- Universal Memory;
- full transcript synchronization;
- Universal Tool abstraction;
- ML Router;
- distributed execution plane;
- multi-tenant/RBAC;
- automatic fallback chains;
- native-session migration across Harnesses;
- generalized provider/Harness factory hierarchies.

## 12. Definition of a completed development increment

An increment is complete when:

1. Current behavior/need was inspected;
2. ownership matches `docs/ARCHITECTURE.md`;
3. the smallest implementation is in the target owner;
4. focused tests pass;
5. real runtime proof is run when the behavior depends on a real Harness/protocol;
6. evidence and known limits are recorded in `docs/CURRENT_TRUTH.md`;
7. Memhub is updated when architecture ownership, Current Truth, or project-level decisions materially change.
