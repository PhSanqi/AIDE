# JEV Reference Evaluation for AIDE

Status: Reference only. No JEV runtime dependency is installed or enabled by this document.

Reviewed on 2026-09-18:

- https://github.com/gargpratyush/jev-router
- https://github.com/0xNatoshi/jev-codex-router
- https://github.com/NiazMorshed2007/jev-review
- https://github.com/devagrawal09/jev-review
- https://github.com/LichHsu/codex-desktop-jev-worker

## Decision summary

JEV is useful to AIDE as an **advisory routing/review signal**, not as another authority plane and not as a proxy that replaces HarnessRouter.

AIDE should reuse four ideas:

1. route only at a stable workflow boundary and freeze the choice for the native turn/Attempt;
2. make low-confidence routing conservative and persist why a route was selected;
3. collect shadow decisions and replay real history before changing automatic routing policy;
4. treat JEV review scores as triage evidence, never as acceptance proof or permission to expand scope.

AIDE should **not** currently reuse:

- loopback proxy/provider injection for Codex;
- model changes inside one AIDE Attempt/tool loop;
- Astra as a required tier;
- automatic external-model failover on quota exhaustion;
- score-driven rewrites or a review score as a failure condition.

The current AIDE native app-server path already owns model/profile identity, approvals, sandbox evidence, session lifecycle, side effects and process ownership. Adding a second Codex proxy plane would duplicate those responsibilities and weaken Current Truth.

## 1. `gargpratyush/jev-router`

### Mechanisms worth reusing

The strongest reusable part is `src/policy.mjs`, not the proxy itself.

- Explicit human model requests win over automatic routing.
- A missing/malformed JEV result keeps the current route rather than inventing one.
- Low confidence cannot cause a downgrade.
- A large existing context blocks a downgrade when rebuilding prompt cache would cost more than the cheaper model saves.
- If the requested tier is unavailable, the policy prefers the nearest stronger available tier before stepping down.
- Routing happens on a fresh user turn; tool-loop continuations reuse the pinned tier.
- Routing decisions are persisted/explainable rather than being invisible model switches.

### AIDE mapping

| JEV Router idea | AIDE owner | AIDE use |
|---|---|---|
| human override wins | Tutti | already true through explicit strategy / preferred target |
| confidence gate | Broker/Tutti policy | future adaptive routing only |
| no mid-turn model flip | Shared Core + HarnessRouter | already stronger: assignment is frozen per Attempt |
| cache-aware downgrade | Broker | future, after native context/cache telemetry exists |
| unavailable tier handling | Broker | already fail-closed for opposite strategy; future adaptive tier may step upward explicitly |
| decision explanation | Broker + Work State | already stores recommendation/decision reason; extend only if adaptive classifier is added |

### Do not copy

`jev-codex` injects a temporary Codex provider and loopback proxy, forwards existing auth headers and rewrites the Responses request model. AIDE should not add this layer because AIDE already has a verified native app-server adapter and configured-target identities. Proxying would create a second place where model identity, request shape, auth and protocol drift must be proven.

## 2. `0xNatoshi/jev-codex-router`

This project is more aggressive: it classifies fresh turns and tool-step continuations, adjusts model plus reasoning effort, logs each decision, supports shadow mode and publishes a replay/backtest methodology.

Its published 7-day replay reports 237 turns and about 59.9% list-price-equivalent savings versus an all-Astra baseline. The repository also states important limits: one operator, stochastic near-ties, token volume held constant, and prompt-cache invalidation from cross-model switching is **not** modelled.

### Mechanisms worth reusing

- **Shadow mode before policy activation.** Decide and log, but do not change the actual model.
- **Decision JSONL / durable calibration history.** Store chosen tier, confidence, reason and observed outcome.
- **Replay/backtest against actual usage.** Calibrate on AIDE's own Tasks instead of copying another user's thresholds.
- **Middle-tier uncertainty fallback.** For a future adaptive mode, uncertainty should not automatically jump to the most expensive model.
- **Reasoning effort is part of routing.** AIDE already models this through configured target identity; future adaptive routing should select model+effort together.

### Do not copy now

- Per-tool-step model switching conflicts with AIDE's frozen Attempt identity and makes evidence/approval/runtime facts harder to attribute.
- The published savings are not directly transferable to AIDE because the workload and cache behaviour differ.
- The external-model "Codex-dry tandem" is a separate provider/failover problem and is outside the current AIDE goal.
- Astra is not part of Current AIDE crossfire policy.

### Recommended synthesis

If AIDE later adds automatic model routing, add a separate explicit mode such as `adaptive`; do not silently redefine `economy` or `capability`.

Proposed boundary:

