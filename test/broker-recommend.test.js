import assert from "node:assert/strict";
import test from "node:test";
import { recommendCandidates, targetsFromHarnessProbe } from "../src/broker/recommend.js";

test("Broker hard-gates unavailable and incompatible Harness targets", () => {
  const targets = targetsFromHarnessProbe({
    dsh: { available: true, version: "1", capabilities: ["headless", "json_events"] },
    codex: { available: true, version: "2", capabilities: ["app_server"] },
    missing: { available: false, capabilities: ["headless", "json_events"] },
  });
  const result = recommendCandidates({ requirements: { capabilities: ["headless", "json_events"] }, targets });
  assert.deepEqual(result.candidates.map((candidate) => candidate.id), ["dsh"]);
  assert.deepEqual(result.rejected, [
    { id: "codex", reasons: ["missing:headless", "missing:json_events"] },
    { id: "missing", reasons: ["unavailable"] },
  ]);
});

test("Broker treats required context capacity as a hard capability fact", () => {
  const targets = targetsFromHarnessProbe({
    small: { available: true, context_window_tokens: 32_000 },
    unknown: { available: true },
    large: { available: true, model: "large-model", context_window_tokens: 128_000, max_output_tokens: 16_000 },
  });
  const result = recommendCandidates({ requirements: { min_context_window_tokens: 64_000 }, targets });
  assert.deepEqual(result.candidates.map((candidate) => candidate.id), ["large"]);
  assert.equal(result.candidates[0].context_window_tokens, 128_000);
  assert.equal(result.candidates[0].max_output_tokens, 16_000);
  assert.deepEqual(result.rejected, [
    { id: "small", reasons: ["insufficient:context_window_tokens"] },
    { id: "unknown", reasons: ["unknown:context_window_tokens"] },
  ]);
});

test("Broker hard-gates required output capacity without inventing unknown limits", () => {
  const targets = targetsFromHarnessProbe({
    unknown: { available: true, context_window_tokens: 128_000 },
    small: { available: true, context_window_tokens: 128_000, max_output_tokens: 4_000 },
    enough: { available: true, context_window_tokens: 128_000, max_output_tokens: 16_000 },
  });
  const result = recommendCandidates({ requirements: { required_output_tokens: 8_000 }, targets });
  assert.deepEqual(result.candidates.map((candidate) => candidate.id), ["enough"]);
  assert.deepEqual(result.rejected, [
    { id: "small", reasons: ["insufficient:max_output_tokens"] },
    { id: "unknown", reasons: ["unknown:max_output_tokens"] },
  ]);
});

test("Broker rejects output requirements that consume the whole advertised context window", () => {
  const targets = targetsFromHarnessProbe({
    impossible: { available: true, context_window_tokens: 8_000, max_output_tokens: 16_000 },
    enough: { available: true, context_window_tokens: 32_000, max_output_tokens: 16_000 },
  });
  const result = recommendCandidates({ requirements: { required_output_tokens: 8_000 }, targets });
  assert.deepEqual(result.candidates.map((candidate) => candidate.id), ["enough"]);
  assert.deepEqual(result.rejected, [{ id: "impossible", reasons: ["insufficient:context_window_for_output"] }]);
});

test("Broker can exclude the source target during automatic handoff", () => {
  const result = recommendCandidates({
    requirements: { exclude_targets: ["dsh"] },
    targets: [
      { id: "dsh", available: true },
      { id: "codex", available: true },
    ],
  });
  assert.deepEqual(result.candidates.map((item) => item.id), ["codex"]);
  assert.deepEqual(result.rejected, [{ id: "dsh", reasons: ["excluded"] }]);
});

test("Broker freezes the selected Harness approval contract into the assignment candidate", () => {
  const approvalContract = { provider: "codex", transport: "app-server-v2", interactive: true };
  const result = recommendCandidates({
    targets: targetsFromHarnessProbe({ codex: { available: true, approval_contract: approvalContract } }),
  });
  assert.deepEqual(result.candidates[0].approval_contract, approvalContract);
  assert.notEqual(result.candidates[0].approval_contract, approvalContract);
});

