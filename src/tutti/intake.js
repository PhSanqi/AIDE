import { approvalRequirementRejection, recommendCandidates, targetsFromHarnessProbe } from "../broker/recommend.js";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { hostname as systemHostname } from "node:os";
import { collectFileEvidence } from "../workspace/evidence.js";
import { GitWorkspaceManager } from "../workspace/git-workspace.js";
import { localProcessTreeAlive } from "../platform/runtime.js";
import { evaluateAcceptance } from "./acceptance.js";
import { closeAcceptedTask } from "./task-closure.js";

function chooseAssignment(recommendation, requirements, { noneCode, noneMessage, decisionPrefix = "" } = {}) {
  const candidates = recommendation.candidates ?? [];
  if (candidates.length === 0) throw Object.assign(new Error(noneMessage), { code: noneCode, recommendation });
  const preferred = Array.isArray(requirements?.preferred_targets)
    ? requirements.preferred_targets.filter((value) => typeof value === "string" && value.length > 0)
    : [];
  for (const targetId of preferred) {
    const match = candidates.find((candidate) => candidate.id === targetId);
    if (match) return { ...match, decision_reason: `${decisionPrefix}preferred_target` };
  }
  const strategy = requirements?.execution_strategy;
  if (["economy", "capability"].includes(strategy) && Number.isInteger(candidates[0]?.strategy_priority?.[strategy])) {
    const best = candidates[0].strategy_priority[strategy];
    const tied = candidates.filter((candidate) => candidate.strategy_priority?.[strategy] === best);
    if (tied.length === 1) return { ...candidates[0], decision_reason: `${decisionPrefix}strategy_${strategy}` };
  }
  if (candidates.length === 1) return { ...candidates[0], decision_reason: `${decisionPrefix}only_qualified_candidate` };
  throw Object.assign(new Error("Multiple qualified Harnesses require an explicit Tutti assignment preference."), {
    code: "HARNESS_ASSIGNMENT_AMBIGUOUS",
    recommendation,
    candidate_ids: candidates.map((candidate) => candidate.id),
  });
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw Object.assign(new Error("AIDE service supervision was aborted."), {
    code: "SERVICE_RUNTIME_ABORTED",
    reason: signal.reason ?? null,
  });
}

function localProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

function localProcessGroupAlive(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

function canonicalJson(value) {
  const normalize = (item) => {
    if (Array.isArray(item)) return item.map((entry) => normalize(entry));
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.keys(item).sort().filter((key) => item[key] !== undefined).map((key) => [key, normalize(item[key])]));
    }
    return item === undefined ? null : item;
  };
  return JSON.stringify(normalize(value));
}

function normalizeRoutingAdvice(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Shadow routing advice must be an object.");
  const source = typeof value.source === "string" ? value.source.trim() : "";
  if (!source) throw new TypeError("Shadow routing advice requires source.");
  if (value.confidence !== undefined && (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1)) {
    throw new TypeError("Shadow routing advice confidence must be between 0 and 1.");
  }
  const advice = { source };
  if (value.decision !== undefined) {
    if (!["insufficient_history", "hold", "recommendation"].includes(value.decision)) throw new TypeError("Shadow routing advice decision is invalid.");
    advice.decision = value.decision;
  }
  for (const field of ["strategy", "target_id", "model", "reasoning_effort", "reason"]) {
    if (value[field] === undefined) continue;
    if (typeof value[field] !== "string" || value[field].trim().length === 0) throw new TypeError(`Shadow routing advice ${field} must be a non-empty string.`);
    advice[field] = value[field].trim();
  }
  if (value.confidence !== undefined) advice.confidence = value.confidence;
  if (value.metrics !== undefined) {
    if (!value.metrics || typeof value.metrics !== "object" || Array.isArray(value.metrics)) throw new TypeError("Shadow routing advice metrics must be an object.");
    advice.metrics = structuredClone(value.metrics);
  }
  return advice;
}

function semanticAcceptanceCriteria(acceptance) {
  const value = acceptance?.semantic ?? [];
  if (!Array.isArray(value) || value.length > 16) throw new TypeError("acceptance.semantic must be an array with at most 16 criteria.");
  return value.map((criterion) => {
    if (typeof criterion !== "string" || criterion.trim().length === 0 || criterion.length > 1_000) {
      throw new TypeError("acceptance.semantic criteria must be non-empty strings up to 1000 characters.");
    }
    return criterion.trim();
  });
}

function semanticReviewCriteria(task) {
  const user = semanticAcceptanceCriteria(task.acceptance);
  const decision = task.semantic_decision;
  const rawSteps = decision?.decision === "decompose" ? decision.steps : [];
  const invalidStepVerification = rawSteps.some((step) => typeof step?.verification !== "string" || step.verification.trim().length === 0 || step.verification.length > 1_000);
  const steps = invalidStepVerification
    ? []
    : rawSteps.map((step, index) => ({
        step_index: index + 1,
        objective: step.objective,
        criterion: step.verification.trim(),
      }))
  return {
    user,
    steps,
    criteria: [...user, ...steps.map((step) => step.criterion)],
    invalid_step_verification: invalidStepVerification,
    step_verification_required: decision?.decision === "decompose",
  };
}

function semanticReviewFingerprint({ task, workPackage, attempt, result, evidence, criteria }) {
  return createHash("sha256").update(canonicalJson({
    task_id: task.task_id,
    work_package_id: workPackage.work_package_id,
    attempt_id: attempt.attempt_id,
    goal: task.objective,
    constraints: task.constraints ?? [],
    criteria,
    result,
    evidence: boundedReviewEvidence(evidence).files,
  })).digest("hex");
}

function normalizeSemanticVerification(value, criteria) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.source !== "string" || value.source.trim().length === 0 || !Array.isArray(value.checks)) {
    throw new TypeError("Semantic verification must contain source and checks.");
  }
  if (value.checks.length !== criteria.length) throw new TypeError("Semantic verification must return exactly one check per requested criterion.");
  const checks = value.checks.map((check, index) => {
    if (!check || typeof check !== "object" || Array.isArray(check) || check.criterion !== criteria[index] || typeof check.passed !== "boolean"
      || typeof check.reason !== "string" || check.reason.trim().length === 0 || check.reason.length > 2_000) {
      throw new TypeError("Semantic verification checks must preserve criterion order and contain passed:boolean plus bounded reason.");
    }
    return { criterion: check.criterion, passed: check.passed, reason: check.reason.trim() };
  });
  let provenance = null;
  if (value.provenance !== undefined) {
    const item = value.provenance;
    if (!item || typeof item !== "object" || Array.isArray(item)
      || typeof item.target_id !== "string" || item.target_id.length === 0
      || typeof item.harness !== "string" || item.harness.length === 0
      || item.role !== "verification"
      || typeof item.run_id !== "string" || item.run_id.length === 0
      || (item.session_id !== null && item.session_id !== undefined && typeof item.session_id !== "string")
      || (item.requested_model !== null && item.requested_model !== undefined && typeof item.requested_model !== "string")
      || (item.effective_model !== null && item.effective_model !== undefined && typeof item.effective_model !== "string")
      || (item.reasoning_effort !== null && item.reasoning_effort !== undefined && typeof item.reasoning_effort !== "string")
      || (item.usage !== null && item.usage !== undefined && (!item.usage || typeof item.usage !== "object" || Array.isArray(item.usage)))
      || !Array.isArray(item.reroutes)
      || !Number.isInteger(item.context_compaction_count) || item.context_compaction_count < 0) {
      throw new TypeError("Semantic verification provenance is invalid.");
    }
    provenance = {
      target_id: item.target_id,
      harness: item.harness,
      role: "verification",
      requested_model: item.requested_model ?? null,
      effective_model: item.effective_model ?? null,
      reasoning_effort: item.reasoning_effort ?? null,
      run_id: item.run_id,
      session_id: item.session_id ?? null,
      usage: item.usage === undefined ? null : structuredClone(item.usage),
      reroutes: structuredClone(item.reroutes),
      context_compaction_count: item.context_compaction_count,
    };
  }
  return { source: value.source.trim(), checks, accepted: checks.every((check) => check.passed), ...(provenance === null ? {} : { provenance }) };
}

function semanticReviewOutputSchema(criteria) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["checks"],
    properties: {
      checks: {
        type: "array",
        minItems: criteria.length,
        maxItems: criteria.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["criterion", "passed", "reason"],
          properties: {
            criterion: { type: "string" },
            passed: { type: "boolean" },
            reason: { type: "string" },
          },
        },
      },
    },
  };
}

function boundedReviewEvidence(evidence) {
  return {
    workspace: evidence?.workspace ?? null,
    files: (evidence?.files ?? []).slice(0, 32).map((file) => ({
      path: file.path,
      size: file.size ?? null,
      sha256: file.sha256 ?? null,
    })),
  };
}

