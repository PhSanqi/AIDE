# AIDE Project Instructions

## Current Truth

- Linux project root: `/home/z/codex-workspace/AIDE`.
- `ServerWorker` is only the remote tool used to operate this Linux machine. It is not part of the AIDE runtime architecture.
- Broker Current source lives on Windows at `C:\Users\Administrator\Desktop\CodeX Workspace\Personal\Broker` and must be inspected through `@DevSpaceV1` when Broker implementation details are needed.
- Do not treat a copied, cached, generated, or historical Broker tree on Linux as Broker Current Truth unless the user explicitly changes this rule.

## Architecture Source of Truth

- The uploaded `Multi-Harness Engineering Orchestration Architecture Guide` is the primary target-architecture reference.
- Read target/current material in this order before architecture or implementation work:
  1. `docs/ARCHITECTURE.md` — human-readable target synthesis;
  2. `docs/PROJECT_RESPONSIBILITIES.md` — runtime ownership versus local/open-source reference roles;
  3. `docs/CURRENT_TRUTH.md` — verified implementation progress and Unknowns;
  4. `docs/BOUNDARY_CONTRACTS.md` — cross-module context/session/workspace/cancel/retry/permission/evidence contracts;
  5. `docs/EXECUTION_STRATEGY.md` — Ponytail implementation discipline;
  6. Memhub project `aide` — sole ongoing architecture / Current-Truth ledger for superseding project decisions and cross-session continuity.
- Legacy Normify material is reference-only. `/home/z/codex-workspace/AIDE/normify-aide` and any account-scoped Normify adapter output must not override newer Memhub/Current-Truth state unless explicitly reconciled.
- The original architecture guide defines intent. `docs/ARCHITECTURE.md`, `docs/CURRENT_TRUTH.md`, and Memhub project `aide` must remain consistent with that intent; when historical Normify state conflicts, treat it as Legacy/Reference rather than Current.
- AIDE is composed from three logical responsibilities: `Tutti + Broker + HarnessRouter`, with Native Harnesses and Workspace/Evidence below them.
- Do not promote any one of Tutti, Broker, or HarnessRouter into the whole-system skeleton merely because that component currently has more implementation.
- Existing implementations are sources of proven mechanisms and evidence, not automatic owners of target-architecture responsibilities.

## Target Responsibility Split

- Tutti owns WHAT and shared work state: main logical intake, Goal, Current Truth, Task Graph, Decisions, Constraints, the Local Context Fabric / Context Capsules, workflow policy, semantic acceptance, Verification State, and project/task workspace references.
- Broker owns WHO intelligence: provider/account/harness/model availability, quota, health, cost, load, historical outcomes, hard capability gates, explainable candidate ranking, and routing evidence. Broker recommends; Tutti decides.
- HarnessRouter owns RUN mechanics: native process/session lifecycle, start/continue/cancel/status/stream, protocol transport, timeout/reconnect/exit normalization, and native capability observation.
- Run control is capability-gated: never emulate `steer`, interaction `respond`, or native pause with semantically different operations. Blocking native input/permission/authentication requests become durable PendingInteractions owned by Tutti/Shared Work State; HarnessRouter transports but does not decide them.
- Native Harness owns HOW: its own agent loop, session/context, compaction, tools, permission semantics, subagents/delegation, and native execution strategy.
- Workspace/Evidence owns PROVE: Git/worktrees, files, diffs, tests, logs, artifacts, exit state, and observed runtime evidence. Tutti registers and consumes this evidence to update Current Truth.

## Reuse Rule

- Reuse useful mechanisms from Broker, Tutti ideas, or HarnessRouter references even when the mechanism's Current implementation owner differs from the target owner.
- Example: Broker's existing writer-lease, attempt, validation, and durable-state patterns may be reused in AIDE without making Broker the owner of all workspace or verification semantics.
- Preserve one owner per target state. When reusing code/patterns, move responsibility to the target plane instead of creating duplicate ownership.
- A reference project is not a runtime dependency unless `docs/PROJECT_RESPONSIBILITIES.md` explicitly promotes it to one.
- `ServerWorker`, `DevSpaceV1`, Memhub, and legacy Normify are development/governance tooling. They must never become hidden AIDE runtime dependencies.

## Personal-Developer Scope

- Optimize for one developer coordinating multiple agents/Harnesses.
- Keep invariants that prevent corrupted workspaces, ambiguous ownership, unsafe execution, lost context, or unverifiable completion.
- Simplify multi-tenant, enterprise, distributed, and generalized publication features until a real requirement appears.

## Platform Support

- AIDE is one architecture and one codebase with **Ubuntu Linux and Windows as first-class runtime targets**. Do not fork the orchestration/core model into separate Linux and Windows products.
- Ubuntu is the primary development and real-smoke platform. It may receive the first implementation of a runtime mechanism, but platform-specific behavior must be isolated behind the narrowest existing runtime/workspace boundary rather than leaking into Tutti, Broker, Shared Work State, or the Web UI.
- Windows must be developed in parallel for every production-critical runtime path. A feature is not cross-platform Current merely because the shared Node code parses on Windows; runtime discovery, process-tree ownership/cancellation, detached recovery fencing, workspace/Git behavior, state paths, and Native Harness availability must each have Windows evidence.
- Prefer Node/platform-native APIs and the existing adapter boundaries. Add a small platform helper only when Linux and Windows genuinely require different mechanics; do not create duplicated `linux/` and `windows/` copies of the whole system.
- Platform-specific runtime facts must be explicit. Unknown Windows process-tree ownership, Codex/DSH runtime location, or recovery semantics fail closed instead of reusing POSIX assumptions.
- Target validation matrix: Ubuntu is the primary real-model/runtime proof environment; Windows requires deterministic tests plus non-generative native runtime/process/workspace proofs, followed by authorization-gated real model smoke only where needed.

## Implementation Rules

- Start from the smallest stable V1 and implement one vertical slice end to end.
- Prefer logical separation inside one local daemon before independent services.
- Do not add abstractions for hypothetical future Harnesses/providers.
- Preserve Native Harness strengths; do not force all Harnesses into a lowest-common-denominator tool protocol.
- All Harnesses should query one canonical shared Context Space, but do not inject the same full repository/transcript into every model. Prefer path/symbol/reference/dependency/semantic retrieval and bounded context materialization before broad file reads.
- Use a target-neutral Routing Capsule before assignment and a target-aware Execution Capsule after assignment. Unknown context capacity stays unknown; do not invent token limits.
- A cancellation request is not terminal cancellation. Keep workspace writer ownership until HarnessRouter observes a terminal result.
- Native session/thread identity is an opaque runtime optimization, not shared Work State; cross-Harness continuity uses Current Truth, Evidence, and Handoff Capsules.
- Assistant/progress output, terminal result, user follow-up, and interaction/permission response are different semantics. Do not collapse them into one generic message path.
- Treat executed evidence as stronger than agent completion claims.
- Keep Current, Legacy, Reference, Target, and Unknown explicitly separated.
- Follow `docs/EXECUTION_STRATEGY.md`: one real vertical slice at a time; stop at the first simple solution that preserves required invariants.
- Do not add a generalized Harness abstraction until a second real Harness forces a shared contract.
- Same-path implementation failure twice means stop patching and reinvestigate the root cause before another attempt.
- When adding or changing a production runtime feature, state whether it is `linux+windows`, `linux-only Current`, or `platform-unknown`; do not silently call a Linux-only proof cross-platform.
