function ratio(value, total) {
  return total === 0 ? null : value / total;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value ?? "unknown"] = (counts[value ?? "unknown"] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function summary(rows) {
  const accepted = rows.filter((row) => row.routing?.outcome?.accepted === true).length;
  const rejected = rows.filter((row) => row.routing?.outcome?.accepted === false).length;
  const durations = rows.map((row) => row.wall_duration_ms).filter(Number.isFinite);
  return {
    attempts: rows.length,
    accepted,
    rejected,
    unknown_acceptance: rows.length - accepted - rejected,
    acceptance_rate: ratio(accepted, accepted + rejected),
    median_duration_ms: median(durations),
    p90_duration_ms: percentile(durations, 0.9),
    terminal_status: countBy(rows.map((row) => row.routing?.outcome?.status ?? null)),
    side_effects: countBy(rows.map((row) => row.routing?.outcome?.side_effects ?? null)),
    usage_scopes: countBy(rows.map((row) => row.routing?.outcome?.usage?.scope ?? null)),
    context_compactions: rows.reduce((total, row) => total + (row.routing?.outcome?.context_health?.compaction_count ?? 0), 0),
    model_reroutes: rows.reduce((total, row) => total + (row.routing?.outcome?.native_model_state?.reroutes?.length ?? 0), 0),
    semantic_review: countBy(rows.map((row) => {
      const review = row.verification?.semantic_review;
      if (!review) return "not_requested";
      if (review.status !== "available") return review.status ?? "unknown";
      return review.accepted === true ? "passed" : "failed";
    })),
    step_verification: countBy(rows.map((row) => {
      const steps = row.verification?.step_verification;
      if (!steps) return "not_requested";
      if (steps.status !== "available") return steps.status ?? "unknown";
      return steps.accepted === true ? "passed" : "failed";
    })),
  };
}

function groupKey(row) {
  const actual = row.routing?.actual ?? {};
  return JSON.stringify([
    actual.role ?? "execution",
    row.routing?.strategy ?? null,
    actual.target_id ?? null,
    actual.model ?? null,
    actual.reasoning_effort ?? null,
  ]);
}

export function replayRoutingHistory(history = []) {
  if (!Array.isArray(history)) throw new TypeError("Routing history must be an array.");
  const groups = new Map();
  for (const row of history) {
    const key = groupKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const summaries = [...groups.entries()].map(([key, rows]) => {
    const [role, strategy, targetId, model, reasoningEffort] = JSON.parse(key);
    return { role, strategy, target_id: targetId, model, reasoning_effort: reasoningEffort, ...summary(rows) };
  }).sort((a, b) => JSON.stringify([a.role, a.strategy, a.target_id, a.model, a.reasoning_effort])
    .localeCompare(JSON.stringify([b.role, b.strategy, b.target_id, b.model, b.reasoning_effort])));

  const advisoryRows = history.filter((row) => row.routing?.advisory?.status === "available");
  const comparableAdvice = advisoryRows.filter((row) => typeof row.routing?.advisory?.advice?.target_id === "string");
  const disagreements = comparableAdvice.filter((row) => row.routing.advisory.advice.target_id !== row.routing?.actual?.target_id).length;
  return {
    version: "routing-replay-v0",
    attempts: history.length,
    groups: summaries,
    advisory: {
      available: advisoryRows.length,
      comparable: comparableAdvice.length,
      disagreements,
      disagreement_rate: ratio(disagreements, comparableAdvice.length),
    },
  };
}

function comparableHistory(history, input) {
  const role = input.actual?.role ?? input.requirements?.target_role ?? "execution";
  const strategy = input.requirements?.execution_strategy ?? null;
  const planConsensus = input.requirements?.plan_consensus ?? "none";
  const decomposition = input.requirements?.semantic_decomposition ?? "none";
  return history.filter((row) => (row.routing?.actual?.role ?? "execution") === role
    && (row.routing?.strategy ?? null) === strategy
    && (row.routing?.plan_consensus ?? "none") === planConsensus
    && (row.routing?.semantic_decomposition ?? "none") === decomposition);
}

export function createHistoricalShadowAdvisor({ historyProvider, minSamples = 10, source = "history-v0" } = {}) {
  if (typeof historyProvider !== "function") throw new TypeError("historyProvider must be a function.");
  if (!Number.isInteger(minSamples) || minSamples < 1) throw new TypeError("minSamples must be a positive integer.");
  return async (input = {}) => {
    const history = await historyProvider();
    if (!Array.isArray(history)) throw new TypeError("historyProvider must return an array.");
    const rows = comparableHistory(history, input);
    const candidates = (input.candidates ?? []).filter((candidate) => typeof candidate?.id === "string");
    const stats = candidates.map((candidate) => {
      const candidateRows = rows.filter((row) => row.routing?.actual?.target_id === candidate.id);
      const metrics = summary(candidateRows);
      return {
        target_id: candidate.id,
        model: candidate.model ?? null,
        reasoning_effort: candidate.reasoning_effort ?? null,
        samples: metrics.attempts,
        accepted: metrics.accepted,
        rejected: metrics.rejected,
        acceptance_rate: metrics.acceptance_rate,
        median_duration_ms: metrics.median_duration_ms,
      };
    }).sort((a, b) => a.target_id.localeCompare(b.target_id));
    const eligible = stats.filter((item) => item.samples >= minSamples && item.acceptance_rate !== null);
    const metrics = { version: "history-v0", min_samples: minSamples, comparable_attempts: rows.length, candidates: stats };
    if (eligible.length < 2 || !eligible.some((item) => item.target_id === input.actual?.id)) {
      return { source, decision: "insufficient_history", reason: "insufficient comparable history for an alternative recommendation", metrics };
    }
    eligible.sort((a, b) => b.acceptance_rate - a.acceptance_rate
      || (a.median_duration_ms ?? Number.POSITIVE_INFINITY) - (b.median_duration_ms ?? Number.POSITIVE_INFINITY)
      || a.target_id.localeCompare(b.target_id));
    const best = eligible[0];
    const decision = best.target_id === input.actual?.id ? "hold" : "recommendation";
    return {
      source,
      decision,
      target_id: best.target_id,
      ...(best.model ? { model: best.model } : {}),
      ...(best.reasoning_effort ? { reasoning_effort: best.reasoning_effort } : {}),
      reason: "historical acceptance rate; median wall duration is the deterministic tiebreak",
      metrics,
    };
  };
}
