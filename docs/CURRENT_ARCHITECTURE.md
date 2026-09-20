# AIDE Current Architecture

Status: **Current** runtime architecture as of 2026-09-18.

This document contains only implemented/current ownership and the remaining gaps that materially block the next product stage. Historical rationale and Target design remain in `ARCHITECTURE.md`. Verification detail remains in `CURRENT_TRUTH.md`.

## 1. Current system boundary

AIDE is one local orchestration service. It coordinates Native Harnesses but does not replace their agent loops.

```text
HTTP / MCP
    |
    v
AideServiceRuntime
  - single-host ServiceLease
  - durable background supervision
    |
    v
AideControl
  - thin control facade
    |
    v
Tutti
  - Task / WorkPackage semantics
  - strategy + assignment ownership
  - plan consensus / handoff / recovery policy
  - semantic acceptance / closure
    |               \
    |                \ optional, observational only
    v                 v
Broker             Shadow Advisor
  - live probe       - no execution authority
  - hard gates       - failure never blocks routing
  - candidate facts  - future JEV/local classifier slot
    |
    v
Frozen Assignment
    |
    +--> durable routing_trace
    |      - candidates / rejections
    |      - actual target/model/effort
    |      - optional advisory
    |      - sanitized resource facts
    |      - terminal verification / native usage snapshot
    |
    v
WorkspaceRef + Context Fabric
    |
    v
HarnessRouter
    |
    +--> DSH Headless
    +--> DSH ACP
    +--> Codex app-server configured targets
           - economy: Luna / low
           - capability: Sol / ultra
           - plan A: Sol / medium / read-only
           - plan B: Sol / high / read-only
    |
    v
Native Harness execution
    |
    v
Evidence -> Tutti verification -> Current Truth / next WorkPackage
```

There is one authority chain:

```text
Broker reports facts/candidates
-> Tutti decides
-> Assignment freezes identity
-> HarnessRouter executes that identity
-> Evidence reports physical truth
-> Tutti decides acceptance
```

Neither Broker, a Shadow Advisor, JEV, nor a Native Harness may independently close a Task.

## 2. Current durable model

The canonical local state is `WorkStateStore`.

Implemented durable entities/state:

- `Task` — user objective, acceptance, open/completed state;
- `WorkPackage` — one bounded unit under a Task;
- `Attempt` — one frozen assignment against one workspace;
- `WorkspaceRef` — direct or isolated physical workspace identity;
- `PendingInteraction` — durable user/permission/authentication request;
- submission idempotency binding;
- bounded Current Truth updates with accepted-Attempt provenance;
- native session/process/process-group facts;
- monotonic approval validation;
- monotonic side-effect classification;
- `routing_trace` for new Attempts.
- one Task-scoped `semantic_decision` for the Current structured decomposition workflow, with accepted planning-Attempt provenance, `single|decompose`, reason, and 1-8 ordered execution steps.
- bounded Task-scoped semantic `constraints` (max 32 strings), kept separate from acceptance criteria and WorkPackage routing/execution requirements.

New WorkPackages also carry bounded durable lineage when AIDE itself creates a successor:

```text
submission
handoff <- source terminal Attempt
plan_consensus_planner <- prior accepted planner Attempt
plan_consensus_execution <- final accepted planner Attempt
```

The edge stores only `kind + from_attempt_id`; the predecessor WorkPackage is derived from that Attempt. Lineage cannot cross Task boundaries and cannot point to a non-terminal Attempt. Older/manual WorkPackages may have no lineage and are not rewritten.

`routing_trace` is intentionally part of the Attempt rather than a new top-level subsystem. It currently stores:

```text
strategy / plan_consensus
Broker candidate ids + rejection reasons
actual target / harness / role / model / reasoning effort / decision reason
sanitized provider resource facts
optional shadow advisory + source/confidence/reason
started_at
terminal status / accepted / side_effects / native usage snapshot / completed_at
```