export function createHarnessSemanticVerifier({ router, targetId = process.env.AIDE_SEMANTIC_REVIEW_TARGET ?? "codex-review", timeoutMs = 120_000, pollMs = 50 } = {}) {
  if (!router || typeof router.probe !== "function" || typeof router.start !== "function" || typeof router.result !== "function" || typeof router.events !== "function" || typeof router.cancel !== "function") {
    throw new TypeError("Harness semantic verifier requires HarnessRouter probe/start/result/events/cancel.");
  }
  if (typeof targetId !== "string" || targetId.length === 0) throw new TypeError("Semantic review targetId must be a non-empty string.");
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError("Semantic review timeoutMs must be a positive integer.");
  if (!Number.isInteger(pollMs) || pollMs <= 0) throw new TypeError("Semantic review pollMs must be a positive integer.");

  return async (input) => {
    const criteria = semanticAcceptanceCriteria({ semantic: input.criteria });
    throwIfAborted(input.signal);
    const requirements = {
      target_role: "verification",
      capabilities: ["structured_output", "context_retrieval"],
      sandbox_mode: "read-only",
      preferred_targets: [targetId],
    };
    const recommendation = recommendCandidates({ requirements, targets: targetsFromHarnessProbe(await router.probe()) });
    const assignment = chooseAssignment(recommendation, requirements, {
      noneCode: "NO_QUALIFIED_SEMANTIC_VERIFIER",
      noneMessage: "Broker found no qualified read-only structured semantic verifier.",
      decisionPrefix: "semantic_verification_",
    });
    const prompt = [
      "You are the read-only semantic verification evidence producer for AIDE.",
      "Evaluate only the exact criteria supplied below. Do not add criteria, alter Task constraints, authorize side effects, or decide Task closure.",
      "Return each criterion verbatim and in the same order with passed:boolean and a concise evidence-grounded reason.",
      "Use aide_context only when needed to inspect the current workspace. Do not invoke command, network, or write tools.",
      `Goal: ${JSON.stringify(input.goal)}`,
      `Constraints: ${JSON.stringify(input.constraints)}`,
      `Criteria: ${JSON.stringify(criteria)}`,
      `Native result: ${JSON.stringify({ status: input.result?.status ?? null, final_text: typeof input.result?.final_text === "string" ? input.result.final_text.slice(0, 8_000) : null })}`,
      `Mechanical evidence refs: ${JSON.stringify(boundedReviewEvidence(input.evidence))}`,
      `Current Truth: ${JSON.stringify((input.current_truth ?? []).slice(-20))}`,
    ].join("\n");
    const started = router.start({
      harness: assignment.harness,
      task: prompt,
      cwd: input.workspace,
      context: input.context,
      outputSchema: semanticReviewOutputSchema(criteria),
    });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (input.signal?.aborted) {
        router.cancel(started.run_id);
        throwIfAborted(input.signal);
      }
      const result = router.result(started.run_id);
      if (result.ready) {
        if (result.status !== "completed") {
          throw Object.assign(new Error("Semantic verifier Harness did not complete successfully."), { code: "SEMANTIC_VERIFIER_HARNESS_FAILED", result });
        }
        const batch = router.events(started.run_id, { after: 0 });
        if (batch.gap) throw Object.assign(new Error("Semantic verifier event evidence is incomplete."), { code: "SEMANTIC_VERIFIER_EVENT_GAP" });
        const events = batch.events.map((item) => item.event);
        const unsafeSideEffect = events.find((event) => event?.type === "side_effect" && event.classification !== "none");
        if (unsafeSideEffect) throw Object.assign(new Error("Semantic verifier emitted a side-effect event."), { code: "SEMANTIC_VERIFIER_SIDE_EFFECT", event: unsafeSideEffect });
        let parsed;
        try { parsed = JSON.parse(result.final_text ?? ""); }
        catch { throw Object.assign(new Error("Semantic verifier returned invalid JSON."), { code: "SEMANTIC_VERIFIER_OUTPUT_INVALID" }); }
        const reroutes = events.filter((event) => event?.type === "model_reroute").map((event) => ({
          from_model: event.fromModel,
          to_model: event.toModel,
          reason: event.reason,
          turn_id: event.turnId,
        }));
        const effectiveModel = reroutes.at(-1)?.to_model ?? assignment.model ?? null;
        return {
          source: `${assignment.id}:${assignment.model ?? "native"}:${assignment.reasoning_effort ?? "default"}`,
          checks: parsed.checks,
          provenance: {
            target_id: assignment.id,
            harness: assignment.harness,
            role: "verification",
            requested_model: assignment.model ?? null,
            effective_model: effectiveModel,
            reasoning_effort: assignment.reasoning_effort ?? null,
            run_id: started.run_id,
            session_id: result.session_id ?? null,
            usage: result.usage ?? null,
            reroutes,
            context_compaction_count: events.filter((event) => event?.type === "context_health" && event.event === "compaction").length,
          },
        };
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, pollMs));
    }
    router.cancel(started.run_id);
    throw Object.assign(new Error("Semantic verifier timed out."), { code: "SEMANTIC_VERIFIER_TIMEOUT", run_id: started.run_id });
  };
}

function routingTrace(submitted) {
  const assignment = submitted.assignment ?? {};
  const recommendation = submitted.recommendation ?? {};
  return {
    strategy: submitted.work_package.requirements?.execution_strategy ?? null,
    plan_consensus: submitted.work_package.requirements?.plan_consensus ?? "none",
    semantic_decomposition: submitted.work_package.requirements?.semantic_decomposition ?? "none",
    recommendation: {
      candidate_ids: (recommendation.candidates ?? []).map((candidate) => candidate.id),
      rejected: structuredClone(recommendation.rejected ?? []),
    },
    actual: {
      target_id: assignment.id ?? null,
      harness: assignment.harness ?? null,
      role: assignment.role ?? "execution",
      model: assignment.model ?? null,
      reasoning_effort: assignment.reasoning_effort ?? null,
      decision_reason: assignment.decision_reason ?? null,
      resource_facts: assignment.resource_facts ? structuredClone(assignment.resource_facts) : null,
    },
    advisory: structuredClone(submitted.routing_advice ?? { status: "disabled" }),
    started_at: null,
    outcome: null,
  };
}

const DEFAULT_PLAN_TARGETS = ["codex-plan", "codex-plan-alt"];
const DEFAULT_DECOMPOSITION_TARGET = "codex-plan";
const SEMANTIC_DECOMPOSITION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "reason", "work_packages"],
  properties: {
    decision: { enum: ["single", "decompose"] },
    reason: { type: "string" },
    work_packages: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["objective", "verification"],
        properties: {
          objective: { type: "string" },
          verification: { type: "string" },
        },
      },
    },
  },
};

function planConsensus(requirements) {
  const mode = requirements?.plan_consensus ?? "none";
  if (!["none", "dual"].includes(mode)) throw new TypeError("plan_consensus must be none or dual.");
  if (mode === "dual" && requirements.execution_strategy !== "capability") {
    throw new TypeError("plan_consensus=dual requires execution_strategy=capability.");
  }
  const targets = requirements?.plan_targets ?? DEFAULT_PLAN_TARGETS;
  if (!Array.isArray(targets) || targets.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new TypeError("plan_targets must be an array of non-empty target ids.");
  }
  const unique = [...new Set(targets)];
  if (mode === "dual" && unique.length !== 2) throw new TypeError("plan_consensus=dual requires exactly two distinct plan_targets.");
  return { mode, targets: unique };
}

function semanticDecomposition(requirements) {
  const mode = requirements?.semantic_decomposition ?? "none";
  if (!["none", "plan"].includes(mode)) throw new TypeError("semantic_decomposition must be none or plan.");
  if (mode === "plan" && requirements.execution_strategy !== "capability") {
    throw new TypeError("semantic_decomposition=plan requires execution_strategy=capability.");
  }
  if (mode === "plan" && requirements.plan_consensus !== undefined && requirements.plan_consensus !== "none") {
    throw new TypeError("semantic_decomposition=plan cannot be combined with plan_consensus.");
  }
  const target = requirements?.decomposition_target ?? DEFAULT_DECOMPOSITION_TARGET;
  if (typeof target !== "string" || target.length === 0) throw new TypeError("decomposition_target must be a non-empty target id.");
  return { mode, target };
}

function normalizeSemanticDecision(text, objective) {
  let value;
  try { value = JSON.parse(text); }
  catch { throw Object.assign(new Error("Semantic decomposition planner must return valid JSON."), { code: "SEMANTIC_DECOMPOSITION_OUTPUT_INVALID" }); }
  if (!value || typeof value !== "object" || Array.isArray(value) || !["single", "decompose"].includes(value.decision)
    || typeof value.reason !== "string" || value.reason.trim().length === 0 || value.reason.length > 2_000
    || !Array.isArray(value.work_packages)) {
    throw Object.assign(new Error("Semantic decomposition planner returned an invalid decision object."), { code: "SEMANTIC_DECOMPOSITION_OUTPUT_INVALID" });
  }
  const workPackages = value.work_packages.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)
      || typeof item.objective !== "string" || item.objective.trim().length === 0 || item.objective.length > 2_000
      || typeof item.verification !== "string" || item.verification.trim().length === 0 || item.verification.length > 1_000) {
      throw Object.assign(new Error("Semantic decomposition work_packages must contain bounded non-empty objective and verification strings."), { code: "SEMANTIC_DECOMPOSITION_OUTPUT_INVALID" });
    }
    return { objective: item.objective.trim(), verification: item.verification.trim() };
  });
  if (value.decision === "decompose" && (workPackages.length < 2 || workPackages.length > 8)) {
    throw Object.assign(new Error("A decompose decision requires 2-8 ordered WorkPackages."), { code: "SEMANTIC_DECOMPOSITION_OUTPUT_INVALID" });
  }
  if (value.decision === "single" && workPackages.length > 1) {
    throw Object.assign(new Error("A single decision cannot contain multiple WorkPackages."), { code: "SEMANTIC_DECOMPOSITION_OUTPUT_INVALID" });
  }
  return {
    decision: value.decision,
    reason: value.reason.trim(),
    steps: value.decision === "single" ? [{ objective }] : workPackages,
  };
}

function decompositionExecutionRequirements(requirements) {
  const {
    semantic_decomposition: _semanticDecomposition,
    decomposition_target: _decompositionTarget,
    ...execution
  } = requirements;
  return { ...execution, target_role: "execution" };
}

function decompositionRoutingRequirements(requirements, preferredTarget) {
  return {
    ...planningRoutingRequirements(requirements, preferredTarget),
    capabilities: ["planning_mode", "structured_output"],
  };
}

function planningRoutingRequirements(requirements, preferredTarget, excludedTargets = []) {
  const {
    approval: _approval,
    capabilities: _capabilities,
    preferred_targets: _preferredTargets,
    target_role: _targetRole,
    exclude_targets: existingExcluded = [],
    ...shared
  } = requirements;
  return {
    ...shared,
    target_role: "planning",
    capabilities: ["planning_mode"],
    sandbox_mode: "read-only",
    preferred_targets: [preferredTarget],
    exclude_targets: [...new Set([...existingExcluded, ...excludedTargets])],
  };
}

function approvalContractDriftReason(contract, state) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) return null;
  for (const field of ["provider", "transport", "profile", "behavior", "sandbox_mode"]) {
    if (typeof contract[field] !== "string") continue;
    if (typeof state[field] !== "string") return `unknown:approval_state.${field}`;
    if (state[field] !== contract[field]) return `mismatch:approval_state.${field}`;
  }
  for (const field of ["response_capability", "one_shot_grants", "session_grants", "remembered_grants", "network_access"]) {
    if (typeof contract[field] !== "boolean") continue;
    if (typeof state[field] !== "boolean") return `unknown:approval_state.${field}`;
    if (state[field] !== contract[field]) return `mismatch:approval_state.${field}`;
  }
  for (const field of ["interactive", "auto_review"]) {
    if (contract[field] !== false) continue;
    if (typeof state[field] !== "boolean") return `unknown:approval_state.${field}`;
    if (state[field] === true) return `mismatch:approval_state.${field}`;
  }
  if (Array.isArray(contract.approval_policy?.supported)) {
    if (typeof state.approval_policy !== "string") return "unknown:approval_state.approval_policy";
    if (!contract.approval_policy.supported.includes(state.approval_policy)) return "unsupported:approval_state.approval_policy";
  }
  if (Array.isArray(contract.reviewers)) {
    if (typeof state.approvals_reviewer !== "string") return "unknown:approval_state.approvals_reviewer";
    if (!contract.reviewers.includes(state.approvals_reviewer)) return "unsupported:approval_state.approvals_reviewer";
  }
  return null;
}

