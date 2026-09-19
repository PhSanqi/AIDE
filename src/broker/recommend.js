function missingCapabilities(target, required) {
  const actual = new Set(target.capabilities ?? []);
  return required.filter((capability) => !actual.has(capability));
}

const APPROVAL_MODES = new Set(["allowed", "required", "forbidden"]);
const APPROVAL_FIELDS = new Set(["interactive", "response_channel", "unattended_fail_closed", "session_grants", "auto_review"]);
const EXECUTION_STRATEGIES = new Set(["economy", "capability"]);
const TARGET_ROLES = new Set(["execution", "planning", "verification"]);
const SANDBOX_MODES = new Set(["read-only", "workspace-write", "danger-full-access"]);

function approvalRequirements(requirements) {
  const approval = requirements.approval;
  if (approval === undefined) return null;
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
    throw new TypeError("requirements.approval must be an object.");
  }
  for (const field of Object.keys(approval)) {
    if (!APPROVAL_FIELDS.has(field)) throw new TypeError(`Unknown requirements.approval field: ${field}.`);
  }
  for (const field of ["interactive", "response_channel", "unattended_fail_closed"]) {
    if (approval[field] !== undefined && typeof approval[field] !== "boolean") {
      throw new TypeError(`requirements.approval.${field} must be a boolean.`);
    }
  }
  for (const field of ["session_grants", "auto_review"]) {
    if (approval[field] !== undefined && !APPROVAL_MODES.has(approval[field])) {
      throw new TypeError(`requirements.approval.${field} must be allowed, required, or forbidden.`);
    }
  }
  return approval;
}

function approvalRejection(approval, contract) {
  if (approval === null) return null;
  const needsContract = approval.interactive === true
    || approval.response_channel === true
    || approval.unattended_fail_closed === true
    || approval.session_grants === "required"
    || approval.session_grants === "forbidden"
    || approval.auto_review === "required"
    || approval.auto_review === "forbidden";
  if (!needsContract) return null;
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) return "unknown:approval_contract";

  if (approval.interactive === true) {
    if (typeof contract.interactive !== "boolean") return "unknown:approval.interactive";
    if (!contract.interactive) return "insufficient:approval.interactive";
  }
  if (approval.response_channel === true) {
    if (typeof contract.response_capability !== "boolean") return "unknown:approval.response_capability";
    if (!contract.response_capability) return "insufficient:approval.response_capability";
  }
  if (approval.unattended_fail_closed === true) {
    if (typeof contract.interactive !== "boolean") return "unknown:approval.interactive";
    if (!contract.interactive) {
      if (typeof contract.behavior !== "string") return "unknown:approval.behavior";
      if (contract.behavior !== "fail_closed") return "insufficient:approval.unattended_fail_closed";
    }
  }

  for (const field of ["session_grants", "auto_review"]) {
    const mode = approval[field];
    if (mode === undefined || mode === "allowed") continue;
    if (typeof contract[field] !== "boolean") return `unknown:approval.${field}`;
    if (mode === "required" && !contract[field]) return `insufficient:approval.${field}`;
    if (mode === "forbidden" && contract[field]) return `forbidden:approval.${field}`;
  }
  return null;
}

export function approvalRequirementRejection(requirements = {}, approvalContract = null) {
  return approvalRejection(approvalRequirements(requirements), approvalContract);
}