Older persisted Attempts may not contain `routing_trace`; it is additive and does not reinterpret historical state.

## 3. Current routing model

Current execution strategies remain explicit:

```text
economy    -> configured economy target
capability -> configured capability target
```

`crossfire=true` is an explicit capability-only workflow:

```text
Sol / medium planner
-> Sol / high planner
-> Sol / ultra executor
```

The all-Sol semantic path is real-proven. Both planners must remain read-only and side-effect-free; planner role collapse is rejected; one executor remains the only writer.

Automatic `adaptive` routing is **not Current**.

### Shadow routing boundary

The new Current boundary is observational:

```text
Broker recommendation + Tutti actual assignment
                |
                +--> optional shadowAdvisor(...)
                         |
                         +--> decision/target?/reason/metrics
                         |
                         X  cannot affect current Assignment
```

The Current production advisor is `history-v0`. It reads only durable routing history, requires a configurable minimum comparable sample count (default 10), and returns `insufficient_history` rather than guessing when evidence is sparse. When evidence is sufficient it uses acceptance rate first and median wall duration only as a deterministic tie-break; this is advice, not assignment authority. Shadow advisor failure is persisted as unavailable and does not block or change execution.

No JEV runtime, API key, proxy, or external code transfer is installed by Current AIDE.

## 4. Current resource telemetry

Codex configured-target probe obtains native, non-generative resource facts when available:

- `account/rateLimits/read`;
- ordinary usage allowed/blocked;
- rate-limit ids and model aliases;
- primary/secondary `usedPercent`;
- reset timestamps and window duration;
- rate-limit/spend-control reached state.

Only routing-relevant fields are retained. Account identity and unrelated account metadata are not propagated into Broker facts.

During a Codex turn, AIDE preserves the latest native `thread/tokenUsage/updated` snapshot as:

```text
provider=codex
scope=thread_snapshot
thread_id / turn_id
token_usage.last
token_usage.total
modelContextWindow
```

This is deliberately **not** relabeled as exact per-Attempt cost. Thread totals may span multiple turns; AIDE records the native fact first and postpones cost arithmetic until the delta semantics are proven.

Current Codex runtime evidence also records two native facts that matter for later routing analysis:

- `contextCompaction` / legacy `thread/compacted` -> durable Attempt `context_health` with compaction count plus latest turn/source/time;
- `model/rerouted` -> durable `native_model_state` preserving both requested model and current runtime model plus reroute history/reason. Current schema identifies `highRiskCyberActivity` as a native reroute reason; AIDE records that safety-owned change and does not attempt to countermand it.

Both facts are copied into terminal routing-trace outcome evidence. Neither currently changes routing or acceptance automatically.

Codex schema also exposes optional `account/usage/read({threadId}) -> threadUsage` with estimated credits/USD and per-model token groups. A real non-generative read against an existing completed AIDE Codex thread returned `threadUsage=null` on the Current account/billing route, so this remains a protocol capability rather than Current resource data.

DSH does not currently expose equivalent token/quota telemetry through the implemented adapters.

## 5. Current context model

`LocalContextFabric` owns one logical Project Context Space and materializes:

- target-neutral Routing Capsule before assignment;
- target/workspace-aware Execution Capsule after assignment;
- bounded search;
- symbol lookup;
- reference lookup;
- bounded file reads;
- bounded Task continuity summaries from prior terminal Attempts/WorkPackages;
- accepted `current_truth` and prior Attempt `evidence` as on-demand context operations;
- WorkspaceRef-scoped live refresh.

Codex new threads can call this fabric through native `aide_context` dynamic tools. Current operations are `search/symbol/references/read/current_truth/evidence`. HarnessRouter passes the scoped object but does not own context semantics. Evidence queries return bounded metadata/decision summaries rather than historical evidence-file bodies.

