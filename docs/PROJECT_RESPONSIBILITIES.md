# AIDE Project and Reference Responsibilities

Status: responsibility map derived from the original architecture guide, Current local projects, verified runtime evidence, and the Memhub `aide` project Current Truth.

## 1. Boundary rule

AIDE combines useful mechanisms from multiple projects, but **code maturity does not determine architecture ownership**.

There are three categories:

1. **AIDE runtime modules** — code that owns a target responsibility at runtime.
2. **Native Harnesses** — independently capable agent runtimes that AIDE starts and observes without replacing their internal agent loop.
3. **Reference / development projects** — sources of mechanisms, protocol knowledge, or development tooling. They are not runtime dependencies unless explicitly promoted later.

The target chain remains:

```text
WHAT  -> Tutti
WHO   -> Broker recommends, Tutti decides
RUN   -> HarnessRouter
HOW   -> Native Harness
PROVE -> Workspace / Evidence
```

## 2. AIDE runtime ownership

| Runtime area | Owns | Must not own |
|---|---|---|
| Tutti | Goal, Current Truth, Task Graph, Decisions, Constraints, Context Capsules, workflow/verification policy, semantic acceptance, final synthesis | Native processes, provider quota truth, Harness internal context |
| Broker | Provider/account/Harness/model availability, capability, health, quota, cost/load/history facts, hard gates, explainable recommendations, routing evidence | User intent, semantic architecture decisions, Native Harness process control |
| HarnessRouter | Runtime discovery, start/continue/cancel/status/result, process ownership, native session refs, protocol transport, timeout/reconnect/exit normalization | Task planning, semantic routing, workspace truth, final acceptance |
| Native Harness | Native Agent Loop, native session/context, tools, compaction, permission semantics, subagents/delegation, execution strategy | Cross-Harness shared truth |
| Workspace / Evidence | Project/task workspace operations, worktree/isolation, diff, tests, logs, artifacts, hashes, exit evidence | Semantic acceptance or resource ranking |
| Shared Core | Project/Task/WorkPackage/Attempt/WorkspaceRef/EvidenceRef/Event identifiers and minimal durable invariants | Plane-specific intelligence |
| Unified Control Surface | One logical MCP/Plugin/Web/CLI control entry plus the local management UI, all delegating to the same Tutti workflow/runtime | Independent copies of Tutti/Broker/Router state, browser-owned orchestration, or transport-specific workflow semantics |

## 3. Local projects

### 3.1 AIDE

Role: **the product being built**.

Current root:

```text
/home/z/codex-workspace/AIDE
```

It owns only the target architecture above. It may copy/rewrite proven mechanisms from references, but the resulting code must live under the target owner.

### 3.2 Broker

Current source:

```text
C:\Users\Administrator\Desktop\CodeX Workspace\Personal\Broker
```

Role in AIDE: **mature mechanism/reference source plus Resource Intelligence design source**.

Useful mechanisms to reuse selectively:

- Task / WorkPackage / Attempt separation;
- frozen assignment per Attempt;
- one-writer lease invariant;
- cancellation/restart recovery bookkeeping;
- deterministic validation patterns;
- bounded evidence/audit patterns;
- provider/runtime health plumbing;
- semantic authority separated from execution permission.

Target ownership after reuse:

- resource/capability facts and recommendation -> AIDE Broker;
- Attempt identifiers/invariants -> Shared Core;
- writer exclusivity/worktree truth -> Workspace/Evidence;
- mechanical validation -> Workspace/Evidence;
- semantic acceptance -> Tutti.

Broker is **not** the AIDE skeleton and its current bounded worker loop is **not** the Native Harness integration contract.

### 3.3 CFR

Role in AIDE: **external-control and remote-interaction reference**.

Useful experience:

- remote GPT/browser control;
- command/session UX;
- remote connection lifecycle;
- desktop/browser integration lessons.

Not in AIDE V1 runtime. AIDE must not depend on CFR routing, CFR sessions, or CFR workspace ownership.

### 3.4 DevSpaceControlPlatform / DevSpace

Role in AIDE: **development-environment and operational UX reference**.

Useful experience:

- project/workspace management;
- version/history/rollback UX;
- logs and status surfaces;
- remote development control;
- process/service observability.

Useful Context Fabric patterns to reuse:

- persistent project/workspace identity instead of rediscovering repository structure every turn;
- path-aware local project spaces;
- symbol-aware navigation before broad whole-file reads;
- definition/reference/dependency lookup;
- bounded context packs assembled around the actual task;
- repository fingerprints/current structure used to detect drift;
- project/context isolation when multiple Tasks or Attempts run in parallel.

