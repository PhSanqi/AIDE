import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { contextBudgetForTarget } from "./context-budget.js";

const MAX_FILES = 5_000;
const MAX_FILE_BYTES = 256 * 1024;
const DEFAULT_RESULT_LIMIT = 20;
const MAX_READ_LINES = 200;
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".cache"]);
const TEXT_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".cs", ".go", ".h", ".hh", ".hpp", ".java", ".js", ".json", ".jsx",
  ".kt", ".kts", ".md", ".mjs", ".py", ".rb", ".rs", ".sh", ".swift", ".toml", ".ts", ".tsx", ".yaml", ".yml",
]);

const SYMBOL_PATTERNS = [
  { kind: "class", re: /^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)\b/ },
  { kind: "function", re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/ },
  { kind: "binding", re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/ },
  { kind: "type", re: /^\s*(?:export\s+)?(?:interface|type|enum|struct|trait)\s+([A-Za-z_$][\w$]*)\b/ },
  { kind: "function", re: /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\b/ },
  { kind: "class", re: /^\s*class\s+([A-Za-z_][\w]*)\b/ },
  { kind: "function", re: /^\s*(?:pub\s+)?fn\s+([A-Za-z_][\w]*)\b/ },
  { kind: "function", re: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\b/ },
];

function boundedLimit(value, fallback = DEFAULT_RESULT_LIMIT) {
  return Number.isInteger(value) && value > 0 ? Math.min(value, 100) : fallback;
}

function contained(root, candidate) {
  if (typeof candidate !== "string" || candidate.length === 0 || isAbsolute(candidate)) throw new TypeError("Context path must be a non-empty relative path.");
  const full = resolve(root, candidate);
  const rel = relative(root, full);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw Object.assign(new Error("Context path escapes the project root."), { code: "CONTEXT_PATH_OUTSIDE_PROJECT" });
  return { full, path: rel.split(sep).join("/") };
}

function wordRegex(name) {
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
}

function extractSymbols(path, lines) {
  const symbols = [];
  lines.forEach((text, index) => {
    for (const { kind, re } of SYMBOL_PATTERNS) {
      const match = text.match(re);
      if (match) {
        symbols.push({ name: match[1], kind, path, line: index + 1, text: text.trim() });
        break;
      }
    }
  });
  return symbols;
}

export class LocalContextFabric {
  constructor({ root, realRoot, store, projectRoot = root }) {
    this.root = root;
    this.realRoot = realRoot;
    this.projectRoot = projectRoot;
    this.store = store;
    this.stateFile = typeof store.filePath === "string" ? resolve(store.filePath) : null;
    this.files = [];
    this.symbolIndex = new Map();
  }

  static async open({ root, store, projectRoot = root } = {}) {
    if (typeof root !== "string" || root.length === 0) throw new TypeError("Context root is required.");
    if (typeof projectRoot !== "string" || projectRoot.length === 0) throw new TypeError("Context projectRoot is required.");
    if (!store || typeof store.getCurrentTruth !== "function") throw new TypeError("Context store must expose Work State reads.");
    const resolved = resolve(root);
    const resolvedProject = resolve(projectRoot);
    const realRoot = await realpath(resolved);
    const fabric = new LocalContextFabric({ root: resolved, realRoot, store, projectRoot: resolvedProject });
    await fabric.refresh();
    return fabric;
  }

  async forWorkspace(workspaceRef) {
    if (!workspaceRef || typeof workspaceRef !== "object" || Array.isArray(workspaceRef)) throw new TypeError("WorkspaceRef is required.");
    if (typeof workspaceRef.path !== "string" || workspaceRef.path.length === 0) throw new TypeError("WorkspaceRef path is required.");
    if (typeof workspaceRef.project_root !== "string" || workspaceRef.project_root.length === 0) throw new TypeError("WorkspaceRef project_root is required.");
    const workspaceRoot = resolve(workspaceRef.path);
    const projectRoot = resolve(workspaceRef.project_root);
    if (projectRoot !== this.projectRoot) {
      throw Object.assign(new Error("WorkspaceRef belongs to a different project."), { code: "CONTEXT_WORKSPACE_PROJECT_MISMATCH" });
    }
    if (workspaceRoot === this.root) return this;
    return LocalContextFabric.open({ root: workspaceRoot, store: this.store, projectRoot: this.projectRoot });
  }

