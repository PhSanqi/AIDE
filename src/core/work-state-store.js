import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const VERSION = 9;
const TERMINAL_ATTEMPTS = new Set(["completed", "failed", "cancelled"]);
const WAITING_ATTEMPTS = new Set(["waiting_input", "waiting_permission"]);
const INTERACTION_KINDS = new Set(["user_input", "permission", "authentication"]);
const INTERACTION_TERMINAL = new Set(["resolved", "cancelled", "orphaned"]);
const SIDE_EFFECT_CLASSES = new Set(["unknown", "none", "workspace_only", "external_possible"]);
const SIDE_EFFECT_RANK = { unknown: -1, none: 0, workspace_only: 1, external_possible: 2 };
const WORK_PACKAGE_TRANSITIONS = new Set(["handoff", "plan_consensus_planner", "plan_consensus_execution", "semantic_decomposition_execution"]);
const MAX_SIDE_EFFECT_EVIDENCE = 64;

const emptyState = () => ({ version: VERSION, conversations: {}, tasks: {}, work_packages: {}, attempts: {}, workspaces: {}, interactions: {}, submissions: {}, current_truth: [] });
const copy = (value) => structuredClone(value);

function syncAttemptWaitingState(state, attempt) {
  if (TERMINAL_ATTEMPTS.has(attempt.status) || attempt.status === "cancelling") return;
  const blocking = Object.values(state.interactions).filter((item) => item.attempt_id === attempt.attempt_id && item.status === "pending" && item.blocking);
  if (blocking.some((item) => item.kind === "permission")) attempt.status = "waiting_permission";
  else if (blocking.length > 0) attempt.status = "waiting_input";
  else if (WAITING_ATTEMPTS.has(attempt.status)) attempt.status = "running";
}