It is not HarnessRouter and does not own AIDE runtime state.
These are patterns to reuse; AIDE runtime must not depend on the DevSpace application or ServerWorker service.

### 3.5 Memhub architecture / Current Truth

Canonical identity:

```text
Memhub project: `aide`
scope: account-scoped
```

Role: **authoritative architecture and Current Truth memory for ongoing AIDE work**. The older repo-local `/home/z/codex-workspace/AIDE/normify-aide` directory is legacy/reference-only and is not part of the ongoing architecture-update workflow.

It records module boundaries, dependencies, reference classifications, and execution-policy structure. It is architecture/development tooling, not a runtime service.

### 3.6 ServerWorker and DevSpaceV1

Role: **development access tools only**.

- ServerWorker operates the Linux development machine.
- DevSpaceV1 inspects/changes the Windows Current Source projects.

Neither may be imported, called, or required by AIDE runtime code.

## 4. Native Harness and open-source sources

### 4.1 DeepSeek Harness / DSH

Category: **real Native Harness + primary upstream runtime source**.

Current AIDE use:

- first real HarnessRouter adapter;
- `headless` one-shot execution;
- NDJSON run events;
- persisted `sessionId` continuation;
- native tools and safety defaults remain DSH-owned.

Other upstream mechanisms worth learning from when required:

- ACP session/cwd/permission behavior;
- permission presets;
- MCP client lifecycle;
- timeout/cancellation primitives;
- provider configuration.
- Web product semantics for provider-grouped model selection, exact-model reasoning-effort choices, write-only credential/provider setup, human-driven authorization flows, Plan mode, and per-session agent preset selection. These are UX/configuration references only; AIDE keeps its own Tutti/Broker/HarnessRouter ownership boundaries and must not import DSH's Cordis/profile architecture as the AIDE control plane.
- The installed DSH authorization, settings-controller, credentials, and Models-page services remain **Reference internals** unless a stable adapter/public protocol is explicitly promoted. AIDE must not depend directly on those Cordis services simply to expose DSH login/settings in its own UI.

Do not copy DSH's internal Agent Loop into AIDE.

### 4.2 OpenAI Codex

Category: **real Native Harness/upstream runtime source**.

Current Linux reality:

- no standalone `codex` command in PATH;
- ChatGPT/Codex Desktop bundles a Codex runtime;
- bundled runtime exposes `app-server` transports.

Target AIDE use:

- second HarnessRouter adapter;
- use native app-server/session/thread/model/event lifecycle;
- discover bundled runtime rather than GUI automation.

Do not hard-code desktop implementation paths unless discovery proves no stable alternative.

### 4.3 Claude Code

Category: **target Native Harness, not Current Linux runtime**.

Target value:

- architecture/system reasoning path;
- native Claude Code session/tools/subagents when actually available.

Current status remains unavailable/unverified on this Linux host. Do not scaffold its adapter before a real runtime is present or selected.

## 5. Open-source architecture references

These projects are **reference-only** unless a later explicit decision promotes a narrow dependency.

### Multica

Use for ideas around:

- runtime identity versus protocol identity;
- Backend/Session/Message/Result normalization;
- capability discovery;
- reconnect/process ownership.

Do not inherit distributed infrastructure, automatic routing/fallback, or unrelated service topology.

### c9r orchestrator

Use for provider-neutral driver/session/event/capability separation.

Do not add a factory/registry hierarchy in AIDE until the second real Harness demonstrates a shared contract that requires it.

### ACP

Use as a protocol-semantics reference for agent sessions, cwd, permissions, framing, and host/agent interaction where a Native Harness actually exposes ACP.

ACP is not AIDE's universal protocol.

### Qwen Code ACP bridge

Use as an implementation reference for process/framing/backpressure/filesystem/permission edge cases around ACP-style adapters.

Do not add Qwen as a V1 Harness merely because its bridge is useful to study.

### Compatibility / orchestration references

Examples include projects previously reviewed such as `twaldin/harness`, `team-harness`, `superharness`, `agent-of-empires`, `orchestmux`, and `codex-deepseek-subagent`.

Use them only to learn failure modes around persistence, PTY/process control, multi-Harness coordination, and compatibility. They do not define AIDE ownership.

## 6. Promotion rule

A reference becomes a runtime dependency only when all are true:

1. a Current V1/V2 requirement cannot be satisfied cleanly by existing native/platform capability;
2. the dependency preserves AIDE's ownership model;
3. it replaces more code/complexity than it introduces;
4. there is a real vertical-slice test proving it;
5. `docs/PROJECT_RESPONSIBILITIES.md`, `docs/ARCHITECTURE.md`, and the Memhub `aide` project Current Truth are updated together.

Until then, references remain references.