  async refresh() {
    const files = [];
    const walk = async (directory) => {
      if (files.length >= MAX_FILES) return;
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (files.length >= MAX_FILES) break;
        if (entry.isSymbolicLink()) continue;
        const full = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(full);
          continue;
        }
        if (!entry.isFile() || !TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
        if (this.stateFile === full) continue;
        const info = await lstat(full);
        if (info.size > MAX_FILE_BYTES) continue;
        const text = await readFile(full, "utf8");
        const path = relative(this.root, full).split(sep).join("/");
        files.push({ path, size: info.size, lines: text.split(/\r?\n/) });
      }
    };
    await walk(this.root);
    this.files = files;
    this.symbolIndex = new Map();
    for (const file of files) {
      for (const symbol of extractSymbols(file.path, file.lines)) {
        const bucket = this.symbolIndex.get(symbol.name) ?? [];
        bucket.push(symbol);
        this.symbolIndex.set(symbol.name, bucket);
      }
    }
    return { root: this.root, files: files.length, symbols: [...this.symbolIndex.values()].reduce((sum, values) => sum + values.length, 0) };
  }

  symbol(name, { limit } = {}) {
    if (typeof name !== "string" || name.length === 0) throw new TypeError("Symbol name is required.");
    return (this.symbolIndex.get(name) ?? []).slice(0, boundedLimit(limit));
  }

  references(name, { limit } = {}) {
    if (typeof name !== "string" || name.length === 0) throw new TypeError("Symbol name is required.");
    const matcher = wordRegex(name);
    const definitions = new Set(this.symbol(name, { limit: 100 }).map(({ path, line }) => `${path}:${line}`));
    const matches = [];
    const max = boundedLimit(limit);
    for (const file of this.files) {
      for (let index = 0; index < file.lines.length && matches.length < max; index += 1) {
        if (matcher.test(file.lines[index]) && !definitions.has(`${file.path}:${index + 1}`)) {
          matches.push({ path: file.path, line: index + 1, text: file.lines[index].trim() });
        }
        matcher.lastIndex = 0;
      }
      if (matches.length >= max) break;
    }
    return matches;
  }

  search(query, { limit } = {}) {
    if (typeof query !== "string" || query.trim().length === 0) throw new TypeError("Search query is required.");
    const needle = query.trim().toLowerCase();
    const matches = [];
    const max = boundedLimit(limit);
    for (const file of this.files) {
      if (file.path.toLowerCase().includes(needle)) matches.push({ path: file.path, line: null, text: null, match: "path" });
      for (let index = 0; index < file.lines.length && matches.length < max; index += 1) {
        if (file.lines[index].toLowerCase().includes(needle)) matches.push({ path: file.path, line: index + 1, text: file.lines[index].trim(), match: "text" });
      }
      if (matches.length >= max) break;
    }
    return matches.slice(0, max);
  }

  async read(path, { startLine = 1, maxLines = 120 } = {}) {
    const target = contained(this.root, path);
    const info = await lstat(target.full);
    if (!info.isFile() || info.isSymbolicLink()) throw Object.assign(new Error("Context target is not a regular file."), { code: "CONTEXT_NOT_REGULAR_FILE" });
    const realTarget = await realpath(target.full);
    const realRelative = relative(this.realRoot, realTarget);
    if (realRelative === ".." || realRelative.startsWith(`..${sep}`) || isAbsolute(realRelative)) throw Object.assign(new Error("Context target resolves outside the project root."), { code: "CONTEXT_PATH_OUTSIDE_PROJECT" });
    if (info.size > MAX_FILE_BYTES) throw Object.assign(new Error("Context file is too large."), { code: "CONTEXT_FILE_TOO_LARGE" });
    const lines = (await readFile(target.full, "utf8")).split(/\r?\n/);
    const start = Math.max(1, Number.isInteger(startLine) ? startLine : 1);
    const count = Math.min(MAX_READ_LINES, Number.isInteger(maxLines) && maxLines > 0 ? maxLines : 120);
    return { path: target.path, start_line: start, end_line: Math.min(lines.length, start + count - 1), text: lines.slice(start - 1, start - 1 + count).join("\n") };
  }

  async query(operation, args = {}) {
    if (typeof operation !== "string" || operation.length === 0) throw new TypeError("Context operation is required.");
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new TypeError("Context query arguments must be an object.");
    if (operation === "current_truth") return this.#currentTruth(boundedLimit(args.limit, 20));
    if (operation === "evidence") {
      if (typeof args.taskId !== "string" || args.taskId.length === 0) throw new TypeError("evidence taskId is required.");
      return this.#continuity(args.taskId, null, boundedLimit(args.limit, 8)).prior_attempts;
    }
    await this.refresh();
    if (operation === "search") return this.search(args.query, { limit: args.limit });
    if (operation === "symbol") return this.symbol(args.name, { limit: args.limit });
    if (operation === "references") return this.references(args.name, { limit: args.limit });
    if (operation === "read") return this.read(args.path, { startLine: args.startLine, maxLines: args.maxLines });
    throw Object.assign(new Error(`Unsupported Context operation: ${operation}`), { code: "CONTEXT_OPERATION_UNSUPPORTED" });
  }

  #workContext(taskId, workPackageId) {
    const task = this.store.getTask(taskId);
    const workPackage = this.store.getWorkPackage(workPackageId);
    if (workPackage.task_id !== task.task_id) throw Object.assign(new Error("WorkPackage does not belong to Task."), { code: "CONTEXT_WORK_STATE_LINK_INVALID" });
    return { task, workPackage };
  }

  #relevant(query, limit) {
    const identifiers = typeof query === "string"
      ? [...new Set(query.match(/[A-Za-z_$][\w$]{2,}/g) ?? [])].filter((name) => this.symbolIndex.has(name)).slice(0, 4)
      : [];
    return identifiers.length > 0
      ? identifiers.flatMap((name) => [
          ...this.symbol(name, { limit: 4 }).map((match) => ({ ...match, match: "symbol" })),
          ...this.references(name, { limit: 4 }).map((match) => ({ ...match, match: "reference", name })),
        ]).slice(0, limit)
      : typeof query === "string" && query.trim().length > 0
        ? this.search(query, { limit })
        : [];
  }

  #continuity(taskId, currentWorkPackageId, attemptLimit = 8) {
    const view = this.store.getTaskView(taskId);
    const terminalAttempts = view.attempts
      .filter((attempt) => ["completed", "failed", "cancelled"].includes(attempt.status))
      .slice(-attemptLimit)
      .map((attempt) => ({
        attempt_id: attempt.attempt_id,
        work_package_id: attempt.work_package_id,
        status: attempt.status,
        target_id: attempt.assignment?.id ?? null,
        harness: attempt.assignment?.harness ?? null,
        role: attempt.assignment?.role ?? null,
        requested_model: attempt.native_model_state?.requested_model ?? attempt.assignment?.model ?? null,
        effective_model: attempt.native_model_state?.current_model ?? attempt.assignment?.model ?? null,
        reasoning_effort: attempt.assignment?.reasoning_effort ?? null,
        decision_reason: attempt.routing_trace?.actual?.decision_reason ?? attempt.assignment?.decision_reason ?? null,
        accepted: typeof attempt.acceptance?.accepted === "boolean" ? attempt.acceptance.accepted : null,
        side_effects: attempt.side_effects ?? "unknown",
        error_code: attempt.outcome?.error_code ?? null,
        final_text_excerpt: attempt.assignment?.role !== "planning" && typeof attempt.outcome?.final_text === "string"
          ? attempt.outcome.final_text.slice(0, 400)
          : null,
        evidence_refs: Array.isArray(attempt.evidence?.files)
          ? attempt.evidence.files.slice(0, 12).map((file) => ({ path: file.path, size: file.size ?? null, sha256: file.sha256 ?? null }))
          : [],
        context_health: attempt.context_health ?? null,
      }));
    const priorWorkPackages = view.work_packages
      .filter((workPackage) => workPackage.work_package_id !== currentWorkPackageId)
      .slice(-attemptLimit)
      .map((workPackage) => ({
        work_package_id: workPackage.work_package_id,
        objective: workPackage.objective,
        status: workPackage.status,
        lineage: workPackage.lineage ?? null,
        completed_by_attempt_id: workPackage.completed_by_attempt_id ?? null,
      }));
    return { prior_work_packages: priorWorkPackages, prior_attempts: terminalAttempts };
  }

  #currentTruth(limit = 20) {
    return this.store.getCurrentTruth().slice(-limit).map((truth) => {
      const task = this.store.getTask(truth.task_id);
      const attempt = this.store.getAttempt(truth.evidence_attempt_id ?? truth.attempt_id);
      return {
        ...truth,
        goal: task.objective,
        constraints: task.constraints ?? [],
        semantic_decision: task.semantic_decision ?? null,
        execution: {
          target_id: attempt.assignment?.id ?? null,
          role: attempt.assignment?.role ?? "execution",
          requested_model: attempt.native_model_state?.requested_model ?? attempt.assignment?.model ?? null,
          effective_model: attempt.native_model_state?.current_model ?? attempt.assignment?.model ?? null,
          reasoning_effort: attempt.assignment?.reasoning_effort ?? null,
        },
        verification: {
          accepted: attempt.acceptance?.accepted === true,
          semantic_review: attempt.acceptance?.semantic_review ?? null,
          step_verification: attempt.acceptance?.step_verification ?? null,
          evidence_refs: Array.isArray(attempt.evidence?.files)
            ? attempt.evidence.files.slice(0, 12).map((file) => ({ path: file.path, size: file.size ?? null, sha256: file.sha256 ?? null }))
            : [],
        },
      };
    });
  }

  buildRoutingCapsule({ taskId, workPackageId, query = "" } = {}) {
    const { task, workPackage } = this.#workContext(taskId, workPackageId);
    return {
      kind: "routing",
      task_id: task.task_id,
      goal: task.objective,
      acceptance: task.acceptance,
      constraints: task.constraints ?? [],
      semantic_decision: task.semantic_decision ?? null,
      requirements: workPackage.requirements,
      current_truth: this.#currentTruth(8),
      continuity: this.#continuity(task.task_id, workPackage.work_package_id, 4),
      relevant: this.#relevant(query, 6),
    };
  }

  buildExecutionCapsule({ taskId, workPackageId, query = "", target, workspaceRef = null } = {}) {
    const { task, workPackage } = this.#workContext(taskId, workPackageId);
    return {
      kind: "execution",
      task_id: task.task_id,
      goal: task.objective,
      acceptance: task.acceptance,
      constraints: task.constraints ?? [],
      semantic_decision: task.semantic_decision ?? null,
      work_package: { id: workPackage.work_package_id, objective: workPackage.objective, requirements: workPackage.requirements, lineage: workPackage.lineage ?? null },
      current_truth: this.#currentTruth(20),
      continuity: this.#continuity(task.task_id, workPackage.work_package_id, 8),
      relevant: this.#relevant(query, 12),
      budget: contextBudgetForTarget(target, workPackage.requirements),
      retrieval: {
        root: this.root,
        project_root: this.projectRoot,
        workspace_ref_id: workspaceRef?.workspace_ref_id ?? null,
        scope: this.root === this.projectRoot ? "project" : "workspace",
        operations: ["search", "symbol", "references", "read", "current_truth", "evidence"],
      },
    };
  }
}