The continuity capsule now carries prior WorkPackage lineage plus terminal Attempt status, routing decision reason, requested/effective model, side-effect class, acceptance, bounded final-text excerpt, and file evidence refs. Planning Attempt text is deliberately excluded from generic continuity so independent crossfire planners cannot see one another; the executor receives accepted planning opinions only through the explicit plan-consensus path.

`current_truth` is also resolved into a bounded provenance view at read time rather than returning bare closure strings. Each truth item keeps its durable ids/facts and adds the referenced Task Goal/Constraints/semantic Decision plus accepted verification summary, metadata-only evidence refs, and requested/effective execution model. Raw evidence-file bodies are not copied into Current Truth.

Task semantic boundaries are now intentionally distinct:

```text
Goal         = what the user is trying to achieve
Constraints  = invariants that must remain true throughout the Task
Acceptance   = evidence required to prove final completion
Requirements = per-WorkPackage execution/routing requirements
Decision     = why Tutti chose the current work shape
```

Constraints are carried in Routing/Execution Capsules for all successor work but are not sent to Broker as capability/ranking facts.

Current does not yet implement dependency-graph traversal, semantic embeddings/indexing, exact model tokenizer packing, or generic DSH interactive retrieval.

Codex app-server also exposes native `turn/start.outputSchema`, and HarnessRouter now passes an optional schema through without interpreting it. This is a Current execution primitive, not an enabled decomposition policy. It gives a future capability-mode decomposer a typed JSON boundary without requiring free-text parsing or a new routing authority.

Tutti now has one explicit structured-decomposition vertical slice:

```text
decompose=true / semantic_decomposition=plan
-> capability only
-> one read-only planning target with planning_mode + structured_output
-> JSON-schema-constrained single|decompose decision
-> deterministic Tutti validation
-> durable Task semantic_decision with source Attempt provenance
-> one execution WorkPackage consumes that canonical decision through Context Fabric
-> normal Task acceptance/closure
```

This is deliberately **not** yet a generic DAG or multi-WorkPackage scheduler. `decompose` and `crossfire` are mutually exclusive Current planning semantics, and economy mode never gains an implicit planning turn.

## 6. Current workspace / side-effect / recovery model

Implemented:

- direct and isolated Git workspace refs;
- one active Attempt per normalized workspace inside Work State;
- isolated landing before accepted Task closure;
- native file-change containment checks;
- durable side-effect classes: `unknown | none | workspace_only | external_possible`;
- automatic handoff when side effects are proven safe;
- same-host detached recovery with owned process-group quiescence when available;
- explicit abandon/reroute recovery actions;
- service-level single-host filesystem lease.

Not implemented:

- multi-host fencing/distributed writer ownership.

Live native reattachment is no longer an open implementation item: Current Codex evidence proves owning-app-server loss interrupts the active turn, while DSH uses owner-bound stdio. Current safe restart behavior is therefore deliberately quiescence-first rather than an unfinished generic reattach layer.

## 7. Current verification model

Verification has two owners:

```text
Workspace/Evidence -> mechanical evidence
Tutti              -> semantic acceptance + closure
```

Native completion, an Agent saying PASS, a reviewer score, or a successful command is insufficient by itself.

Current Tutti now has an explicit two-layer acceptance contract:

```text
mechanical acceptance
  -> native terminal state / exact finalText / required files / approval-runtime invariants / landing evidence
  -> if failed: stop; semantic verifier is not called

optional Task acceptance.semantic[]
  -> one bounded semanticVerifier evidence source
  -> must return exactly the original criteria in the original order
  -> per criterion: passed:boolean + reason
  -> cannot add criteria or close the Task directly

Tutti
  -> combines mechanical + semantic evidence
  -> only combined PASS permits isolated landing and Task closure
```

If semantic criteria are requested but no qualified verifier is available, AIDE fails closed. Semantic rejection happens before isolated workspace landing. The Current service wires a `codex-review` verification target by default: Sol/medium, read-only, approval `never`, structured output + Context Fabric retrieval. It runs only for explicit semantic criteria, so ordinary execution cost is unchanged.

