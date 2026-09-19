import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

function workspaceError(code, message) {
  return Object.assign(new Error(message), { code });
}

export class GitWorkspaceManager {
  constructor({ git = process.env.AIDE_GIT_COMMAND ?? "git", exec = execFile, worktreeRoot = null } = {}) {
    this.git = git;
    this.exec = exec;
    this.worktreeRoot = worktreeRoot;
  }

  async allocate({ projectRoot } = {}) {
    if (typeof projectRoot !== "string" || projectRoot.length === 0) throw new TypeError("projectRoot is required.");
    const project = resolve(projectRoot);
    const baseRevision = await this.#revision(project, "WORKSPACE_GIT_HEAD_REQUIRED");
    await this.#requireClean(project);
    const root = resolve(this.worktreeRoot ?? join(dirname(project), ".aide-worktrees", basename(project)));
    await mkdir(root, { recursive: true });
    const path = join(root, `attempt-${randomUUID()}`);
    try {
      await this.exec(this.git, ["-C", project, "worktree", "add", "--detach", path, baseRevision]);
    } catch (error) {
      throw workspaceError(error?.code ?? "WORKSPACE_WORKTREE_ADD_FAILED", error?.stderr?.trim() || error?.message || "Failed to create Git worktree.");
    }
    return { path, project_root: project, mode: "isolated", base_revision: baseRevision };
  }

  async land({ path, projectRoot } = {}) {
    if (typeof path !== "string" || path.length === 0) throw new TypeError("workspace path is required.");
    if (typeof projectRoot !== "string" || projectRoot.length === 0) throw new TypeError("projectRoot is required.");
    const workspace = resolve(path);
    const project = resolve(projectRoot);
    const baseRevision = await this.#revision(workspace, "WORKSPACE_GIT_HEAD_REQUIRED");
    const projectRevision = await this.#revision(project, "WORKSPACE_GIT_HEAD_REQUIRED");
    if (projectRevision !== baseRevision) throw workspaceError("WORKSPACE_BASE_DRIFT", "Project HEAD changed after the isolated workspace was allocated.");
    await this.#requireClean(project);

    // Intent-to-add makes untracked files part of `git diff HEAD` without staging their contents.
    await this.exec(this.git, ["-C", workspace, "add", "-N", "--", "."]);
    const { stdout: patch = "" } = await this.exec(this.git, ["-C", workspace, "diff", "--binary", "HEAD"], { maxBuffer: 32 * 1024 * 1024 });
    const patchBytes = Buffer.from(patch);
    const patchSha256 = createHash("sha256").update(patchBytes).digest("hex");

    if (patchBytes.length > 0) {
      const patchDirectory = await mkdtemp(join(tmpdir(), "aide-land-"));
      const patchPath = join(patchDirectory, "change.patch");
      let applied = false;
      try {
        await writeFile(patchPath, patchBytes);
        await this.exec(this.git, ["-C", project, "apply", "--check", patchPath]);
        await this.exec(this.git, ["-C", project, "apply", patchPath]);
        applied = true;
        await this.exec(this.git, ["-C", project, "add", "-N", "--", "."]);
        const { stdout: landedPatch = "" } = await this.exec(this.git, ["-C", project, "diff", "--binary", "HEAD"], { maxBuffer: 32 * 1024 * 1024 });
        await this.exec(this.git, ["-C", project, "reset", "--mixed", "HEAD"]);
        if (createHash("sha256").update(landedPatch).digest("hex") !== patchSha256) {
          throw workspaceError("WORKSPACE_LANDING_VERIFY_FAILED", "Landed project diff does not match the isolated workspace diff.");
        }
      } catch (error) {
        if (applied) {
          try {
            await this.exec(this.git, ["-C", project, "reset", "--mixed", "HEAD"]);
            await this.exec(this.git, ["-C", project, "apply", "-R", patchPath]);
          } catch (rollbackError) {
            throw workspaceError("WORKSPACE_LANDING_ROLLBACK_FAILED", `${error?.message ?? "Landing verification failed."} Rollback failed: ${rollbackError?.stderr?.trim() || rollbackError?.message || "unknown rollback error"}`);
          }
        }
        throw workspaceError(error?.code ?? "WORKSPACE_LANDING_FAILED", error?.stderr?.trim() || error?.message || "Failed to land isolated workspace changes.");
      } finally {
        await rm(patchDirectory, { recursive: true, force: true });
      }
    }

    return {
      base_revision: baseRevision,
      patch_bytes: patchBytes.length,
      patch_sha256: patchSha256,
    };
  }

  async discard({ path, projectRoot } = {}) {
    if (typeof path !== "string" || path.length === 0) throw new TypeError("workspace path is required.");
    if (typeof projectRoot !== "string" || projectRoot.length === 0) throw new TypeError("projectRoot is required.");
    await this.exec(this.git, ["-C", resolve(projectRoot), "worktree", "remove", "--force", resolve(path)]);
  }

  async #revision(root, code) {
    try {
      const { stdout = "" } = await this.exec(this.git, ["-C", root, "rev-parse", "HEAD"]);
      const revision = stdout.trim();
      if (!revision) throw new Error("Empty HEAD.");
      return revision;
    } catch (error) {
      throw workspaceError(code, error?.stderr?.trim() || error?.message || "Git HEAD is required.");
    }
  }

  async #requireClean(project) {
    const { stdout = "" } = await this.exec(this.git, ["-C", project, "status", "--porcelain=v1", "--untracked-files=all"]);
    if (stdout.trim()) throw workspaceError("WORKSPACE_PROJECT_DIRTY", "Isolated workspace allocation/landing requires a clean project workspace.");
  }
}