test("Broker hard-gates provider-neutral approval requirements without guessing unknown facts", () => {
  const result = recommendCandidates({
    requirements: {
      approval: {
        interactive: true,
        response_channel: true,
        session_grants: "required",
        auto_review: "forbidden",
      },
    },
    targets: [
      { id: "interactive", available: true, approval_contract: { interactive: true, response_capability: true, session_grants: true, auto_review: false } },
      { id: "headless", available: true, approval_contract: { interactive: false, response_capability: false, session_grants: false, auto_review: false, behavior: "fail_closed" } },
      { id: "unknown-review", available: true, approval_contract: { interactive: true, response_capability: true, session_grants: true } },
    ],
  });

  assert.deepEqual(result.candidates.map((candidate) => candidate.id), ["interactive"]);
  assert.deepEqual(result.rejected, [
    { id: "headless", reasons: ["insufficient:approval.interactive"] },
    { id: "unknown-review", reasons: ["unknown:approval.auto_review"] },
  ]);
});

test("Broker only requires fail-closed behavior from unattended approval targets", () => {
  const result = recommendCandidates({
    requirements: { approval: { unattended_fail_closed: true, session_grants: "forbidden", auto_review: "allowed" } },
    targets: [
      { id: "interactive", available: true, approval_contract: { interactive: true, session_grants: false } },
      { id: "safe-headless", available: true, approval_contract: { interactive: false, behavior: "fail_closed", session_grants: false } },
      { id: "unsafe-headless", available: true, approval_contract: { interactive: false, behavior: "continue", session_grants: false } },
      { id: "unknown-session", available: true, approval_contract: { interactive: true } },
    ],
  });

  assert.deepEqual(result.candidates.map((candidate) => candidate.id), ["interactive", "safe-headless"]);
  assert.deepEqual(result.rejected, [
    { id: "unknown-session", reasons: ["unknown:approval.session_grants"] },
    { id: "unsafe-headless", reasons: ["insufficient:approval.unattended_fail_closed"] },
  ]);
});

test("Broker rejects misspelled approval requirements before routing", () => {
  assert.throws(
    () => recommendCandidates({ requirements: { approval: { interative: true } }, targets: [] }),
    /Unknown requirements\.approval field: interative/,
  );
});

test("Broker ranks explicit economy and capability profiles without treating planning targets as executors", () => {
  const targets = [
    { id: "economy", available: true, strategy_priority: { economy: 0, capability: 100 } },
    { id: "capability", available: true, strategy_priority: { economy: 100, capability: 0 } },
    { id: "unknown", available: true },
    { id: "plan", available: true, role: "planning", capabilities: ["planning_mode"], approval_contract: { sandbox_mode: "read-only" } },
  ];

  const economy = recommendCandidates({ requirements: { execution_strategy: "economy" }, targets });
  assert.deepEqual(economy.candidates.map((candidate) => candidate.id), ["economy", "capability", "unknown"]);
  assert.deepEqual(economy.rejected, [{ id: "plan", reasons: ["role:planning"] }]);
  assert.ok(economy.candidates[0].reasons.includes("strategy:economy:priority=0"));

  const capability = recommendCandidates({ requirements: { execution_strategy: "capability" }, targets });
  assert.deepEqual(capability.candidates.map((candidate) => candidate.id), ["capability", "economy", "unknown"]);

  const planning = recommendCandidates({ requirements: { target_role: "planning", capabilities: ["planning_mode"], sandbox_mode: "read-only" }, targets });
  assert.deepEqual(planning.candidates.map((candidate) => candidate.id), ["plan"]);
});

test("Broker fail-closes planning sandbox requirements", () => {
  const result = recommendCandidates({
    requirements: { target_role: "planning", capabilities: ["planning_mode"], sandbox_mode: "read-only" },
    targets: [
      { id: "safe", available: true, role: "planning", capabilities: ["planning_mode"], approval_contract: { sandbox_mode: "read-only" } },
      { id: "writable", available: true, role: "planning", capabilities: ["planning_mode"], approval_contract: { sandbox_mode: "workspace-write" } },
      { id: "unknown", available: true, role: "planning", capabilities: ["planning_mode"] },
    ],
  });
  assert.deepEqual(result.candidates.map((candidate) => candidate.id), ["safe"]);
  assert.deepEqual(result.rejected, [
    { id: "unknown", reasons: ["unknown:sandbox_mode"] },
    { id: "writable", reasons: ["insufficient:sandbox_mode:workspace-write"] },
  ]);
});