The semantic reviewer is modeled as an **evidence run**, not a second WorkPackage or closure authority. Broker qualifies the verification target; HarnessRouter owns its native lifecycle; Tutti validates immutable criteria and persists trusted runtime provenance inside the execution Attempt's acceptance. This avoids colliding with the one-writer Attempt state machine while keeping the reviewer auditable.

The native-result -> semantic-review -> Attempt-completion boundary is now restart-durable without adding a reviewer entity. Shared Work State persists a bounded Attempt finalization checkpoint before semantic review and again after a valid review. After native quiescence, explicit recovery can finalize from that checkpoint: missing review evidence is recomputed, while a fingerprint-matching durable `status=available` review is reused. The checkpoint is cleared when the Attempt becomes terminal.

JEV-style review may later supply advisory/reviewer evidence behind this contract, but does not own acceptance or closure.

## 8. What is actually missing now

The remaining gaps are not equal priority.

### P0 — production continuity

There is no remaining **live reattach** implementation target for the Current transports.

- Codex: a real authorization-gated active-turn crash/reconnect smoke on 2026-09-18 killed the owning app-server after `turn/start`, opened a fresh app-server, resumed the same native thread, and read the same pre-crash turn back as `status=interrupted`. Therefore an active Codex turn does **not** survive loss of its owning app-server in the Current runtime. Pending approval/user-input rebinding is not a meaningful next experiment because the containing turn is already terminated.
- Normal Codex session continuation still fail-closes if `thread/resume` reports `status=active`; AIDE returns `CODEX_THREAD_REATTACH_REQUIRED` and does not issue a duplicate `turn/start`.
- Completed Codex rollouts remain resumable for later turns. Native single-writer enforcement and writer release/reacquisition were separately real-proven with non-generative probes.
- DSH Headless/ACP are AIDE-owned stdio child processes, so live pipes and pending ACP JSON-RPC requests are likewise not reconnectable after the owner disappears.
- Current restart policy for all these transports is therefore **quiescence first**: durable Attempt/session/process facts -> fence while the old native process group is alive -> after quiescence, abandon or safe reroute/continuation as allowed by side-effect evidence.

The remaining production-continuity work is operational rather than a missing reattach protocol: improve orphan-process recovery ergonomics only if real service-crash evidence shows the existing process-group fence creates unacceptable manual recovery.

### P0 — local management UI / human entry

Management UI V1 is now implemented and Current on the existing service.