export class TuttiIntake {
  constructor({ store, router, context, workspaceManager = new GitWorkspaceManager(), targetPreference = null, defaultExecutionStrategy = process.env.AIDE_EXECUTION_STRATEGY || null, shadowAdvisor = null, semanticVerifier = null, hostName = systemHostname(), platform = process.platform, processAlive = localProcessAlive, processGroupAlive = localProcessGroupAlive, processTreeAlive = localProcessTreeAlive }) {
    if (!store || typeof store.createSubmission !== "function") throw new TypeError("Intake store is required.");
    if (!router || typeof router.probe !== "function") throw new TypeError("Intake HarnessRouter is required.");
    if (!context || typeof context.buildRoutingCapsule !== "function" || typeof context.buildExecutionCapsule !== "function" || typeof context.forWorkspace !== "function") throw new TypeError("Intake Context Fabric is required.");
    this.store = store;
    this.router = router;
    this.context = context;
    this.workspaceManager = workspaceManager;
    this.hostName = hostName;
    this.platform = platform;
    this.processAlive = processAlive;
    this.processGroupAlive = processGroupAlive;
    this.processTreeAlive = processTreeAlive;
    if (shadowAdvisor !== null && typeof shadowAdvisor !== "function") throw new TypeError("shadowAdvisor must be a function or null.");
    this.shadowAdvisor = shadowAdvisor;
    if (semanticVerifier !== null && typeof semanticVerifier !== "function") throw new TypeError("semanticVerifier must be a function or null.");
    this.semanticVerifier = semanticVerifier;
    const configuredPreference = targetPreference ?? String(process.env.AIDE_TARGET_PREFERENCE ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    if (!Array.isArray(configuredPreference) || configuredPreference.some((value) => typeof value !== "string" || value.length === 0)) {
      throw new TypeError("targetPreference must be an array of non-empty target ids.");
    }
    this.targetPreference = [...new Set(configuredPreference)];
    if (defaultExecutionStrategy !== null && !["economy", "capability"].includes(defaultExecutionStrategy)) {
      throw new TypeError("defaultExecutionStrategy must be economy, capability, or null.");
    }
    this.defaultExecutionStrategy = defaultExecutionStrategy;
  }

  async #shadowAdvice({ objective, requirements, recommendation, assignment }) {
    if (this.shadowAdvisor === null) return { status: "disabled" };
    try {
      const advice = normalizeRoutingAdvice(await this.shadowAdvisor({
        objective,
        requirements: structuredClone(requirements),
        candidates: structuredClone(recommendation.candidates ?? []),
        rejected: structuredClone(recommendation.rejected ?? []),
        actual: structuredClone(assignment),
      }));
      return { status: "available", advice };
    } catch (error) {
      return {
        status: "unavailable",
        error_code: error?.code ?? "SHADOW_ROUTING_ADVISOR_FAILED",
        error_message: error?.message ?? "Shadow routing advisor failed.",
      };
    }
  }