```text
Task / WorkPackage
  -> optional advisory classifier
  -> AIDE policy gate
     - explicit user preference wins
     - low confidence cannot downgrade
     - only verified configured targets are eligible
     - cache/context guard when telemetry exists
  -> Tutti freezes one configured target
  -> one native Attempt keeps that target for its whole turn/tool loop
```

Before `adaptive` can affect execution, run it in shadow mode and collect AIDE-specific quality/cost/latency history.

## 3. `NiazMorshed2007/jev-review`

This is the most directly compatible review integration because it exposes one local MCP tool, `jev_review`, and leaves repository discovery/editing to the coding agent.

Useful properties:

- caller sends only focused task/diff/files/repository context;
- the tool returns per-dimension scores, confidence and deltas;
- unsupported dimensions can be marked not applicable;
- `previousEvaluation` enables before/after comparison;
- correctness and user requirements explicitly outrank score improvement;
- the review service does not edit the repository;
- context sent to the tool leaves the machine for the TypeSafe JEV API.

### AIDE mapping

JEV Review can fit as an **optional Verification advisor** after deterministic checks, not as a Harness and not as a Task closure authority.

Recommended rules if added later:

1. JEV review is opt-in because code/diff context is sent to an external service.
2. Send the minimum coherent diff + relevant evidence, never the repository by default.
3. Persist score/confidence/delta as review evidence.
4. A low score cannot independently fail acceptance.
5. A reported weakness must be verified against the artifact, requirements or reproducible checks before creating rework.
6. JEV cannot add new acceptance criteria after execution.
7. Stop re-scoring when another change would be score-chasing rather than goal improvement.

This is compatible with AIDE's existing Verification Owner model.

## 4. `devagrawal09/jev-review`

This repository is useful mainly for **review orchestration**, not its UI.

Its staged flow is roughly:

```text
risk screen
  -> choose/profile highest-risk files
  -> choose concrete evidence regions
  -> classify mechanism
  -> score severity
  -> route only bounded follow-ups
```

The implementation caps concurrency and follow-ups instead of asking a reviewer to deeply inspect every file.

### AIDE use

If AIDE later reviews large changes, reuse the staged idea:

- deterministic discovery first;
- cheap/risk-oriented screening;
- deep review only on top signals;
- hard cap on reviewer calls;
- preserve original evidence behind each finding.

Do not add its dashboard or its TypeSafe-specific workflow until AIDE has a real review-scale problem that needs them.

## 5. `LichHsu/codex-desktop-jev-worker`

This is the closest match found to the "JEV Desktop" family: a bounded Codex Desktop Planner A -> Worker B -> Planner A workflow with optional JEV triage.

The most important design choice is that **JEV is not a third worker**. Planner A remains acceptance owner; JEV only focuses review. A score alone cannot reject the worker output, JEV cannot add acceptance criteria, and unavailable JEV falls back to normal direct verification.

### AIDE mapping

AIDE already has a stronger durable version of the A/B topology through Task/WorkPackage/Attempt, one-writer ownership and handoff gates. Do not copy Desktop thread orchestration.

Useful reusable policies are:

- reviewer is evidence/triage, never authority;
- bounded repair loops need durable counters/state rather than conversational memory;
- reviewer results do not count as worker responses;
- stop and ask for a human decision after a bounded repair budget is exhausted;
- verify actual artifacts after a worker reports success.

The response-budget mechanism is worth adding only if real AIDE Tasks begin looping repeatedly; there is not yet evidence that another durable counter is necessary.

## Recommended AIDE roadmap

### Now: reference only

- Keep `economy`, `capability`, and explicit all-Sol `crossfire` unchanged.
- Keep one configured target frozen for the full Attempt.
- Add these repositories to the reuse matrix as external references.
- Do not install JEV, request an API key or transmit code externally without a separate explicit authorization.

### Current evidence-gathering step

Provider-neutral shadow routing telemetry is now implemented before adding JEV itself. New Attempt routing traces can store:

```text
task/work_package
current configured target
advisory tier + effort
confidence
reason/metrics
actual target used
latency/token/quota facts when available
verification result
```

Actual recommendation/assignment/outcome facts are populated now. The advisory slot remains disabled unless an internal `shadowAdvisor` is explicitly supplied; a future JEV or other classifier can populate that slot without changing Broker/Tutti ownership or affecting the Current assignment.

### Only after enough AIDE history exists

Consider an explicit `adaptive` execution strategy. It should route at the WorkPackage/Attempt boundary, not on tool continuations. Thresholds must be calibrated on AIDE's own history, not copied from either JEV Router project.

### Optional review integration

If the user explicitly authorizes TypeSafe/JEV data transfer, integrate `jev_review` as a read-only Verification advisor. Start with one focused post-change review call and persist its evidence. Do not add an automatic score-improvement loop until it demonstrates decision value.