- Current entry: the local Project service serves `http://127.0.0.1:8711/` as the primary human UI while keeping `/v1/*` and `/mcp` on the same runtime.
- Current Conversation model: Shared Work State v9 persists one small Tutti/Shared-Core-owned human Conversation with title/archive state, ordered Task linkage and next-send defaults; no Native Harness session is treated as shared memory and no full transcript is duplicated.
- Current navigation: Overview, Conversations, Tasks/Recovery, Models & Accounts, Harnesses & Modes, Routing/Replay, and Settings. Overview is a read-only aggregation of existing Control facts and cannot become another routing/policy owner.
- Current primary Conversation screen: recent-conversation navigation + typed Task/result timeline/composer + Task/Attempt inspector. The composer controls next-send strategy, configured target/profile, exact Codex model/reasoning effort when that profile advertises model selection, and AIDE orchestration mode; pending interactions and recover/cancel/steer use dedicated Control actions.
- Current frontend implementation remains vanilla HTML/CSS/JS served from the existing process. The WebMaker baseline is applied as design/QA discipline rather than framework migration: semantic visual tokens, consistent surface/status/empty-state patterns, responsive information hierarchy, and narrow-screen composition. No React/shadcn build chain is justified by the Current requirements.
- Current Conversation scrolling is user-respecting: polling follows the live edge only while the user remains near it; scrolling upward exposes an explicit `Jump to latest` action instead of repeatedly forcing the viewport back down. Ctrl/Cmd+Enter is a second send path; ordinary Send semantics are unchanged.
- DSH is a product-reference source here: reuse its provider-grouped model catalog, exact-model reasoning-effort selector, write-only credentials/provider configuration, human authorization-flow rendering, Plan-mode UX, and new-session preset semantics. Do **not** copy its Cordis/profile ownership model into AIDE.
- Ownership remains unchanged: Tutti owns Conversation/Task intent and orchestration modes; Broker owns provider/account/model availability and qualification; HarnessRouter owns native lifecycle/capability observation; Native Harness owns its native mode/preset semantics; browser/UI owns presentation only.
- Current implementation remains one-process and dependency-light: static UI assets from the existing Node service, existing Control APIs, and only small Conversation/catalog/list endpoints. A separate frontend daemon/framework build chain is not justified.
- Current Codex configuration seam: native app-server account status, ChatGPT/browser login, device-code login, write-only API-key login, cancel/logout, exact `model/list` directory, and per-model reasoning efforts are wired through HarnessRouter/Control into `Models & Accounts`. Direct execution can override model/effort inside one already-qualified Codex target profile; Broker validates the live pair and Tutti freezes it without changing that profile's sandbox/approval contract. Decompose/Crossfire keep their dedicated planner/executor/reviewer profiles and reject this direct override.
- Missing: a verified DSH adapter/public provider-auth/configuration seam. The installed DSH Cordis authorization/settings/credential services remain valuable product references but are not promoted into the AIDE runtime. Native mode/preset **inspection** is Current; arbitrary native mode/preset mutation remains provider-specific and should be added only when the selected adapter exposes a stable contract with clear Task semantics.

### P1 — task intelligence

1. **Step-level decomposition execution / verification policy**
   - Current: Goal, Task constraints, acceptance, Current Truth, deterministic semantic closure, explicit dual-plan/handoff successors, durable lineage, bounded Task continuity, and one durable structured semantic decomposition Decision are implemented. `decompose=true` is explicit capability-only intent and is real-proven end to end. Each `decompose` step now carries a bounded semantic verification postcondition, and the existing read-only semantic verifier evaluates all step postconditions together with any immutable user semantic acceptance before Task closure. Step verdicts are persisted separately in Attempt acceptance.
   - Current execution shape remains one planner -> one executor -> one final verifier. A failed step postcondition blocks closure, but AIDE does **not** claim mid-execution transition gating because the single Native Harness turn does not expose trustworthy AIDE-owned step boundaries.
   - Real-proof status: the full Current path is now real-proven under explicit authorization: Sol/medium planner -> durable two-step Decision with per-step postconditions -> Sol/ultra executor -> Sol/medium read-only reviewer -> both step verdicts PASS -> Task closure + Current Truth. The durable smoke report independently preserved that evidence, so the proof no longer depends on ServerWorker stdout.
   - Missing: real evidence that independent step execution materially improves reliability enough to justify additional WorkPackages, plus dependency/retry semantics and step-local constraint propagation if that promotion is made.
   - Why it matters: materializing steps too early would turn a planning convenience into a weakly verified autonomous workflow and create a local optimum around graph machinery.

2. **Real-proven semantic reviewer provider**
   - Current contract: `acceptance.semantic[]` plus fail-closed Tutti `semanticVerifier` boundary is implemented and deterministic-tested. Reviewer criteria are immutable, mechanical failure skips reviewer work, semantic rejection blocks landing/closure.
   - Real proof: on 2026-09-19 one Sol/medium read-only structured reviewer evaluated a fixed semantic criterion over deterministic evidence, returned a criterion-preserving PASS + reason, and Tutti closed the Task. Reviewer provenance is supplied by the wrapper, not by model output.
   - Current: explicit semantic criteria are the production policy for paying the extra reviewer call. Reviewer runtime provenance is durable inside execution acceptance without manufacturing a second writer Attempt.
   - Missing: enough real Task history to decide whether semantic review should ever be automatically proposed for high-risk Tasks rather than remaining explicitly acceptance-driven.