test("Broker keeps verification targets separate from execution and planning", () => {
  const targets = [
    { id: "exec", available: true, role: "execution", capabilities: ["structured_output"] },
    { id: "plan", available: true, role: "planning", capabilities: ["structured_output"], approval_contract: { sandbox_mode: "read-only" } },
    { id: "review", available: true, role: "verification", capabilities: ["structured_output", "context_retrieval"], approval_contract: { sandbox_mode: "read-only" } },
  ];
  const verification = recommendCandidates({
    requirements: { target_role: "verification", capabilities: ["structured_output", "context_retrieval"], sandbox_mode: "read-only" },
    targets,
  });
  assert.deepEqual(verification.candidates.map((candidate) => candidate.id), ["review"]);
  assert.deepEqual(verification.rejected, [
    { id: "exec", reasons: ["role:execution"] },
    { id: "plan", reasons: ["role:planning"] },
  ]);
});

test("Broker rejects unknown execution strategies instead of silently choosing a model", () => {
  assert.throws(() => recommendCandidates({ requirements: { execution_strategy: "cheap-ish" }, targets: [] }), /execution_strategy/);
});

test("Broker preserves provider resource facts as routing evidence without ranking on them", () => {
  const resourceFacts = { rate_limits: { ordinary_usage_allowed: true, limits: [{ limit_id: "codex", primary: { used_percent: 42 } }] } };
  const result = recommendCandidates({ requirements: {}, targets: [{ id: "codex", available: true, resource_facts: resourceFacts }] });
  assert.deepEqual(result.candidates[0].resource_facts, resourceFacts);
});

test("Broker qualifies an explicit Codex model/effort inside an already-qualified target profile", () => {
  const modelDirectory = [
    { id: "gpt-small", model: "gpt-small", default_reasoning_effort: "medium", reasoning_efforts: ["low", "medium"], multi_agent_version: "v1" },
    { id: "gpt-large", model: "gpt-large", default_reasoning_effort: "high", reasoning_efforts: ["medium", "high", "ultra"], multi_agent_version: "v2" },
  ];
  const targets = [
    { id: "codex-capability", available: true, provider: "codex", capabilities: ["app_server", "proactive_multi_agent"], model: "gpt-large", reasoning_effort: "ultra", model_directory: modelDirectory },
    { id: "dsh", available: true, capabilities: ["headless"] },
  ];

  const selected = recommendCandidates({
    requirements: { requested_model: "gpt-small", requested_reasoning_effort: "low" },
    targets,
  });
  assert.equal(selected.candidates.length, 1);
  assert.equal(selected.candidates[0].id, "codex-capability");
  assert.equal(selected.candidates[0].model, "gpt-small");
  assert.equal(selected.candidates[0].reasoning_effort, "low");
  assert.equal(selected.candidates[0].capabilities.includes("proactive_multi_agent"), false);
  assert.deepEqual(selected.rejected, [{ id: "dsh", reasons: ["unsupported:model_selection"] }]);

  const defaultEffort = recommendCandidates({ requirements: { requested_model: "gpt-large" }, targets });
  assert.equal(defaultEffort.candidates[0].reasoning_effort, "high");
});

test("Broker fail-closes unavailable model/effort requests and model-dependent capabilities", () => {
  const target = {
    id: "codex",
    available: true,
    provider: "codex",
    capabilities: ["app_server", "proactive_multi_agent"],
    model_directory: [{ id: "gpt-small", model: "gpt-small", default_reasoning_effort: "medium", reasoning_efforts: ["low", "medium"], multi_agent_version: "v1" }],
  };
  assert.deepEqual(recommendCandidates({ requirements: { requested_model: "missing" }, targets: [target] }).rejected, [
    { id: "codex", reasons: ["unavailable:model:missing"] },
  ]);
  assert.deepEqual(recommendCandidates({ requirements: { requested_model: "gpt-small", requested_reasoning_effort: "ultra" }, targets: [target] }).rejected, [
    { id: "codex", reasons: ["unavailable:reasoning_effort:ultra"] },
  ]);
  assert.deepEqual(recommendCandidates({ requirements: { requested_model: "gpt-small", capabilities: ["proactive_multi_agent"] }, targets: [target] }).rejected, [
    { id: "codex", reasons: ["missing:proactive_multi_agent"] },
  ]);
  assert.throws(() => recommendCandidates({ requirements: { requested_reasoning_effort: "medium" }, targets: [target] }), /requires requested_model/);
});