export function recommendCandidates({ requirements = {}, targets = [] } = {}) {
  const required = Array.isArray(requirements.capabilities) ? [...new Set(requirements.capabilities)].sort() : [];
  const approval = approvalRequirements(requirements);
  const requestedModel = requirements.requested_model ?? null;
  if (requestedModel !== null && (typeof requestedModel !== "string" || requestedModel.trim().length === 0)) throw new TypeError("requested_model must be a non-empty string.");
  const requestedEffort = requirements.requested_reasoning_effort ?? null;
  if (requestedEffort !== null && (typeof requestedEffort !== "string" || requestedEffort.trim().length === 0)) throw new TypeError("requested_reasoning_effort must be a non-empty string.");
  if (requestedEffort !== null && requestedModel === null) throw new TypeError("requested_reasoning_effort requires requested_model.");
  const strategy = requirements.execution_strategy ?? null;
  if (strategy !== null && !EXECUTION_STRATEGIES.has(strategy)) throw new TypeError("execution_strategy must be economy or capability.");
  const targetRole = requirements.target_role ?? "execution";
  if (!TARGET_ROLES.has(targetRole)) throw new TypeError("target_role must be execution, planning, or verification.");
  const sandboxMode = requirements.sandbox_mode ?? null;
  if (sandboxMode !== null && !SANDBOX_MODES.has(sandboxMode)) throw new TypeError("sandbox_mode must be read-only, workspace-write, or danger-full-access.");
  const excluded = new Set(Array.isArray(requirements.exclude_targets) ? requirements.exclude_targets.filter((value) => typeof value === "string") : []);
  const minimumContext = Number.isInteger(requirements.min_context_window_tokens) && requirements.min_context_window_tokens > 0
    ? requirements.min_context_window_tokens
    : null;
  const requiredOutput = Number.isInteger(requirements.required_output_tokens) && requirements.required_output_tokens > 0
    ? requirements.required_output_tokens
    : null;
  const candidates = [];
  const rejected = [];

  for (const target of targets) {
    if (!target || typeof target.id !== "string") continue;
    if (excluded.has(target.id)) {
      rejected.push({ id: target.id, reasons: ["excluded"] });
      continue;
    }
    if (target.available !== true) {
      rejected.push({ id: target.id, reasons: ["unavailable"] });
      continue;
    }
    const role = target.role ?? "execution";
    if (role !== targetRole) {
      rejected.push({ id: target.id, reasons: [`role:${role}`] });
      continue;
    }
    if (sandboxMode !== null) {
      const actualSandbox = target.approval_contract?.sandbox_mode;
      if (typeof actualSandbox !== "string") {
        rejected.push({ id: target.id, reasons: ["unknown:sandbox_mode"] });
        continue;
      }
      if (actualSandbox !== sandboxMode) {
        rejected.push({ id: target.id, reasons: [`insufficient:sandbox_mode:${actualSandbox}`] });
        continue;
      }
    }
    let effectiveModel = typeof target.model === "string" ? target.model : null;
    let effectiveEffort = typeof target.reasoning_effort === "string" ? target.reasoning_effort : null;
    let effectiveCapabilities = [...(target.capabilities ?? [])];
    if (requestedModel !== null) {
      if (!Array.isArray(target.model_directory)) {
        rejected.push({ id: target.id, reasons: ["unsupported:model_selection"] });
        continue;
      }
      const model = target.model_directory.find((item) => item?.id === requestedModel || item?.model === requestedModel) ?? null;
      if (!model) {
        rejected.push({ id: target.id, reasons: [`unavailable:model:${requestedModel}`] });
        continue;
      }
      if (requestedEffort !== null && !model.reasoning_efforts?.includes(requestedEffort)) {
        rejected.push({ id: target.id, reasons: [`unavailable:reasoning_effort:${requestedEffort}`] });
        continue;
      }
      effectiveModel = model.model ?? model.id;
      effectiveEffort = requestedEffort ?? model.default_reasoning_effort ?? null;
      if (!(effectiveEffort === "ultra" && model.multi_agent_version && model.multi_agent_version !== "disabled")) {
        effectiveCapabilities = effectiveCapabilities.filter((capability) => capability !== "proactive_multi_agent");
      }
    }
    const missing = missingCapabilities({ capabilities: effectiveCapabilities }, required);
    if (missing.length) {
      rejected.push({ id: target.id, reasons: missing.map((capability) => `missing:${capability}`) });
      continue;
    }
    const approvalReason = approvalRejection(approval, target.approval_contract);
    if (approvalReason) {
      rejected.push({ id: target.id, reasons: [approvalReason] });
      continue;
    }
    if (minimumContext !== null && !Number.isInteger(target.context_window_tokens)) {
      rejected.push({ id: target.id, reasons: ["unknown:context_window_tokens"] });
      continue;
    }
    if (minimumContext !== null && target.context_window_tokens < minimumContext) {
      rejected.push({ id: target.id, reasons: ["insufficient:context_window_tokens"] });
      continue;
    }
    if (requiredOutput !== null && !Number.isInteger(target.max_output_tokens)) {
      rejected.push({ id: target.id, reasons: ["unknown:max_output_tokens"] });
      continue;
    }
    if (requiredOutput !== null && Number.isInteger(target.context_window_tokens) && requiredOutput >= target.context_window_tokens) {
      rejected.push({ id: target.id, reasons: ["insufficient:context_window_for_output"] });
      continue;
    }
    if (requiredOutput !== null && target.max_output_tokens < requiredOutput) {
      rejected.push({ id: target.id, reasons: ["insufficient:max_output_tokens"] });
      continue;
    }
    const candidate = {
      id: target.id,
      harness: target.harness ?? target.id,
      version: target.version ?? null,
      role,
      capabilities: [...effectiveCapabilities].sort(),
      reasons: [
        "available",
        ...required.map((capability) => `capability:${capability}`),
        ...(minimumContext === null ? [] : [`context_window>=${minimumContext}`]),
        ...(requiredOutput === null ? [] : [`max_output>=${requiredOutput}`]),
        ...(approval === null ? [] : ["approval_policy_compatible"]),
        ...(sandboxMode === null ? [] : [`sandbox:${sandboxMode}`]),
      ],
    };
    if (typeof effectiveModel === "string") candidate.model = effectiveModel;
    if (typeof target.provider === "string") candidate.provider = target.provider;
    if (typeof effectiveEffort === "string") candidate.reasoning_effort = effectiveEffort;
    if (typeof target.collaboration_mode === "string") candidate.collaboration_mode = target.collaboration_mode;
    if (target.strategy_priority && typeof target.strategy_priority === "object" && !Array.isArray(target.strategy_priority)) {
      candidate.strategy_priority = structuredClone(target.strategy_priority);
      const priority = target.strategy_priority[strategy];
      if (strategy !== null && Number.isInteger(priority)) candidate.reasons.push(`strategy:${strategy}:priority=${priority}`);
    }
    if (target.resource_facts && typeof target.resource_facts === "object" && !Array.isArray(target.resource_facts)) {
      candidate.resource_facts = structuredClone(target.resource_facts);
    }
    if (Number.isInteger(target.context_window_tokens) && target.context_window_tokens > 0) candidate.context_window_tokens = target.context_window_tokens;
    if (Number.isInteger(target.max_output_tokens) && target.max_output_tokens > 0) candidate.max_output_tokens = target.max_output_tokens;
    if (target.approval_contract && typeof target.approval_contract === "object" && !Array.isArray(target.approval_contract)) {
      candidate.approval_contract = structuredClone(target.approval_contract);
    }
    candidates.push(candidate);
  }

  candidates.sort((a, b) => {
    if (strategy !== null) {
      const left = a.strategy_priority?.[strategy];
      const right = b.strategy_priority?.[strategy];
      const leftKnown = Number.isInteger(left);
      const rightKnown = Number.isInteger(right);
      if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
      if (leftKnown && rightKnown && left !== right) return left - right;
    }
    return a.id.localeCompare(b.id);
  });
  rejected.sort((a, b) => a.id.localeCompare(b.id));
  return { candidates, rejected };
}

export function targetsFromHarnessProbe(probe = {}) {
  return Object.entries(probe).map(([harness, value]) => ({ id: harness, harness, ...value }));
}