3. **Calibrated adaptive routing**
   - Current: explicit economy/capability/crossfire, durable routing telemetry, bounded observational history, deterministic offline `routing-replay-v0`, and production-wired observe-only `history-v0` shadow advice. The feed includes routing requirements/lineage, actual + advisory routing facts, terminal acceptance, side effects, context/model state, native usage scope, and wall-clock duration, but intentionally excludes raw Task objective text and never affects assignment.
   - Real validation: the feed reconstructed the authorized step-verification smoke as exactly planner + executor rows; reviewer provenance remained verifier evidence inside the execution acceptance rather than becoming a fake routed Attempt. Codex usage remained explicitly `thread_snapshot`.
   - Real sparse-history validation: the same smoke produces only one comparable `codex-plan` sample and zero `codex-plan-alt` samples, so `history-v0` returns `insufficient_history` with no alternate target. This is the intended default behavior.
   - Missing: enough real AIDE history to calibrate whether the simple observational rule is useful, stable, and not dominated by task-shape confounding. No automatic route change is justified yet.
   - Required order: collect real history -> replay/calibrate shadow advice -> explicit `adaptive` experiment -> only then consider automatic route changes.

### P1 — resource truth

4. **Exact per-Attempt usage / cost / latency model**
   - Current: timestamps, sanitized Codex quota windows, raw Codex thread token snapshots, terminal verification.
   - Missing: proven turn/Attempt deltas, DSH-equivalent usage where available, pricing/version source, and historical aggregation.
   - Do not compute cost from cumulative thread totals until semantics are proven.

5. **Exact context occupancy / packing**
   - Current: bounded retrieval + declared context/output capacity + durable native compaction observations + native thread token snapshots with `modelContextWindow` when provided.
   - Missing: proven live occupancy/remaining-budget semantics and model-specific packing enforcement sufficient to decide when downgrade/model-switch cache cost is actually worthwhile. Compaction occurrence is evidence of context pressure, not an exact occupancy percentage.

### P2 — context quality

6. **Dependency-aware and semantic retrieval**
   - Current symbol/reference/path retrieval is adequate for the first vertical slice.
   - Add dependency traversal or semantic indexing only when real Tasks show repeated context misses or excessive broad reads.

### P0 — Ubuntu + Windows runtime parity

7. **Cross-platform runtime boundary — Current for the Codex-backed V1 path.** Architecture remains one codebase with Ubuntu and Windows as first-class runtimes. Ubuntu is the primary development host, while the same current core tree has now passed the full non-generative runtime/control/UI gate on Windows.
   - Current shared layers are already intended to stay OS-neutral: Shared Core, Tutti, Broker, Control/HTTP/MCP, UI, Context Fabric.
   - Current platform seam: `src/platform/runtime.js` owns OS-specific default Codex/DSH launcher names, `.cmd/.bat` wrapping, state-root convention, Windows process-tree liveness, and Windows tree termination. Linux adapters retain POSIX process-group ownership; Windows adapters persist a tree root instead.
   - Windows native proofs now exist for Codex app-server read-only protocol/catalog, `%LOCALAPPDATA%` state root, ServiceLease filesystem/PID primitives, Git worktree/landing, orphan-descendant discovery, tree cancellation, the complete 185-test suite, `smoke:platform`, `smoke:intake`, local service startup, and real Chrome HTTP desktop/mobile layout behavior.
   - The validated Ubuntu/Windows core tree is byte-equivalent after normalizing line endings/path separators. Cross-platform validation fixed target-platform path joining in `src/platform/runtime.js`; no Windows-specific orchestration/UI fork was introduced.
   - DSH is still absent on the checked Windows host, so native DSH Windows runtime/cancellation/continuation remain Unknown. This is a Harness-coverage gap, not a Codex-backed AIDE parity blocker.

