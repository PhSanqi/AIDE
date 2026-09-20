# AIDE Component Reuse Matrix

Purpose: extract useful mechanisms from Tutti, Broker and HarnessRouter without making any one of them the whole-system skeleton.

| Mechanism | Source idea / evidence | Target owner | V1 action |
|---|---|---|---|
| Goal / Current Truth | Tutti target architecture | Tutti | KEEP |
| Task Graph / dependencies | Tutti target architecture | Tutti | KEEP |
| Routing / Execution / Handoff Capsules | Tutti target architecture + cross-Harness continuity evidence | Tutti | ROUTING + EXECUTION IMPLEMENTED V0; AUTOMATIC SUCCESSOR HANDOFF IMPLEMENTED; DEDICATED DURABLE HANDOFF ENTITY DEFERRED |
| Decisions / constraints / failure history | Tutti target architecture | Tutti | KEEP, bounded |
| Semantic verification / closure | Tutti target architecture | Tutti | KEEP |
| Provider/Harness/model availability | Broker target role | Broker | KEEP |
| Quota / reset / health / load | Broker target role | Broker | KEEP minimal live facts |
| Hard capability gate | Broker target role | Broker | KEEP |
| Context-window / max-output capacity gate | DSH route-capacity metadata + Harness capability discovery pattern | Broker | IMPLEMENTED V0 WHEN FACT IS ADVERTISED; UNKNOWN STAYS UNKNOWN |
| Explainable candidate ranking | Broker target role | Broker | KEEP simple rules first |
| Historical attempt outcomes | Broker target + Current AIDE routing trace | Broker | IMPLEMENTED BASELINE: recommendation/assignment/advisory/resource facts + terminal outcome persisted per new Attempt |
| Task / WorkPackage / Attempt separation | Current Broker proven pattern | Shared Core + Tutti semantics | IMPLEMENTED BASELINE |
| Frozen assignment per Attempt | Current Broker proven pattern | Shared Core | IMPLEMENTED BASELINE |
| One-writer lease | Current Broker proven pattern | Workspace/Evidence | REUSE PATTERN |
| Durable cancellation/recovery | Current Broker + Codex/c9r cancellation semantics | Shared Core + HarnessRouter | IMPLEMENTED BASELINE: `cancelling` NON-TERMINAL + DETACHED DETECTION + QUIESCENCE + ABANDON/REROUTE; NATIVE LIVE REATTACHMENT OPEN |
| Deterministic validation | Current Broker proven pattern | Workspace/Evidence | REUSE PATTERN |
| Safe bounded evidence/audit | Current Broker proven pattern | Shared Core / Evidence | REUSE SIMPLE FORM |
| Start/continue/cancel/status/result | HarnessRouter target | HarnessRouter | KEEP |
| Native session/process ownership | HarnessRouter target | HarnessRouter | KEEP |
| Runtime probe/capabilities | HarnessRouter target | HarnessRouter -> Broker consumes | KEEP |
| Protocol/transport normalization | HarnessRouter target | HarnessRouter | KEEP |
| Capability preflight before execution | HarnessRouter UHP + c9r driver requirement checks | Broker + Tutti | KEEP; DO NOT ASSUME RESUME/CANCEL/PERMISSION/WORKSPACE FEATURES |
| Native Agent Loop/tools/context | Native Harness preservation rule | Native Harness | KEEP, do not abstract away |
| Local project/context space | DevSpace project/workspace pattern | Tutti Context Fabric | IMPLEMENTED V0: one bounded local project source + Work State |
| Symbol / definition / reference search | DevSpace semantic navigation pattern | Tutti Context Fabric | IMPLEMENTED V0: heuristic definitions/references before broad reads |
| Bounded context pack | DevSpace context-pack pattern | Tutti Context Fabric | IMPLEMENTED V0: Current Truth + WorkPackage + relevant symbols; dependency traversal later |
| Context-health / handoff packet | Tutti token-capacity + handoff pattern | Tutti Context Fabric | PLAN AFTER NATIVE USAGE TELEMETRY EXISTS |
| Attempt worktree isolation | Tutti worktree pattern + original AIDE architecture | Workspace/Evidence | PLAN WITH WorkspaceRef + LANDING; DO NOT AUTO-CLOSE ISOLATED CHANGE BEFORE LAND |
| DSH headless launcher | Verified `dsh 0.1.6-alpha.1`: stdin + `--json` events + `--session-id` continuation | HarnessRouter DSH adapter | IMPLEMENTED BASELINE |
| DSH real execution | Authorized smoke run completed with exit 0, native session ID, workspace mutation and accepted evidence | HarnessRouter + Workspace/Evidence + Tutti | VERIFIED FIRST REAL SLICE |
| Broker live capability hard gate | HarnessRouter probe -> availability/capability facts -> explainable candidate/rejection | Broker | IMPLEMENTED V0; NO SCORING YET |
| Codex Desktop bundled `app-server` | Verified desktop package contains `codex-cli 0.154.0-alpha.6.2` with native app-server transports | HarnessRouter Codex Desktop adapter | USE SECOND; DISCOVER RUNTIME, NO GUI AUTOMATION |
| Codex desktop GUI automation | Not needed while bundled native app-server is available | none | AVOID |
| Full transcript sharing | Original non-goal | none | DEFER/AVOID |
| ML routing | Original non-goal | none | DEFER |
| Universal Tool layer | Original non-goal | none | DEFER |
| Distributed workers | Later-phase option | none | DEFER |
| Sticky turn-level model routing | `gargpratyush/jev-router`: route fresh user turns, pin tool-loop continuations | Broker + Tutti | REFERENCE; AIDE already freezes one configured target per Attempt |
| Confidence-gated adaptive tiering | `gargpratyush/jev-router` + `0xNatoshi/jev-codex-router` | Broker policy | REFERENCE FOR FUTURE `adaptive`; DO NOT COPY THRESHOLDS WITHOUT AIDE DATA |
| Shadow routing / replay calibration | `0xNatoshi/jev-codex-router` | Broker + Work State | SHADOW-READY TELEMETRY IMPLEMENTED; OPTIONAL ADVISOR CANNOT ALTER ASSIGNMENT; REPLAY/CALIBRATION STILL NEXT |
| Cache-aware downgrade guard | `gargpratyush/jev-router` | Broker | DEFER UNTIL NATIVE CONTEXT/CACHE TELEMETRY EXISTS |
| JEV scalar quality review | `NiazMorshed2007/jev-review` | Tutti Verification | OPTIONAL EXTERNAL ADVISOR; SCORE IS NOT ACCEPTANCE PROOF; REQUIRES DATA-TRANSFER AUTHORIZATION |
| Staged risk screen -> bounded deep review | `devagrawal09/jev-review` | Tutti Verification | REFERENCE; USE ONLY IF LARGE-DIFF REVIEW COST BECOMES REAL |
| Bounded Planner/Worker review loop + optional JEV triage | `LichHsu/codex-desktop-jev-worker` | Tutti | REUSE POLICY ONLY; DO NOT COPY DESKTOP THREAD TOPOLOGY |

## Rule for reuse

When a mechanism comes from an existing Broker implementation but the target architecture assigns that responsibility elsewhere, reuse the invariant/data shape/algorithm where useful and move ownership to the target module.

Do not preserve an accidental implementation boundary merely because code already exists.

External JEV-family evaluation and the AIDE-specific adoption boundary are documented in `docs/JEV_REFERENCE_EVALUATION.md`.
