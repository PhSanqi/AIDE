import assert from "node:assert/strict";
import test from "node:test";
import { createHistoricalShadowAdvisor, replayRoutingHistory } from "../src/broker/routing-replay.js";

function row({ id, target, accepted, duration, strategy = "economy", role = "execution", advisory = { status: "disabled" }, usageScope = "thread_snapshot" }) {
  return {
    attempt_id: id,
    requirements: { execution_strategy: strategy },
    routing: {
      strategy,
      plan_consensus: "none",
      semantic_decomposition: "none",
      actual: { role, target_id: target, model: target === "capability" ? "large" : "small", reasoning_effort: target === "capability" ? "high" : "low" },
      advisory,
      outcome: {
        status: "completed",
        accepted,
        side_effects: "none",
        context_health: { compaction_count: 0 },
        native_model_state: { reroutes: [] },
        usage: { scope: usageScope },
      },
    },
    verification: { accepted },
    wall_duration_ms: duration,
  };
}

test("routing replay deterministically summarizes outcomes without inventing per-Attempt usage semantics", () => {
  const history = [
    row({ id: "a", target: "economy", accepted: true, duration: 100, advisory: { status: "available", advice: { target_id: "capability" } } }),
    row({ id: "b", target: "economy", accepted: false, duration: 300, advisory: { status: "available", advice: { target_id: "economy" } } }),
    row({ id: "c", target: "capability", accepted: true, duration: 200 }),
  ];
  const report = replayRoutingHistory(history);
  assert.equal(report.version, "routing-replay-v0");
  assert.equal(report.attempts, 3);
  assert.equal(report.groups.length, 2);
  const economy = report.groups.find((group) => group.target_id === "economy");
  assert.equal(economy.attempts, 2);
  assert.equal(economy.acceptance_rate, 0.5);
  assert.equal(economy.median_duration_ms, 200);
  assert.equal(economy.p90_duration_ms, 300);
  assert.deepEqual(economy.usage_scopes, { thread_snapshot: 2 });
  assert.deepEqual(report.advisory, { available: 2, comparable: 2, disagreements: 1, disagreement_rate: 0.5 });
  assert.deepEqual(replayRoutingHistory(history), report);
});

test("historical shadow advisor reports insufficient history instead of guessing", async () => {
  const advisor = createHistoricalShadowAdvisor({
    historyProvider: () => [row({ id: "a", target: "economy", accepted: true, duration: 100 })],
    minSamples: 2,
  });
  const advice = await advisor({
    requirements: { execution_strategy: "economy" },
    candidates: [{ id: "economy", model: "small" }, { id: "capability", model: "large" }],
    actual: { id: "economy", role: "execution" },
  });
  assert.equal(advice.decision, "insufficient_history");
  assert.equal(advice.target_id, undefined);
  assert.equal(advice.metrics.comparable_attempts, 1);
  assert.equal(advice.metrics.min_samples, 2);
});

test("historical shadow advisor uses acceptance first and duration only as deterministic tiebreak", async () => {
  const history = [
    row({ id: "e1", target: "economy", accepted: true, duration: 100 }),
    row({ id: "e2", target: "economy", accepted: false, duration: 100 }),
    row({ id: "c1", target: "capability", accepted: true, duration: 400 }),
    row({ id: "c2", target: "capability", accepted: true, duration: 500 }),
  ];
  const advisor = createHistoricalShadowAdvisor({ historyProvider: () => history, minSamples: 2 });
  const advice = await advisor({
    requirements: { execution_strategy: "economy" },
    candidates: [
      { id: "economy", model: "small", reasoning_effort: "low" },
      { id: "capability", model: "large", reasoning_effort: "high" },
    ],
    actual: { id: "economy", role: "execution" },
  });
  assert.equal(advice.decision, "recommendation");
  assert.equal(advice.target_id, "capability");
  assert.equal(advice.model, "large");
  assert.equal(advice.reasoning_effort, "high");
  assert.equal(advice.metrics.candidates.find((item) => item.target_id === "economy").acceptance_rate, 0.5);
  assert.equal(advice.metrics.candidates.find((item) => item.target_id === "capability").acceptance_rate, 1);
});
