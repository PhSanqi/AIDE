function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export function contextBudgetForTarget(target = {}, requirements = {}) {
  const contextWindow = positiveInteger(target.context_window_tokens);
  const maxOutput = positiveInteger(target.max_output_tokens);
  const requiredOutput = positiveInteger(requirements.required_output_tokens);
  const budget = {
    mode: contextWindow === undefined ? "retrieval_first_unknown_capacity" : "target_capacity_known",
    packing: "bounded_structural_v0",
    token_enforcement: "native_tokenizer_pending",
  };
  if (contextWindow !== undefined) budget.context_window_tokens = contextWindow;
  if (maxOutput !== undefined) budget.max_output_tokens = maxOutput;
  if (requiredOutput !== undefined) budget.required_output_tokens = requiredOutput;
  if (contextWindow !== undefined && requiredOutput !== undefined && requiredOutput < contextWindow) {
    budget.input_ceiling_tokens = contextWindow - requiredOutput;
  }
  return budget;
}