  async #semanticAcceptance({ task, workPackage, attempt, result, evidence, mechanical, currentTruth = null, signal }) {
    const semantic = semanticReviewCriteria(task);
    const { criteria } = semantic;
    const required = criteria.length > 0 || semantic.step_verification_required;
    if (!required) return { required: false, accepted: true, review: null, step_verification: null, checks: [] };
    if (mechanical.accepted !== true) {
      return {
        required: true,
        accepted: false,
        review: { status: "skipped", reason: "mechanical_acceptance_failed" },
        step_verification: semantic.step_verification_required ? { status: "skipped", accepted: false, reason: "mechanical_acceptance_failed", steps: [] } : null,
        checks: [{ name: "semantic_acceptance", passed: false, actual: "skipped:mechanical_acceptance_failed", expected: "accepted" }],
      };
    }
    if (semantic.invalid_step_verification) {
      return {
        required: true,
        accepted: false,
        review: { status: "unavailable", error_code: "SEMANTIC_STEP_VERIFICATION_INVALID" },
        step_verification: { status: "unavailable", accepted: false, error_code: "SEMANTIC_STEP_VERIFICATION_INVALID", steps: [] },
        checks: [{ name: "step_verification", passed: false, actual: "SEMANTIC_STEP_VERIFICATION_INVALID", expected: "valid planner postconditions" }],
      };
    }
    if (this.semanticVerifier === null) {
      return {
        required: true,
        accepted: false,
        review: { status: "unavailable", error_code: "SEMANTIC_VERIFIER_UNAVAILABLE" },
        step_verification: semantic.steps.length > 0 ? { status: "unavailable", accepted: false, error_code: "SEMANTIC_VERIFIER_UNAVAILABLE", steps: [] } : null,
        checks: [{ name: "semantic_acceptance", passed: false, actual: "verifier_unavailable", expected: "accepted" }],
      };
    }
    try {
      const reviewContext = attempt.workspace_ref_id
        ? await this.context.forWorkspace(this.store.getWorkspace(attempt.workspace_ref_id))
        : undefined;
      const review = normalizeSemanticVerification(await this.semanticVerifier({
        task_id: task.task_id,
        work_package_id: workPackage.work_package_id,
        attempt_id: attempt.attempt_id,
        goal: task.objective,
        constraints: structuredClone(task.constraints ?? []),
        criteria: structuredClone(criteria),
        result: structuredClone(result),
        evidence: structuredClone(evidence),
        current_truth: structuredClone(currentTruth ?? this.store.getCurrentTruth().slice(-20)),
        workspace: attempt.workspace,
        context: reviewContext,
        signal,
      }), criteria);
      const userChecks = review.checks.slice(0, semantic.user.length);
      const stepChecks = review.checks.slice(semantic.user.length).map((check, index) => ({
        step_index: semantic.steps[index].step_index,
        objective: semantic.steps[index].objective,
        criterion: check.criterion,
        passed: check.passed,
        reason: check.reason,
      }));
      return {
        required: true,
        accepted: review.accepted,
        review: { status: "available", ...review },
        step_verification: stepChecks.length > 0 ? { status: "available", accepted: stepChecks.every((check) => check.passed), steps: stepChecks } : null,
        checks: [
          ...userChecks.map((check, index) => ({
          name: `semantic:${index + 1}`,
          passed: check.passed,
          actual: check.reason,
          expected: check.criterion,
          })),
          ...stepChecks.map((check) => ({
            name: `step:${check.step_index}`,
            passed: check.passed,
            actual: check.reason,
            expected: check.criterion,
          })),
        ],
      };
    } catch (error) {
      return {
        required: true,
        accepted: false,
        review: { status: "unavailable", error_code: error?.code ?? "SEMANTIC_VERIFIER_FAILED", error_message: error?.message ?? "Semantic verifier failed." },
        step_verification: semantic.steps.length > 0 ? { status: "unavailable", accepted: false, error_code: error?.code ?? "SEMANTIC_VERIFIER_FAILED", steps: [] } : null,
        checks: [{ name: "semantic_acceptance", passed: false, actual: error?.code ?? "verifier_failed", expected: "accepted" }],
      };
    }
  }

  async submit(message, { acceptance = {}, constraints = [], requirements = {}, clientRequestId = null, requestContext = {}, conversationId = null } = {}) {
    if (typeof message !== "string" || message.trim().length === 0) throw new TypeError("Intake message must be a non-empty string.");
    semanticAcceptanceCriteria(acceptance);
    const objective = message.trim();
    const withStrategy = requirements.execution_strategy !== undefined || this.defaultExecutionStrategy === null
      ? requirements
      : { ...requirements, execution_strategy: this.defaultExecutionStrategy };
    const effectiveRequirements = Array.isArray(withStrategy.preferred_targets) || this.targetPreference.length === 0
      ? withStrategy
      : { ...withStrategy, preferred_targets: this.targetPreference };
    const planning = planConsensus(effectiveRequirements);
    const decomposition = semanticDecomposition(effectiveRequirements);
    const requestedModel = effectiveRequirements.requested_model ?? null;
    const requestedEffort = effectiveRequirements.requested_reasoning_effort ?? null;
    if (requestedModel !== null && (typeof requestedModel !== "string" || requestedModel.trim().length === 0)) throw new TypeError("requested_model must be a non-empty string.");
    if (requestedEffort !== null && (typeof requestedEffort !== "string" || requestedEffort.trim().length === 0)) throw new TypeError("requested_reasoning_effort must be a non-empty string.");
    if (requestedEffort !== null && requestedModel === null) throw new TypeError("requested_reasoning_effort requires requested_model.");
    if (requestedModel !== null && (planning.mode !== "none" || decomposition.mode !== "none")) throw new TypeError("Explicit model selection is only supported for direct execution in the Current UI slice.");
    if (requestedModel !== null && (!Array.isArray(effectiveRequirements.preferred_targets) || effectiveRequirements.preferred_targets.length !== 1)) {
      throw new TypeError("Explicit model selection requires exactly one preferred target profile.");
    }
    const requestFingerprint = clientRequestId === null ? null : createHash("sha256").update(canonicalJson({
      objective,
      acceptance,
      constraints,
      requirements: effectiveRequirements,
      request_context: requestContext,
    })).digest("hex");
    const submission = await this.store.createSubmission({
      objective,
      acceptance,
      constraints,
      requirements: effectiveRequirements,
      clientRequestId,
      requestFingerprint,
      conversationId,
    });
    const { task, work_package: workPackage } = submission;
    if (submission.replayed && this.store.getTaskView(task.task_id).latest_attempt) {
      return { task, work_package: workPackage, idempotent_replay: true };
    }
    await this.context.refresh();
    const routingContext = this.context.buildRoutingCapsule({ taskId: task.task_id, workPackageId: workPackage.work_package_id, query: objective });
    const routingRequirements = decomposition.mode === "plan"
      ? decompositionRoutingRequirements(workPackage.requirements, decomposition.target)
      : planning.mode === "dual"
        ? planningRoutingRequirements(workPackage.requirements, planning.targets[0])
        : workPackage.requirements;
    const recommendation = recommendCandidates({ requirements: routingRequirements, targets: targetsFromHarnessProbe(await this.router.probe()) });
    const selected = chooseAssignment(recommendation, routingRequirements, {
      noneCode: "NO_QUALIFIED_HARNESS",
      noneMessage: "Broker found no qualified Harness for the submitted work.",
      decisionPrefix: decomposition.mode === "plan" ? "semantic_decomposition_" : "",
    });
    const routingAdvice = await this.#shadowAdvice({ objective, requirements: routingRequirements, recommendation, assignment: selected });
    return { task, work_package: workPackage, routing_context: routingContext, recommendation, assignment: selected, routing_advice: routingAdvice, idempotent_replay: submission.replayed };
  }

  async submitAndRun(message, { workspace, acceptance = {}, constraints = [], requirements = {}, facts, timeoutMs = 120_000, cancelGraceMs = 5_000, signal, conversationId = null } = {}) {
    throwIfAborted(signal);
    const submitted = await this.submit(message, { acceptance, constraints, requirements, conversationId });
    return this.#runPrepared(submitted, { workspace, acceptance, facts, timeoutMs, cancelGraceMs, signal });
  }

  async runTask(message, { workspace, acceptance = {}, constraints = [], requirements = {}, facts, timeoutMs = 120_000, cancelGraceMs = 5_000, signal, conversationId = null } = {}) {
    const first = await this.submitAndRun(message, { workspace, acceptance, constraints, requirements, facts, timeoutMs, cancelGraceMs, signal, conversationId });
    return this.advanceTask(first, { workspace, facts, timeoutMs, cancelGraceMs, signal });
  }

  async startRun(message, { workspace, acceptance = {}, constraints = [], requirements = {}, signal, clientRequestId = null, conversationId = null } = {}) {
    throwIfAborted(signal);
    const submitted = await this.submit(message, { acceptance, constraints, requirements, clientRequestId, conversationId, requestContext: { workspace: workspace ?? null, conversation_id: conversationId } });
    if (submitted.idempotent_replay) {
      const view = this.taskStatus(submitted.task.task_id);
      if (view.latest_attempt) {
        const taskCompleted = view.task.status === "completed";
        const terminalLatest = ["completed", "failed", "cancelled"].includes(view.latest_attempt.status);
        const replayState = view.task.status === "completed"
          ? "terminal"
          : view.active_attempt
            ? view.runtime?.attached ? view.runtime.state : "detached"
            : terminalLatest ? "terminal" : "detached";
        return {
          ...submitted,
          attempt: view.latest_attempt,
          state: replayState,
          recovery_required: view.runtime?.recovery_required === true,
          supervision_required: !taskCompleted && terminalLatest,
        };
      }
    }
    return { ...(await this.#startPrepared(submitted, { workspace, signal })), supervision_required: true };
  }

  async handoffAndRun(fromAttemptId, { objective, workspace, requirements = {}, facts, timeoutMs = 120_000, cancelGraceMs = 5_000, signal } = {}) {
    throwIfAborted(signal);
    const sourceAttempt = this.store.getAttempt(fromAttemptId);
    if (!["completed", "failed", "cancelled"].includes(sourceAttempt.status)) {
      throw Object.assign(new Error("Automatic handoff requires a terminal source Attempt."), { code: "HANDOFF_SOURCE_NOT_TERMINAL" });
    }
    const sourceWorkPackage = this.store.getWorkPackage(sourceAttempt.work_package_id);
    const task = this.store.getTask(sourceWorkPackage.task_id);
    if (task.status !== "open") throw Object.assign(new Error("Completed Task cannot be handed off."), { code: "HANDOFF_TASK_CLOSED" });
    const sourceWorkspace = sourceAttempt.workspace_ref_id ? this.store.getWorkspace(sourceAttempt.workspace_ref_id) : null;
    const sideEffects = sourceAttempt.side_effects ?? "unknown";
    const safeSideEffects = sideEffects === "none"
      || (sideEffects === "workspace_only" && sourceWorkspace?.mode === "isolated" && sourceWorkspace?.landing_status === "pending");
    if (!safeSideEffects) {
      throw Object.assign(new Error("Automatic handoff is blocked because source Attempt side effects are not proven safe."), {
        code: "HANDOFF_SIDE_EFFECTS_UNSAFE",
        attempt_id: sourceAttempt.attempt_id,
        side_effects: sideEffects,
        workspace_mode: sourceWorkspace?.mode ?? null,
        landing_status: sourceWorkspace?.landing_status ?? null,
      });
    }
    const handoffObjective = typeof objective === "string" && objective.trim().length > 0 ? objective.trim() : sourceWorkPackage.objective;
    const inheritedRequirements = { ...sourceWorkPackage.requirements, ...requirements };
    const excluded = [...new Set([
      ...(Array.isArray(sourceWorkPackage.requirements?.exclude_targets) ? sourceWorkPackage.requirements.exclude_targets : []),
      ...(Array.isArray(requirements.exclude_targets) ? requirements.exclude_targets : []),
      sourceAttempt.assignment?.id,
    ].filter(Boolean))];
    const nextRequirements = { ...inheritedRequirements, exclude_targets: excluded };
    const recommendation = recommendCandidates({ requirements: nextRequirements, targets: targetsFromHarnessProbe(await this.router.probe()) });
    const selected = chooseAssignment(recommendation, nextRequirements, {
      noneCode: "NO_QUALIFIED_HANDOFF_HARNESS",
      noneMessage: "Broker found no alternate Harness for automatic handoff.",
      decisionPrefix: "handoff_",
    });
    const workPackage = await this.store.createWorkPackage({
      taskId: task.task_id,
      objective: handoffObjective,
      requirements: nextRequirements,
      lineage: { kind: "handoff", from_attempt_id: sourceAttempt.attempt_id },
    });
    await this.context.refresh();
    const routingContext = this.context.buildRoutingCapsule({ taskId: task.task_id, workPackageId: workPackage.work_package_id, query: handoffObjective });
    const prepared = {
      task,
      work_package: workPackage,
      routing_context: routingContext,
      recommendation,
      assignment: selected,
      routing_advice: await this.#shadowAdvice({ objective: handoffObjective, requirements: nextRequirements, recommendation, assignment: selected }),
      handoff: { from_attempt_id: sourceAttempt.attempt_id, from_target_id: sourceAttempt.assignment?.id ?? null },
    };
    return this.#runPrepared(prepared, { workspace, acceptance: task.acceptance, facts, timeoutMs, cancelGraceMs, signal });
  }

  async advanceTask(boundary, { workspace, facts, timeoutMs = 120_000, cancelGraceMs = 5_000, signal } = {}) {
    if (!boundary?.attempt?.attempt_id) throw new TypeError("Task advancement requires an Attempt boundary result.");
    throwIfAborted(signal);
    const attempts = [boundary.attempt.attempt_id];
    let current = boundary;

    if (current.state === "terminal" && current.verification?.accepted === true && current.attempt.assignment?.role !== "planning") {
      const workPackage = this.store.getWorkPackage(current.attempt.work_package_id);
      const task = this.store.getTask(workPackage.task_id);
      if (task.status === "open") {
        const closure = await closeAcceptedTask({
          store: this.store,
          attemptId: current.attempt.attempt_id,
          facts: Array.isArray(facts) && facts.length > 0 ? facts : [`Completed: ${workPackage.objective}`],
        });
        current = { ...current, closure };
      }
    }

    while (current.state === "terminal") {
      throwIfAborted(signal);
      if (current.verification?.accepted === true && current.attempt.assignment?.role === "planning") {
        if (current.attempt.side_effects !== "none") {
          current = {
            ...current,
            plan_consensus: {
              status: "blocked",
              error_code: "PLAN_CONSENSUS_SIDE_EFFECTS_UNSAFE",
              attempt_id: current.attempt.attempt_id,
              side_effects: current.attempt.side_effects,
            },
          };
          break;
        }
        const planningWorkPackage = this.store.getWorkPackage(current.attempt.work_package_id);
        current = planningWorkPackage.requirements?.semantic_decomposition === "plan"
          ? await this.#advanceSemanticDecomposition(current.attempt.attempt_id, { workspace, facts, timeoutMs, cancelGraceMs, signal })
          : await this.#advancePlanConsensus(current.attempt.attempt_id, { workspace, facts, timeoutMs, cancelGraceMs, signal });
        attempts.push(current.attempt.attempt_id);
        continue;
      }
      if (current.attempt.assignment?.role === "planning" && current.verification?.accepted !== true) {
        const planningWorkPackage = this.store.getWorkPackage(current.attempt.work_package_id);
        const semanticPlanning = planningWorkPackage.requirements?.semantic_decomposition === "plan";
        current = {
          ...current,
          ...(semanticPlanning
            ? { semantic_decomposition: { status: "blocked", error_code: "SEMANTIC_DECOMPOSITION_ATTEMPT_FAILED", attempt_id: current.attempt.attempt_id } }
            : { plan_consensus: { status: "blocked", error_code: "PLAN_CONSENSUS_ATTEMPT_FAILED", attempt_id: current.attempt.attempt_id } }),
        };
        break;
      }
      if (current.verification?.accepted === true || (current.attempt.status === "cancelled" && current.boundary_reason !== "timeout")) break;
      try {
        current = await this.handoffAndRun(current.attempt.attempt_id, { workspace, facts, timeoutMs, cancelGraceMs, signal });
        attempts.push(current.attempt.attempt_id);
      } catch (error) {
        if (!["NO_QUALIFIED_HANDOFF_HARNESS", "HARNESS_ASSIGNMENT_AMBIGUOUS", "HANDOFF_SIDE_EFFECTS_UNSAFE"].includes(error?.code)) throw error;
        return {
          ...current,
          attempt_chain: attempts,
          automation: {
            status: "blocked",
            error_code: error.code,
            side_effects: error.side_effects ?? null,
            candidate_ids: error.candidate_ids ?? error.recommendation?.candidates?.map((candidate) => candidate.id) ?? [],
          },
        };
      }
    }

    return {
      ...current,
      attempt_chain: attempts,
      automation: {
        status: current.state === "waiting"
          ? "waiting"
          : current.verification?.accepted === true
            ? "completed"
            : current.attempt.status === "cancelled"
              ? "cancelled"
              : "stopped",
      },
    };
  }

  async #advanceSemanticDecomposition(fromAttemptId, { workspace, facts, timeoutMs, cancelGraceMs, signal }) {
    const sourceAttempt = this.store.getAttempt(fromAttemptId);
    const sourceWorkPackage = this.store.getWorkPackage(sourceAttempt.work_package_id);
    const task = this.store.getTask(sourceWorkPackage.task_id);
    if (sourceWorkPackage.requirements?.semantic_decomposition !== "plan") {
      throw Object.assign(new Error("Planning Attempt is not a semantic decomposition planner."), { code: "SEMANTIC_DECOMPOSITION_STATE_INVALID" });
    }
    const decision = normalizeSemanticDecision(sourceAttempt.outcome?.final_text ?? "", task.objective);
    await this.store.recordTaskSemanticDecision(task.task_id, {
      sourceAttemptId: sourceAttempt.attempt_id,
      decision: decision.decision,
      reason: decision.reason,
      steps: decision.steps,
    });
    const currentPlanningWorkPackage = this.store.getWorkPackage(sourceWorkPackage.work_package_id);
    if (currentPlanningWorkPackage.status === "ready") {
      await this.store.completeWorkPackage(currentPlanningWorkPackage.work_package_id, { attemptId: sourceAttempt.attempt_id });
    }

    const requirements = decompositionExecutionRequirements(sourceWorkPackage.requirements);
    const recommendation = recommendCandidates({ requirements, targets: targetsFromHarnessProbe(await this.router.probe()) });
    const selected = chooseAssignment(recommendation, requirements, {
      noneCode: "NO_QUALIFIED_HARNESS",
      noneMessage: "Broker found no qualified execution Harness after semantic decomposition.",
      decisionPrefix: "semantic_decomposition_",
    });
    const workPackage = await this.store.createWorkPackage({
      taskId: task.task_id,
      objective: task.objective,
      requirements,
      lineage: { kind: "semantic_decomposition_execution", from_attempt_id: sourceAttempt.attempt_id },
    });
    await this.context.refresh();
    const routingContext = this.context.buildRoutingCapsule({ taskId: task.task_id, workPackageId: workPackage.work_package_id, query: workPackage.objective });
    const routingAdvice = await this.#shadowAdvice({ objective: workPackage.objective, requirements, recommendation, assignment: selected });
    return this.#runPrepared({
      task: this.store.getTask(task.task_id),
      work_package: workPackage,
      routing_context: routingContext,
      recommendation,
      assignment: selected,
      routing_advice: routingAdvice,
      semantic_decomposition: { status: "planned", decision: this.store.getTask(task.task_id).semantic_decision },
    }, { workspace, acceptance: task.acceptance, facts, timeoutMs, cancelGraceMs, signal });
  }

  async #advancePlanConsensus(fromAttemptId, { workspace, facts, timeoutMs, cancelGraceMs, signal }) {
    const sourceAttempt = this.store.getAttempt(fromAttemptId);
    const sourceWorkPackage = this.store.getWorkPackage(sourceAttempt.work_package_id);
    const task = this.store.getTask(sourceWorkPackage.task_id);
    const planning = planConsensus(sourceWorkPackage.requirements);
    if (planning.mode !== "dual") throw Object.assign(new Error("Planning Attempt is missing its dual-consensus requirement."), { code: "PLAN_CONSENSUS_STATE_INVALID" });

    const taskView = this.store.getTaskView(task.task_id);
    const planningAttempts = taskView.attempts.filter((attempt) => attempt.assignment?.role === "planning" && attempt.status === "completed" && attempt.acceptance?.accepted === true);
    const usedTargets = new Set(planningAttempts.map((attempt) => attempt.assignment?.id).filter(Boolean));
    const nextPlanner = planning.targets.find((targetId) => !usedTargets.has(targetId));
    const allTargets = targetsFromHarnessProbe(await this.router.probe());

    if (nextPlanner) {
      const requirements = { ...sourceWorkPackage.requirements };
      const routingRequirements = planningRoutingRequirements(requirements, nextPlanner, [...usedTargets]);
      const recommendation = recommendCandidates({ requirements: routingRequirements, targets: allTargets });
      const selected = chooseAssignment(recommendation, routingRequirements, {
        noneCode: "NO_QUALIFIED_PLAN_HARNESS",
        noneMessage: "Broker found no qualified Harness for the next planning opinion.",
        decisionPrefix: "plan_consensus_",
      });
      const workPackage = await this.store.createWorkPackage({
        taskId: task.task_id,
        objective: sourceWorkPackage.objective,
        requirements,
        lineage: { kind: "plan_consensus_planner", from_attempt_id: sourceAttempt.attempt_id },
      });
      await this.context.refresh();
      const routingContext = this.context.buildRoutingCapsule({ taskId: task.task_id, workPackageId: workPackage.work_package_id, query: workPackage.objective });
      const routingAdvice = await this.#shadowAdvice({ objective: workPackage.objective, requirements: routingRequirements, recommendation, assignment: selected });
      return this.#runPrepared({ task, work_package: workPackage, routing_context: routingContext, recommendation, assignment: selected, routing_advice: routingAdvice }, {
        workspace,
        acceptance: {},
        facts,
        timeoutMs,
        cancelGraceMs,
        signal,
      });
    }

    const requirements = { ...sourceWorkPackage.requirements, plan_consensus_completed: true };
    const routingRequirements = { ...requirements, target_role: "execution" };
    const recommendation = recommendCandidates({ requirements: routingRequirements, targets: allTargets });
    const selected = chooseAssignment(recommendation, routingRequirements, {
      noneCode: "NO_QUALIFIED_HARNESS",
      noneMessage: "Broker found no qualified execution Harness after planning consensus.",
      decisionPrefix: "plan_consensus_",
    });
    const workPackage = await this.store.createWorkPackage({
      taskId: task.task_id,
      objective: sourceWorkPackage.objective,
      requirements,
      lineage: { kind: "plan_consensus_execution", from_attempt_id: sourceAttempt.attempt_id },
    });
    await this.context.refresh();
    const routingContext = this.context.buildRoutingCapsule({ taskId: task.task_id, workPackageId: workPackage.work_package_id, query: workPackage.objective });
    const routingAdvice = await this.#shadowAdvice({ objective: workPackage.objective, requirements: routingRequirements, recommendation, assignment: selected });
    return this.#runPrepared({ task, work_package: workPackage, routing_context: routingContext, recommendation, assignment: selected, routing_advice: routingAdvice }, {
      workspace,
      acceptance: task.acceptance,
      facts,
      timeoutMs,
      cancelGraceMs,
      signal,
    });
  }

  async driveTask(attemptId, { workspace, facts, timeoutMs = 120_000, cancelGraceMs = 5_000, signal } = {}) {
    const boundary = await this.runAttemptToBoundary(attemptId, { facts, timeoutMs, cancelGraceMs, signal });
    return this.advanceTask(boundary, { workspace, facts, timeoutMs, cancelGraceMs, signal });
  }

  async steerAttempt(attemptId, message) {
    const attempt = this.store.getAttempt(attemptId);
    if (attempt.status !== "running") throw Object.assign(new Error("Only a running Attempt can be steered."), { code: "ATTEMPT_NOT_RUNNING" });
    if (!attempt.assignment?.capabilities?.includes("same_turn_steer")) {
      throw Object.assign(new Error("Assigned Harness does not support same-turn steering."), { code: "ATTEMPT_STEER_UNSUPPORTED" });
    }
    return this.router.steer(attempt.run_id, message);
  }

  taskView(taskId) {
    return this.store.getTaskView(taskId);
  }

  taskStatus(taskId) {
    const view = this.taskView(taskId);
    if (!view.active_attempt?.run_id) return { ...view, runtime: null };
    try {
      return { ...view, runtime: { attached: true, ...this.router.status(view.active_attempt.run_id) } };
    } catch (error) {
      if (error?.code !== "HARNESS_RUN_NOT_FOUND") throw error;
      return {
        ...view,
        runtime: {
          attached: false,
          run_id: view.active_attempt.run_id,
          session_id: view.active_attempt.session_id,
          state: "detached",
          recovery_required: true,
        },
      };
    }
  }

  recoveryStatus() {
    return this.store.listTaskViews({ status: "open" })
      .filter((view) => view.active_attempt?.run_id)
      .map((view) => this.taskStatus(view.task.task_id))
      .filter((view) => view.runtime?.recovery_required === true);
  }

  createConversation(options = {}) { return this.store.createConversation(options); }
  updateConversation(conversationId, patch = {}) { return this.store.updateConversation(conversationId, patch); }
  conversations(options = {}) { return this.store.listConversations(options); }
  conversation(conversationId) { return this.store.getConversationView(conversationId); }
  tasks({ limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new TypeError("Task list limit must be an integer between 1 and 1000.");
    return this.store.listTaskViews().slice(-limit).reverse().map((view) => this.taskStatus(view.task.task_id));
  }
  async catalog() {
    const [probe, providers] = await Promise.all([
      this.router.probe(),
      typeof this.router.providerCatalog === "function" ? this.router.providerCatalog() : Promise.resolve({ providers: [] }),
    ]);
    return {
      defaults: { execution_strategy: this.defaultExecutionStrategy },
      providers: providers.providers ?? [],
      targets: Object.entries(probe).map(([id, target]) => ({
        id,
        available: target.available === true,
        provider: target.approval_contract?.provider ?? (id.startsWith("codex") ? "codex" : id.startsWith("dsh") ? "dsh" : "unknown"),
        role: target.role ?? "execution",
        model: target.model ?? null,
        reasoning_effort: target.reasoning_effort ?? null,
        collaboration_mode: target.collaboration_mode ?? null,
        model_selection: Array.isArray(target.model_directory),
        strategy_priority: structuredClone(target.strategy_priority ?? {}),
        capabilities: structuredClone(target.capabilities ?? []),
        approval_contract: structuredClone(target.approval_contract ?? null),
        resource_facts: structuredClone(target.resource_facts ?? null),
      })),
    };
  }
  providerLogin(provider, options = {}) { return this.router.startProviderLogin(provider, options); }
  providerLoginStatus(provider, loginId) { return this.router.providerLoginStatus(provider, loginId); }
  providerLoginCancel(provider, loginId) { return this.router.cancelProviderLogin(provider, loginId); }
  providerLogout(provider) { return this.router.logoutProvider(provider); }
  closeProviderAuth() { this.router.closeProviderAuth?.(); }

  routingHistory(options = {}) {
    return this.store.listRoutingHistory(options);
  }

  async recoverTask(taskId, {
    action,
    quiescent = false,
    workspace,
    facts,
    timeoutMs = 120_000,
    cancelGraceMs = 5_000,
    signal,
  } = {}) {
    throwIfAborted(signal);
    const view = this.taskStatus(taskId);
    if (!view.active_attempt || view.runtime?.recovery_required !== true) {
      throw Object.assign(new Error("Task does not have a detached active Attempt requiring recovery."), { code: "RECOVERY_NOT_REQUIRED" });
    }
    if (action === "resume") {
      throw Object.assign(new Error("Live resume of a detached in-progress native turn is unsupported by the current Harness transports; recovery requires native quiescence before abandon or reroute."), { code: "RECOVERY_RESUME_UNSUPPORTED" });
    }
    if (!["abandon", "reroute", "finalize"].includes(action)) throw new TypeError("Recovery action must be abandon, reroute, or finalize.");
    const detached = view.active_attempt;
    const runtimeProcess = detached.runtime_process;
    let quiescenceEvidence;
    if (runtimeProcess?.hostname === this.hostName && Number.isInteger(runtimeProcess?.process_group_id) && runtimeProcess.process_group_id > 0) {
      if (this.processGroupAlive(runtimeProcess.process_group_id)) {
        throw Object.assign(new Error("Detached native process group is still alive; recovery is fenced."), {
          code: "RECOVERY_PROCESS_GROUP_STILL_ALIVE",
          process_group_id: runtimeProcess.process_group_id,
          pid: runtimeProcess.pid,
          hostname: runtimeProcess.hostname,
        });
      }
      quiescenceEvidence = {
        source: "local_process_group_exit",
        process_group_id: runtimeProcess.process_group_id,
        pid: runtimeProcess.pid,
        hostname: runtimeProcess.hostname,
      };
    } else if (runtimeProcess?.hostname === this.hostName && Number.isInteger(runtimeProcess?.process_tree_root_pid) && runtimeProcess.process_tree_root_pid > 0) {
      if (await this.processTreeAlive(runtimeProcess.process_tree_root_pid, { platform: this.platform })) {
        throw Object.assign(new Error("Detached native process tree is still alive; recovery is fenced."), {
          code: "RECOVERY_PROCESS_TREE_STILL_ALIVE",
          process_tree_root_pid: runtimeProcess.process_tree_root_pid,
          pid: runtimeProcess.pid,
          hostname: runtimeProcess.hostname,
        });
      }
      quiescenceEvidence = {
        source: "local_process_tree_exit",
        process_tree_root_pid: runtimeProcess.process_tree_root_pid,
        pid: runtimeProcess.pid,
        hostname: runtimeProcess.hostname,
      };
    } else if (runtimeProcess?.hostname === this.hostName && Number.isInteger(runtimeProcess?.pid) && runtimeProcess.pid > 0) {
      if (this.platform === "win32") {
        throw Object.assign(new Error("Windows detached recovery requires persisted process-tree ownership; parent PID exit alone is not sufficient quiescence evidence."), {
          code: "RECOVERY_PROCESS_TREE_OWNERSHIP_REQUIRED",
          pid: runtimeProcess.pid,
          hostname: runtimeProcess.hostname,
        });
      }
      if (this.processAlive(runtimeProcess.pid)) {
        throw Object.assign(new Error("Detached native process is still alive; recovery is fenced."), {
          code: "RECOVERY_PROCESS_STILL_ALIVE",
          pid: runtimeProcess.pid,
          hostname: runtimeProcess.hostname,
        });
      }
      quiescenceEvidence = { source: "local_pid_exit", pid: runtimeProcess.pid, hostname: runtimeProcess.hostname };
    } else {
      if (quiescent !== true) {
        throw Object.assign(new Error("Detached Attempt recovery requires explicit confirmation that the old native process is quiescent."), { code: "RECOVERY_QUIESCENCE_REQUIRED" });
      }
      quiescenceEvidence = { source: "external_assertion" };
    }
    if (action === "finalize") {
      const checkpoint = detached.finalization_checkpoint;
      if (!checkpoint?.result) {
        throw Object.assign(new Error("Detached Attempt has no durable terminal-result checkpoint to finalize."), { code: "RECOVERY_FINALIZATION_UNAVAILABLE" });
      }
      const finalized = await this.#finalizeAttempt(detached, checkpoint.result, { facts, signal });
      return this.advanceTask(finalized, { workspace, facts, timeoutMs, cancelGraceMs, signal });
    }
    const sideEffects = detached.side_effects ?? "unknown";
    const workspaceRef = detached.workspace_ref_id ? this.store.getWorkspace(detached.workspace_ref_id) : null;
    const rerouteSafe = sideEffects === "none"
      || (sideEffects === "workspace_only" && workspaceRef?.mode === "isolated" && workspaceRef?.landing_status === "pending");
    if (action === "reroute" && !rerouteSafe) {
      throw Object.assign(new Error("Automatic reroute requires side effects classified as none, or workspace_only inside an unlanded isolated WorkspaceRef."), {
        code: "RECOVERY_SIDE_EFFECTS_UNSAFE",
        side_effects: sideEffects,
      });
    }

    const result = {
      status: "failed",
      session_id: detached.session_id,
      error_code: action === "reroute" ? "DETACHED_ATTEMPT_REROUTED" : "DETACHED_ATTEMPT_ABANDONED",
      recovery: { action, quiescent: true, quiescence: quiescenceEvidence, side_effects: sideEffects, detached_run_id: detached.run_id },
    };
    const evidence = { recovery: result.recovery };
    const verification = { accepted: false, checks: [{ name: "detached_recovery", passed: false, actual: action, expected: "native terminal result" }] };
    const recoveredAttempt = await this.store.finishAttempt(detached.attempt_id, { result, evidence, acceptance: verification });
    if (action === "abandon") {
      return {
        state: "terminal",
        attempt: recoveredAttempt,
        result,
        evidence,
        verification,
        recovery: { status: "abandoned", side_effects: sideEffects },
      };
    }
    return this.advanceTask({ state: "terminal", attempt: recoveredAttempt, result, evidence, verification }, {
      workspace,
      facts,
      timeoutMs,
      cancelGraceMs,
      signal,
    });
  }

  async steerTask(taskId, message) {
    const view = this.taskView(taskId);
    if (!view.active_attempt) throw Object.assign(new Error("Task has no active Attempt to steer."), { code: "TASK_NO_ACTIVE_ATTEMPT" });
    return this.steerAttempt(view.active_attempt.attempt_id, message);
  }

  async cancelTask(taskId) {
    const view = this.taskView(taskId);
    if (!view.active_attempt) throw Object.assign(new Error("Task has no active Attempt to cancel."), { code: "TASK_NO_ACTIVE_ATTEMPT" });
    return this.requestCancel(view.active_attempt.attempt_id);
  }

  async registerInteractionRequest(attemptId, { kind, summary, blocking = true, nativeRequestRef = null, nativeContract = null } = {}) {
    const attempt = this.store.getAttempt(attemptId);
    if (!["running", "waiting_input", "waiting_permission"].includes(attempt.status)) {
      throw Object.assign(new Error("Interaction request requires an active Attempt."), { code: "ATTEMPT_NOT_RUNNING" });
    }
    return this.store.createInteraction({ attemptId, kind, summary, blocking, nativeRequestRef, nativeContract });
  }

  async respondToInteraction(interactionId, response, { resolvedBy = "user" } = {}) {
    const interaction = this.store.getInteraction(interactionId);
    if (interaction.status !== "pending") throw Object.assign(new Error("Interaction is not pending."), { code: "INTERACTION_STATE_INVALID" });
    const attempt = this.store.getAttempt(interaction.attempt_id);
    if (!attempt.assignment?.capabilities?.includes("interaction_response")) {
      throw Object.assign(new Error("Assigned Harness does not support interaction responses."), { code: "INTERACTION_RESPONSE_UNSUPPORTED" });
    }
    const native = await this.router.respond(interaction.run_id, { nativeRequestRef: interaction.native_request_ref, response });
    if (native.accepted !== true) throw Object.assign(new Error("Harness rejected the interaction response."), { code: "INTERACTION_RESPONSE_REJECTED" });
    return this.store.resolveInteraction(interactionId, { response, resolvedBy });
  }

  async observeAttempt(attemptId, { facts, signal } = {}) {
    let attempt = this.store.getAttempt(attemptId);
    if (!attempt.run_id) throw Object.assign(new Error("Attempt has no Harness run."), { code: "ATTEMPT_RUN_MISSING" });
    if (["completed", "failed", "cancelled"].includes(attempt.status)) {
      return { state: "terminal", attempt, result: attempt.outcome, evidence: attempt.evidence, verification: attempt.acceptance, closure: null };
    }

    await this.#projectRunEvents(attempt);
    attempt = this.store.getAttempt(attemptId);
    const result = this.router.result(attempt.run_id);
    if (result.ready) return this.#finalizeAttempt(attempt, result, { facts, signal });

    const interactions = this.store.listInteractions({ attemptId, status: "pending" });
    return {
      state: attempt.status === "waiting_input" || attempt.status === "waiting_permission" ? "waiting" : "running",
      attempt,
      interactions,
    };
  }

  async requestCancel(attemptId) {
    let attempt = this.store.getAttempt(attemptId);
    if (["completed", "failed", "cancelled"].includes(attempt.status)) return { state: "terminal", attempt };
    if (!attempt.run_id) throw Object.assign(new Error("Attempt has no Harness run."), { code: "ATTEMPT_RUN_MISSING" });
    const cancelState = this.router.cancel(attempt.run_id);
    if (cancelState?.terminal === true) return this.observeAttempt(attemptId);
    if (cancelState?.state !== "cancelling") {
      throw Object.assign(new Error("Harness did not accept cancellation; workspace writer ownership is retained."), {
        code: "INTAKE_CANCEL_NOT_ACCEPTED",
        attempt_id: attempt.attempt_id,
        run_id: attempt.run_id,
      });
    }
    if (attempt.status !== "cancelling") attempt = await this.store.markAttemptCancelling(attempt.attempt_id);
    return { state: "cancelling", attempt };
  }

  async runAttemptToBoundary(attemptId, { facts, timeoutMs = 120_000, cancelGraceMs = 5_000, signal } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      throwIfAborted(signal);
      const observed = await this.observeAttempt(attemptId, { facts, signal });
      if (observed.state === "terminal" || observed.state === "waiting") return observed;
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }

    throwIfAborted(signal);
    await this.requestCancel(attemptId);
    const cancelDeadline = Date.now() + cancelGraceMs;
    while (Date.now() < cancelDeadline) {
      throwIfAborted(signal);
      const observed = await this.observeAttempt(attemptId, { facts, signal });
      if (observed.state === "terminal") return { ...observed, boundary_reason: "timeout" };
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    const attempt = this.store.getAttempt(attemptId);
    throw Object.assign(new Error("Harness cancellation is still pending; workspace writer ownership is retained."), {
      code: "INTAKE_CANCEL_PENDING",
      attempt_id: attempt.attempt_id,
      run_id: attempt.run_id,
    });
  }

  async #runPrepared(submitted, { workspace, acceptance = {}, facts, timeoutMs, cancelGraceMs, signal }) {
    const started = await this.#startPrepared(submitted, { workspace, signal });
    const observed = await this.runAttemptToBoundary(started.attempt.attempt_id, { facts, timeoutMs, cancelGraceMs, signal });
    return { ...started, ...observed };
  }

  async #startPrepared(submitted, { workspace, signal } = {}) {
    throwIfAborted(signal);
    const isolation = submitted.assignment?.role === "planning"
      ? "direct"
      : submitted.work_package.requirements?.workspace_isolation ?? "direct";
    if (isolation !== "direct" && isolation !== "attempt") throw new TypeError("workspace_isolation must be direct or attempt.");
    let workspaceRef;
    let allocated = null;
    if (isolation === "attempt") {
      if (workspace !== undefined) throw Object.assign(new Error("Caller-provided workspace is incompatible with attempt isolation."), { code: "WORKSPACE_ISOLATION_PATH_FORBIDDEN" });
      allocated = await this.workspaceManager.allocate({ projectRoot: this.context.root });
      workspaceRef = await this.store.ensureWorkspace({ path: allocated.path, projectRoot: allocated.project_root, mode: "isolated" });
    } else {
      const workspacePath = workspace ?? this.context.root;
      if (typeof workspacePath !== "string" || workspacePath.length === 0) throw new TypeError("Execution workspace is required.");
      workspaceRef = await this.store.ensureWorkspace({ path: workspacePath, projectRoot: this.context.root, mode: "direct" });
    }

    let attempt;
    try {
      attempt = await this.store.createAttempt({
        workPackageId: submitted.work_package.work_package_id,
        assignment: submitted.assignment,
        workspaceRefId: workspaceRef.workspace_ref_id,
        routingTrace: routingTrace(submitted),
      });
    } catch (error) {
      if (allocated && typeof this.workspaceManager.discard === "function") {
        try { await this.workspaceManager.discard({ path: allocated.path, projectRoot: allocated.project_root }); }
        catch { /* preserve the original state error */ }
      }
      throw error;
    }
    const scopedContext = await this.context.forWorkspace(workspaceRef);
    const executionContext = scopedContext.buildExecutionCapsule({
      taskId: submitted.task.task_id,
      workPackageId: submitted.work_package.work_package_id,
      query: submitted.work_package.objective,
      target: submitted.assignment,
      workspaceRef,
    });
    const priorPlans = submitted.assignment?.role === "execution" && submitted.work_package.requirements?.plan_consensus === "dual"
      ? this.store.getTaskView(submitted.task.task_id).attempts
          .filter((prior) => prior.assignment?.role === "planning" && prior.status === "completed" && prior.acceptance?.accepted === true && typeof prior.outcome?.final_text === "string")
          .map((prior) => ({ target: prior.assignment.id, model: prior.assignment.model ?? null, plan: prior.outcome.final_text }))
      : [];
    const crossfirePlanning = submitted.assignment?.role === "planning" && submitted.work_package.requirements?.plan_consensus === "dual";
    const decompositionPlanning = submitted.assignment?.role === "planning" && submitted.work_package.requirements?.semantic_decomposition === "plan";
    const decompositionExecution = submitted.assignment?.role === "execution" && submitted.work_package.lineage?.kind === "semantic_decomposition_execution";
    const prompt = [
      ...(crossfirePlanning ? [
        "AIDE independent crossfire planning role:",
        "Produce a concrete implementation plan for the Task objective below. Do not execute, modify files, or act as the final executor.",
        "Any instruction addressed to the final executor, including a final success marker or acceptance text, is executor-only. Do not return that marker as your plan; describe how the executor should satisfy it.",
        "",
        "Task objective:",
      ] : []),
      ...(decompositionPlanning ? [
        "AIDE semantic decomposition role:",
        "Decide whether the Task should remain one execution unit or be represented as a small ordered implementation plan.",
        "Do not execute, modify files, add requirements, or weaken the Task acceptance criteria. Preserve the user's objective and constraints from the shared Context Capsule.",
        "Use decision=single when one execution WorkPackage is sufficient. Use decision=decompose only when 2-8 ordered steps materially improve dependency clarity, verification, or handoff quality.",
        "For decision=decompose, every work_packages item must include verification: one bounded observable semantic postcondition that can be checked after execution. It is additive and must not weaken or replace Task acceptance.",
        "The work_packages array is advisory ordered structure for one executor in this Current vertical slice; it does not authorize parallel writers or independent Task closure.",
        "",
        "Task objective:",
      ] : []),
      ...(decompositionExecution ? [
        "AIDE ordered semantic decomposition execution:",
        "Use the durable semantic_decision steps in the shared Context Capsule as the ordered implementation plan.",
        "Satisfy every step verification postcondition before final completion. These postconditions are additive and do not replace the Task's final acceptance criteria.",
        "AIDE will independently verify the postconditions at finalization; do not treat your own completion claim as proof.",
        "",
        "Task objective:",
      ] : []),
      submitted.work_package.objective,
      "",
      "AIDE shared Context Capsule:",
      JSON.stringify(executionContext),
      ...(priorPlans.length === 0 ? [] : [
        "",
        "AIDE independent planning opinions. Reconcile disagreements using current evidence before executing; do not treat either opinion as authority:",
        JSON.stringify(priorPlans),
      ]),
    ].join("\n");
    throwIfAborted(signal);
    const started = this.router.start({
      harness: submitted.assignment.harness,
      cwd: workspaceRef.path,
      task: prompt,
      context: scopedContext,
      model: submitted.assignment.model ?? undefined,
      reasoningEffort: submitted.assignment.reasoning_effort ?? undefined,
      ...(decompositionPlanning ? { outputSchema: SEMANTIC_DECOMPOSITION_SCHEMA } : {}),
    });
    const runningAttempt = await this.store.markAttemptRunning(attempt.attempt_id, {
      runId: started.run_id,
      pid: started.pid ?? null,
      processGroupId: started.process_group_id ?? null,
      processTreeRootPid: started.process_tree_root_pid ?? null,
      hostname: this.hostName,
    });
    return { ...submitted, execution_context: executionContext, planning_consensus: priorPlans, workspace_ref: workspaceRef, attempt: runningAttempt, run: started };
  }

  async #projectRunEvents(attempt) {
    if (typeof this.router.events !== "function") return;
    const batch = this.router.events(attempt.run_id, { after: attempt.event_cursor ?? 0 });
    if (batch.gap === true) {
      throw Object.assign(new Error("Harness event buffer advanced past the durable projection cursor."), {
        code: "INTAKE_EVENT_GAP",
        attempt_id: attempt.attempt_id,
        run_id: attempt.run_id,
        oldest_seq: batch.oldest_seq,
        latest_seq: batch.latest_seq,
      });
    }
    for (const item of batch.events ?? []) {
      const event = item.event;
      if (event?.type === "session" && typeof event.sessionId === "string" && event.sessionId.length > 0) {
        await this.store.recordAttemptSession(attempt.attempt_id, event.sessionId);
      }
      if (event?.type === "approval_state") {
        if (!event.state || typeof event.state !== "object" || Array.isArray(event.state)) {
          throw Object.assign(new Error("Harness emitted an invalid approval-state event."), { code: "HARNESS_APPROVAL_STATE_INVALID" });
        }
        const workPackage = this.store.getWorkPackage(attempt.work_package_id);
        const driftReason = approvalContractDriftReason(attempt.assignment?.approval_contract, event.state)
          ?? approvalRequirementRejection(workPackage.requirements, event.state);
        await this.store.recordAttemptApprovalState(attempt.attempt_id, event.state, {
          validation: { compatible: driftReason === null, reason: driftReason },
        });
        if (driftReason !== null) {
          await this.store.advanceAttemptEventCursor(attempt.attempt_id, item.seq);
          let cancelState;
          try {
            cancelState = this.router.cancel(attempt.run_id);
          } catch (error) {
            throw Object.assign(new Error("Harness approval state drifted from the frozen routing policy and cancellation failed."), {
              code: "HARNESS_APPROVAL_STATE_INVALID",
              reason: driftReason,
              cancel_error: error?.code ?? error?.message ?? "cancel_failed",
            });
          }
          if (cancelState?.terminal !== true) {
            if (cancelState?.state !== "cancelling") {
              throw Object.assign(new Error("Harness approval state drifted from the frozen routing policy and cancellation was not accepted."), {
                code: "HARNESS_APPROVAL_STATE_INVALID",
                reason: driftReason,
              });
            }
            const current = this.store.getAttempt(attempt.attempt_id);
            if (current.status !== "cancelling") await this.store.markAttemptCancelling(attempt.attempt_id);
          }
          return;
        }
      }
      if (event?.type === "interaction_request") {
        const kind = event.kind;
        const summary = event.summary;
        const blocking = event.blocking ?? true;
        const nativeRequestRef = event.nativeRequestRef;
        const nativeContract = event.nativeContract ?? null;
        if (!["user_input", "permission", "authentication"].includes(kind)
          || typeof summary !== "string" || summary.trim().length === 0
          || typeof blocking !== "boolean"
          || typeof nativeRequestRef !== "string" || nativeRequestRef.length === 0
          || (nativeContract !== null && (!nativeContract || typeof nativeContract !== "object" || Array.isArray(nativeContract)))) {
          throw Object.assign(new Error("Harness emitted an invalid interaction request."), { code: "HARNESS_INTERACTION_EVENT_INVALID" });
        }
        await this.registerInteractionRequest(attempt.attempt_id, { kind, summary, blocking, nativeRequestRef, nativeContract });
      }
      if (event?.type === "side_effect") {
        if (!["none", "workspace_only", "external_possible"].includes(event.classification)
          || typeof event.source !== "string" || event.source.length === 0) {
          throw Object.assign(new Error("Harness emitted an invalid side-effect event."), { code: "HARNESS_SIDE_EFFECT_EVENT_INVALID" });
        }
        await this.store.recordAttemptSideEffects(attempt.attempt_id, {
          classification: event.classification,
          source: event.source,
          detail: event.detail ?? null,
        });
      }
      if (event?.type === "context_health" && event.event === "compaction") {
        if (typeof event.source !== "string" || event.source.length === 0 || (event.turnId !== null && event.turnId !== undefined && (typeof event.turnId !== "string" || event.turnId.length === 0))) {
          throw Object.assign(new Error("Harness emitted an invalid context-health event."), { code: "HARNESS_CONTEXT_HEALTH_EVENT_INVALID" });
        }
        await this.store.recordAttemptContextCompaction(attempt.attempt_id, { source: event.source, turnId: event.turnId ?? null });
      }
      if (event?.type === "model_reroute") {
        if ([event.fromModel, event.toModel, event.reason, event.turnId].some((value) => typeof value !== "string" || value.length === 0)) {
          throw Object.assign(new Error("Harness emitted an invalid model-reroute event."), { code: "HARNESS_MODEL_REROUTE_EVENT_INVALID" });
        }
        await this.store.recordAttemptModelReroute(attempt.attempt_id, {
          fromModel: event.fromModel,
          toModel: event.toModel,
          reason: event.reason,
          turnId: event.turnId,
        });
      }
      await this.store.advanceAttemptEventCursor(attempt.attempt_id, item.seq);
    }
  }

  async #finalizeAttempt(attempt, result, { facts, signal } = {}) {
    const workPackage = this.store.getWorkPackage(attempt.work_package_id);
    const task = this.store.getTask(workPackage.task_id);
    const workspace = attempt.workspace_ref_id ? this.store.getWorkspace(attempt.workspace_ref_id) : { path: attempt.workspace };
    const planningOnly = attempt.assignment?.role === "planning";
    const acceptance = planningOnly ? {} : task.acceptance ?? {};

    if (result?.status === "completed" && attempt.assignment?.approval_contract && attempt.approval_validation === null) {
      attempt = await this.store.recordAttemptApprovalValidation(attempt.attempt_id, {
        compatible: false,
        reason: "unknown:approval_state",
      });
    }

    if (attempt.approval_validation?.compatible === false) {
      const failedResult = {
        ...result,
        native_status: result?.status ?? null,
        status: "failed",
        error_code: "HARNESS_APPROVAL_STATE_INVALID",
        error_message: `Runtime approval state is incompatible with the frozen routing policy: ${attempt.approval_validation.reason}`,
      };
      const evidence = { workspace: resolve(workspace.path), files: [], approval_validation: attempt.approval_validation };
      const verification = {
        accepted: false,
        checks: [{ name: "approval_runtime_compatibility", passed: false, actual: attempt.approval_validation.reason, expected: "compatible" }],
      };
      const completedAttempt = await this.store.finishAttempt(attempt.attempt_id, { result: failedResult, evidence, acceptance: verification });
      return { state: "terminal", attempt: completedAttempt, result: failedResult, evidence, verification, closure: null };
    }

    const evidencePaths = Object.keys(acceptance.files ?? {});
    const evidenceRoot = workspace.mode === "isolated" && workspace.landing_status === "landed"
      ? workspace.project_root
      : workspace.path;
    let evidence = evidencePaths.length > 0
      ? await collectFileEvidence({ cwd: evidenceRoot, paths: evidencePaths, allowMissing: true })
      : { workspace: resolve(evidenceRoot), files: [] };
    let verification = evaluateAcceptance({ result, evidence, criteria: acceptance });
    let semanticAcceptance = null;
    if (planningOnly) {
      const planText = typeof result?.final_text === "string" ? result.final_text.trim() : "";
      const executorFinalText = workPackage.requirements?.plan_consensus === "dual" && typeof task.acceptance?.finalText === "string"
        ? task.acceptance.finalText.trim()
        : null;
      const echoesExecutorFinal = executorFinalText !== null && planText === executorFinalText;
      const hasPlan = planText.length > 0 && !echoesExecutorFinal;
      let decompositionValid = true;
      let decompositionError = null;
      if (workPackage.requirements?.semantic_decomposition === "plan" && planText.length > 0) {
        try { normalizeSemanticDecision(planText, task.objective); }
        catch (error) {
          decompositionValid = false;
          decompositionError = error?.code ?? "SEMANTIC_DECOMPOSITION_OUTPUT_INVALID";
        }
      }
      verification = {
        accepted: verification.accepted && hasPlan && decompositionValid,
        checks: [
          ...verification.checks,
          { name: "planning_output", passed: planText.length > 0, actual: planText.length > 0 ? "non-empty" : "empty", expected: "non-empty" },
          ...(executorFinalText === null ? [] : [{ name: "planning_role_separation", passed: !echoesExecutorFinal, actual: echoesExecutorFinal ? "executor_final_text" : "independent_plan", expected: "independent_plan" }]),
          ...(workPackage.requirements?.semantic_decomposition === "plan" ? [{ name: "semantic_decomposition_schema", passed: decompositionValid, actual: decompositionValid ? "valid" : decompositionError, expected: "valid" }] : []),
        ],
      };
    }
    if (!planningOnly) {
      const semanticRequirements = semanticReviewCriteria(task);
      const criteria = semanticRequirements.criteria;
      const currentTruth = this.store.getCurrentTruth().slice(-20);
      const semanticInputHash = criteria.length > 0 || semanticRequirements.step_verification_required
        ? semanticReviewFingerprint({ task, workPackage, attempt, result, evidence, criteria })
        : null;
      const priorCheckpoint = attempt.finalization_checkpoint;
      const reusableSemantic = priorCheckpoint?.semantic_input_hash === semanticInputHash
        && priorCheckpoint.semantic_acceptance?.review?.status === "available"
        ? priorCheckpoint.semantic_acceptance
        : null;
      if (semanticInputHash !== null) {
        await this.store.recordAttemptFinalizationCheckpoint(attempt.attempt_id, {
          result,
          evidence,
          verification,
          semanticInputHash,
          semanticAcceptance: reusableSemantic,
        });
      }
      semanticAcceptance = reusableSemantic ?? await this.#semanticAcceptance({
        task,
        workPackage,
        attempt,
        result,
        evidence,
        mechanical: verification,
        currentTruth,
        signal,
      });
      if (semanticAcceptance.required) {
        verification = {
          accepted: verification.accepted && semanticAcceptance.accepted,
          checks: [...verification.checks, ...semanticAcceptance.checks],
          semantic_review: semanticAcceptance.review,
          ...(semanticAcceptance.step_verification ? { step_verification: semanticAcceptance.step_verification } : {}),
        };
        await this.store.recordAttemptFinalizationCheckpoint(attempt.attempt_id, {
          result,
          evidence,
          verification,
          semanticInputHash,
          semanticAcceptance,
        });
      }
    }
    if (verification.accepted && workspace.mode === "isolated") {
      try {
        const currentWorkspace = this.store.getWorkspace(workspace.workspace_ref_id);
        let landing = currentWorkspace.landing_evidence;
        if (currentWorkspace.landing_status === "pending") {
          landing = await this.workspaceManager.land({ path: workspace.path, projectRoot: workspace.project_root });
          await this.store.markWorkspaceLanded(workspace.workspace_ref_id, { evidence: landing });
          if (typeof this.workspaceManager.discard === "function") {
            try { await this.workspaceManager.discard({ path: workspace.path, projectRoot: workspace.project_root }); }
            catch { /* landing is durable; stale worktree cleanup is non-semantic */ }
          }
        }
        const landedEvidence = evidencePaths.length > 0
          ? await collectFileEvidence({ cwd: workspace.project_root, paths: evidencePaths, allowMissing: true })
          : { workspace: resolve(workspace.project_root), files: [] };
        const landedVerification = evaluateAcceptance({ result, evidence: landedEvidence, criteria: acceptance });
        evidence = { ...landedEvidence, candidate_workspace: workspace.path, candidate_files: evidence.files, landing };
        verification = semanticAcceptance?.required
          ? {
              accepted: landedVerification.accepted && semanticAcceptance.accepted,
              checks: [...landedVerification.checks, ...semanticAcceptance.checks],
              semantic_review: semanticAcceptance.review,
              ...(semanticAcceptance.step_verification ? { step_verification: semanticAcceptance.step_verification } : {}),
            }
          : landedVerification;
        if (semanticAcceptance?.required) {
          const checkpoint = this.store.getAttempt(attempt.attempt_id).finalization_checkpoint;
          await this.store.recordAttemptFinalizationCheckpoint(attempt.attempt_id, {
            result,
            evidence,
            verification,
            semanticInputHash: checkpoint?.semantic_input_hash ?? null,
            semanticAcceptance,
          });
        }
      } catch (error) {
        evidence = { ...evidence, landing: { error_code: error?.code ?? "WORKSPACE_LANDING_FAILED", error_message: error?.message ?? "Workspace landing failed." } };
        verification = {
          accepted: false,
          checks: [
            ...verification.checks,
            { name: "workspace_landing", passed: false, actual: error?.code ?? "WORKSPACE_LANDING_FAILED", expected: "landed" },
          ],
        };
      }
    }
    const completedAttempt = await this.store.finishAttempt(attempt.attempt_id, { result, evidence, acceptance: verification });
    const closure = verification.accepted && !planningOnly
      ? await closeAcceptedTask({
          store: this.store,
          attemptId: completedAttempt.attempt_id,
          facts: Array.isArray(facts) && facts.length > 0 ? facts : [`Completed: ${workPackage.objective}`],
        })
      : null;
    const planningCompletion = verification.accepted && planningOnly
      ? await this.store.completeWorkPackage(workPackage.work_package_id, { attemptId: completedAttempt.attempt_id })
      : null;
    return { state: "terminal", attempt: completedAttempt, result, evidence, verification, closure, planning_completion: planningCompletion };
  }
}