8. **Self-development preflight — Current.** Before AIDE is allowed to develop AIDE (or perform another high-impact Task), Tutti may execute a no-side-effect preflight using the same request validation, Broker hard gates, configured-target selection, exact-model constraints, and workspace-isolation contract as real submission. Preflight returns the intended workflow/assignment/workspace facts only; it must not create Task/WorkPackage/Attempt state, allocate a worktree, or start a Harness. Control exposes this same contract over HTTP/MCP rather than inventing a separate self-hosting service.

9. **Upstream adoption rule.** HarnessRouter and Tutti are reference sources, not vendored architecture owners. Adopt HarnessRouter changes only when they refine RUN/native lifecycle facts (for example session-to-Harness affinity). Adopt Tutti changes only when they refine WHAT/workflow/semantic supervision (for example dry-run). Artifact timing belongs to Workspace/Evidence, provider/model facts to Broker, and native agent loops remain inside each Native Harness. New upstream status values or abstractions are not copied until AIDE has real evidence that the corresponding state exists.

10. **Dual-platform development tooling.** Ubuntu development/verification uses `@Server`; the group's Windows development/verification endpoint is `@Group`. These are development tools, not runtime dependencies. Cross-platform Current requires shared-code evidence plus host-specific runtime proof; tool renames or remote-access mechanisms must not leak into Tutti/Broker/HarnessRouter product contracts.
   - Do not implement a second Windows orchestration stack. Add only the narrow platform mechanics required by existing adapters/runtime boundaries.

### P2 — portability / breadth after parity baseline

8. **External/resumed Codex dynamic-tool preservation** — AIDE-created new threads are proven; externally created/resumed thread behavior is not.
9. **Additional Harnesses such as Claude Code** — unavailable/unverified on this host; not a Current blocker.
10. **Legacy MCP protocol compatibility** — current service intentionally targets the modern stateless MCP era; add only for a real client requirement.

The Memhub architecture review also confirms that top-level container/reference state must not be read as evidence of missing parallel runtimes. One local Project service remains the intended V1 physical boundary, so a global multi-project registry is not a Current blocker. Promote those only when one daemon must own multiple project roots.

## 9. Things that are not missing

Do not create work merely because these sound sophisticated:

- a second router authority;
- per-tool-step model switching;
- a universal Tool layer;
- full transcript synchronization;
- universal memory;
- multiple concurrent writers to one workspace;
- JEV installation before a provider/data-transfer decision;
- automatic score-chasing review loops;
- distributed workers without a real multi-host requirement.

## 10. Next execution order

The shortest path from Current to a stronger usable product is:

```text
1. use `aide_preflight` before AIDE self-development, then run a small real AIDE-on-AIDE Task only with explicit model-call authorization; fix problems at the owning boundary rather than bypassing AIDE
2. keep the **same-source dual-platform gate** for every self-development/runtime/UI increment: Ubuntu + Windows `npm test`, `smoke:platform`, `smoke:intake`, service startup, and targeted browser/runtime checks where the change can be platform-sensitive
3. keep DSH Windows optional/Unknown until DSH is actually installed and required there; do not infer DSH parity from the Codex path
4. keep DSH account/model configuration Native-managed unless its AIDE adapter gains a stable public configuration/auth contract; do not import internal Cordis services merely to match the Codex page
5. use the now-real-proven decomposition + semantic-review paths through the human entry before making either more autonomous
6. define independent step/dependency/retry semantics only when a real Task demonstrates that one executor consuming an ordered Decision is insufficient
7. keep collecting real routing/resource/outcome/context-health traces and improve exact resource/context truth only where providers expose trustworthy facts; add broader autonomy/breadth only from real evidence
```

This order makes the already-proven orchestration usable from one human entry while keeping routing intelligence downstream of trustworthy execution/recovery evidence instead of using a smarter classifier to hide orchestration gaps.