function requiredText(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${name} must be a non-empty string.`);
  return value;
}

function semanticConstraints(value = []) {
  if (!Array.isArray(value) || value.length > 32) throw new TypeError("constraints must be an array with at most 32 items.");
  const normalized = value.map((item) => {
    const text = requiredText(item, "constraint").trim();
    if (text.length > 1_000) throw new TypeError("constraint must not exceed 1000 characters.");
    return text;
  });
  return [...new Set(normalized)];
}

function conversationDefaults(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("conversation defaults must be an object.");
  const defaults = {};
  if (value.strategy !== undefined) {
    if (!["economy", "capability"].includes(value.strategy)) throw new TypeError("conversation default strategy must be economy or capability.");
    defaults.strategy = value.strategy;
  }
  if (value.mode !== undefined) {
    if (!["direct", "decompose", "crossfire"].includes(value.mode)) throw new TypeError("conversation default mode must be direct, decompose, or crossfire.");
    defaults.mode = value.mode;
  }
  if (value.target_id !== undefined) defaults.target_id = requiredText(value.target_id, "conversation target_id").trim();
  if (value.model !== undefined) defaults.model = requiredText(value.model, "conversation model").trim();
  if (value.reasoning_effort !== undefined) defaults.reasoning_effort = requiredText(value.reasoning_effort, "conversation reasoning_effort").trim();
  return defaults;
}

function approvalValidation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || typeof value.compatible !== "boolean"
    || (value.reason !== null && (typeof value.reason !== "string" || value.reason.length === 0))) {
    throw new TypeError("approval validation must contain compatible:boolean and reason:string|null.");
  }
  return value;
}

function validateState(state) {
  const record = (value) => value && typeof value === "object" && !Array.isArray(value);
  if (record(state) && state.version === 1 && record(state.tasks) && record(state.work_packages) && record(state.attempts) && Array.isArray(state.current_truth)) {
    state = { ...state, version: 2, workspaces: {} };
  }
  if (record(state) && state.version === 2 && record(state.tasks) && record(state.work_packages) && record(state.attempts) && record(state.workspaces) && Array.isArray(state.current_truth)) {
    state = { ...state, version: 3, interactions: {} };
  }
  if (record(state) && state.version === 3 && record(state.tasks) && record(state.work_packages) && record(state.attempts) && record(state.workspaces) && record(state.interactions) && Array.isArray(state.current_truth)) {
    state = { ...state, version: 4, submissions: {} };
  }
  if (record(state) && state.version === 4 && record(state.tasks) && record(state.work_packages) && record(state.attempts) && record(state.workspaces) && record(state.interactions) && record(state.submissions) && Array.isArray(state.current_truth)) {
    state = {
      ...state,
      version: 5,
      attempts: Object.fromEntries(Object.entries(state.attempts).map(([id, attempt]) => [id, { ...attempt, approval_validation: attempt.approval_validation ?? null }])),
    };
  }
  if (record(state) && state.version === 5 && record(state.tasks) && record(state.work_packages) && record(state.attempts) && record(state.workspaces) && record(state.interactions) && record(state.submissions) && Array.isArray(state.current_truth)) {
    state = {
      ...state,
      version: 6,
      tasks: Object.fromEntries(Object.entries(state.tasks).map(([id, task]) => [id, { ...task, semantic_decision: task.semantic_decision ?? null }])),
    };
  }
  if (record(state) && state.version === 6 && record(state.tasks) && record(state.work_packages) && record(state.attempts) && record(state.workspaces) && record(state.interactions) && record(state.submissions) && Array.isArray(state.current_truth)) {
    state = {
      ...state,
      version: 7,
      tasks: Object.fromEntries(Object.entries(state.tasks).map(([id, task]) => [id, { ...task, constraints: Array.isArray(task.constraints) ? task.constraints : [] }])),
    };
  }
  if (record(state) && state.version === 7 && record(state.tasks) && record(state.work_packages) && record(state.attempts) && record(state.workspaces) && record(state.interactions) && record(state.submissions) && Array.isArray(state.current_truth)) {
    state = {
      ...state,
      version: 8,
      attempts: Object.fromEntries(Object.entries(state.attempts).map(([id, attempt]) => [id, { ...attempt, finalization_checkpoint: attempt.finalization_checkpoint ?? null }])),
    };
  }
  if (record(state) && state.version === 8 && record(state.tasks) && record(state.work_packages) && record(state.attempts) && record(state.workspaces) && record(state.interactions) && record(state.submissions) && Array.isArray(state.current_truth)) {
    state = {
      ...state,
      version: VERSION,
      conversations: {},
      tasks: Object.fromEntries(Object.entries(state.tasks).map(([id, task]) => [id, { ...task, conversation_id: task.conversation_id ?? null }])),
    };
  }
  if (!record(state) || state.version !== VERSION || !record(state.conversations) || !record(state.tasks) || !record(state.work_packages) || !record(state.attempts) || !record(state.workspaces) || !record(state.interactions) || !record(state.submissions) || !Array.isArray(state.current_truth)) {
    throw Object.assign(new Error("Unsupported or invalid AIDE work state."), { code: "WORK_STATE_INVALID" });
  }
  return state;
}

export class WorkStateStore {
  constructor({ filePath, state, now = () => new Date().toISOString(), id = randomUUID }) {
    this.filePath = filePath;
    this.state = state;
    this.now = now;
    this.id = id;
    this.queue = Promise.resolve();
  }

  static async open({ filePath, now, id } = {}) {
    requiredText(filePath, "filePath");
    await mkdir(dirname(filePath), { recursive: true });
    let state;
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8"));
      state = validateState(parsed);
      if (parsed.version !== state.version) await WorkStateStore.#write(filePath, state);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      state = emptyState();
      await WorkStateStore.#write(filePath, state);
    }
    return new WorkStateStore({ filePath, state, now, id });
  }

  snapshot() { return copy(this.state); }
  getTask(taskId) { return copy(this.#require(this.state.tasks, taskId, "TASK_NOT_FOUND")); }
  getWorkPackage(workPackageId) { return copy(this.#require(this.state.work_packages, workPackageId, "WORK_PACKAGE_NOT_FOUND")); }
  getAttempt(attemptId) { return copy(this.#require(this.state.attempts, attemptId, "ATTEMPT_NOT_FOUND")); }
  getWorkspace(workspaceRefId) { return copy(this.#require(this.state.workspaces, workspaceRefId, "WORKSPACE_REF_NOT_FOUND")); }
  getInteraction(interactionId) { return copy(this.#require(this.state.interactions, interactionId, "INTERACTION_NOT_FOUND")); }
  getConversation(conversationId) { return copy(this.#require(this.state.conversations, conversationId, "CONVERSATION_NOT_FOUND")); }
  listConversations({ archived = false } = {}) {
    if (typeof archived !== "boolean") throw new TypeError("archived must be a boolean.");
    return copy(Object.values(this.state.conversations)
      .filter((conversation) => conversation.archived === archived)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .map((conversation) => {
        const tasks = Object.values(this.state.tasks).filter((task) => task.conversation_id === conversation.conversation_id);
        return { ...conversation, task_count: tasks.length, latest_task_id: tasks.at(-1)?.task_id ?? null };
      }));
  }
  getConversationView(conversationId) {
    const conversation = this.#require(this.state.conversations, conversationId, "CONVERSATION_NOT_FOUND");
    const tasks = Object.values(this.state.tasks).filter((task) => task.conversation_id === conversationId);
    return copy({ conversation, tasks: tasks.map((task) => this.getTaskView(task.task_id)) });
  }
  listInteractions({ attemptId = null, status = null } = {}) {
    return copy(Object.values(this.state.interactions).filter((item) =>
      (attemptId === null || item.attempt_id === attemptId) && (status === null || item.status === status)));
  }
  getTaskView(taskId) {
    const task = this.#require(this.state.tasks, taskId, "TASK_NOT_FOUND");
    const workPackages = Object.values(this.state.work_packages).filter((item) => item.task_id === task.task_id);
    const workPackageIds = new Set(workPackages.map((item) => item.work_package_id));
    const attempts = Object.values(this.state.attempts).filter((item) => workPackageIds.has(item.work_package_id));
    const activeAttempt = [...attempts].reverse().find((item) => !TERMINAL_ATTEMPTS.has(item.status)) ?? null;
    const latestAttempt = activeAttempt ?? attempts.at(-1) ?? null;
    const pendingInteractions = latestAttempt
      ? Object.values(this.state.interactions).filter((item) => item.attempt_id === latestAttempt.attempt_id && item.status === "pending")
      : [];
    return copy({
      task,
      work_packages: workPackages,
      attempts,
      active_attempt: activeAttempt,
      latest_attempt: latestAttempt,
      pending_interactions: pendingInteractions,
    });
  }
  listTaskViews({ status = null } = {}) {
    if (status !== null && typeof status !== "string") throw new TypeError("Task status filter must be a string or null.");
    return Object.values(this.state.tasks)
      .filter((task) => status === null || task.status === status)
      .map((task) => this.getTaskView(task.task_id));
  }
  listRoutingHistory({ limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new TypeError("Routing history limit must be an integer between 1 and 1000.");
    const attempts = Object.values(this.state.attempts)
      .filter((attempt) => TERMINAL_ATTEMPTS.has(attempt.status) && attempt.routing_trace)
      .sort((left, right) => (left.completed_at ?? left.created_at).localeCompare(right.completed_at ?? right.created_at))
      .slice(-limit);
    return copy(attempts.map((attempt) => {
      const workPackage = this.#require(this.state.work_packages, attempt.work_package_id, "WORK_PACKAGE_NOT_FOUND");
      const task = this.#require(this.state.tasks, workPackage.task_id, "TASK_NOT_FOUND");
      const startedMs = Date.parse(attempt.routing_trace.started_at ?? "");
      const completedMs = Date.parse(attempt.completed_at ?? "");
      return {
        task_id: task.task_id,
        work_package_id: workPackage.work_package_id,
        attempt_id: attempt.attempt_id,
        task_shape: {
          constraints_count: Array.isArray(task.constraints) ? task.constraints.length : 0,
          semantic_acceptance_count: Array.isArray(task.acceptance?.semantic) ? task.acceptance.semantic.length : 0,
          semantic_decision: task.semantic_decision?.decision ?? null,
        },
        lineage: workPackage.lineage ?? null,
        requirements: workPackage.requirements ?? {},
        routing: attempt.routing_trace,
        verification: {
          accepted: attempt.acceptance?.accepted === true,
          semantic_review: attempt.acceptance?.semantic_review ? {
            status: attempt.acceptance.semantic_review.status ?? null,
            accepted: attempt.acceptance.semantic_review.accepted ?? null,
            source: attempt.acceptance.semantic_review.source ?? null,
          } : null,
          step_verification: attempt.acceptance?.step_verification ? {
            status: attempt.acceptance.step_verification.status ?? null,
            accepted: attempt.acceptance.step_verification.accepted ?? null,
            step_count: Array.isArray(attempt.acceptance.step_verification.steps) ? attempt.acceptance.step_verification.steps.length : 0,
          } : null,
        },
        wall_duration_ms: Number.isFinite(startedMs) && Number.isFinite(completedMs) ? Math.max(0, completedMs - startedMs) : null,
      };
    }));
  }
  getCurrentTruth() { return copy(this.state.current_truth); }

  ensureWorkspace({ path, projectRoot = path, mode = "direct" } = {}) {
    return this.#mutate((state) => {
      if (mode !== "direct" && mode !== "isolated") throw new TypeError("workspace mode must be direct or isolated.");
      const workspacePath = resolve(requiredText(path, "path"));
      const projectPath = resolve(requiredText(projectRoot, "projectRoot"));
      if (mode === "direct" && workspacePath !== projectPath) {
        throw Object.assign(new Error("Direct workspace must be the project workspace."), { code: "WORKSPACE_DIRECT_PATH_MISMATCH" });
      }
      const existing = Object.values(state.workspaces).find((item) => item.path === workspacePath && item.project_root === projectPath && item.mode === mode);
      if (existing) return existing;
      const workspace = {
        workspace_ref_id: `workspace-${this.id()}`,
        path: workspacePath,
        project_root: projectPath,
        mode,
        landing_required: mode === "isolated",
        landing_status: mode === "isolated" ? "pending" : "not_required",
        landing_evidence: null,
        landed_at: null,
        created_at: this.now(),
      };
      state.workspaces[workspace.workspace_ref_id] = workspace;
      return workspace;
    });
  }

  markWorkspaceLanded(workspaceRefId, { evidence = null } = {}) {
    return this.#mutate((state) => {
      const workspace = this.#require(state.workspaces, workspaceRefId, "WORKSPACE_REF_NOT_FOUND");
      if (!workspace.landing_required) throw Object.assign(new Error("Direct workspace does not require landing."), { code: "WORKSPACE_LANDING_NOT_REQUIRED" });
      if (workspace.landing_status !== "pending") throw Object.assign(new Error("Workspace is not pending landing."), { code: "WORKSPACE_LANDING_STATE_INVALID" });
      workspace.landing_status = "landed";
      workspace.landing_evidence = copy(evidence);
      workspace.landed_at = this.now();
      return workspace;
    });
  }

  createConversation({ title = "New conversation", defaults = {} } = {}) {
    return this.#mutate((state) => {
      const now = this.now();
      const conversation = {
        conversation_id: `conversation-${this.id()}`,
        title: requiredText(title, "title").trim(),
        archived: false,
        defaults: conversationDefaults(defaults),
        created_at: now,
        updated_at: now,
      };
      state.conversations[conversation.conversation_id] = conversation;
      return conversation;
    });
  }

  updateConversation(conversationId, { title, archived, defaults } = {}) {
    return this.#mutate((state) => {
      const conversation = this.#require(state.conversations, conversationId, "CONVERSATION_NOT_FOUND");
      if (title !== undefined) conversation.title = requiredText(title, "title").trim();
      if (archived !== undefined) {
        if (typeof archived !== "boolean") throw new TypeError("archived must be a boolean.");
        conversation.archived = archived;
      }
      if (defaults !== undefined) conversation.defaults = conversationDefaults(defaults);
      conversation.updated_at = this.now();
      return conversation;
    });
  }

  createTask({ objective, acceptance = {}, constraints = [], conversationId = null } = {}) {
    return this.#mutate((state) => {
      if (conversationId !== null) this.#require(state.conversations, conversationId, "CONVERSATION_NOT_FOUND");
      const task = {
        task_id: `task-${this.id()}`,
        conversation_id: conversationId,
        objective: requiredText(objective, "objective"),
        acceptance: copy(acceptance),
        constraints: semanticConstraints(constraints),
        semantic_decision: null,
        status: "open",
        created_at: this.now(),
        completed_at: null,
        closed_by_attempt_id: null,
      };
      state.tasks[task.task_id] = task;
      if (conversationId !== null) state.conversations[conversationId].updated_at = this.now();
      return task;
    });
  }

  createSubmission({ objective, acceptance = {}, constraints = [], requirements = {}, clientRequestId = null, requestFingerprint = null, conversationId = null } = {}) {
    return this.#mutate((state) => {
      const normalizedObjective = requiredText(objective, "objective");
      const normalizedConstraints = semanticConstraints(constraints);
      const conversation = conversationId === null ? null : this.#require(state.conversations, conversationId, "CONVERSATION_NOT_FOUND");
      let requestKey = null;
      if (clientRequestId !== null) {
        const requestId = requiredText(clientRequestId, "clientRequestId");
        const fingerprint = requiredText(requestFingerprint, "requestFingerprint");
        requestKey = createHash("sha256").update(requestId).digest("hex");
        const previous = state.submissions[requestKey];
        if (previous) {
          if (previous.fingerprint !== fingerprint) {
            throw Object.assign(new Error("Idempotency key was already used for a different submission."), {
              code: "SUBMISSION_IDEMPOTENCY_CONFLICT",
              task_id: previous.task_id,
            });
          }
          return {
            task: this.#require(state.tasks, previous.task_id, "TASK_NOT_FOUND"),
            work_package: this.#require(state.work_packages, previous.work_package_id, "WORK_PACKAGE_NOT_FOUND"),
            replayed: true,
          };
        }
      }

      const now = this.now();
      const task = {
        task_id: `task-${this.id()}`,
        conversation_id: conversationId,
        objective: normalizedObjective,
        acceptance: copy(acceptance),
        constraints: normalizedConstraints,
        semantic_decision: null,
        status: "open",
        created_at: now,
        completed_at: null,
        closed_by_attempt_id: null,
      };
      const workPackage = {
        work_package_id: `wp-${this.id()}`,
        task_id: task.task_id,
        objective: normalizedObjective,
        requirements: copy(requirements),
        lineage: { kind: "submission", from_attempt_id: null },
        status: "ready",
        created_at: now,
        completed_at: null,
        completed_by_attempt_id: null,
      };
      state.tasks[task.task_id] = task;
      state.work_packages[workPackage.work_package_id] = workPackage;
      if (conversation) {
        if (conversation.title === "New conversation") conversation.title = normalizedObjective.slice(0, 80);
        conversation.updated_at = now;
      }
      if (requestKey) {
        state.submissions[requestKey] = {
          fingerprint: requestFingerprint,
          task_id: task.task_id,
          work_package_id: workPackage.work_package_id,
          created_at: now,
        };
      }
      return { task, work_package: workPackage, replayed: false };
    });
  }

  recordTaskSemanticDecision(taskId, { sourceAttemptId, decision, reason, steps } = {}) {
    if (!["single", "decompose"].includes(decision)) throw new TypeError("semantic decision must be single or decompose.");
    const normalizedReason = requiredText(reason, "reason");
    if (normalizedReason.length > 2_000) throw new TypeError("semantic decision reason must not exceed 2000 characters.");
    if (!Array.isArray(steps) || steps.length === 0 || steps.length > 8 || steps.some((step) => !step || typeof step !== "object" || Array.isArray(step) || typeof step.objective !== "string" || step.objective.trim().length === 0 || step.objective.length > 2_000)) {
      throw new TypeError("semantic decision steps must contain 1-8 objective objects.");
    }
    if ((decision === "single" && steps.length !== 1) || (decision === "decompose" && steps.length < 2)) {
      throw new TypeError("semantic decision step count does not match the decision.");
    }
    if (decision === "decompose" && steps.some((step) => typeof step.verification !== "string" || step.verification.trim().length === 0 || step.verification.length > 1_000)) {
      throw new TypeError("decomposed semantic decision steps require bounded verification strings.");
    }
    return this.#mutate((state) => {
      const task = this.#require(state.tasks, taskId, "TASK_NOT_FOUND");
      if (task.status !== "open") throw Object.assign(new Error("Semantic decision requires an open Task."), { code: "TASK_STATE_INVALID" });
      const attempt = this.#require(state.attempts, sourceAttemptId, "ATTEMPT_NOT_FOUND");
      const workPackage = this.#require(state.work_packages, attempt.work_package_id, "WORK_PACKAGE_NOT_FOUND");
      if (workPackage.task_id !== task.task_id || workPackage.requirements?.semantic_decomposition !== "plan"
        || attempt.status !== "completed" || attempt.acceptance?.accepted !== true || attempt.assignment?.role !== "planning") {
        throw Object.assign(new Error("Semantic decision requires an accepted planning Attempt from the same Task."), { code: "SEMANTIC_DECISION_SOURCE_INVALID" });
      }
      const value = {
        kind: "task_decomposition",
        decision,
        reason: normalizedReason,
        steps: steps.map((step) => ({
          objective: step.objective.trim(),
          ...(typeof step.verification === "string" && step.verification.trim().length > 0 ? { verification: step.verification.trim() } : {}),
        })),
        source_attempt_id: attempt.attempt_id,
        created_at: this.now(),
      };
      if (task.semantic_decision !== null) {
        if (task.semantic_decision.source_attempt_id === attempt.attempt_id) return task.semantic_decision;
        throw Object.assign(new Error("Task already has a semantic decomposition decision."), { code: "SEMANTIC_DECISION_ALREADY_SET" });
      }
      task.semantic_decision = value;
      return value;
    });
  }

  createWorkPackage({ taskId, objective, requirements = {}, lineage = null } = {}) {
    return this.#mutate((state) => {
      const task = this.#require(state.tasks, taskId, "TASK_NOT_FOUND");
      if (task.status !== "open") throw Object.assign(new Error("Task is not open for new WorkPackages."), { code: "TASK_STATE_INVALID" });
      let storedLineage = null;
      if (lineage !== null) {
        if (!lineage || typeof lineage !== "object" || Array.isArray(lineage)
          || !WORK_PACKAGE_TRANSITIONS.has(lineage.kind)
          || typeof lineage.from_attempt_id !== "string" || lineage.from_attempt_id.length === 0) {
          throw new TypeError("lineage must contain a supported kind and from_attempt_id.");
        }
        const sourceAttempt = this.#require(state.attempts, lineage.from_attempt_id, "WORK_PACKAGE_LINEAGE_ATTEMPT_NOT_FOUND");
        if (!TERMINAL_ATTEMPTS.has(sourceAttempt.status)) {
          throw Object.assign(new Error("WorkPackage lineage requires a terminal source Attempt."), { code: "WORK_PACKAGE_LINEAGE_SOURCE_ACTIVE" });
        }
        const sourceWorkPackage = this.#require(state.work_packages, sourceAttempt.work_package_id, "WORK_PACKAGE_NOT_FOUND");
        if (sourceWorkPackage.task_id !== taskId) {
          throw Object.assign(new Error("WorkPackage lineage cannot cross Task boundaries."), { code: "WORK_PACKAGE_LINEAGE_TASK_MISMATCH" });
        }
        storedLineage = { kind: lineage.kind, from_attempt_id: lineage.from_attempt_id };
      }
      const workPackage = {
        work_package_id: `wp-${this.id()}`,
        task_id: taskId,
        objective: requiredText(objective, "objective"),
        requirements: copy(requirements),
        lineage: storedLineage,
        status: "ready",
        created_at: this.now(),
        completed_at: null,
        completed_by_attempt_id: null,
      };
      state.work_packages[workPackage.work_package_id] = workPackage;
      return workPackage;
    });
  }

  completeWorkPackage(workPackageId, { attemptId } = {}) {
    return this.#mutate((state) => {
      const workPackage = this.#require(state.work_packages, workPackageId, "WORK_PACKAGE_NOT_FOUND");
      const task = this.#require(state.tasks, workPackage.task_id, "TASK_NOT_FOUND");
      const attempt = this.#require(state.attempts, attemptId, "ATTEMPT_NOT_FOUND");
      if (task.status !== "open" || workPackage.status !== "ready" || attempt.status !== "completed") {
        throw Object.assign(new Error("WorkPackage completion requires open Task, ready WorkPackage, and completed Attempt."), { code: "WORK_PACKAGE_COMPLETION_STATE_INVALID" });
      }
      if (attempt.work_package_id !== workPackage.work_package_id) {
        throw Object.assign(new Error("Attempt does not belong to the WorkPackage being completed."), { code: "WORK_PACKAGE_COMPLETION_LINK_INVALID" });
      }
      if (attempt.acceptance?.accepted !== true) {
        throw Object.assign(new Error("WorkPackage completion requires accepted evidence."), { code: "WORK_PACKAGE_ACCEPTANCE_REQUIRED" });
      }
      workPackage.status = "completed";
      workPackage.completed_at = this.now();
      workPackage.completed_by_attempt_id = attempt.attempt_id;
      return workPackage;
    });
  }

  createAttempt({ workPackageId, assignment, workspace, workspaceRefId = null, routingTrace = null } = {}) {
    if (routingTrace !== null && (!routingTrace || typeof routingTrace !== "object" || Array.isArray(routingTrace))) {
      throw new TypeError("routingTrace must be an object or null.");
    }
    return this.#mutate((state) => {
      const workPackage = this.#require(state.work_packages, workPackageId, "WORK_PACKAGE_NOT_FOUND");
      if (workPackage.status !== "ready") throw Object.assign(new Error("WorkPackage is not ready for a new Attempt."), { code: "WORK_PACKAGE_STATE_INVALID" });
      if (!assignment || typeof assignment !== "object" || Array.isArray(assignment)) throw new TypeError("assignment must be an object.");
      const workspaceRef = workspaceRefId ? this.#require(state.workspaces, workspaceRefId, "WORKSPACE_REF_NOT_FOUND") : null;
      const workspacePath = workspaceRef ? workspaceRef.path : resolve(requiredText(workspace, "workspace"));
      const conflict = Object.values(state.attempts).find((item) => item.workspace === workspacePath && !TERMINAL_ATTEMPTS.has(item.status));
      if (conflict) throw Object.assign(new Error("Workspace already has an active writer Attempt."), { code: "WORKSPACE_WRITER_CONFLICT" });
      const attempt = {
        attempt_id: `attempt-${this.id()}`,
        work_package_id: workPackageId,
        assignment: copy(assignment),
        workspace: workspacePath,
        workspace_ref_id: workspaceRef?.workspace_ref_id ?? null,
        status: "created",
        run_id: null,
        event_cursor: 0,
        session_id: null,
        runtime_process: null,
        native_model_state: { requested_model: assignment.model ?? null, current_model: assignment.model ?? null, reroutes: [] },
        native_approval_state: null,
        approval_validation: null,
        side_effects: "unknown",
        side_effect_evidence: [],
        context_health: { compaction_count: 0, last_compaction_at: null, last_source: null, last_turn_id: null },
        routing_trace: routingTrace === null ? null : copy(routingTrace),
        finalization_checkpoint: null,
        outcome: null,
        evidence: null,
        acceptance: null,
        created_at: this.now(),
        completed_at: null,
      };
      state.attempts[attempt.attempt_id] = attempt;
      return attempt;
    });
  }

  markAttemptRunning(attemptId, { runId, pid = null, processGroupId = null, processTreeRootPid = null, hostname = null } = {}) {
    return this.#mutate((state) => {
      const attempt = this.#require(state.attempts, attemptId, "ATTEMPT_NOT_FOUND");
      if (attempt.status !== "created") throw Object.assign(new Error("Attempt is not in created state."), { code: "ATTEMPT_STATE_INVALID" });
      attempt.status = "running";
      attempt.run_id = requiredText(runId, "runId");
      if (attempt.routing_trace) attempt.routing_trace.started_at = this.now();
      if (processGroupId !== null && (!Number.isInteger(processGroupId) || processGroupId <= 0)) throw new TypeError("processGroupId must be a positive integer when provided.");
      if (processTreeRootPid !== null && (!Number.isInteger(processTreeRootPid) || processTreeRootPid <= 0)) throw new TypeError("processTreeRootPid must be a positive integer when provided.");
      if (pid !== null) {
        if (!Number.isInteger(pid) || pid <= 0) throw new TypeError("pid must be a positive integer when provided.");
        attempt.runtime_process = {
          pid,
          ...(processGroupId === null ? {} : { process_group_id: processGroupId }),
          ...(processTreeRootPid === null ? {} : { process_tree_root_pid: processTreeRootPid }),
          hostname: requiredText(hostname, "hostname"),
          observed_at: this.now(),
        };
      }
      return attempt;
    });
  }

  recordAttemptSession(attemptId, sessionId) {
    return this.#mutate((state) => {
      const attempt = this.#require(state.attempts, attemptId, "ATTEMPT_NOT_FOUND");
      if (TERMINAL_ATTEMPTS.has(attempt.status)) throw Object.assign(new Error("Terminal Attempt cannot change session identity."), { code: "ATTEMPT_STATE_INVALID" });
      attempt.session_id = requiredText(sessionId, "sessionId");
      return attempt;
    });
  }

  recordAttemptApprovalState(attemptId, stateValue, { validation = null } = {}) {
    if (!stateValue || typeof stateValue !== "object" || Array.isArray(stateValue)) throw new TypeError("approval state must be an object.");
    if (validation !== null) approvalValidation(validation);
    return this.#mutate((state) => {
      const attempt = this.#require(state.attempts, attemptId, "ATTEMPT_NOT_FOUND");
      if (TERMINAL_ATTEMPTS.has(attempt.status)) throw Object.assign(new Error("Terminal Attempt cannot change approval state."), { code: "ATTEMPT_STATE_INVALID" });
      attempt.native_approval_state = copy(stateValue);
      if (validation !== null && attempt.approval_validation?.compatible !== false) {
        attempt.approval_validation = { ...copy(validation), observed_at: this.now() };
      }
      return attempt;
    });
  }

  recordAttemptApprovalValidation(attemptId, validation) {
    approvalValidation(validation);
    return this.#mutate((state) => {
      const attempt = this.#require(state.attempts, attemptId, "ATTEMPT_NOT_FOUND");
      if (TERMINAL_ATTEMPTS.has(attempt.status)) throw Object.assign(new Error("Terminal Attempt cannot change approval validation."), { code: "ATTEMPT_STATE_INVALID" });
      if (attempt.approval_validation?.compatible !== false) {
        attempt.approval_validation = { ...copy(validation), observed_at: this.now() };
      }
      return attempt;
    });
  }

  recordAttemptSideEffects(attemptId, { classification, source, detail = null } = {}) {
    if (!SIDE_EFFECT_CLASSES.has(classification)) throw new TypeError("side-effect classification must be unknown, none, workspace_only, or external_possible.");
    return this.#mutate((state) => {
      const attempt = this.#require(state.attempts, attemptId, "ATTEMPT_NOT_FOUND");
      if (TERMINAL_ATTEMPTS.has(attempt.status)) throw Object.assign(new Error("Terminal Attempt cannot change side-effect classification."), { code: "ATTEMPT_STATE_INVALID" });
      const current = SIDE_EFFECT_CLASSES.has(attempt.side_effects) ? attempt.side_effects : "unknown";
      if (classification !== "unknown" && SIDE_EFFECT_RANK[classification] > SIDE_EFFECT_RANK[current]) attempt.side_effects = classification;
      else attempt.side_effects = current;
      attempt.side_effect_evidence ??= [];
      attempt.side_effect_evidence.push({
        classification,
        source: requiredText(source, "source"),
        detail: detail === null ? null : copy(detail),
        observed_at: this.now(),
      });
      if (attempt.side_effect_evidence.length > MAX_SIDE_EFFECT_EVIDENCE) {
        attempt.side_effect_evidence.splice(0, attempt.side_effect_evidence.length - MAX_SIDE_EFFECT_EVIDENCE);
      }
      return attempt;
    });
  }

  recordAttemptContextCompaction(attemptId, { source, turnId = null } = {}) {
    return this.#mutate((state) => {
      const attempt = this.#require(state.attempts, attemptId, "ATTEMPT_NOT_FOUND");
      if (TERMINAL_ATTEMPTS.has(attempt.status)) throw Object.assign(new Error("Terminal Attempt cannot change context health."), { code: "ATTEMPT_STATE_INVALID" });
      const health = attempt.context_health ?? { compaction_count: 0, last_compaction_at: null, last_source: null, last_turn_id: null };
      health.compaction_count += 1;
      health.last_compaction_at = this.now();
      health.last_source = requiredText(source, "source");
      health.last_turn_id = turnId === null ? null : requiredText(turnId, "turnId");
      attempt.context_health = health;
      return attempt;
    });
  }

  recordAttemptModelReroute(attemptId, { fromModel, toModel, reason, turnId } = {}) {
    return this.#mutate((state) => {
      const attempt = this.#require(state.attempts, attemptId, "ATTEMPT_NOT_FOUND");
      if (TERMINAL_ATTEMPTS.has(attempt.status)) throw Object.assign(new Error("Terminal Attempt cannot change native model state."), { code: "ATTEMPT_STATE_INVALID" });
      const modelState = attempt.native_model_state ?? { requested_model: attempt.assignment?.model ?? null, current_model: attempt.assignment?.model ?? null, reroutes: [] };
      modelState.current_model = requiredText(toModel, "toModel");
      modelState.reroutes.push({
        from_model: requiredText(fromModel, "fromModel"),
        to_model: modelState.current_model,
        reason: requiredText(reason, "reason"),
        turn_id: requiredText(turnId, "turnId"),
        observed_at: this.now(),
      });
      attempt.native_model_state = modelState;
      return attempt;
    });
  }

  markAttemptCancelling(attemptId) {
    return this.#mutate((state) => {
      const attempt = this.#require(state.attempts, attemptId, "ATTEMPT_NOT_FOUND");
      if (attempt.status !== "running" && !WAITING_ATTEMPTS.has(attempt.status)) throw Object.assign(new Error("Attempt is not active."), { code: "ATTEMPT_STATE_INVALID" });
      attempt.status = "cancelling";
      return attempt;
    });
  }

  advanceAttemptEventCursor(attemptId, seq) {
    if (!Number.isInteger(seq) || seq < 0) throw new TypeError("event cursor must be a non-negative integer.");
    return this.#mutate((state) => {
      const attempt = this.#require(state.attempts, attemptId, "ATTEMPT_NOT_FOUND");
      attempt.event_cursor = Math.max(attempt.event_cursor ?? 0, seq);
      return attempt;
    });
  }

  createInteraction({ attemptId, kind, summary, blocking = true, nativeRequestRef = null, nativeContract = null } = {}) {
    return this.#mutate((state) => {
      const attempt = this.#require(state.attempts, attemptId, "ATTEMPT_NOT_FOUND");
      if (attempt.status !== "running" && !WAITING_ATTEMPTS.has(attempt.status)) throw Object.assign(new Error("Interaction requires an active Attempt."), { code: "INTERACTION_ATTEMPT_NOT_RUNNING" });
      if (!INTERACTION_KINDS.has(kind)) throw new TypeError("interaction kind must be user_input, permission, or authentication.");
      if (typeof blocking !== "boolean") throw new TypeError("blocking must be boolean.");
      if (nativeContract !== null && (!nativeContract || typeof nativeContract !== "object" || Array.isArray(nativeContract))) {
        throw new TypeError("nativeContract must be an object or null.");
      }
      if (nativeRequestRef !== null) {
        requiredText(nativeRequestRef, "nativeRequestRef");
        const existing = Object.values(state.interactions).find((item) => item.attempt_id === attempt.attempt_id && item.native_request_ref === nativeRequestRef);
        if (existing) return existing;
      }
      const interaction = {
        interaction_id: `interaction-${this.id()}`,
        attempt_id: attempt.attempt_id,
        run_id: attempt.run_id,
        kind,
        summary: requiredText(summary, "summary"),
        blocking,
        native_request_ref: nativeRequestRef === null ? null : requiredText(nativeRequestRef, "nativeRequestRef"),
        native_contract: nativeContract === null ? null : copy(nativeContract),
        status: "pending",
        response: null,
        resolved_by: null,
        created_at: this.now(),
        resolved_at: null,
      };
      state.interactions[interaction.interaction_id] = interaction;
      if (blocking) syncAttemptWaitingState(state, attempt);
      return interaction;
    });
  }

  resolveInteraction(interactionId, { response, resolvedBy = "user" } = {}) {
    return this.#mutate((state) => {
      const interaction = this.#require(state.interactions, interactionId, "INTERACTION_NOT_FOUND");
      if (interaction.status !== "pending") throw Object.assign(new Error("Interaction is not pending."), { code: "INTERACTION_STATE_INVALID" });
      interaction.status = "resolved";
      interaction.response = copy(response ?? null);
      interaction.resolved_by = requiredText(resolvedBy, "resolvedBy");
      interaction.resolved_at = this.now();
      const attempt = this.#require(state.attempts, interaction.attempt_id, "ATTEMPT_NOT_FOUND");
      syncAttemptWaitingState(state, attempt);
      return interaction;
    });
  }

  closeInteraction(interactionId, { status, reason = null } = {}) {
    return this.#mutate((state) => {
      const interaction = this.#require(state.interactions, interactionId, "INTERACTION_NOT_FOUND");
      if (interaction.status !== "pending") throw Object.assign(new Error("Interaction is not pending."), { code: "INTERACTION_STATE_INVALID" });
      if (!INTERACTION_TERMINAL.has(status) || status === "resolved") throw new TypeError("interaction close status must be cancelled or orphaned.");
      interaction.status = status;
      interaction.response = reason;
      interaction.resolved_by = "system";
      interaction.resolved_at = this.now();
      const attempt = this.#require(state.attempts, interaction.attempt_id, "ATTEMPT_NOT_FOUND");
      syncAttemptWaitingState(state, attempt);
      return interaction;
    });
  }

  recordAttemptFinalizationCheckpoint(attemptId, { result, evidence, verification, semanticInputHash = null, semanticAcceptance = null } = {}) {
    if (!TERMINAL_ATTEMPTS.has(result?.status)) throw Object.assign(new Error("Finalization checkpoint result must be terminal."), { code: "ATTEMPT_RESULT_INVALID" });
    if (!verification || typeof verification !== "object" || Array.isArray(verification) || typeof verification.accepted !== "boolean") {
      throw new TypeError("Finalization checkpoint verification must contain accepted:boolean.");
    }
    if (semanticInputHash !== null && (typeof semanticInputHash !== "string" || semanticInputHash.length === 0)) {
      throw new TypeError("semanticInputHash must be a non-empty string or null.");
    }
    return this.#mutate((state) => {
      const attempt = this.#require(state.attempts, attemptId, "ATTEMPT_NOT_FOUND");
      if (TERMINAL_ATTEMPTS.has(attempt.status)) throw Object.assign(new Error("Terminal Attempt cannot change finalization checkpoint."), { code: "ATTEMPT_STATE_INVALID" });
      attempt.finalization_checkpoint = {
        result: copy(result),
        evidence: copy(evidence ?? null),
        verification: copy(verification),
        semantic_input_hash: semanticInputHash,
        semantic_acceptance: semanticAcceptance === null ? null : copy(semanticAcceptance),
        updated_at: this.now(),
      };
      return attempt.finalization_checkpoint;
    });
  }

  finishAttempt(attemptId, { result, evidence, acceptance } = {}) {
    return this.#mutate((state) => {
      const attempt = this.#require(state.attempts, attemptId, "ATTEMPT_NOT_FOUND");
      if (attempt.status !== "running" && attempt.status !== "cancelling" && !WAITING_ATTEMPTS.has(attempt.status)) throw Object.assign(new Error("Attempt is not active."), { code: "ATTEMPT_STATE_INVALID" });
      const resultStatus = result?.status;
      if (!TERMINAL_ATTEMPTS.has(resultStatus)) throw Object.assign(new Error("Attempt result must be terminal."), { code: "ATTEMPT_RESULT_INVALID" });
      attempt.status = resultStatus;
      attempt.session_id = typeof result?.session_id === "string" ? result.session_id : null;
      attempt.outcome = copy(result);
      attempt.evidence = copy(evidence ?? null);
      attempt.acceptance = copy(acceptance ?? null);
      attempt.finalization_checkpoint = null;
      attempt.completed_at = this.now();
      if (attempt.routing_trace) {
        attempt.routing_trace.outcome = {
          status: resultStatus,
          accepted: typeof acceptance?.accepted === "boolean" ? acceptance.accepted : null,
          side_effects: attempt.side_effects ?? "unknown",
          context_health: attempt.context_health ? copy(attempt.context_health) : null,
          native_model_state: attempt.native_model_state ? copy(attempt.native_model_state) : null,
          usage: result?.usage && typeof result.usage === "object" && !Array.isArray(result.usage) ? copy(result.usage) : null,
          completed_at: attempt.completed_at,
        };
      }
      for (const interaction of Object.values(state.interactions)) {
        if (interaction.attempt_id === attempt.attempt_id && interaction.status === "pending") {
          interaction.status = "orphaned";
          interaction.response = "attempt_terminal";
          interaction.resolved_by = "system";
          interaction.resolved_at = attempt.completed_at;
        }
      }
      return attempt;
    });
  }

  commitTaskClosure({ taskId, workPackageId, attemptId, facts } = {}) {
    if (!Array.isArray(facts) || facts.length === 0 || facts.some((fact) => typeof fact !== "string" || fact.trim().length === 0)) {
      throw new TypeError("facts must be a non-empty array of non-empty strings.");
    }
    return this.#mutate((state) => {
      const task = this.#require(state.tasks, taskId, "TASK_NOT_FOUND");
      const workPackage = this.#require(state.work_packages, workPackageId, "WORK_PACKAGE_NOT_FOUND");
      const attempt = this.#require(state.attempts, attemptId, "ATTEMPT_NOT_FOUND");
      if (task.status !== "open" || workPackage.status !== "ready" || attempt.status !== "completed") {
        throw Object.assign(new Error("Task closure requires open Task, ready WorkPackage, and completed Attempt."), { code: "TASK_CLOSURE_STATE_INVALID" });
      }
      if (workPackage.task_id !== taskId || attempt.work_package_id !== workPackageId) {
        throw Object.assign(new Error("Task closure references do not belong to one execution chain."), { code: "TASK_CLOSURE_LINK_INVALID" });
      }
      if (attempt.acceptance?.accepted !== true) {
        throw Object.assign(new Error("Task closure requires accepted evidence."), { code: "TASK_ACCEPTANCE_REQUIRED" });
      }
      if (attempt.workspace_ref_id) {
        const workspace = this.#require(state.workspaces, attempt.workspace_ref_id, "WORKSPACE_REF_NOT_FOUND");
        if (workspace.landing_required && workspace.landing_status !== "landed") {
          throw Object.assign(new Error("Task closure requires the isolated workspace to be landed first."), { code: "TASK_LANDING_REQUIRED" });
        }
      }
      const now = this.now();
      const truthUpdate = {
        truth_id: `truth-${this.id()}`,
        task_id: taskId,
        work_package_id: workPackageId,
        attempt_id: attemptId,
        facts: facts.map((fact) => fact.trim()),
        evidence_attempt_id: attemptId,
        created_at: now,
      };
      state.current_truth.push(truthUpdate);
      workPackage.status = "completed";
      workPackage.completed_at = now;
      workPackage.completed_by_attempt_id = attemptId;
      task.status = "completed";
      task.completed_at = now;
      task.closed_by_attempt_id = attemptId;
      return { task, work_package: workPackage, truth_update: truthUpdate };
    });
  }

  #require(collection, id, code) {
    const value = typeof id === "string" ? collection[id] : undefined;
    if (!value) throw Object.assign(new Error(`${code}: ${id ?? "missing"}`), { code });
    return value;
  }

  #mutate(change) {
    const operation = this.queue.then(async () => {
      const next = copy(this.state);
      const result = change(next);
      await WorkStateStore.#write(this.filePath, next);
      this.state = next;
      return copy(result);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  static async #write(filePath, state) {
    const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, filePath);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
